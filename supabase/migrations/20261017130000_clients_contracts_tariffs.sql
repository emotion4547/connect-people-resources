-- Этап 1, шаг 4: заказчики, договоры, тарифы. ТЗ: разделы 4 и 7.
--
-- Что здесь нового по сравнению с прежней схемой: заказчик перестаёт быть строкой
-- «компания» в профиле HR и становится отдельной сущностью с ответственными, договорами и
-- тарифами. Тариф — единственный источник ставок: «заказ можно создать только по
-- утверждённому тарифу, чтобы маржа была известна до первой смены».
--
-- Отложено: подтягивание реквизитов по ИНН из внешнего сервиса (П-2, нужен ключ и решение
-- о внешнем сервисе), число объектов и заказов, выручка и маржа в списке (появятся с заказами
-- и начислениями), задача с чек-листом запуска при передаче (П-11, нужны уведомления, шаг 12),
-- приглашение контакта в кабинет письмом (П-5, нужен SMTP).

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- ============================================================
-- 1. Область доступа строки (общая для таблиц этого и следующих шагов)
-- ============================================================
-- Область берётся из матрицы прав роли: all — все строки организации; own — строки, где
-- пользователь назван ответственным; department — строки, где ответственный работает в
-- том же отделе; none — нет доступа.
CREATE OR REPLACE FUNCTION private.row_in_scope(_org_id uuid, _module text, _action text, _owners uuid[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  -- coalesce нужен: если в списке ответственных есть NULL (ответственный не назначен), сравнение
  -- даёт NULL, а не false, и проверка «NOT row_in_scope(...)» в функциях тогда пропустила бы чужого.
  SELECT coalesce(CASE private.permission_scope(auth.uid(), _org_id, _module, _action)
    WHEN 'all' THEN true
    WHEN 'own' THEN auth.uid() = ANY (_owners)
    WHEN 'department' THEN EXISTS (
      SELECT 1 FROM public.staff_profiles me
      JOIN public.staff_profiles owner_profile ON owner_profile.department = me.department
      WHERE me.user_id = auth.uid() AND owner_profile.user_id = ANY (_owners)
    )
    ELSE false
  END, false)
$$;

REVOKE EXECUTE ON FUNCTION private.row_in_scope(uuid, text, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.row_in_scope(uuid, text, text, uuid[]) TO authenticated, service_role;

-- ============================================================
-- 1а. Журнал виден администратору и руководителю организации (ТЗ, Ж-2)
-- ============================================================
DROP POLICY IF EXISTS "Org admins can view audit log of their organization" ON public.audit_log;
CREATE POLICY "Org admins and directors can view audit log"
  ON public.audit_log FOR SELECT TO authenticated
  USING (org_id IS NOT NULL AND (
    private.has_org_role(auth.uid(), 'admin', org_id) OR private.has_org_role(auth.uid(), 'director', org_id)));

-- ============================================================
-- 2. Позиции (виды работ)
-- ============================================================
CREATE TABLE public.positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  requirements text,
  default_unit text NOT NULL DEFAULT 'hour' CHECK (default_unit IN ('hour', 'shift', 'piece')),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, name)
);

CREATE TRIGGER audit_positions
  AFTER INSERT OR UPDATE OR DELETE ON public.positions
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('name', 'default_unit', 'is_active');

ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.positions FROM anon, authenticated;
GRANT SELECT, INSERT ON public.positions TO authenticated;
GRANT UPDATE (name, description, requirements, default_unit, sort_order, is_active) ON public.positions TO authenticated;
GRANT ALL ON public.positions TO service_role;

CREATE POLICY "Members can read positions" ON public.positions FOR SELECT TO authenticated
  USING (private.is_org_member(org_id));
CREATE POLICY "Org admins can add positions" ON public.positions FOR INSERT TO authenticated
  WITH CHECK (private.has_org_role(auth.uid(), 'admin', org_id));
CREATE POLICY "Org admins can edit positions" ON public.positions FOR UPDATE TO authenticated
  USING (private.has_org_role(auth.uid(), 'admin', org_id))
  WITH CHECK (private.has_org_role(auth.uid(), 'admin', org_id));

-- Начальные позиции — те, что сейчас зашиты в интерфейсе (src/lib/constants.ts).
CREATE OR REPLACE FUNCTION private.seed_positions(_org_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, private
AS $$
  INSERT INTO public.positions (org_id, name, sort_order)
  SELECT _org_id, p.name, p.ord
  FROM (VALUES
    ('Сортировщик', 1), ('Упаковщик', 2), ('Грузчик', 3), ('Комплектовщик', 4),
    ('Кладовщик', 5), ('Водитель погрузчика', 6), ('Разнорабочий', 7)
  ) AS p(name, ord)
  ON CONFLICT DO NOTHING
$$;

CREATE OR REPLACE FUNCTION private.organizations_seed_positions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  PERFORM private.seed_positions(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_seed_positions
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.organizations_seed_positions();

REVOKE EXECUTE ON FUNCTION private.seed_positions(uuid), private.organizations_seed_positions() FROM PUBLIC, anon, authenticated;
SELECT private.seed_positions(id) FROM public.organizations;

-- ============================================================
-- 3. Заказчики
-- ============================================================
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  legal_name text,
  inn text CHECK (inn IS NULL OR inn ~ '^([0-9]{10}|[0-9]{12})$'),
  kpp text,
  ogrn text,
  legal_address text,
  bank_name text,
  bank_account text,
  bik text,
  city text,
  -- Лид → Переговоры → Договор → Активный → Пауза → Архив (П-3).
  -- «Активный» ставится сам при первой смене (шаг 6); архив требует причины.
  status text NOT NULL DEFAULT 'lead' CHECK (status IN ('lead', 'negotiation', 'contract', 'active', 'paused', 'archived')),
  archive_reason text,
  source_id uuid REFERENCES public.directories(id) ON DELETE SET NULL,
  sales_manager_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sites_manager_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  CONSTRAINT clients_archive_needs_reason CHECK (status <> 'archived' OR length(btrim(coalesce(archive_reason, ''))) > 0)
);

-- ИНН уникален в пределах организации; у лида, пришедшего с регистрации на сайте, его ещё нет.
CREATE UNIQUE INDEX clients_org_inn_key ON public.clients (org_id, inn) WHERE inn IS NOT NULL;
CREATE INDEX clients_org_status_idx ON public.clients (org_id, status);
CREATE INDEX clients_sales_manager_idx ON public.clients (sales_manager_id);
CREATE INDEX clients_sites_manager_idx ON public.clients (sites_manager_id);

CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_clients
  AFTER INSERT OR UPDATE OR DELETE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes(
    'name', 'legal_name', 'inn', 'kpp', 'ogrn', 'legal_address', 'status', 'archive_reason',
    'sales_manager_id', 'sites_manager_id');

-- Контакты заказчика. Аккаунт (user_id) — это человек из кабинета заказчика.
CREATE TABLE public.client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  full_name text NOT NULL CHECK (length(btrim(full_name)) > 0),
  job_title text,
  phone text,
  email text,
  is_signer boolean NOT NULL DEFAULT false,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cabinet_role text CHECK (cabinet_role IN ('client_admin', 'client_manager')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, client_id) REFERENCES public.clients (org_id, id) ON DELETE CASCADE,
  CONSTRAINT client_contacts_account_has_role CHECK (user_id IS NULL OR cabinet_role IS NOT NULL)
);

CREATE INDEX client_contacts_client_idx ON public.client_contacts (client_id);
CREATE UNIQUE INDEX client_contacts_user_key ON public.client_contacts (client_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX client_contacts_user_idx ON public.client_contacts (user_id) WHERE user_id IS NOT NULL;

CREATE TRIGGER audit_client_contacts
  AFTER INSERT OR UPDATE OR DELETE ON public.client_contacts
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('client_id', 'full_name', 'is_signer', 'user_id', 'cabinet_role');

-- Договоры. Наша организация — это org_id.
CREATE TABLE public.contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  number text NOT NULL CHECK (length(btrim(number)) > 0),
  signed_on date NOT NULL,
  valid_until date,
  billing_period text NOT NULL DEFAULT 'month' CHECK (billing_period IN ('week', 'two_weeks', 'month')),
  payment_delay_days integer NOT NULL DEFAULT 0 CHECK (payment_delay_days >= 0 AND payment_delay_days <= 365),
  file_path text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'terminated')),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, client_id) REFERENCES public.clients (org_id, id) ON DELETE CASCADE,
  UNIQUE (org_id, client_id, number),
  CONSTRAINT contracts_dates_ordered CHECK (valid_until IS NULL OR valid_until >= signed_on)
);

