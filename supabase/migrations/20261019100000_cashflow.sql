-- Этап 3, шаг 21: счета денег и операции ДДС.
-- ТЗ: раздел 16 (Ф-1, Ф-2), раздел 5 (сущности «Счёт денег», «Операция ДДС», «Статья ДДС»).
--
-- ДДС показывает, сколько денег реально пришло и ушло. Основная часть операций создаётся сама: оплаты заказчиков и проведённые
-- выплаты; вручную вносятся прочие расходы (аренда, зарплата штата, реклама) и перемещения между счетами. Это управленческий
-- учёт; официальные налоги считаются в 1С.

-- ============================================================
-- 1. Счета и статьи
-- ============================================================
CREATE TABLE public.cash_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Расчётный счёт, касса или баланс на платформе выплат.
  kind text NOT NULL CHECK (kind IN ('bank', 'cash', 'platform')),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  bank_name text,
  account_number text,
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  -- Остаток на начало этой даты; операции раньше неё в остаток не входят.
  opening_date date NOT NULL DEFAULT date_trunc('year', current_date)::date,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);

CREATE TRIGGER audit_cash_accounts
  AFTER INSERT OR UPDATE ON public.cash_accounts
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('kind', 'name', 'account_number', 'opening_balance', 'opening_date', 'is_active');

-- Статья ДДС. Поле «bdr_article» связывает её с отчётом БДР (шаг 24); перемещения в отчёты не входят.
CREATE TABLE public.cashflow_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  direction text NOT NULL CHECK (direction IN ('in', 'out', 'both')),
  bdr_article text CHECK (bdr_article IN ('revenue', 'worker_costs', 'worker_taxes', 'payout_fees', 'other_staff_costs', 'admin_costs', 'usn_tax')),
  is_transfer boolean NOT NULL DEFAULT false,
  -- Системные статьи используются автоматическими операциями и не удаляются.
  is_system boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (org_id, id)
);

CREATE UNIQUE INDEX cashflow_categories_code_key ON public.cashflow_categories (org_id, code) WHERE code IS NOT NULL;

-- ============================================================
-- 2. Операции
-- ============================================================
CREATE TABLE public.cashflow_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  entry_date date NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  -- Пустая статья — операция ждёт разнесения (шаг 22).
  category_id uuid,
  client_id uuid,
  worker_id uuid,
  counterparty text,
  source text NOT NULL CHECK (source IN ('manual', 'statement', 'auto')),
  -- Основание автоматической операции: оплата заказчика, строка реестра. Одно основание — одна операция.
  basis_type text,
  basis_id uuid,
  is_advance boolean NOT NULL DEFAULT false,
  transfer_group uuid,
  file_path text,
  comment text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, account_id) REFERENCES public.cash_accounts (org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, category_id) REFERENCES public.cashflow_categories (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT cashflow_basis_pair CHECK ((basis_type IS NULL) = (basis_id IS NULL))
);

CREATE UNIQUE INDEX cashflow_entries_basis_key ON public.cashflow_entries (org_id, basis_type, basis_id) WHERE basis_id IS NOT NULL;
CREATE INDEX cashflow_entries_date_idx ON public.cashflow_entries (org_id, entry_date);
CREATE INDEX cashflow_entries_account_idx ON public.cashflow_entries (account_id, entry_date);
CREATE INDEX cashflow_entries_unsorted_idx ON public.cashflow_entries (org_id) WHERE category_id IS NULL;

CREATE TRIGGER audit_cashflow_entries
  AFTER INSERT OR UPDATE OR DELETE ON public.cashflow_entries
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('account_id', 'entry_date', 'direction', 'amount', 'category_id', 'source');

