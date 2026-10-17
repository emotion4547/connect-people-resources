-- Этап 2, шаг 14: акты, УПД и счета заказчикам.
-- ТЗ: раздел 14 (Б-1…Б-5), раздел 5 (сущности «Документ заказчику», «Строка документа»).
--
-- Акт (или УПД — по карточке организации) и счёт собираются из подтверждённых начислений заказчика за период
-- выставления по договору. Каждое начисление входит ровно в один документ; сумма документа равна сумме начислений
-- до копейки. Выставленный документ не правится: только аннулирование с причиной до подписания.

-- ============================================================
-- 1. Реквизиты и условия
-- ============================================================
-- Форма закрывающего документа выбирается в карточке организации: акт или УПД. Счёт выставляется всегда.
ALTER TABLE public.organizations ADD COLUMN document_form text NOT NULL DEFAULT 'act' CHECK (document_form IN ('act', 'upd'));
-- Простая электронная подпись («Принято» в кабинете) допустима, только если это записано в договоре.
ALTER TABLE public.contracts ADD COLUMN allows_simple_esign boolean NOT NULL DEFAULT false;

INSERT INTO public.notification_events (code, title, channels, delivery, critical, audience) VALUES
  ('document_issued',      'Вам выставлен документ',            ARRAY['email'], 'all', false, 'заказчик'),
  ('document_draft_ready', 'Готов черновик акта и счёта',       ARRAY[]::text[], 'all', false, 'бухгалтер');

-- ============================================================
-- 2. Нумерация без пропусков
-- ============================================================
-- Свой счётчик на организацию, вид документа и год. Номер выдаётся при выставлении в той же транзакции, что и сам
-- документ: откат отменяет и выданный номер, поэтому пропусков не бывает. Аннулированный документ номер сохраняет.
CREATE TABLE public.document_counters (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  year integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, kind, year)
);

CREATE OR REPLACE FUNCTION private.next_document_number(_org_id uuid, _kind text, _year integer)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, private
AS $$
  INSERT INTO public.document_counters (org_id, kind, year, last_number) VALUES (_org_id, _kind, _year, 1)
  ON CONFLICT (org_id, kind, year) DO UPDATE SET last_number = public.document_counters.last_number + 1
  RETURNING last_number
$$;

-- ============================================================
-- 3. Документы
-- ============================================================
CREATE TABLE public.client_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('invoice', 'act', 'upd', 'reconciliation')),
  client_id uuid NOT NULL,
  contract_id uuid REFERENCES public.contracts(id) ON DELETE RESTRICT,
  -- Счёт ссылается на акт (УПД), с которым выставляется.
  parent_document_id uuid REFERENCES public.client_documents(id) ON DELETE RESTRICT,
  number text,
  number_seq integer,
  issue_date date,
  period_from date NOT NULL,
  period_to date NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'signed', 'paid_partial', 'paid', 'cancelled')),
  amount_net numeric(14,2) NOT NULL DEFAULT 0,
  vat_rate numeric(4,2) NOT NULL DEFAULT 0,
  vat_amount numeric(14,2) NOT NULL DEFAULT 0,
  amount_total numeric(14,2) NOT NULL DEFAULT 0,
  -- В периоде остались неподтверждённые или оспоренные табели: бухгалтер увидит это до выставления.
  has_open_timesheets boolean NOT NULL DEFAULT false,
  file_path text,
  sent_at timestamptz,
  signed_at timestamptz,
  signed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sign_method text CHECK (sign_method IN ('scan', 'simple_esign')),
  sign_file_path text,
  cancel_reason text,
  cancelled_at timestamptz,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, client_id) REFERENCES public.clients (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT client_documents_period CHECK (period_to >= period_from),
  CONSTRAINT client_documents_number_when_issued CHECK (status = 'draft' OR number IS NOT NULL OR kind = 'reconciliation'),
  CONSTRAINT client_documents_cancel_reason CHECK (status <> 'cancelled' OR length(btrim(coalesce(cancel_reason, ''))) > 0)
);

