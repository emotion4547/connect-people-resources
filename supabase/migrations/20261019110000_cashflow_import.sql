-- Этап 3, шаг 22: импорт выписки по всем операциям с правилами разнесения по статьям и отчёт ДДС.
-- ТЗ: раздел 16 (Ф-3, Ф-4, Ф-8).
--
-- Выписка банка загружается целиком: каждая строка либо совпадает с уже учтённой операцией (оплата заказчика, проведённая выплата) и
-- просто подтверждает её, либо становится новой операцией. Статью новой операции подбирают правила (по ИНН контрагента и словам в
-- назначении платежа); что не подобралось, остаётся в очереди бухгалтера, а выбранную им статью можно запомнить как новое правило.

-- ============================================================
-- 1. Поля операций и правила
-- ============================================================
ALTER TABLE public.cashflow_entries
  ADD COLUMN counterparty_inn text,
  ADD COLUMN purpose text,
  ADD COLUMN statement_key text;

-- Одна и та же строка выписки второй раз не загружается.
CREATE UNIQUE INDEX cashflow_entries_statement_key ON public.cashflow_entries (account_id, statement_key) WHERE statement_key IS NOT NULL;

CREATE TABLE public.cashflow_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 100,
  direction text CHECK (direction IN ('in', 'out')),
  match_inn text,
  -- Достаточно любого из слов в назначении платежа (без учёта регистра).
  match_words text[],
  category_id uuid NOT NULL,
  note text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, category_id) REFERENCES public.cashflow_categories (org_id, id) ON DELETE CASCADE,
  CONSTRAINT cashflow_rules_has_condition CHECK (match_inn IS NOT NULL OR coalesce(cardinality(match_words), 0) > 0)
);

CREATE INDEX cashflow_rules_org_idx ON public.cashflow_rules (org_id, priority) WHERE is_active;
CREATE TRIGGER audit_cashflow_rules AFTER INSERT OR UPDATE ON public.cashflow_rules
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('priority', 'direction', 'match_inn', 'match_words', 'category_id', 'is_active');

