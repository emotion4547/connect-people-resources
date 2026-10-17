-- Этап 2, шаг 15: оплаты заказчиков, дебиторская задолженность, кредитный лимит, акт сверки.
-- ТЗ: раздел 14 (Б-6…Б-9).
--
-- Платёж приходит из банковской выписки (формат обмена с 1С, kl_to_1c.txt) или вводится вручную. Система сама
-- сопоставляет его с заказчиком по ИНН и со счётом по номеру в назначении или по сумме. Что не удалось — очередь бухгалтеру.

-- ============================================================
-- 1. Условия по заказчику
-- ============================================================
-- Если долг больше лимита или просрочка дольше N дней, новые заказы заказчика принимает только руководитель (Б-8).
ALTER TABLE public.clients
  ADD COLUMN credit_limit numeric(14,2) CHECK (credit_limit IS NULL OR credit_limit >= 0),
  ADD COLUMN max_overdue_days integer CHECK (max_overdue_days IS NULL OR max_overdue_days >= 0);

INSERT INTO public.notification_events (code, title, channels, delivery, critical, audience) VALUES
  ('invoice_overdue',   'Просрочена оплата счёта',          ARRAY['max'],    'all', false, 'менеджер продаж, бухгалтер'),
  ('payment_unmatched', 'Есть неразнесённые платежи',       ARRAY[]::text[], 'all', false, 'бухгалтер');

-- ============================================================
-- 2. Платежи и разнесение
-- ============================================================
CREATE TABLE public.bank_statement_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  filename text,
  account text,
  rows_total integer NOT NULL DEFAULT 0,
  rows_new integer NOT NULL DEFAULT 0,
  rows_duplicate integer NOT NULL DEFAULT 0,
  rows_allocated integer NOT NULL DEFAULT 0,
  rows_queue integer NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.client_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Пока заказчик не определён, платёж в очереди бухгалтера.
  client_id uuid,
  payment_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  source text NOT NULL CHECK (source IN ('manual', 'bank_statement')),
  doc_number text,
  payer_name text,
  payer_inn text,
  purpose text,
  import_id uuid REFERENCES public.bank_statement_imports(id) ON DELETE SET NULL,
  allocated_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
  note text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, client_id) REFERENCES public.clients (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT client_payments_allocated_within CHECK (allocated_amount <= amount)
);

-- Одну и ту же выписку можно загружать повторно: платёж из банка с теми же реквизитами второй раз не создаётся.
CREATE UNIQUE INDEX client_payments_bank_key ON public.client_payments
  (org_id, payment_date, amount, (coalesce(doc_number, '')), (coalesce(payer_inn, ''))) WHERE source = 'bank_statement';
CREATE INDEX client_payments_client_idx ON public.client_payments (client_id, payment_date);
CREATE INDEX client_payments_queue_idx ON public.client_payments (org_id) WHERE client_id IS NULL OR allocated_amount < amount;