-- Номер уникален в пределах организации, вида и года.
CREATE UNIQUE INDEX client_documents_number_key ON public.client_documents (org_id, kind, (extract(year FROM issue_date)::integer), number_seq)
  WHERE number_seq IS NOT NULL;
CREATE INDEX client_documents_client_idx ON public.client_documents (client_id, status);
CREATE INDEX client_documents_org_status_idx ON public.client_documents (org_id, status, due_date);

CREATE TRIGGER update_client_documents_updated_at
  BEFORE UPDATE ON public.client_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_client_documents
  AFTER INSERT OR UPDATE OR DELETE ON public.client_documents
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('kind', 'number', 'client_id', 'status', 'amount_total', 'period_from', 'period_to');

CREATE TABLE public.client_document_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.client_documents(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  -- Работа за период, доначисление за прошлый период, корректировка, оплата поздней отмены.
  line_kind text NOT NULL CHECK (line_kind IN ('work', 'late', 'correction', 'penalty')),
  -- Названия копируются в строку: выставленный документ не меняется, даже если объект переименуют.
  site_name text,
  position_name text,
  unit text,
  quantity numeric(12,2) NOT NULL,
  rate numeric(12,2) NOT NULL,
  amount numeric(14,2) NOT NULL,
  note text,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX client_document_lines_doc_idx ON public.client_document_lines (document_id, sort_order);

-- Начисление входит ровно в один документ; пока документ черновик, ссылка снимается вместе с ним.
ALTER TABLE public.accruals ADD COLUMN client_document_id uuid REFERENCES public.client_documents(id) ON DELETE SET NULL;
CREATE INDEX accruals_client_document_idx ON public.accruals (client_document_id) WHERE client_document_id IS NOT NULL;

-- Выставленный документ не правится (Б-3): после черновика меняются только статус, отправка, подпись, оплата.
CREATE OR REPLACE FUNCTION private.client_documents_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Выставленный документ нельзя удалить: его аннулируют с причиной' USING ERRCODE = '22023';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (NEW.kind, NEW.client_id, NEW.number, NEW.number_seq, NEW.issue_date, NEW.period_from, NEW.period_to,
       NEW.amount_net, NEW.vat_rate, NEW.vat_amount, NEW.amount_total, NEW.org_id, NEW.parent_document_id)
     IS DISTINCT FROM (OLD.kind, OLD.client_id, OLD.number, OLD.number_seq, OLD.issue_date, OLD.period_from, OLD.period_to,
       OLD.amount_net, OLD.vat_rate, OLD.vat_amount, OLD.amount_total, OLD.org_id, OLD.parent_document_id) THEN
    RAISE EXCEPTION 'Выставленный документ не правится: аннулируйте его и составьте заново' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER client_documents_guard
  BEFORE UPDATE OR DELETE ON public.client_documents
  FOR EACH ROW EXECUTE FUNCTION private.client_documents_guard();

CREATE OR REPLACE FUNCTION private.client_document_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  st text;
BEGIN
  SELECT status INTO st FROM public.client_documents WHERE id = coalesce(NEW.document_id, OLD.document_id);
  -- Каскадное удаление при удалении черновика допустимо; у выставленного документа строки неизменны.
  IF st IS NOT NULL AND st <> 'draft' THEN
    RAISE EXCEPTION 'Строки выставленного документа не правятся' USING ERRCODE = '22023';
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE TRIGGER client_document_lines_guard
  BEFORE UPDATE OR DELETE ON public.client_document_lines
  FOR EACH ROW EXECUTE FUNCTION private.client_document_lines_guard();

-- ============================================================
-- 4. Сборка черновика
-- ============================================================
-- Последний завершённый период выставления по договору на дату _ref.
--   неделя — с понедельника по воскресенье; месяц — календарный;
--   две недели — блоки по 14 дней, начиная с понедельника недели подписания договора.
CREATE OR REPLACE FUNCTION private.billing_period_bounds(_billing text, _signed_on date, _ref date)
RETURNS TABLE (period_from date, period_to date)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  anchor date;
  n integer;
  cur date;