-- Статья по правилам: берётся первое подходящее по приоритету. Правило направления и условия по ИНН и словам складываются через «и»:
-- если задан ИНН, он должен совпасть; если заданы слова, нужно хотя бы одно.
CREATE OR REPLACE FUNCTION private.match_cashflow_rule(_org_id uuid, _direction text, _inn text, _purpose text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT r.category_id FROM public.cashflow_rules r
  WHERE r.org_id = _org_id AND r.is_active AND (r.direction IS NULL OR r.direction = _direction)
    AND (r.match_inn IS NULL OR r.match_inn = _inn)
    AND (coalesce(cardinality(r.match_words), 0) = 0
         OR EXISTS (SELECT 1 FROM unnest(r.match_words) w WHERE position(lower(w) IN lower(coalesce(_purpose, ''))) > 0))
  ORDER BY r.priority, r.created_at LIMIT 1
$$;

-- ============================================================
-- 2. Совпадение с уже учтённой операцией
-- ============================================================
-- Оплата заказчика и выплата уже стали операциями сами. Строка выписки подтверждает такую операцию (получает ключ строки),
-- а не создаёт вторую. Поиск: тот же счёт, направление, сумма, дата в пределах окна, и пока без ключа выписки.
CREATE OR REPLACE FUNCTION private.adopt_statement_row(_org_id uuid, _account_id uuid, _direction text, _amount numeric, _date date, _window integer, _key text, _basis_types text[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  eid uuid;
  acc_kind text;
BEGIN
  SELECT kind INTO acc_kind FROM public.cash_accounts WHERE id = _account_id;
  -- Автоматические операции живут на расчётном счёте (или счёте платформы), выписка банка подтверждает операции расчётного счёта.
  SELECT e.id INTO eid FROM public.cashflow_entries e
  WHERE e.org_id = _org_id AND e.account_id = _account_id AND e.direction = _direction AND e.amount = _amount AND e.statement_key IS NULL
    AND e.source = 'auto' AND e.basis_type = ANY (_basis_types) AND abs(e.entry_date - _date) <= _window
  ORDER BY abs(e.entry_date - _date), e.created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF eid IS NULL THEN RETURN NULL; END IF;
  UPDATE public.cashflow_entries SET statement_key = _key WHERE id = eid;
  RETURN eid;
END;
$$;

-- Оплата, внесённая после загрузки выписки, подтверждает уже созданную операцию выписки, а не дублирует её.
CREATE OR REPLACE FUNCTION private.cashflow_on_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  adopt uuid;
BEGIN
  SELECT e.id INTO adopt FROM public.cashflow_entries e
  WHERE e.org_id = NEW.org_id AND e.direction = 'in' AND e.amount = NEW.amount AND e.source = 'statement' AND e.basis_id IS NULL
    AND abs(e.entry_date - NEW.payment_date) <= 1 AND (NEW.payer_inn IS NULL OR e.counterparty_inn IS NULL OR e.counterparty_inn = NEW.payer_inn)
  ORDER BY e.created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF adopt IS NOT NULL THEN
    UPDATE public.cashflow_entries SET basis_type = 'client_payment', basis_id = NEW.id, client_id = NEW.client_id,
           category_id = private.category_by_code(NEW.org_id, 'client_payment'), source = 'auto' WHERE id = adopt;
    RETURN NEW;
  END IF;
  INSERT INTO public.cashflow_entries (org_id, account_id, entry_date, direction, amount, category_id, client_id, counterparty, counterparty_inn, source, basis_type, basis_id, comment)
  VALUES (NEW.org_id, private.default_account(NEW.org_id, 'bank'), NEW.payment_date, 'in', NEW.amount, private.category_by_code(NEW.org_id, 'client_payment'),
          NEW.client_id, NEW.payer_name, NEW.payer_inn, 'auto', 'client_payment', NEW.id, NEW.purpose)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 3. Загрузка выписки по всем операциям
-- ============================================================
CREATE OR REPLACE FUNCTION public.import_cashflow_statement(_org_id uuid, _account_id uuid, _filename text, _rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  r jsonb;
  key text;
  dir text;
  amt numeric;
  dt date;
  inn text;
  purpose text;
  cat uuid;
  eid uuid;
  total integer := 0;
  fresh integer := 0;
  dup integer := 0;
  confirmed integer := 0;
  sorted integer := 0;
  queue integer := 0;
  u uuid;
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'cashflow', 'create') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cash_accounts WHERE id = _account_id AND org_id = _org_id AND is_active) THEN
    RAISE EXCEPTION 'Счёт не найден' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(_rows) <> 'array' THEN RAISE EXCEPTION 'Нет операций для загрузки' USING ERRCODE = '22023'; END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    total := total + 1;
    dir := r->>'direction';
    amt := (r->>'amount')::numeric;
    dt := (r->>'date')::date;
    inn := nullif(r->>'counterparty_inn', '');
    purpose := nullif(r->>'purpose', '');
    IF dir NOT IN ('in', 'out') OR amt IS NULL OR amt <= 0 OR dt IS NULL THEN CONTINUE; END IF;
    key := md5(concat_ws('|', dt::text, dir, amt::text, coalesce(r->>'number', ''), coalesce(inn, ''), coalesce(left(purpose, 40), '')));

    IF EXISTS (SELECT 1 FROM public.cashflow_entries WHERE account_id = _account_id AND statement_key = key) THEN dup := dup + 1; CONTINUE; END IF;

    -- Строка подтверждает оплату заказчика или проведённую выплату, уже учтённые сами
    eid := private.adopt_statement_row(_org_id, _account_id, dir, amt, dt, CASE dir WHEN 'in' THEN 1 ELSE 5 END, key,
                                       CASE dir WHEN 'in' THEN ARRAY['client_payment'] ELSE ARRAY['payout_line'] END);
    IF eid IS NOT NULL THEN confirmed := confirmed + 1; CONTINUE; END IF;

    cat := private.match_cashflow_rule(_org_id, dir, inn, purpose);
    INSERT INTO public.cashflow_entries (org_id, account_id, entry_date, direction, amount, category_id, counterparty, counterparty_inn, purpose, source, statement_key, comment)
    VALUES (_org_id, _account_id, dt, dir, amt, cat, nullif(r->>'counterparty_name', ''), inn, purpose, 'statement', key, purpose);
    fresh := fresh + 1;
    IF cat IS NULL THEN queue := queue + 1; ELSE sorted := sorted + 1; END IF;
  END LOOP;

  IF queue > 0 THEN
    FOR u IN SELECT DISTINCT user_id FROM public.user_roles WHERE org_id = _org_id AND role = 'accountant' LOOP
      PERFORM private.notify(_org_id, u, 'payment_unmatched', 'Есть неразнесённые операции выписки: ' || queue, coalesce(_filename, ''), '/cash', 'cfq:' || md5(coalesce(_filename, '') || now()::text));
    END LOOP;
  END IF;
  RETURN jsonb_build_object('total', total, 'new', fresh, 'duplicates', dup, 'confirmed', confirmed, 'sorted', sorted, 'queue', queue);
END;
$$;

-- ============================================================
-- 4. Правила и очередь
-- ============================================================
-- Разнести неразнесённые операции по правилам (после добавления нового правила).
CREATE OR REPLACE FUNCTION public.apply_cashflow_rules(_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  n integer;
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'cashflow', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  UPDATE public.cashflow_entries e SET category_id = x.cat
    FROM (SELECT id, private.match_cashflow_rule(org_id, direction, counterparty_inn, purpose) AS cat FROM public.cashflow_entries
          WHERE org_id = _org_id AND category_id IS NULL AND source = 'statement') x
   WHERE e.id = x.id AND x.cat IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Правило из выбранной статьи: по ИНН контрагента, а если его нет — по самому длинному слову назначения.
CREATE OR REPLACE FUNCTION public.rule_from_entry(_entry_id uuid, _category_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  e public.cashflow_entries;
  w text;
BEGIN
  SELECT * INTO e FROM public.cashflow_entries WHERE id = _entry_id;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), e.org_id, 'cashflow', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cashflow_categories WHERE id = _category_id AND org_id = e.org_id AND NOT is_transfer AND direction IN (e.direction, 'both')) THEN
    RAISE EXCEPTION 'Статья не подходит к этой операции' USING ERRCODE = '22023';
  END IF;
  IF e.counterparty_inn IS NOT NULL THEN
    INSERT INTO public.cashflow_rules (org_id, direction, match_inn, category_id, note) VALUES (e.org_id, e.direction, e.counterparty_inn, _category_id, 'Из операции ' || e.entry_date);
  ELSE
    SELECT word INTO w FROM (SELECT regexp_split_to_table(lower(coalesce(e.purpose, e.comment, '')), '[^[:alnum:]а-яё]+') AS word) s
     WHERE length(word) >= 5 ORDER BY length(word) DESC LIMIT 1;
    IF w IS NULL THEN RAISE EXCEPTION 'В операции нет ни ИНН, ни слов для правила' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.cashflow_rules (org_id, direction, match_words, category_id, note) VALUES (e.org_id, e.direction, ARRAY[w], _category_id, 'Из операции ' || e.entry_date);
  END IF;
  UPDATE public.cashflow_entries SET category_id = _category_id WHERE id = _entry_id;
  RETURN public.apply_cashflow_rules(e.org_id);
END;
$$;

-- ============================================================
-- 5. Отчёт ДДС
-- ============================================================
-- Статьи × месяцы: приход и расход. Перемещения между счетами в отчёт не входят. Можно взять несколько организаций сразу
-- (суммарный отчёт): статьи сводятся по коду, а пользовательские — по названию.
CREATE OR REPLACE FUNCTION public.cashflow_report(_org_ids uuid[], _from date, _to date, _account_kind text DEFAULT NULL)
RETURNS TABLE (month date, article text, article_name text, direction text, bdr_article text, amount_in numeric, amount_out numeric, entries integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  allowed uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  SELECT array_agg(o) INTO allowed FROM unnest(_org_ids) o WHERE private.permission_scope(auth.uid(), o, 'cashflow', 'view') = 'all';
  IF allowed IS NULL THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT date_trunc('month', e.entry_date)::date,
         coalesce(c.code, c.name, 'unsorted'), coalesce(c.name, 'Не разнесено'), min(e.direction), min(c.bdr_article),
         coalesce(sum(e.amount) FILTER (WHERE e.direction = 'in'), 0), coalesce(sum(e.amount) FILTER (WHERE e.direction = 'out'), 0), count(*)::integer
  FROM public.cashflow_entries e
  JOIN public.cash_accounts a ON a.id = e.account_id
  LEFT JOIN public.cashflow_categories c ON c.id = e.category_id
  WHERE e.org_id = ANY (allowed) AND e.entry_date BETWEEN _from AND _to AND e.transfer_group IS NULL AND (c.is_transfer IS NOT TRUE)
    AND (_account_kind IS NULL OR a.kind = _account_kind)
  GROUP BY 1, 2, 3
  ORDER BY 1, min(c.sort_order), 3;
END;
$$;

-- Остатки по нескольким организациям на дату (для суммарного отчёта)
CREATE OR REPLACE FUNCTION public.cash_total_balance(_org_ids uuid[], _date date)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  total numeric := 0;
  o uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  FOREACH o IN ARRAY _org_ids LOOP
    IF private.permission_scope(auth.uid(), o, 'cashflow', 'view') = 'all' THEN
      total := total + coalesce((SELECT sum(balance) FROM public.cash_balances(o, _date)), 0);
    END IF;
  END LOOP;
  RETURN total;
END;
$$;

-- Теперь смена статьи может запомниться правилом: старая версия функции заменяется.
DROP FUNCTION IF EXISTS public.set_entry_category(uuid, uuid);
CREATE OR REPLACE FUNCTION public.set_entry_category(_entry_id uuid, _category_id uuid, _make_rule boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  e public.cashflow_entries;
  c public.cashflow_categories;
BEGIN
  SELECT * INTO e FROM public.cashflow_entries WHERE id = _entry_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), e.org_id, 'cashflow', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF e.transfer_group IS NOT NULL THEN RAISE EXCEPTION 'Статью перемещения менять нельзя' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM public.cashflow_categories WHERE id = _category_id AND org_id = e.org_id AND is_active;
  IF NOT FOUND OR c.is_transfer OR c.direction NOT IN (e.direction, 'both') THEN
    RAISE EXCEPTION 'Статья не подходит к этой операции' USING ERRCODE = '22023';
  END IF;
  UPDATE public.cashflow_entries SET category_id = _category_id WHERE id = _entry_id;
  IF _make_rule THEN PERFORM public.rule_from_entry(_entry_id, _category_id); END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.import_cashflow_statement(uuid, uuid, text, jsonb), public.apply_cashflow_rules(uuid), public.rule_from_entry(uuid, uuid),
  public.cashflow_report(uuid[], date, date, text), public.cash_total_balance(uuid[], date), public.set_entry_category(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_cashflow_statement(uuid, uuid, text, jsonb), public.apply_cashflow_rules(uuid), public.rule_from_entry(uuid, uuid),
  public.cashflow_report(uuid[], date, date, text), public.cash_total_balance(uuid[], date), public.set_entry_category(uuid, uuid, boolean) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.match_cashflow_rule(uuid, text, text, text), private.adopt_statement_row(uuid, uuid, text, numeric, date, integer, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.match_cashflow_rule(uuid, text, text, text), private.adopt_statement_row(uuid, uuid, text, numeric, date, integer, text, text[]) TO service_role;

-- ============================================================
-- 6. Доступ
-- ============================================================
ALTER TABLE public.cashflow_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cashflow_rules FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashflow_rules TO authenticated;
GRANT ALL ON public.cashflow_rules TO service_role;
CREATE POLICY "Rules: view" ON public.cashflow_rules FOR SELECT TO authenticated USING (private.permission_scope(auth.uid(), org_id, 'cashflow', 'view') = 'all');
CREATE POLICY "Rules: add" ON public.cashflow_rules FOR INSERT TO authenticated WITH CHECK (private.permission_scope(auth.uid(), org_id, 'cashflow', 'create') = 'all');
CREATE POLICY "Rules: edit" ON public.cashflow_rules FOR UPDATE TO authenticated
  USING (private.permission_scope(auth.uid(), org_id, 'cashflow', 'update') = 'all') WITH CHECK (private.permission_scope(auth.uid(), org_id, 'cashflow', 'update') = 'all');
CREATE POLICY "Rules: delete" ON public.cashflow_rules FOR DELETE TO authenticated USING (private.permission_scope(auth.uid(), org_id, 'cashflow', 'delete') = 'all');