CREATE INDEX contracts_client_idx ON public.contracts (client_id);
CREATE INDEX contracts_expiry_idx ON public.contracts (org_id, valid_until) WHERE status = 'active';

CREATE TRIGGER update_contracts_updated_at
  BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_contracts
  AFTER INSERT OR UPDATE OR DELETE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes(
    'client_id', 'number', 'signed_on', 'valid_until', 'billing_period', 'payment_delay_days', 'status');

-- Права по заказчику: через его ответственных (модуль задаёт вызывающая политика).
CREATE OR REPLACE FUNCTION private.client_in_scope(_client_id uuid, _module text, _action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = _client_id
      AND private.row_in_scope(c.org_id, _module, _action, ARRAY[c.sales_manager_id, c.sites_manager_id])
  )
$$;

-- Человек из кабинета заказчика видит свою компанию.
CREATE OR REPLACE FUNCTION private.is_client_contact(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT private.is_user_active(auth.uid())
    AND EXISTS (SELECT 1 FROM public.client_contacts WHERE client_id = _client_id AND user_id = auth.uid())
$$;

REVOKE EXECUTE ON FUNCTION private.client_in_scope(uuid, text, text), private.is_client_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.client_in_scope(uuid, text, text), private.is_client_contact(uuid) TO authenticated, service_role;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clients FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.clients TO authenticated;
GRANT UPDATE (name, legal_name, inn, kpp, ogrn, legal_address, bank_name, bank_account, bik, city, status,
              archive_reason, source_id, sales_manager_id, sites_manager_id, notes) ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;

CREATE POLICY "Clients: view in scope or own company" ON public.clients FOR SELECT TO authenticated
  USING (
    private.row_in_scope(org_id, 'clients', 'view', ARRAY[sales_manager_id, sites_manager_id])
    OR private.is_client_contact(id)
  );
CREATE POLICY "Clients: create in scope" ON public.clients FOR INSERT TO authenticated
  WITH CHECK (private.row_in_scope(org_id, 'clients', 'create', ARRAY[sales_manager_id, sites_manager_id]));
CREATE POLICY "Clients: update in scope" ON public.clients FOR UPDATE TO authenticated
  USING (private.row_in_scope(org_id, 'clients', 'update', ARRAY[sales_manager_id, sites_manager_id]))
  WITH CHECK (private.row_in_scope(org_id, 'clients', 'update', ARRAY[sales_manager_id, sites_manager_id]));
CREATE POLICY "Clients: delete in scope" ON public.clients FOR DELETE TO authenticated
  USING (private.row_in_scope(org_id, 'clients', 'delete', ARRAY[sales_manager_id, sites_manager_id]));

ALTER TABLE public.client_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_contacts FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.client_contacts TO authenticated;
GRANT UPDATE (full_name, job_title, phone, email, is_signer) ON public.client_contacts TO authenticated;
GRANT ALL ON public.client_contacts TO service_role;

-- Привязку к аккаунту и роль в кабинете меняет только администратор через service_role
-- (приглашение, шаг 11): иначе менеджер продаж мог бы сам выдать доступ в чужой кабинет.
CREATE POLICY "Contacts: view with client" ON public.client_contacts FOR SELECT TO authenticated
  USING (private.client_in_scope(client_id, 'clients', 'view') OR user_id = auth.uid());
CREATE POLICY "Contacts: add with client" ON public.client_contacts FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL AND cabinet_role IS NULL AND private.client_in_scope(client_id, 'clients', 'update'));
CREATE POLICY "Contacts: edit with client" ON public.client_contacts FOR UPDATE TO authenticated
  USING (private.client_in_scope(client_id, 'clients', 'update'))
  WITH CHECK (private.client_in_scope(client_id, 'clients', 'update'));