BEGIN
  IF _billing = 'week' THEN
    period_to := date_trunc('week', _ref)::date - 1;
    period_from := period_to - 6;
  ELSIF _billing = 'month' THEN
    period_to := date_trunc('month', _ref)::date - 1;
    period_from := date_trunc('month', period_to)::date;
  ELSE
    anchor := date_trunc('week', _signed_on)::date;
    n := floor((_ref - anchor) / 14.0)::integer;
    cur := anchor + 14 * n;
    period_to := cur - 1;
    period_from := period_to - 13;
  END IF;
  RETURN NEXT;
END;
$$;

-- Собирает черновики закрывающего документа (акт или УПД) и счёта. Возвращает идентификатор акта (УПД) или NULL,
-- если выставлять нечего. Если по тому же периоду уже есть черновик, он пересобирается.
CREATE OR REPLACE FUNCTION private.build_client_documents(_client_id uuid, _from date, _to date, _contract_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  c public.clients;
  org public.organizations;
  k public.contracts;
  act_id uuid;
  inv_id uuid;
  act_kind text;
  net numeric(14,2);
  vat numeric(14,2);
  linked integer;
  open_ts boolean;
  old record;
BEGIN
  SELECT * INTO c FROM public.clients WHERE id = _client_id;
  SELECT * INTO org FROM public.organizations WHERE id = c.org_id;
  IF _contract_id IS NOT NULL THEN
    SELECT * INTO k FROM public.contracts WHERE id = _contract_id AND client_id = _client_id;
  ELSE
    SELECT * INTO k FROM public.contracts WHERE client_id = _client_id AND status = 'active'
     AND signed_on <= _to AND (valid_until IS NULL OR valid_until >= _from) ORDER BY signed_on DESC LIMIT 1;
  END IF;
  IF k.id IS NULL THEN
    RAISE EXCEPTION 'У заказчика нет действующего договора на этот период' USING ERRCODE = '22023';
  END IF;
  act_kind := org.document_form;

  -- Прежний черновик за период снимается вместе со ссылками на начисления.
  FOR old IN SELECT id FROM public.client_documents
             WHERE client_id = _client_id AND status = 'draft' AND kind IN ('act', 'upd', 'invoice') AND period_from = _from AND period_to = _to LOOP
    UPDATE public.accruals SET client_document_id = NULL WHERE client_document_id = old.id;
  END LOOP;
  DELETE FROM public.client_documents WHERE client_id = _client_id AND status = 'draft' AND kind = 'invoice' AND period_from = _from AND period_to = _to;
  DELETE FROM public.client_documents WHERE client_id = _client_id AND status = 'draft' AND kind IN ('act', 'upd') AND period_from = _from AND period_to = _to;

  INSERT INTO public.client_documents (org_id, kind, client_id, contract_id, period_from, period_to, vat_rate)
  VALUES (c.org_id, act_kind, _client_id, k.id, _from, _to, org.vat_rate) RETURNING id INTO act_id;

  -- В документ входят утверждённые начисления заказчика, ещё не попавшие в другой документ: за период, а также
  -- доначисления за прошлые периоды и корректировки, подтверждённые позже.
  UPDATE public.accruals SET client_document_id = act_id
   WHERE client_id = _client_id AND org_id = c.org_id AND status IN ('approved', 'in_registry', 'paid') AND client_document_id IS NULL
     AND amount_client <> 0 AND shift_date <= _to;
  GET DIAGNOSTICS linked = ROW_COUNT;
  IF linked = 0 THEN
    DELETE FROM public.client_documents WHERE id = act_id;
    RETURN NULL;
  END IF;

  INSERT INTO public.client_document_lines (document_id, org_id, line_kind, site_name, position_name, unit, quantity, rate, amount, note, sort_order)
  SELECT act_id, c.org_id, g.line_kind, g.site_name, g.position_name, g.unit, g.quantity, g.rate, g.amount, g.note,
         row_number() OVER (ORDER BY g.ord, g.site_name, g.position_name, g.note, g.rate)
  FROM (
    SELECT e.line_kind, e.ord, e.site_name, e.position_name, e.unit, sum(e.qty) AS quantity, e.rate, sum(e.amount_client) AS amount,
           CASE e.line_kind WHEN 'penalty' THEN 'Оплата поздней отмены'
                            WHEN 'late' THEN 'За ' || to_char(to_date(min(e.month_key), 'YYYY-MM'), 'MM.YYYY') || ' (подтверждено позже)' END AS note
    FROM (
      SELECT CASE WHEN x.kind = 'client_penalty' THEN 'penalty' WHEN x.shift_date < _from THEN 'late' ELSE 'work' END AS line_kind,
             CASE WHEN x.kind = 'client_penalty' THEN 3 WHEN x.shift_date < _from THEN 2 ELSE 1 END AS ord,
             si.name AS site_name, p.name AS position_name, x.unit,
             coalesce(x.billable_quantity, 1) AS qty, coalesce(x.client_rate, 0) AS rate, x.amount_client,
             CASE WHEN x.shift_date < _from THEN to_char(x.shift_date, 'YYYY-MM') END AS month_key
      FROM public.accruals x
      JOIN public.sites si ON si.id = x.site_id
      JOIN public.shifts sh ON sh.id = x.shift_id
      JOIN public.positions p ON p.id = sh.position_id
      WHERE x.client_document_id = act_id AND x.kind IN ('main', 'client_penalty')
    ) e
    GROUP BY e.line_kind, e.ord, e.site_name, e.position_name, e.unit, e.rate, e.month_key
    UNION ALL
    -- Корректировки идут отдельными строками со ссылкой на исходный период (Б-5)
    SELECT 'correction', 4, si.name, p.name, 'service', 1, x.amount_client, x.amount_client,
           'Корректировка за ' || to_char(o.shift_date, 'MM.YYYY') || coalesce(': ' || x.note, '')
    FROM public.accruals x
    JOIN public.accruals o ON o.id = x.corrects_id
    JOIN public.sites si ON si.id = x.site_id
    JOIN public.shifts sh ON sh.id = x.shift_id
    JOIN public.positions p ON p.id = sh.position_id
    WHERE x.client_document_id = act_id AND x.kind = 'correction'
  ) g;

  SELECT coalesce(sum(amount), 0) INTO net FROM public.client_document_lines WHERE document_id = act_id;
  IF net <> (SELECT coalesce(sum(amount_client), 0) FROM public.accruals WHERE client_document_id = act_id) THEN
    RAISE EXCEPTION 'Сумма документа не сошлась с начислениями' USING ERRCODE = 'XX001';
  END IF;
  vat := round(net * org.vat_rate / 100, 2);

  SELECT EXISTS (SELECT 1 FROM public.timesheets t WHERE t.client_id = _client_id AND t.period_from <= _to AND t.period_to >= _from
                 AND t.status IN ('draft', 'pending', 'disputed')) INTO open_ts;

  UPDATE public.client_documents SET amount_net = net, vat_amount = vat, amount_total = net + vat, has_open_timesheets = open_ts WHERE id = act_id;

  -- Счёт с теми же строками и суммой
  INSERT INTO public.client_documents (org_id, kind, client_id, contract_id, parent_document_id, period_from, period_to,
                                       amount_net, vat_rate, vat_amount, amount_total, has_open_timesheets)
  VALUES (c.org_id, 'invoice', _client_id, k.id, act_id, _from, _to, net, org.vat_rate, vat, net + vat, open_ts) RETURNING id INTO inv_id;
  INSERT INTO public.client_document_lines (document_id, org_id, line_kind, site_name, position_name, unit, quantity, rate, amount, note, sort_order)
  SELECT inv_id, org_id, line_kind, site_name, position_name, unit, quantity, rate, amount, note, sort_order
  FROM public.client_document_lines WHERE document_id = act_id;
  RETURN act_id;
END;
$$;

-- Бухгалтер собирает черновик вручную за любой период.
CREATE OR REPLACE FUNCTION public.generate_client_documents(_client_id uuid, _from date, _to date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  doc_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT private.client_in_scope(_client_id, 'client_documents', 'create') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF _to < _from THEN RAISE EXCEPTION 'Конец периода раньше начала' USING ERRCODE = '22023'; END IF;
  doc_id := private.build_client_documents(_client_id, _from, _to);
  IF doc_id IS NULL THEN
    RAISE EXCEPTION 'Нет подтверждённых начислений для выставления' USING ERRCODE = '22023';
  END IF;
  RETURN doc_id;
END;
$$;

-- По окончании периода выставления система сама создаёт черновики (Б-1). Вызывается раз в сутки.
CREATE OR REPLACE FUNCTION private.generate_due_documents()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  k record;
  b record;
  doc_id uuid;
  n integer := 0;
  u uuid;
  cname text;
BEGIN
  FOR k IN SELECT ct.* FROM public.contracts ct JOIN public.clients cl ON cl.id = ct.client_id
           WHERE ct.status = 'active' AND cl.status IN ('active', 'contract') LOOP
    SELECT * INTO b FROM private.billing_period_bounds(k.billing_period, k.signed_on, current_date);
    IF b.period_to < k.signed_on OR (k.valid_until IS NOT NULL AND b.period_from > k.valid_until) THEN CONTINUE; END IF;
    -- За этот период уже есть документ (черновик, выставленный или оплаченный) — ничего не делаем.
    IF EXISTS (SELECT 1 FROM public.client_documents d WHERE d.client_id = k.client_id AND d.kind IN ('act', 'upd')
               AND d.status <> 'cancelled' AND d.period_to >= b.period_to) THEN CONTINUE; END IF;
    doc_id := private.build_client_documents(k.client_id, greatest(b.period_from, k.signed_on), b.period_to, k.id);
    IF doc_id IS NOT NULL THEN
      n := n + 1;
      SELECT name INTO cname FROM public.clients WHERE id = k.client_id;
      FOR u IN SELECT DISTINCT user_id FROM public.user_roles WHERE org_id = k.org_id AND role = 'accountant' LOOP
        PERFORM private.notify(k.org_id, u, 'document_draft_ready', 'Готов черновик акта и счёта: ' || cname,
                               to_char(b.period_from, 'DD.MM') || ' — ' || to_char(b.period_to, 'DD.MM.YYYY'), '/documents/' || doc_id, 'draft:' || doc_id);
      END LOOP;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

-- ============================================================
-- 5. Выставление, отправка, подпись, аннулирование
-- ============================================================
CREATE OR REPLACE FUNCTION private.document_prefix(_kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT CASE _kind WHEN 'invoice' THEN 'СЧ' WHEN 'act' THEN 'АКТ' WHEN 'upd' THEN 'УПД' ELSE 'АС' END $$;

-- Доступ к документу по его идентификатору: _action — view/create/update по матрице прав.
CREATE OR REPLACE FUNCTION private.document_in_scope(_doc_id uuid, _action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (SELECT 1 FROM public.client_documents d WHERE d.id = _doc_id AND private.client_in_scope(d.client_id, 'client_documents', _action))
$$;

-- Идентификатор главного документа пары: для счёта — его акт (УПД), для остальных — он сам.
CREATE OR REPLACE FUNCTION private.document_root(_doc_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$ SELECT coalesce(parent_document_id, id) FROM public.client_documents WHERE id = _doc_id $$;

-- Выставляет акт (УПД) и счёт вместе: присваивает номера, срок оплаты и переводит начисления в «В акте».
CREATE OR REPLACE FUNCTION public.issue_client_documents(_doc_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  root uuid := private.document_root(_doc_id);
  a public.client_documents;
  d record;
  k public.contracts;
  seq integer;
  yr integer := extract(year FROM current_date)::integer;
BEGIN
  SELECT * INTO a FROM public.client_documents WHERE id = root FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.client_in_scope(a.client_id, 'client_documents', 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF a.status <> 'draft' OR a.kind NOT IN ('act', 'upd') THEN
    RAISE EXCEPTION 'Выставить можно только черновик акта или УПД' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO k FROM public.contracts WHERE id = a.contract_id;

  FOR d IN SELECT * FROM public.client_documents WHERE id = root OR parent_document_id = root ORDER BY (kind = 'invoice') DESC, created_at LOOP
    seq := private.next_document_number(a.org_id, d.kind, yr);
    UPDATE public.client_documents
       SET status = 'issued', issue_date = current_date, number_seq = seq, number = private.document_prefix(d.kind) || '-' || yr || '/' || seq,
           due_date = current_date + coalesce(k.payment_delay_days, 0)
     WHERE id = d.id;
  END LOOP;
  UPDATE public.accruals SET status = 'in_act' WHERE client_document_id = root AND status = 'approved';
  RETURN root;
END;
$$;

-- Отправка заказчику: документ появляется в его кабинете, письмо уходит через уведомления.
CREATE OR REPLACE FUNCTION public.send_client_document(_doc_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  root uuid := private.document_root(_doc_id);
  a public.client_documents;
  u uuid;
BEGIN
  SELECT * INTO a FROM public.client_documents WHERE id = root FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.client_in_scope(a.client_id, 'client_documents', 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF a.status NOT IN ('issued', 'signed') THEN
    RAISE EXCEPTION 'Отправить можно только выставленный документ' USING ERRCODE = '22023';
  END IF;
  UPDATE public.client_documents SET sent_at = now() WHERE id = root OR parent_document_id = root;
  FOR u IN SELECT user_id FROM public.client_contacts WHERE client_id = a.client_id AND user_id IS NOT NULL LOOP
    PERFORM private.notify(a.org_id, u, 'document_issued', 'Вам выставлены документы ' || a.number,
                           'Период ' || to_char(a.period_from, 'DD.MM') || ' — ' || to_char(a.period_to, 'DD.MM.YYYY') || ', сумма ' || a.amount_total || ' ₽',
                           '/client/documents/' || root, 'doc:' || root);
  END LOOP;
END;
$$;

-- «Принято» в кабинете — простая электронная подпись, если договор это допускает.
CREATE OR REPLACE FUNCTION public.accept_client_document(_doc_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.client_documents;
  k public.contracts;
BEGIN
  SELECT * INTO a FROM public.client_documents WHERE id = private.document_root(_doc_id) FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.is_client_contact(a.client_id) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO k FROM public.contracts WHERE id = a.contract_id;
  IF NOT coalesce(k.allows_simple_esign, false) THEN
    RAISE EXCEPTION 'Договор не допускает подписание кнопкой: передайте подписанный скан менеджеру' USING ERRCODE = '22023';
  END IF;
  IF a.status <> 'issued' OR a.sent_at IS NULL THEN
    RAISE EXCEPTION 'Этот документ принять нельзя' USING ERRCODE = '22023';
  END IF;
  UPDATE public.client_documents SET status = 'signed', signed_at = now(), signed_by = auth.uid(), sign_method = 'simple_esign'
   WHERE id = a.id OR parent_document_id = a.id;
END;
$$;

-- Подписанный скан загружает бухгалтер.
CREATE OR REPLACE FUNCTION public.register_document_signature(_doc_id uuid, _file_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.client_documents;
BEGIN
  SELECT * INTO a FROM public.client_documents WHERE id = private.document_root(_doc_id) FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.client_in_scope(a.client_id, 'client_documents', 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF a.status <> 'issued' THEN RAISE EXCEPTION 'Подписать можно только выставленный документ' USING ERRCODE = '22023'; END IF;
  IF nullif(btrim(coalesce(_file_path, '')), '') IS NULL THEN RAISE EXCEPTION 'Загрузите скан подписанного документа' USING ERRCODE = '22023'; END IF;
  UPDATE public.client_documents SET status = 'signed', signed_at = now(), signed_by = auth.uid(), sign_method = 'scan', sign_file_path = _file_path
   WHERE id = a.id OR parent_document_id = a.id;
END;
$$;

-- Аннулирование выставленной пары до подписания: начисления возвращаются в «утверждено» и попадут в новый документ.
CREATE OR REPLACE FUNCTION public.cancel_client_documents(_doc_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.client_documents;
BEGIN
  SELECT * INTO a FROM public.client_documents WHERE id = private.document_root(_doc_id) FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.client_in_scope(a.client_id, 'client_documents', 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF a.status <> 'issued' THEN
    RAISE EXCEPTION 'Аннулировать можно только выставленный и ещё не подписанный документ' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Укажите причину аннулирования' USING ERRCODE = '22023';
  END IF;
  UPDATE public.client_documents SET status = 'cancelled', cancel_reason = _reason, cancelled_at = now() WHERE id = a.id OR parent_document_id = a.id;
  UPDATE public.accruals SET status = CASE WHEN status = 'in_act' THEN 'approved' ELSE status END, client_document_id = NULL WHERE client_document_id = a.id;
END;
$$;

-- Черновик, который не нужен, можно удалить: начисления освобождаются.
CREATE OR REPLACE FUNCTION public.discard_client_document_draft(_doc_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.client_documents;
BEGIN
  SELECT * INTO a FROM public.client_documents WHERE id = private.document_root(_doc_id) FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.client_in_scope(a.client_id, 'client_documents', 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF a.status <> 'draft' THEN RAISE EXCEPTION 'Удалить можно только черновик' USING ERRCODE = '22023'; END IF;
  UPDATE public.accruals SET client_document_id = NULL WHERE client_document_id = a.id;
  DELETE FROM public.client_documents WHERE parent_document_id = a.id;
  DELETE FROM public.client_documents WHERE id = a.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_client_documents(uuid, date, date), public.issue_client_documents(uuid),
  public.send_client_document(uuid), public.accept_client_document(uuid), public.register_document_signature(uuid, text),
  public.cancel_client_documents(uuid, text), public.discard_client_document_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_client_documents(uuid, date, date), public.issue_client_documents(uuid),
  public.send_client_document(uuid), public.accept_client_document(uuid), public.register_document_signature(uuid, text),
  public.cancel_client_documents(uuid, text), public.discard_client_document_draft(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.build_client_documents(uuid, date, date, uuid), private.generate_due_documents(),
  private.next_document_number(uuid, text, integer), private.billing_period_bounds(text, date, date), private.document_prefix(text),
  private.document_root(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.build_client_documents(uuid, date, date, uuid), private.generate_due_documents(),
  private.next_document_number(uuid, text, integer), private.billing_period_bounds(text, date, date), private.document_prefix(text),
  private.document_root(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION private.document_in_scope(uuid, text) TO authenticated, service_role;

-- ============================================================
-- 6. Доступ
-- ============================================================
ALTER TABLE public.document_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_document_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_counters, public.client_documents, public.client_document_lines FROM anon, authenticated;
GRANT SELECT ON public.client_documents, public.client_document_lines TO authenticated;
GRANT ALL ON public.document_counters, public.client_documents, public.client_document_lines TO service_role;

-- Сотрудники — по матрице прав. Заказчик — свои документы, которые ему отправлены; черновиков и чужих не видит.
CREATE POLICY "Documents: view in scope or own sent" ON public.client_documents FOR SELECT TO authenticated
  USING (private.client_in_scope(client_id, 'client_documents', 'view') OR (private.is_client_contact(client_id) AND sent_at IS NOT NULL AND status <> 'draft'));
CREATE POLICY "Document lines: view with document" ON public.client_document_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.client_documents d WHERE d.id = document_id
                 AND (private.client_in_scope(d.client_id, 'client_documents', 'view')
                      OR (private.is_client_contact(d.client_id) AND d.sent_at IS NOT NULL AND d.status <> 'draft'))));

-- ============================================================
-- 7. Файлы: сканы подписанных документов
-- ============================================================
-- Путь: <организация>/<документ>/<файл>. Читать и грузить могут сотрудники с правом на документы заказчиков во всей организации.
INSERT INTO storage.buckets (id, name, public) VALUES ('client-documents', 'client-documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.client_document_file_allowed(_name text, _action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT CASE
    WHEN (storage.foldername(_name))[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN false
    ELSE private.permission_scope(auth.uid(), ((storage.foldername(_name))[1])::uuid, 'client_documents', _action) = 'all'
  END
$$;

REVOKE EXECUTE ON FUNCTION private.client_document_file_allowed(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.client_document_file_allowed(text, text) TO authenticated, service_role;

CREATE POLICY "Client documents files: read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'client-documents' AND private.client_document_file_allowed(name, 'view'));
CREATE POLICY "Client documents files: upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-documents' AND private.client_document_file_allowed(name, 'update'));