CREATE TABLE public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  payment_id uuid NOT NULL REFERENCES public.client_payments(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL REFERENCES public.client_documents(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_allocations_payment_idx ON public.payment_allocations (payment_id);
CREATE INDEX payment_allocations_document_idx ON public.payment_allocations (document_id);

CREATE TRIGGER audit_client_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.client_payments
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('client_id', 'payment_date', 'amount', 'allocated_amount', 'source');
CREATE TRIGGER audit_payment_allocations
  AFTER INSERT OR DELETE ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('payment_id', 'document_id', 'amount');

-- ============================================================
-- 3. Остаток по счёту и статус оплаты
-- ============================================================
CREATE OR REPLACE FUNCTION private.invoice_outstanding(_doc_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT d.amount_total - coalesce((SELECT sum(a.amount) FROM public.payment_allocations a WHERE a.document_id = d.id), 0)
  FROM public.client_documents d WHERE d.id = _doc_id
$$;

-- Статус счёта и парного акта следует за разнесёнными платежами; без платежей возвращается к «выставлен» или «подписан».
CREATE OR REPLACE FUNCTION private.refresh_invoice_status(_doc_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  d public.client_documents;
  paid numeric;
BEGIN
  SELECT * INTO d FROM public.client_documents WHERE id = _doc_id;
  IF d.status = 'cancelled' OR d.kind <> 'invoice' THEN RETURN; END IF;
  SELECT coalesce(sum(amount), 0) INTO paid FROM public.payment_allocations WHERE document_id = _doc_id;
  UPDATE public.client_documents
     SET status = CASE WHEN paid >= amount_total AND amount_total > 0 THEN 'paid' WHEN paid > 0 THEN 'paid_partial'
                       WHEN signed_at IS NOT NULL THEN 'signed' ELSE 'issued' END
   WHERE id = _doc_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.do_allocate(_payment_id uuid, _doc_id uuid, _amount numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  p public.client_payments;
  d public.client_documents;
BEGIN
  SELECT * INTO p FROM public.client_payments WHERE id = _payment_id FOR UPDATE;
  SELECT * INTO d FROM public.client_documents WHERE id = _doc_id FOR UPDATE;
  IF d.kind <> 'invoice' OR d.status NOT IN ('issued', 'signed', 'paid_partial') OR d.org_id <> p.org_id THEN
    RAISE EXCEPTION 'Разнести платёж можно только на выставленный неоплаченный счёт' USING ERRCODE = '22023';
  END IF;
  IF p.client_id IS NOT NULL AND p.client_id <> d.client_id THEN
    RAISE EXCEPTION 'Платёж и счёт относятся к разным заказчикам' USING ERRCODE = '22023';
  END IF;
  IF _amount <= 0 OR _amount > p.amount - p.allocated_amount THEN
    RAISE EXCEPTION 'Сумма больше неразнесённого остатка платежа (%)', p.amount - p.allocated_amount USING ERRCODE = '22023';
  END IF;
  IF _amount > private.invoice_outstanding(_doc_id) THEN
    RAISE EXCEPTION 'Сумма больше неоплаченного остатка счёта (%)', private.invoice_outstanding(_doc_id) USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.payment_allocations (org_id, payment_id, document_id, amount) VALUES (p.org_id, _payment_id, _doc_id, _amount);
  UPDATE public.client_payments SET allocated_amount = allocated_amount + _amount, client_id = coalesce(client_id, d.client_id) WHERE id = _payment_id;
  PERFORM private.refresh_invoice_status(_doc_id);
END;
$$;

-- ============================================================
-- 4. Автоматическое сопоставление
-- ============================================================
-- Заказчик — по ИНН плательщика. Счёт — по номеру в назначении («СЧ-2026/17» или «счёт № 17»), иначе по точной сумме
-- среди неоплаченных счетов заказчика, если такой счёт один. Что не определилось, остаётся в очереди.
CREATE OR REPLACE FUNCTION private.match_payment(_payment_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  p public.client_payments;
  cid uuid;
  inv uuid;
  m text[];
  yr integer;
  seq integer;
  cnt integer;
  room numeric;
BEGIN
  SELECT * INTO p FROM public.client_payments WHERE id = _payment_id;
  IF p.allocated_amount >= p.amount THEN RETURN true; END IF;
  cid := p.client_id;
  IF cid IS NULL AND p.payer_inn IS NOT NULL THEN
    SELECT id INTO cid FROM public.clients WHERE org_id = p.org_id AND inn = p.payer_inn;
  END IF;

  -- Номер счёта в назначении платежа
  m := regexp_match(coalesce(p.purpose, ''), '(?:СЧ|SCH)-(\d{4})/(\d+)', 'i');
  IF m IS NOT NULL THEN
    yr := m[1]::integer; seq := m[2]::integer;
  ELSE
    m := regexp_match(coalesce(p.purpose, ''), 'сч[её]т\w*\s*(?:№|N|#)?\s*(\d+)', 'i');
    IF m IS NOT NULL THEN seq := m[1]::integer; END IF;
  END IF;
  IF seq IS NOT NULL THEN
    SELECT d.id INTO inv FROM public.client_documents d
     WHERE d.org_id = p.org_id AND d.kind = 'invoice' AND d.status IN ('issued', 'signed', 'paid_partial') AND d.number_seq = seq
       AND (cid IS NULL OR d.client_id = cid)
       AND extract(year FROM d.issue_date) = coalesce(yr, extract(year FROM p.payment_date))
     ORDER BY d.issue_date DESC LIMIT 1;
  END IF;

  -- По сумме: единственный неоплаченный счёт заказчика на ровно эту сумму
  IF inv IS NULL AND cid IS NOT NULL THEN
    SELECT count(*), min(d.id::text)::uuid INTO cnt, inv FROM public.client_documents d
     WHERE d.org_id = p.org_id AND d.client_id = cid AND d.kind = 'invoice' AND d.status IN ('issued', 'signed', 'paid_partial')
       AND private.invoice_outstanding(d.id) = p.amount - p.allocated_amount;
    IF cnt <> 1 THEN inv := NULL; END IF;
  END IF;

  IF cid IS NULL AND inv IS NOT NULL THEN SELECT client_id INTO cid FROM public.client_documents WHERE id = inv; END IF;
  IF cid IS NOT NULL AND p.client_id IS NULL THEN
    UPDATE public.client_payments SET client_id = cid WHERE id = _payment_id;
  END IF;
  IF inv IS NOT NULL THEN
    room := least(p.amount - p.allocated_amount, private.invoice_outstanding(inv));
    IF room > 0 THEN PERFORM private.do_allocate(_payment_id, inv, room); END IF;
  END IF;
  RETURN (SELECT allocated_amount >= amount FROM public.client_payments WHERE id = _payment_id);
END;
$$;

-- Загрузка выписки. Разбор файла kl_to_1c.txt делает интерфейс, сюда приходят только входящие платежи.
CREATE OR REPLACE FUNCTION public.import_bank_statement(_org_id uuid, _filename text, _account text, _payments jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  org public.organizations;
  imp uuid;
  r jsonb;
  pid uuid;
  total integer := 0;
  fresh integer := 0;
  dup integer := 0;
  done integer := 0;
  queue integer := 0;
  acc uuid;
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'client_documents', 'create') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO org FROM public.organizations WHERE id = _org_id;
  IF org.bank_account IS NOT NULL AND nullif(btrim(coalesce(_account, '')), '') IS NOT NULL AND org.bank_account <> btrim(_account) THEN
    RAISE EXCEPTION 'Выписка по счёту %, а в карточке организации счёт %', _account, org.bank_account USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(_payments) <> 'array' THEN RAISE EXCEPTION 'Нет платежей для загрузки' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.bank_statement_imports (org_id, filename, account) VALUES (_org_id, _filename, _account) RETURNING id INTO imp;
  FOR r IN SELECT * FROM jsonb_array_elements(_payments) LOOP
    total := total + 1;
    BEGIN
      INSERT INTO public.client_payments (org_id, payment_date, amount, source, doc_number, payer_name, payer_inn, purpose, import_id)
      VALUES (_org_id, (r->>'date')::date, (r->>'amount')::numeric, 'bank_statement', nullif(r->>'number', ''), nullif(r->>'payer_name', ''),
              nullif(r->>'payer_inn', ''), nullif(r->>'purpose', ''), imp)
      RETURNING id INTO pid;
    EXCEPTION WHEN unique_violation THEN
      dup := dup + 1;
      CONTINUE;
    END;
    fresh := fresh + 1;
    IF private.match_payment(pid) THEN done := done + 1; ELSE queue := queue + 1; END IF;
  END LOOP;
  UPDATE public.bank_statement_imports SET rows_total = total, rows_new = fresh, rows_duplicate = dup, rows_allocated = done, rows_queue = queue WHERE id = imp;

  IF queue > 0 THEN
    FOR acc IN SELECT DISTINCT user_id FROM public.user_roles WHERE org_id = _org_id AND role = 'accountant' LOOP
      PERFORM private.notify(_org_id, acc, 'payment_unmatched', 'Есть неразнесённые платежи: ' || queue, 'Загрузка выписки ' || coalesce(_filename, ''), '/payments', 'unm:' || imp);
    END LOOP;
  END IF;
  RETURN jsonb_build_object('import_id', imp, 'total', total, 'new', fresh, 'duplicates', dup, 'allocated', done, 'queue', queue);
END;
$$;

-- Ручной ввод оплаты (с попыткой автоматического разнесения)
CREATE OR REPLACE FUNCTION public.add_client_payment(_org_id uuid, _client_id uuid, _date date, _amount numeric, _doc_number text, _purpose text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  pid uuid;
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'client_documents', 'create') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF _client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id = _client_id AND org_id = _org_id) THEN
    RAISE EXCEPTION 'Заказчик не найден' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.client_payments (org_id, client_id, payment_date, amount, source, doc_number, purpose)
  VALUES (_org_id, _client_id, _date, _amount, 'manual', nullif(btrim(coalesce(_doc_number, '')), ''), nullif(btrim(coalesce(_purpose, '')), ''))
  RETURNING id INTO pid;
  PERFORM private.match_payment(pid);
  RETURN pid;
END;
$$;

-- Ручное разнесение из очереди
CREATE OR REPLACE FUNCTION public.allocate_payment(_payment_id uuid, _doc_id uuid, _amount numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  org uuid;
BEGIN
  SELECT org_id INTO org FROM public.client_payments WHERE id = _payment_id;
  IF org IS NULL OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), org, 'client_documents', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  PERFORM private.do_allocate(_payment_id, _doc_id, _amount);
END;
$$;

-- Снять разнесение (ошибка бухгалтера): сумма возвращается в неразнесённый остаток платежа.
CREATE OR REPLACE FUNCTION public.unallocate_payment(_allocation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.payment_allocations;
BEGIN
  SELECT * INTO a FROM public.payment_allocations WHERE id = _allocation_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), a.org_id, 'client_documents', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.payment_allocations WHERE id = _allocation_id;
  UPDATE public.client_payments SET allocated_amount = allocated_amount - a.amount WHERE id = a.payment_id;
  PERFORM private.refresh_invoice_status(a.document_id);
END;
$$;

-- Назначить заказчика платежу из очереди и попробовать разнести заново
CREATE OR REPLACE FUNCTION public.assign_payment_client(_payment_id uuid, _client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  p public.client_payments;
BEGIN
  SELECT * INTO p FROM public.client_payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), p.org_id, 'client_documents', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF p.allocated_amount > 0 AND p.client_id IS DISTINCT FROM _client_id THEN
    RAISE EXCEPTION 'Часть платежа уже разнесена на счета другого заказчика' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = _client_id AND org_id = p.org_id) THEN
    RAISE EXCEPTION 'Заказчик не найден' USING ERRCODE = '22023';
  END IF;
  UPDATE public.client_payments SET client_id = _client_id WHERE id = _payment_id;
  PERFORM private.match_payment(_payment_id);
END;
$$;

-- ============================================================
-- 5. Дебиторская задолженность
-- ============================================================
-- Выставлено, оплачено, долг и просрочка 0–30, 31–60, больше 60 дней от срока оплаты по договору (Б-7).
-- Платёж, ещё не разнесённый на счета, показывается отдельно как аванс заказчика.
CREATE OR REPLACE FUNCTION public.client_receivables(_as_of date DEFAULT current_date)
RETURNS TABLE (client_id uuid, client_name text, invoiced numeric, paid numeric, debt numeric, not_due numeric,
               overdue_30 numeric, overdue_60 numeric, overdue_60p numeric, unallocated numeric, max_overdue_days integer,
               credit_limit numeric, blocked boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH inv AS (
    SELECT d.client_id, d.amount_total, d.due_date,
           d.amount_total - coalesce((SELECT sum(a.amount) FROM public.payment_allocations a WHERE a.document_id = d.id), 0) AS open_amount
    FROM public.client_documents d WHERE d.kind = 'invoice' AND d.status IN ('issued', 'signed', 'paid_partial', 'paid')
  ), agg AS (
    SELECT i.client_id, sum(i.amount_total) AS invoiced, sum(i.amount_total - i.open_amount) AS paid, sum(i.open_amount) AS debt,
           sum(i.open_amount) FILTER (WHERE i.due_date IS NULL OR i.due_date >= _as_of) AS not_due,
           sum(i.open_amount) FILTER (WHERE i.due_date < _as_of AND _as_of - i.due_date <= 30) AS o30,
           sum(i.open_amount) FILTER (WHERE i.due_date < _as_of AND _as_of - i.due_date BETWEEN 31 AND 60) AS o60,
           sum(i.open_amount) FILTER (WHERE i.due_date < _as_of AND _as_of - i.due_date > 60) AS o60p,
           max(_as_of - i.due_date) FILTER (WHERE i.open_amount > 0 AND i.due_date < _as_of) AS maxd
    FROM inv i GROUP BY i.client_id
  ), pay AS (
    SELECT p.client_id, sum(p.amount - p.allocated_amount) AS unalloc FROM public.client_payments p WHERE p.client_id IS NOT NULL GROUP BY p.client_id
  )
  SELECT c.id, c.name, coalesce(a.invoiced, 0), coalesce(a.paid, 0), coalesce(a.debt, 0), coalesce(a.not_due, 0),
         coalesce(a.o30, 0), coalesce(a.o60, 0), coalesce(a.o60p, 0), coalesce(pay.unalloc, 0), a.maxd, c.credit_limit,
         private.client_credit_blocked(c.id) IS NOT NULL
  FROM public.clients c
  LEFT JOIN agg a ON a.client_id = c.id
  LEFT JOIN pay ON pay.client_id = c.id
  WHERE (a.invoiced IS NOT NULL OR pay.unalloc IS NOT NULL)
    AND private.client_in_scope(c.id, 'client_documents', 'view')
  ORDER BY coalesce(a.debt, 0) DESC, c.name;
END;
$$;

-- Причина, по которой заказ заказчика должен принимать руководитель: долг больше лимита или просрочка дольше срока.
CREATE OR REPLACE FUNCTION private.client_credit_blocked(_client_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  c public.clients;
  debt numeric;
  unalloc numeric;
  maxd integer;
BEGIN
  SELECT * INTO c FROM public.clients WHERE id = _client_id;
  IF c.credit_limit IS NULL AND c.max_overdue_days IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(sum(d.amount_total - coalesce((SELECT sum(a.amount) FROM public.payment_allocations a WHERE a.document_id = d.id), 0)), 0)
    INTO debt FROM public.client_documents d WHERE d.client_id = _client_id AND d.kind = 'invoice' AND d.status IN ('issued', 'signed', 'paid_partial');
  SELECT coalesce(sum(amount - allocated_amount), 0) INTO unalloc FROM public.client_payments WHERE client_id = _client_id;
  SELECT max(current_date - d.due_date) INTO maxd FROM public.client_documents d
   WHERE d.client_id = _client_id AND d.kind = 'invoice' AND d.status IN ('issued', 'signed', 'paid_partial')
     AND d.due_date < current_date AND private.invoice_outstanding(d.id) > 0;
  IF c.credit_limit IS NOT NULL AND debt - unalloc > c.credit_limit THEN
    RETURN 'долг ' || (debt - unalloc) || ' ₽ больше кредитного лимита ' || c.credit_limit || ' ₽';
  END IF;
  IF c.max_overdue_days IS NOT NULL AND coalesce(maxd, 0) > c.max_overdue_days THEN
    RETURN 'просрочка ' || maxd || ' дн. больше допустимых ' || c.max_overdue_days;
  END IF;
  RETURN NULL;
END;
$$;

-- Принять заказ такого заказчика может только руководитель (Б-8).
CREATE OR REPLACE FUNCTION public.accept_order(_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  o public.orders;
  n integer;
  why text;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.order_in_scope(_order_id, 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF o.status <> 'new' THEN
    RAISE EXCEPTION 'Принять можно только новый заказ' USING ERRCODE = '22023';
  END IF;
  why := private.client_credit_blocked(o.client_id);
  IF why IS NOT NULL AND NOT private.has_org_role(auth.uid(), 'director', o.org_id) THEN
    RAISE EXCEPTION 'Заказ этого заказчика принимает только руководитель: %', why USING ERRCODE = '42501';
  END IF;

  n := private.generate_shifts(_order_id);
  UPDATE public.orders SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now() WHERE id = _order_id;
  RETURN n;
END;
$$;

-- Просрочка — уведомление менеджеру продаж и бухгалтеру; раз в сутки, по каждому счёту не чаще раза в неделю.
CREATE OR REPLACE FUNCTION private.notify_overdue_invoices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  r record;
  u uuid;
  n integer := 0;
  wk text := to_char(current_date, 'IYYY-IW');
BEGIN
  FOR r IN SELECT d.id, d.org_id, d.number, d.due_date, c.name, c.sales_manager_id, private.invoice_outstanding(d.id) AS open_amount
           FROM public.client_documents d JOIN public.clients c ON c.id = d.client_id
           WHERE d.kind = 'invoice' AND d.status IN ('issued', 'signed', 'paid_partial') AND d.due_date < current_date LOOP
    IF r.open_amount <= 0 THEN CONTINUE; END IF;
    FOR u IN SELECT r.sales_manager_id WHERE r.sales_manager_id IS NOT NULL
             UNION SELECT user_id FROM public.user_roles WHERE org_id = r.org_id AND role = 'accountant' LOOP
      IF private.notify(r.org_id, u, 'invoice_overdue', 'Просрочена оплата: ' || r.name,
                        'Счёт ' || r.number || ', долг ' || r.open_amount || ' ₽, срок был ' || to_char(r.due_date, 'DD.MM.YYYY'),
                        '/receivables', 'overdue:' || r.id || ':' || wk) IS NOT NULL THEN
        n := n + 1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN n;
END;
$$;

-- ============================================================
-- 6. Акт сверки
-- ============================================================
-- Движения по заказчику за период: счета увеличивают долг, платежи уменьшают. Сальдо на начало и на конец.
CREATE OR REPLACE FUNCTION public.client_reconciliation(_client_id uuid, _from date, _to date)
RETURNS TABLE (row_kind text, row_date date, title text, debit numeric, credit numeric, balance numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  opening numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT (private.client_in_scope(_client_id, 'client_documents', 'view') OR private.is_client_contact(_client_id)) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce((SELECT sum(amount_total) FROM public.client_documents
                   WHERE client_id = _client_id AND kind = 'invoice' AND status NOT IN ('draft', 'cancelled') AND issue_date < _from), 0)
       - coalesce((SELECT sum(amount) FROM public.client_payments WHERE client_id = _client_id AND payment_date < _from), 0)
    INTO opening;
  RETURN QUERY
  WITH moves AS (
    SELECT 'invoice'::text AS k, d.issue_date AS dt, 'Счёт № ' || d.number AS ttl, d.amount_total AS db, 0::numeric AS cr
    FROM public.client_documents d
    WHERE d.client_id = _client_id AND d.kind = 'invoice' AND d.status NOT IN ('draft', 'cancelled') AND d.issue_date BETWEEN _from AND _to
    UNION ALL
    SELECT 'payment', p.payment_date, 'Оплата' || coalesce(' п/п № ' || p.doc_number, ''), 0, p.amount
    FROM public.client_payments p WHERE p.client_id = _client_id AND p.payment_date BETWEEN _from AND _to
  ), ordered AS (
    SELECT m.*, opening + sum(m.db - m.cr) OVER (ORDER BY m.dt, m.k DESC, m.ttl) AS bal FROM moves m
  )
  SELECT 'opening', _from, 'Сальдо на начало периода', NULL::numeric, NULL::numeric, opening
  UNION ALL SELECT o.k, o.dt, o.ttl, o.db, o.cr, o.bal FROM ordered o
  UNION ALL SELECT 'closing', _to, 'Сальдо на конец периода', NULL, NULL,
         opening + coalesce((SELECT sum(db - cr) FROM moves), 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.import_bank_statement(uuid, text, text, jsonb), public.add_client_payment(uuid, uuid, date, numeric, text, text),
  public.allocate_payment(uuid, uuid, numeric), public.unallocate_payment(uuid), public.assign_payment_client(uuid, uuid),
  public.client_receivables(date), public.client_reconciliation(uuid, date, date), public.accept_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bank_statement(uuid, text, text, jsonb), public.add_client_payment(uuid, uuid, date, numeric, text, text),
  public.allocate_payment(uuid, uuid, numeric), public.unallocate_payment(uuid), public.assign_payment_client(uuid, uuid),
  public.client_receivables(date), public.client_reconciliation(uuid, date, date), public.accept_order(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.invoice_outstanding(uuid), private.refresh_invoice_status(uuid), private.do_allocate(uuid, uuid, numeric),
  private.match_payment(uuid), private.client_credit_blocked(uuid), private.notify_overdue_invoices() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.invoice_outstanding(uuid), private.refresh_invoice_status(uuid), private.do_allocate(uuid, uuid, numeric),
  private.match_payment(uuid), private.client_credit_blocked(uuid), private.notify_overdue_invoices() TO service_role;

-- ============================================================
-- 7. Доступ
-- ============================================================
ALTER TABLE public.bank_statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bank_statement_imports, public.client_payments, public.payment_allocations FROM anon, authenticated;
GRANT SELECT ON public.bank_statement_imports, public.client_payments, public.payment_allocations TO authenticated;
GRANT ALL ON public.bank_statement_imports, public.client_payments, public.payment_allocations TO service_role;

-- Платежи без заказчика (очередь) видит тот, у кого право на документы во всей организации.
CREATE POLICY "Payments: view in scope" ON public.client_payments FOR SELECT TO authenticated
  USING ((client_id IS NOT NULL AND private.client_in_scope(client_id, 'client_documents', 'view'))
         OR private.permission_scope(auth.uid(), org_id, 'client_documents', 'view') = 'all');
CREATE POLICY "Allocations: view with payment" ON public.payment_allocations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.client_payments p WHERE p.id = payment_id
         AND ((p.client_id IS NOT NULL AND private.client_in_scope(p.client_id, 'client_documents', 'view'))
              OR private.permission_scope(auth.uid(), p.org_id, 'client_documents', 'view') = 'all')));
CREATE POLICY "Imports: accounting only" ON public.bank_statement_imports FOR SELECT TO authenticated
  USING (private.permission_scope(auth.uid(), org_id, 'client_documents', 'view') = 'all');

-- Аннулировать документы, по которым уже есть оплата, нельзя: сначала снимают разнесение.
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
  IF EXISTS (SELECT 1 FROM public.payment_allocations pa JOIN public.client_documents d ON d.id = pa.document_id
             WHERE d.id = a.id OR d.parent_document_id = a.id) THEN
    RAISE EXCEPTION 'По счёту есть оплата: сначала снимите разнесение платежа' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Укажите причину аннулирования' USING ERRCODE = '22023';
  END IF;
  UPDATE public.client_documents SET status = 'cancelled', cancel_reason = _reason, cancelled_at = now() WHERE id = a.id OR parent_document_id = a.id;
  UPDATE public.accruals SET status = CASE WHEN status = 'in_act' THEN 'approved' ELSE status END, client_document_id = NULL WHERE client_document_id = a.id;
END;
$$;