-- ============================================================
-- 3. Начальные данные организации
-- ============================================================
CREATE OR REPLACE FUNCTION private.seed_cashflow(_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  o public.organizations;
BEGIN
  SELECT * INTO o FROM public.organizations WHERE id = _org_id;
  INSERT INTO public.cashflow_categories (org_id, code, name, direction, bdr_article, is_transfer, is_system, sort_order) VALUES
    (_org_id, 'client_payment', 'Оплата заказчиков',                        'in',   'revenue',           false, true, 10),
    (_org_id, 'other_income',   'Прочие поступления',                       'in',   NULL,                false, true, 20),
    (_org_id, 'worker_payout',  'Выплаты исполнителям',                     'out',  'worker_costs',      false, true, 30),
    (_org_id, 'worker_taxes',   'Налоги и взносы по исполнителям',          'out',  'worker_taxes',      false, true, 40),
    (_org_id, 'payout_fee',     'Комиссии платформы выплат',                'out',  'payout_fees',       false, true, 50),
    (_org_id, 'other_staff',    'Прочие расходы на персонал',               'out',  'other_staff_costs', false, true, 60),
    (_org_id, 'rent',           'Аренда офиса',                             'out',  'admin_costs',       false, false, 70),
    (_org_id, 'office_salary',  'Зарплата штата',                           'out',  'admin_costs',       false, false, 80),
    (_org_id, 'advertising',    'Реклама',                                  'out',  'admin_costs',       false, false, 90),
    (_org_id, 'other_expense',  'Прочие управленческие расходы',            'out',  'admin_costs',       false, true, 100),
    (_org_id, 'usn_tax',        'Налог по УСН',                             'out',  'usn_tax',           false, true, 110),
    (_org_id, 'transfer',       'Перемещение между счетами',                'both', NULL,                true,  true, 120)
  ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.cash_accounts WHERE org_id = _org_id) THEN
    INSERT INTO public.cash_accounts (org_id, kind, name, bank_name, account_number, sort_order) VALUES
      (_org_id, 'bank', 'Расчётный счёт', o.bank_name, o.bank_account, 10),
      (_org_id, 'platform', 'Платформа выплат', NULL, NULL, 20),
      (_org_id, 'cash', 'Касса', NULL, NULL, 30);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.organizations_seed_cashflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  PERFORM private.seed_cashflow(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_seed_cashflow AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION private.organizations_seed_cashflow();
REVOKE EXECUTE ON FUNCTION private.seed_cashflow(uuid), private.organizations_seed_cashflow() FROM PUBLIC, anon, authenticated;
SELECT private.seed_cashflow(id) FROM public.organizations;

-- ============================================================
-- 4. Автоматические операции
-- ============================================================
CREATE OR REPLACE FUNCTION private.default_account(_org_id uuid, _kind text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$ SELECT id FROM public.cash_accounts WHERE org_id = _org_id AND kind = _kind AND is_active ORDER BY sort_order, created_at LIMIT 1 $$;

CREATE OR REPLACE FUNCTION private.category_by_code(_org_id uuid, _code text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$ SELECT id FROM public.cashflow_categories WHERE org_id = _org_id AND code = _code $$;

-- Оплата заказчика → поступление на расчётный счёт
CREATE OR REPLACE FUNCTION private.cashflow_on_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  INSERT INTO public.cashflow_entries (org_id, account_id, entry_date, direction, amount, category_id, client_id, counterparty, source, basis_type, basis_id, comment)
  VALUES (NEW.org_id, private.default_account(NEW.org_id, 'bank'), NEW.payment_date, 'in', NEW.amount, private.category_by_code(NEW.org_id, 'client_payment'),
          NEW.client_id, NEW.payer_name, 'auto', 'client_payment', NEW.id, NEW.purpose)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cashflow_on_payment AFTER INSERT ON public.client_payments FOR EACH ROW EXECUTE FUNCTION private.cashflow_on_payment();

-- Проведённая строка реестра → расход со счёта канала; у самозанятых отдельно комиссия платформы
CREATE OR REPLACE FUNCTION private.cashflow_on_payout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  r public.payout_registries;
  acc uuid;
  fee numeric;
BEGIN
  IF NEW.status <> 'paid' OR OLD.status = 'paid' THEN RETURN NEW; END IF;
  SELECT * INTO r FROM public.payout_registries WHERE id = NEW.registry_id;
  acc := private.default_account(NEW.org_id, CASE r.channel WHEN 'platform' THEN 'platform' ELSE 'bank' END);
  IF NEW.amount_to_pay > 0 THEN
    INSERT INTO public.cashflow_entries (org_id, account_id, entry_date, direction, amount, category_id, worker_id, counterparty, source, basis_type, basis_id, is_advance, comment)
    VALUES (NEW.org_id, acc, coalesce(NEW.paid_at::date, current_date), 'out', NEW.amount_to_pay, private.category_by_code(NEW.org_id, 'worker_payout'),
            NEW.worker_id, NEW.worker_name, 'auto', 'payout_line', NEW.id, NEW.advance_id IS NOT NULL, 'Реестр ' || r.number)
    ON CONFLICT DO NOTHING;
  END IF;
  IF r.channel = 'platform' AND NEW.advance_id IS NULL THEN
    SELECT coalesce(sum(payout_fee), 0) INTO fee FROM public.accruals WHERE payout_line_id = NEW.id;
    IF fee > 0 THEN
      INSERT INTO public.cashflow_entries (org_id, account_id, entry_date, direction, amount, category_id, worker_id, counterparty, source, basis_type, basis_id, comment)
      VALUES (NEW.org_id, acc, coalesce(NEW.paid_at::date, current_date), 'out', fee, private.category_by_code(NEW.org_id, 'payout_fee'),
              NEW.worker_id, 'Платформа выплат', 'auto', 'payout_fee', NEW.id, 'Комиссия платформы, реестр ' || r.number)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cashflow_on_payout AFTER UPDATE OF status ON public.payout_lines FOR EACH ROW EXECUTE FUNCTION private.cashflow_on_payout();

REVOKE EXECUTE ON FUNCTION private.default_account(uuid, text), private.category_by_code(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.default_account(uuid, text), private.category_by_code(uuid, text) TO service_role;

-- Уже существующие оплаты и выплаты становятся операциями (одно основание — одна операция, повтор безопасен).
INSERT INTO public.cashflow_entries (org_id, account_id, entry_date, direction, amount, category_id, client_id, counterparty, source, basis_type, basis_id, comment)
SELECT p.org_id, private.default_account(p.org_id, 'bank'), p.payment_date, 'in', p.amount, private.category_by_code(p.org_id, 'client_payment'),
       p.client_id, p.payer_name, 'auto', 'client_payment', p.id, p.purpose
FROM public.client_payments p ON CONFLICT DO NOTHING;

-- ============================================================
-- 5. Остатки
-- ============================================================
CREATE OR REPLACE FUNCTION public.cash_balances(_org_id uuid, _date date DEFAULT current_date)
RETURNS TABLE (account_id uuid, name text, kind text, balance numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'cashflow', 'view') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.id, a.name, a.kind,
         a.opening_balance + coalesce((SELECT sum(CASE e.direction WHEN 'in' THEN e.amount ELSE -e.amount END) FROM public.cashflow_entries e
                                       WHERE e.account_id = a.id AND e.entry_date >= a.opening_date AND e.entry_date <= _date), 0)
  FROM public.cash_accounts a WHERE a.org_id = _org_id AND a.is_active ORDER BY a.sort_order, a.created_at;
END;
$$;

-- ============================================================
-- 6. Ручные операции и перемещения
-- ============================================================
CREATE OR REPLACE FUNCTION public.add_cashflow_entry(_org_id uuid, _account_id uuid, _date date, _direction text, _amount numeric,
                                                     _category_id uuid, _counterparty text DEFAULT NULL, _comment text DEFAULT NULL,
                                                     _file_path text DEFAULT NULL, _client_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  c public.cashflow_categories;
  eid uuid;
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'cashflow', 'create') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF _direction NOT IN ('in', 'out') OR _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Укажите направление и сумму больше нуля' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cash_accounts WHERE id = _account_id AND org_id = _org_id AND is_active) THEN
    RAISE EXCEPTION 'Счёт не найден' USING ERRCODE = '22023';
  END IF;
  IF _category_id IS NOT NULL THEN
    SELECT * INTO c FROM public.cashflow_categories WHERE id = _category_id AND org_id = _org_id AND is_active;
    IF NOT FOUND OR c.is_transfer OR c.direction NOT IN (_direction, 'both') THEN
      RAISE EXCEPTION 'Статья не подходит к этой операции' USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO public.cashflow_entries (org_id, account_id, entry_date, direction, amount, category_id, client_id, counterparty, source, comment, file_path)
  VALUES (_org_id, _account_id, _date, _direction, _amount, _category_id, _client_id, nullif(btrim(coalesce(_counterparty, '')), ''), 'manual', _comment, _file_path)
  RETURNING id INTO eid;
  RETURN eid;
END;
$$;

-- Перемещение между своими счетами (например, пополнение баланса на платформе выплат): две связанные операции.
CREATE OR REPLACE FUNCTION public.transfer_cash(_org_id uuid, _from uuid, _to uuid, _date date, _amount numeric, _comment text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  g uuid := gen_random_uuid();
  cat uuid := private.category_by_code(_org_id, 'transfer');
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'cashflow', 'create') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF _from = _to OR _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Выберите два разных счёта и сумму больше нуля' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM public.cash_accounts WHERE org_id = _org_id AND id IN (_from, _to) AND is_active) <> 2 THEN
    RAISE EXCEPTION 'Счёт не найден' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cashflow_entries (org_id, account_id, entry_date, direction, amount, category_id, source, transfer_group, comment)
  VALUES (_org_id, _from, _date, 'out', _amount, cat, 'manual', g, coalesce(_comment, 'Перемещение')),
         (_org_id, _to, _date, 'in', _amount, cat, 'manual', g, coalesce(_comment, 'Перемещение'));
  RETURN g;
END;
$$;

-- Сменить статью операции (разнести): автоматические операции — только внутри допустимых по направлению статей.
CREATE OR REPLACE FUNCTION public.set_entry_category(_entry_id uuid, _category_id uuid)
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
END;
$$;

-- Удалить можно только внесённое вручную или из выписки; автоматические операции исправляются в источнике.
CREATE OR REPLACE FUNCTION public.delete_cashflow_entry(_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  e public.cashflow_entries;
BEGIN
  SELECT * INTO e FROM public.cashflow_entries WHERE id = _entry_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), e.org_id, 'cashflow', 'delete') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF e.source = 'auto' THEN RAISE EXCEPTION 'Автоматическую операцию удалить нельзя: исправьте оплату или выплату' USING ERRCODE = '22023'; END IF;
  IF e.transfer_group IS NOT NULL THEN
    DELETE FROM public.cashflow_entries WHERE transfer_group = e.transfer_group;
  ELSE
    DELETE FROM public.cashflow_entries WHERE id = _entry_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cash_balances(uuid, date), public.add_cashflow_entry(uuid, uuid, date, text, numeric, uuid, text, text, text, uuid),
  public.transfer_cash(uuid, uuid, uuid, date, numeric, text), public.set_entry_category(uuid, uuid), public.delete_cashflow_entry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_balances(uuid, date), public.add_cashflow_entry(uuid, uuid, date, text, numeric, uuid, text, text, text, uuid),
  public.transfer_cash(uuid, uuid, uuid, date, numeric, text), public.set_entry_category(uuid, uuid), public.delete_cashflow_entry(uuid) TO authenticated, service_role;

-- ============================================================
-- 7. Доступ и файлы
-- ============================================================
ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashflow_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashflow_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_accounts, public.cashflow_categories, public.cashflow_entries FROM anon, authenticated;
GRANT SELECT ON public.cash_accounts, public.cashflow_categories, public.cashflow_entries TO authenticated;
GRANT INSERT, UPDATE ON public.cash_accounts, public.cashflow_categories TO authenticated;
GRANT ALL ON public.cash_accounts, public.cashflow_categories, public.cashflow_entries TO service_role;

CREATE POLICY "Cash accounts: view" ON public.cash_accounts FOR SELECT TO authenticated USING (private.permission_scope(auth.uid(), org_id, 'cashflow', 'view') = 'all');
CREATE POLICY "Cash accounts: add" ON public.cash_accounts FOR INSERT TO authenticated WITH CHECK (private.permission_scope(auth.uid(), org_id, 'cashflow', 'create') = 'all');
CREATE POLICY "Cash accounts: edit" ON public.cash_accounts FOR UPDATE TO authenticated
  USING (private.permission_scope(auth.uid(), org_id, 'cashflow', 'update') = 'all') WITH CHECK (private.permission_scope(auth.uid(), org_id, 'cashflow', 'update') = 'all');
CREATE POLICY "Categories: view" ON public.cashflow_categories FOR SELECT TO authenticated USING (private.permission_scope(auth.uid(), org_id, 'cashflow', 'view') = 'all');
CREATE POLICY "Categories: add custom" ON public.cashflow_categories FOR INSERT TO authenticated
  WITH CHECK (NOT is_system AND code IS NULL AND private.permission_scope(auth.uid(), org_id, 'cashflow', 'create') = 'all');
CREATE POLICY "Categories: edit custom" ON public.cashflow_categories FOR UPDATE TO authenticated
  USING (NOT is_system AND private.permission_scope(auth.uid(), org_id, 'cashflow', 'update') = 'all')
  WITH CHECK (NOT is_system AND private.permission_scope(auth.uid(), org_id, 'cashflow', 'update') = 'all');
CREATE POLICY "Entries: view" ON public.cashflow_entries FOR SELECT TO authenticated USING (private.permission_scope(auth.uid(), org_id, 'cashflow', 'view') = 'all');

-- Файлы к операциям: <организация>/<операция>/<файл>
INSERT INTO storage.buckets (id, name, public) VALUES ('cashflow-files', 'cashflow-files', false) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.cashflow_file_allowed(_name text, _action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT CASE
    WHEN (storage.foldername(_name))[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN false
    ELSE private.permission_scope(auth.uid(), ((storage.foldername(_name))[1])::uuid, 'cashflow', _action) = 'all'
  END
$$;

REVOKE EXECUTE ON FUNCTION private.cashflow_file_allowed(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.cashflow_file_allowed(text, text) TO authenticated, service_role;

CREATE POLICY "Cashflow files: read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'cashflow-files' AND private.cashflow_file_allowed(name, 'view'));
CREATE POLICY "Cashflow files: upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'cashflow-files' AND private.cashflow_file_allowed(name, 'create'));