CREATE POLICY "Contacts: delete without account" ON public.client_contacts FOR DELETE TO authenticated
  USING (user_id IS NULL AND private.client_in_scope(client_id, 'clients', 'update'));

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contracts FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.contracts TO authenticated;
GRANT UPDATE (number, signed_on, valid_until, billing_period, payment_delay_days, file_path, status) ON public.contracts TO authenticated;
GRANT ALL ON public.contracts TO service_role;

CREATE POLICY "Contracts: view with client" ON public.contracts FOR SELECT TO authenticated
  USING (private.client_in_scope(client_id, 'clients', 'view'));
CREATE POLICY "Contracts: add with client" ON public.contracts FOR INSERT TO authenticated
  WITH CHECK (private.client_in_scope(client_id, 'clients', 'update'));
CREATE POLICY "Contracts: edit with client" ON public.contracts FOR UPDATE TO authenticated
  USING (private.client_in_scope(client_id, 'clients', 'update'))
  WITH CHECK (private.client_in_scope(client_id, 'clients', 'update'));
CREATE POLICY "Contracts: delete drafts" ON public.contracts FOR DELETE TO authenticated
  USING (status = 'draft' AND private.client_in_scope(client_id, 'clients', 'update'));

-- ============================================================
-- 4. Расчёт себестоимости и маржи (основа шага 10)
-- ============================================================
-- Формулы из ТЗ (раздел 11). «На руки» — ставка исполнителя; налоги ложатся сверху:
--   брутто = на руки / (1 − НДФЛ);  налоги = брутто − на руки + брутто × взносы;
--   комиссия выплаты = на руки × комиссия;  себестоимость = на руки + налоги + комиссия;
--   маржа = ставка заказчику − себестоимость. Каждая составляющая округляется до копеек.
CREATE OR REPLACE FUNCTION public.calc_margins(_org_id uuid, _client_rate numeric, _worker_rate numeric, _at date DEFAULT current_date)
RETURNS TABLE (status text, taxes numeric, payout_fee numeric, cost numeric, margin numeric, margin_pct numeric)
LANGUAGE sql
STABLE
SET search_path = public, private
AS $$
  SELECT s.status,
         round(g.gross - _worker_rate + g.gross * r.contributions_pct / 100, 2) AS taxes,
         round(_worker_rate * r.payout_fee_pct / 100, 2) AS payout_fee,
         _worker_rate
           + round(g.gross - _worker_rate + g.gross * r.contributions_pct / 100, 2)
           + round(_worker_rate * r.payout_fee_pct / 100, 2) AS cost,
         _client_rate - (_worker_rate
           + round(g.gross - _worker_rate + g.gross * r.contributions_pct / 100, 2)
           + round(_worker_rate * r.payout_fee_pct / 100, 2)) AS margin,
         CASE WHEN _client_rate > 0 THEN round((_client_rate - (_worker_rate
           + round(g.gross - _worker_rate + g.gross * r.contributions_pct / 100, 2)
           + round(_worker_rate * r.payout_fee_pct / 100, 2))) / _client_rate * 100, 1) END AS margin_pct
  FROM (VALUES ('ip'), ('self_employed'), ('gph'), ('employment')) AS s(status)
  CROSS JOIN LATERAL (SELECT * FROM public.get_tax_rate(_org_id, s.status, _at)) r
  CROSS JOIN LATERAL (SELECT _worker_rate / (1 - r.ndfl_pct / 100) AS gross) g
  WHERE r.id IS NOT NULL
  ORDER BY array_position(ARRAY['ip', 'self_employed', 'gph', 'employment'], s.status)
$$;

REVOKE EXECUTE ON FUNCTION public.calc_margins(uuid, numeric, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calc_margins(uuid, numeric, numeric, date) TO authenticated, service_role;

-- По какому налоговому статусу считается маржа тарифа для порога согласования.
-- Правило в ТЗ не названо (раздел 21): по умолчанию — самозанятый как самый частый случай.
INSERT INTO public.setting_definitions
  (key, group_name, label, description, value_type, default_value, nullable, unit, min_value, max_value, allowed_values, levels, needs_confirmation, sort_order)
VALUES
  ('tariff.margin_basis', 'Деньги', 'Налоговый статус для порога маржи тарифа',
   'По какому статусу исполнителя считается маржа при согласовании тарифа; min и max — по худшему и лучшему из статусов',
   'text', '"self_employed"', false, NULL, NULL, NULL,
   '["ip","self_employed","gph","employment","min","max"]', ARRAY['org'], true, 82);

-- ============================================================
-- 5. Тарифы
-- ============================================================
CREATE TABLE public.tariffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  -- NULL — тариф на все объекты заказчика; тариф на конкретный объект важнее общего.
  site_id uuid REFERENCES public.sites(id) ON DELETE RESTRICT,
  position_id uuid NOT NULL,
  unit text NOT NULL DEFAULT 'hour' CHECK (unit IN ('hour', 'shift', 'piece')),
  client_rate numeric(12,2) NOT NULL CHECK (client_rate >= 0),
  worker_rate numeric(12,2) NOT NULL CHECK (worker_rate >= 0),
  night_coef numeric(4,2) NOT NULL DEFAULT 1 CHECK (night_coef >= 0),
  holiday_coef numeric(4,2) NOT NULL DEFAULT 1 CHECK (holiday_coef >= 0),
  overtime_coef numeric(4,2) NOT NULL DEFAULT 1 CHECK (overtime_coef >= 0),
  min_paid_hours numeric(5,2) NOT NULL DEFAULT 0 CHECK (min_paid_hours >= 0),
  -- Минимальные часы применяются к сумме заказчику; к исполнителю — по этой галочке (Д-2).
  min_paid_hours_for_worker boolean NOT NULL DEFAULT false,
  valid_from date NOT NULL,
  valid_to date,
  -- Черновик → На согласовании → Утверждён → Закрыт (П-9). Меняется только функцией set_tariff_status.
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'closed')),
  note text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, client_id) REFERENCES public.clients (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, position_id) REFERENCES public.positions (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT tariffs_dates_ordered CHECK (valid_to IS NULL OR valid_to >= valid_from),
  -- Периоды утверждённых тарифов с одним ключом не пересекаются (раздел 4).
  CONSTRAINT tariffs_no_overlap EXCLUDE USING gist (
    org_id WITH =, client_id WITH =,
    (coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    position_id WITH =, unit WITH =,
    daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') WITH &&
  ) WHERE (status = 'approved')
);

CREATE INDEX tariffs_lookup_idx ON public.tariffs (org_id, client_id, position_id, unit, valid_from DESC) WHERE status = 'approved';
CREATE INDEX tariffs_client_idx ON public.tariffs (client_id);

CREATE TRIGGER update_tariffs_updated_at
  BEFORE UPDATE ON public.tariffs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_tariffs
  AFTER INSERT OR UPDATE OR DELETE ON public.tariffs
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes();

-- Согласованный тариф не правится: ставка меняется новой версией (П-10). Единственное
-- исключение — закрытие предшественника при утверждении новой версии, его делает функция.
CREATE OR REPLACE FUNCTION private.tariff_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, private
AS $$
BEGIN
  IF current_setting('app.tariff_internal', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'draft' AND (
       NEW.client_id, NEW.site_id, NEW.position_id, NEW.unit, NEW.client_rate, NEW.worker_rate,
       NEW.night_coef, NEW.holiday_coef, NEW.overtime_coef, NEW.min_paid_hours,
       NEW.min_paid_hours_for_worker, NEW.valid_from, NEW.valid_to)
     IS DISTINCT FROM (
       OLD.client_id, OLD.site_id, OLD.position_id, OLD.unit, OLD.client_rate, OLD.worker_rate,
       OLD.night_coef, OLD.holiday_coef, OLD.overtime_coef, OLD.min_paid_hours,
       OLD.min_paid_hours_for_worker, OLD.valid_from, OLD.valid_to) THEN
    RAISE EXCEPTION 'Тариф вне черновика не правится: создайте новую версию' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tariffs_guard
  BEFORE UPDATE ON public.tariffs
  FOR EACH ROW EXECUTE FUNCTION private.tariff_guard();

ALTER TABLE public.tariffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tariffs FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.tariffs TO authenticated;
GRANT UPDATE (site_id, position_id, unit, client_rate, worker_rate, night_coef, holiday_coef, overtime_coef,
              min_paid_hours, min_paid_hours_for_worker, valid_from, valid_to, note) ON public.tariffs TO authenticated;
GRANT ALL ON public.tariffs TO service_role;

-- Кабинет заказчика ставку исполнителя видеть не должен: прямого доступа к таблице у заказчика нет,
-- свои ставки он получит через отдельное представление (шаг 11).
CREATE POLICY "Tariffs: view in scope" ON public.tariffs FOR SELECT TO authenticated
  USING (private.client_in_scope(client_id, 'tariffs', 'view'));
CREATE POLICY "Tariffs: create drafts in scope" ON public.tariffs FOR INSERT TO authenticated
  WITH CHECK (status = 'draft' AND approved_by IS NULL AND private.client_in_scope(client_id, 'tariffs', 'create'));
CREATE POLICY "Tariffs: edit in scope" ON public.tariffs FOR UPDATE TO authenticated
  USING (private.client_in_scope(client_id, 'tariffs', 'update'))
  WITH CHECK (private.client_in_scope(client_id, 'tariffs', 'update'));
CREATE POLICY "Tariffs: delete drafts" ON public.tariffs FOR DELETE TO authenticated
  USING (status = 'draft' AND private.client_in_scope(client_id, 'tariffs', 'update'));

-- Маржа тарифа в % по налоговому статусу из настройки tariff.margin_basis.
CREATE OR REPLACE FUNCTION private.tariff_margin_pct(_t public.tariffs)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT CASE basis
           WHEN 'min' THEN (SELECT min(m.margin_pct) FROM public.calc_margins(_t.org_id, _t.client_rate, _t.worker_rate, _t.valid_from) m)
           WHEN 'max' THEN (SELECT max(m.margin_pct) FROM public.calc_margins(_t.org_id, _t.client_rate, _t.worker_rate, _t.valid_from) m)
           ELSE (SELECT m.margin_pct FROM public.calc_margins(_t.org_id, _t.client_rate, _t.worker_rate, _t.valid_from) m WHERE m.status = basis)
         END
  FROM (SELECT public.get_setting(_t.org_id, 'tariff.margin_basis', current_date) #>> '{}' AS basis) b
$$;

-- Смена статуса тарифа с проверкой, кто вправе (П-9).
--   Черновик → На согласовании: тот, кто правит тарифы заказчика.
--   На согласовании → Утверждён: руководитель компании; руководитель отдела продаж — если маржа не ниже порога.
--   На согласовании → Черновик: возврат на доработку тем, кто согласует или правит.
--   Утверждён → Закрыт, Черновик → Закрыт: тот, кто правит тарифы заказчика.
-- Утверждение новой версии закрывает предыдущую датой «за день до» начала новой.
CREATE OR REPLACE FUNCTION public.set_tariff_status(_tariff_id uuid, _new_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  t public.tariffs;
  threshold numeric;
  pct numeric;
  is_director boolean;
  is_sales_head boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_user_active(auth.uid()) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO t FROM public.tariffs WHERE id = _tariff_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Тариф не найден' USING ERRCODE = 'P0002';
  END IF;

  is_director := private.has_org_role(auth.uid(), 'director', t.org_id);
  is_sales_head := private.has_org_role(auth.uid(), 'sales', t.org_id)
    AND EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = auth.uid() AND department = 'sales' AND is_department_head);

  PERFORM set_config('app.tariff_internal', 'on', true);

  IF t.status = 'draft' AND _new_status = 'pending' THEN
    IF NOT private.client_in_scope(t.client_id, 'tariffs', 'update') THEN
      RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
    END IF;
    UPDATE public.tariffs SET status = 'pending', submitted_at = now() WHERE id = t.id;

  ELSIF t.status = 'pending' AND _new_status = 'approved' THEN
    pct := private.tariff_margin_pct(t);
    threshold := public.get_setting_numeric(t.org_id, 'tariff.min_margin_pct', current_date);
    IF NOT (is_director OR (is_sales_head AND pct IS NOT NULL AND pct >= threshold)) THEN
      RAISE EXCEPTION 'Тариф с маржой % %% (порог % %%) утверждает %',
        coalesce(pct::text, 'не определена'), threshold,
        CASE WHEN pct IS NOT NULL AND pct >= threshold THEN 'руководитель компании или руководитель отдела продаж'
             ELSE 'руководитель компании' END
        USING ERRCODE = '42501';
    END IF;
    -- Предыдущая версия того же тарифа заканчивается накануне.
    UPDATE public.tariffs p SET valid_to = t.valid_from - 1
     WHERE p.id <> t.id AND p.status = 'approved' AND p.org_id = t.org_id AND p.client_id = t.client_id
       AND coalesce(p.site_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(t.site_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND p.position_id = t.position_id AND p.unit = t.unit
       AND p.valid_from < t.valid_from AND (p.valid_to IS NULL OR p.valid_to >= t.valid_from);
    UPDATE public.tariffs SET status = 'approved', approved_by = auth.uid(), approved_at = now() WHERE id = t.id;

  ELSIF t.status = 'pending' AND _new_status = 'draft' THEN
    IF NOT (is_director OR is_sales_head OR private.client_in_scope(t.client_id, 'tariffs', 'update')) THEN
      RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
    END IF;
    UPDATE public.tariffs SET status = 'draft', submitted_at = NULL WHERE id = t.id;

  ELSIF t.status IN ('draft', 'approved') AND _new_status = 'closed' THEN
    IF NOT private.client_in_scope(t.client_id, 'tariffs', 'update') THEN
      RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
    END IF;
    UPDATE public.tariffs SET status = 'closed', closed_at = now(),
           valid_to = CASE WHEN t.status = 'approved' THEN least(coalesce(t.valid_to, current_date), current_date) ELSE t.valid_to END
     WHERE id = t.id;

  ELSE
    RAISE EXCEPTION 'Переход «% → %» невозможен', t.status, _new_status USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.tariff_internal', 'off', true);
END;
$$;

-- Новая версия тарифа: черновик с теми же условиями и другими ставками с даты (П-10).
CREATE OR REPLACE FUNCTION public.new_tariff_version(_tariff_id uuid, _client_rate numeric, _worker_rate numeric, _valid_from date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  t public.tariffs;
  new_id uuid;
BEGIN
  SELECT * INTO t FROM public.tariffs WHERE id = _tariff_id;
  IF NOT FOUND OR NOT private.client_in_scope(t.client_id, 'tariffs', 'create') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF t.status NOT IN ('approved', 'closed') THEN
    RAISE EXCEPTION 'Новую версию можно создать только от утверждённого или закрытого тарифа' USING ERRCODE = '22023';
  END IF;
  IF _valid_from < current_date THEN
    RAISE EXCEPTION 'Новая версия начинается не раньше сегодняшнего дня' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tariffs (org_id, client_id, site_id, position_id, unit, client_rate, worker_rate, night_coef,
                              holiday_coef, overtime_coef, min_paid_hours, min_paid_hours_for_worker, valid_from, note)
  VALUES (t.org_id, t.client_id, t.site_id, t.position_id, t.unit, _client_rate, _worker_rate, t.night_coef,
          t.holiday_coef, t.overtime_coef, t.min_paid_hours, t.min_paid_hours_for_worker, _valid_from,
          'Новая версия тарифа от ' || t.valid_from::text)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- Применимый тариф на дату: утверждённый, действующий, объектный важнее общего.
CREATE OR REPLACE FUNCTION public.get_tariff(_client_id uuid, _site_id uuid, _position_id uuid, _unit text, _at date DEFAULT current_date)
RETURNS public.tariffs
LANGUAGE sql
STABLE
SET search_path = public, private
AS $$
  SELECT t.* FROM public.tariffs t
  WHERE t.client_id = _client_id AND t.position_id = _position_id AND t.unit = _unit AND t.status = 'approved'
    AND t.valid_from <= _at AND (t.valid_to IS NULL OR t.valid_to >= _at)
    AND (t.site_id IS NULL OR t.site_id = _site_id)
  ORDER BY (t.site_id IS NOT NULL) DESC, t.valid_from DESC
  LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.set_tariff_status(uuid, text), public.new_tariff_version(uuid, numeric, numeric, date),
  public.get_tariff(uuid, uuid, uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_tariff_status(uuid, text), public.new_tariff_version(uuid, numeric, numeric, date),
  public.get_tariff(uuid, uuid, uuid, text, date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.tariff_margin_pct(public.tariffs) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.tariff_margin_pct(public.tariffs) TO authenticated, service_role;

-- ============================================================
-- 6. Передача заказчика в ведение объектов (П-11)
-- ============================================================
-- Задача с чек-листом запуска придёт вместе с уведомлениями (шаг 12); пока назначается ответственный.
CREATE OR REPLACE FUNCTION public.handoff_client(_client_id uuid, _sites_manager_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  c public.clients;
BEGIN
  SELECT * INTO c FROM public.clients WHERE id = _client_id;
  IF NOT FOUND OR NOT private.row_in_scope(c.org_id, 'clients', 'update', ARRAY[c.sales_manager_id, c.sites_manager_id]) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF NOT private.has_org_role(_sites_manager_id, 'site_manager', c.org_id) THEN
    RAISE EXCEPTION 'Ответственным за объекты можно назначить только менеджера объекта этой организации' USING ERRCODE = '22023';
  END IF;
  UPDATE public.clients SET sites_manager_id = _sites_manager_id WHERE id = _client_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handoff_client(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handoff_client(uuid, uuid) TO authenticated, service_role;

-- ============================================================
-- 7. Заказчики из существующих HR-пользователей и из новых регистраций
-- ============================================================
-- Заказчик-лид с контактом-администратором. Название берётся из компании, затем из ФИО и email.
CREATE OR REPLACE FUNCTION private.create_client_lead(_org_id uuid, _user_id uuid, _full_name text, _email text, _phone text, _company text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  cid uuid;
BEGIN
  INSERT INTO public.clients (org_id, name, status)
  VALUES (_org_id, coalesce(nullif(btrim(_company), ''), nullif(btrim(_full_name), ''), _email, 'Без названия'), 'lead')
  RETURNING id INTO cid;

  INSERT INTO public.client_contacts (org_id, client_id, full_name, phone, email, user_id, cabinet_role)
  VALUES (_org_id, cid, coalesce(nullif(btrim(_full_name), ''), _email, 'Контакт'), _phone, _email, _user_id, 'client_admin');
  RETURN cid;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.create_client_lead(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- Саморегистрация HR создаёт лида, а не активного заказчика (П-5). К существующему заказчику по
-- названию компании НЕ присоединяем: иначе, назвав чужую компанию, можно получить доступ к её данным.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _meta_role text;
  _role app_role;
  _org uuid;
BEGIN
  _meta_role := NEW.raw_user_meta_data ->> 'role';
  IF _meta_role IN ('hr','worker') THEN
    _role := _meta_role::app_role;
  ELSE
    _role := 'worker'::app_role;
  END IF;

  INSERT INTO public.profiles (user_id, email, full_name, company, login)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'company',
    NEW.raw_user_meta_data ->> 'login'
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _role)
  RETURNING org_id INTO _org;

  IF _role = 'hr' THEN
    PERFORM private.create_client_lead(
      _org, NEW.id, NEW.raw_user_meta_data ->> 'full_name', NEW.email, NULL, NEW.raw_user_meta_data ->> 'company');
  END IF;

  RETURN NEW;
END;
$$;

-- Перенос существующих HR-пользователей: компании с одним названием объединяются в одного заказчика
-- (дубли потом проверяет менеджер по продажам). Заказчик становится «Активным», если у кого-то из его
-- людей есть заявки, иначе остаётся лидом. Безопасно запускать повторно: уже связанные пропускаются.
CREATE OR REPLACE FUNCTION private.migrate_hr_to_clients()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  g record;
  u record;
  cid uuid;
  created integer := 0;
  first_contact boolean;
BEGIN
  FOR g IN
    SELECT ur.org_id,
           lower(btrim(coalesce(nullif(btrim(p.company), ''), nullif(btrim(p.full_name), ''), p.email, p.user_id::text))) AS grp,
           min(coalesce(nullif(btrim(p.company), ''), nullif(btrim(p.full_name), ''), p.email, 'Без названия')) AS display_name,
           bool_or(EXISTS (SELECT 1 FROM public.requests r WHERE r.hr_id = p.user_id)) AS has_requests
    FROM public.user_roles ur
    JOIN public.profiles p ON p.user_id = ur.user_id
    WHERE ur.role = 'hr'
      AND NOT EXISTS (SELECT 1 FROM public.client_contacts cc WHERE cc.user_id = ur.user_id)
    GROUP BY ur.org_id, 2
  LOOP
    INSERT INTO public.clients (org_id, name, status)
    VALUES (g.org_id, g.display_name, CASE WHEN g.has_requests THEN 'active' ELSE 'lead' END)
    RETURNING id INTO cid;
    created := created + 1;
    first_contact := true;

    FOR u IN
      SELECT p.user_id, p.full_name, p.email, p.phone
      FROM public.user_roles ur
      JOIN public.profiles p ON p.user_id = ur.user_id
      WHERE ur.role = 'hr' AND ur.org_id = g.org_id
        AND lower(btrim(coalesce(nullif(btrim(p.company), ''), nullif(btrim(p.full_name), ''), p.email, p.user_id::text))) = g.grp
        AND NOT EXISTS (SELECT 1 FROM public.client_contacts cc WHERE cc.user_id = p.user_id)
      ORDER BY p.created_at, p.user_id
    LOOP
      INSERT INTO public.client_contacts (org_id, client_id, full_name, phone, email, user_id, cabinet_role)
      VALUES (g.org_id, cid, coalesce(nullif(btrim(u.full_name), ''), u.email, 'Контакт'), u.phone, u.email, u.user_id,
              CASE WHEN first_contact THEN 'client_admin' ELSE 'client_manager' END);
      first_contact := false;
    END LOOP;
  END LOOP;
  RETURN created;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.migrate_hr_to_clients() FROM PUBLIC, anon, authenticated;
SELECT private.migrate_hr_to_clients();
