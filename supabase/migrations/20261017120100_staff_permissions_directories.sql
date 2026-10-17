-- Этап 1, шаг 3 (часть 2): сотрудники, права ролей, справочники.
-- ТЗ: раздел 2 (матрица прав), раздел 6 (А-4, А-5, А-8, А-9).
--
-- Не входит в эту миграцию: приглашение сотрудника по email (нужен SMTP — раздел 21;
-- делается edge-функцией) и передача заказчиков, объектов и кандидатов при блокировке
-- (А-4, вторая половина): этих таблиц ещё нет, передача добавляется в шагах 4 и 8.

-- ============================================================
-- 0. Журнал: идентификатор записи и организации для таблиц без собственных id и org_id
-- ============================================================
-- Таблицы этого шага не укладываются в схему «id + org_id»: у role_permissions составной ключ,
-- а профиль сотрудника не привязан к одной организации (у человека могут быть роли в нескольких).
-- Для профиля запись журнала пишется в каждую организацию, где у человека есть роль.
CREATE OR REPLACE FUNCTION private.audit_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _old jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  _new jsonb := CASE WHEN TG_OP IN ('UPDATE', 'INSERT') THEN to_jsonb(NEW) END;
  _row jsonb := coalesce(_new, _old);
  _org uuid := coalesce((_row ->> 'org_id')::uuid, CASE WHEN TG_TABLE_NAME = 'organizations' THEN (_row ->> 'id')::uuid END);
  _orgs uuid[];
  _o uuid;
  _rec text := coalesce(
    _row ->> 'id',
    CASE TG_TABLE_NAME
      WHEN 'role_permissions' THEN (_row ->> 'role') || '/' || (_row ->> 'module') || '/' || (_row ->> 'action')
      WHEN 'staff_profiles' THEN _row ->> 'user_id'
    END
  );
  _cols text[];
  _col text;
BEGIN
  IF _org IS NOT NULL THEN
    _orgs := ARRAY[_org];
  ELSIF TG_TABLE_NAME = 'staff_profiles' THEN
    SELECT coalesce(array_agg(DISTINCT org_id), ARRAY[NULL]::uuid[]) INTO _orgs
    FROM public.user_roles WHERE user_id = (_row ->> 'user_id')::uuid;
  ELSE
    _orgs := ARRAY[NULL]::uuid[];
  END IF;

  IF TG_NARGS > 0 THEN
    _cols := TG_ARGV;
  ELSE
    SELECT array_agg(key) INTO _cols FROM jsonb_object_keys(_row) AS key
    WHERE key NOT IN ('created_at', 'updated_at');
  END IF;

  FOREACH _o IN ARRAY _orgs LOOP
    IF TG_OP = 'UPDATE' THEN
      FOREACH _col IN ARRAY _cols LOOP
        IF _old -> _col IS DISTINCT FROM _new -> _col THEN
          INSERT INTO public.audit_log (org_id, actor_id, action, table_name, record_id, field, old_value, new_value)
          VALUES (_o, auth.uid(), 'update', TG_TABLE_NAME, _rec, _col, _old ->> _col, _new ->> _col);
        END IF;
      END LOOP;
    ELSE
      INSERT INTO public.audit_log (org_id, actor_id, action, table_name, record_id, old_value, new_value)
      VALUES (
        _o, auth.uid(), lower(TG_OP), TG_TABLE_NAME, _rec,
        CASE WHEN TG_OP = 'DELETE' THEN (SELECT jsonb_object_agg(k, _old -> k) FROM unnest(_cols) k)::text END,
        CASE WHEN TG_OP = 'INSERT' THEN (SELECT jsonb_object_agg(k, _new -> k) FROM unnest(_cols) k)::text END
      );
    END IF;
  END LOOP;

  RETURN coalesce(NEW, OLD);
END;
$$;

-- ============================================================
-- 1. Профиль сотрудника и блокировка
-- ============================================================
CREATE TABLE public.staff_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (length(btrim(full_name)) > 0),
  department text NOT NULL CHECK (department IN ('management', 'sales', 'sites', 'hiring', 'accounting', 'admin')),
  job_title text,
  phone text,
  -- Руководитель отдела видит все записи отдела (область «department» в правах).
  is_department_head boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  blocked_at timestamptz,
  blocked_by uuid,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER update_staff_profiles_updated_at
  BEFORE UPDATE ON public.staff_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- В журнал идут изменения отдела, должности и признака руководителя, блокировка и разблокировка.
CREATE TRIGGER audit_staff_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_profiles
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('user_id', 'full_name', 'department', 'job_title', 'is_department_head', 'is_active');

-- Заблокированный сотрудник перестаёт быть участником организации и терять права
-- должен сразу, а не когда истечёт его токен: проверка встроена в функции доступа,
-- на которых держатся политики.
CREATE OR REPLACE FUNCTION private.is_user_active(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = _user_id AND NOT is_active)
$$;

REVOKE EXECUTE ON FUNCTION private.is_user_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_user_active(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.is_user_active(_user_id)
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION private.has_org_role(_user_id uuid, _role app_role, _org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT private.is_user_active(_user_id)
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role AND org_id = _org_id)
$$;

CREATE OR REPLACE FUNCTION private.is_org_member(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT private.is_user_active(auth.uid())
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND org_id = _org_id)
$$;

CREATE OR REPLACE FUNCTION private.user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT DISTINCT org_id FROM public.user_roles
  WHERE user_id = auth.uid() AND private.is_user_active(auth.uid())
$$;

ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_profiles FROM anon, authenticated;
GRANT SELECT ON public.staff_profiles TO authenticated;
GRANT ALL ON public.staff_profiles TO service_role;

-- Свой профиль и коллег по организации видит любой участник: нужно, чтобы показывать
-- имена ответственных. Изменения идут через функции ниже и edge-функцию приглашения.
CREATE POLICY "Staff can read own profile and colleagues"
  ON public.staff_profiles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = staff_profiles.user_id AND private.is_org_member(ur.org_id)
    )
  );

-- Администратор организации правит профиль сотрудника, у которого есть роль в его организации.
CREATE OR REPLACE FUNCTION private.is_admin_of_user(_target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _target AND private.has_org_role(auth.uid(), 'admin', ur.org_id)
  )
$$;
REVOKE EXECUTE ON FUNCTION private.is_admin_of_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_admin_of_user(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_staff_profile(
  _user_id uuid, _full_name text, _department text, _job_title text DEFAULT NULL,
  _phone text DEFAULT NULL, _is_department_head boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_admin_of_user(_user_id) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  UPDATE public.staff_profiles
     SET full_name = _full_name, department = _department, job_title = _job_title,
         phone = _phone, is_department_head = _is_department_head
   WHERE user_id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Сотрудник не найден' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- Блокировка закрывает вход (бан в GoTrue), все открытые сессии и, через
-- private.is_user_active, права в базе — сразу, не дожидаясь истечения токена.
CREATE OR REPLACE FUNCTION public.block_staff(_user_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_admin_of_user(_user_id) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'Нельзя заблокировать самого себя' USING ERRCODE = '22023';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) = 0 THEN
    RAISE EXCEPTION 'Укажите причину блокировки' USING ERRCODE = '22023';
  END IF;

  UPDATE public.staff_profiles
     SET is_active = false, blocked_at = now(), blocked_by = auth.uid()
   WHERE user_id = _user_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Сотрудник не найден или уже заблокирован' USING ERRCODE = 'P0002';
  END IF;

  UPDATE auth.users SET banned_until = 'infinity' WHERE id = _user_id;
  IF to_regclass('auth.sessions') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.sessions WHERE user_id = $1' USING _user_id;
  END IF;

  -- Причина — только в журнале, а не в профиле, который видят коллеги.
  INSERT INTO public.audit_log (org_id, actor_id, action, table_name, record_id, field, old_value, new_value, note)
  SELECT ur.org_id, auth.uid(), 'update', 'staff_profiles', _user_id::text, 'block', 'active', 'blocked', _reason
  FROM (SELECT DISTINCT org_id FROM public.user_roles WHERE user_id = _user_id) ur;
END;
$$;

CREATE OR REPLACE FUNCTION public.unblock_staff(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_admin_of_user(_user_id) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  UPDATE public.staff_profiles
     SET is_active = true, blocked_at = NULL, blocked_by = NULL
   WHERE user_id = _user_id AND NOT is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Сотрудник не найден или не заблокирован' USING ERRCODE = 'P0002';
  END IF;
  UPDATE auth.users SET banned_until = NULL WHERE id = _user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_staff_profile(uuid, text, text, text, text, boolean),
  public.block_staff(uuid, text), public.unblock_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_staff_profile(uuid, text, text, text, text, boolean),
  public.block_staff(uuid, text), public.unblock_staff(uuid) TO authenticated, service_role;

-- ============================================================
-- 2. Права ролей: модуль × действие × область
-- ============================================================
CREATE TABLE public.role_permissions (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  module text NOT NULL,
  action text NOT NULL CHECK (action IN ('view', 'create', 'update', 'delete', 'export')),
  -- none — нет доступа; own — свои записи; department — записи отдела; all — все записи организации.
  scope text NOT NULL DEFAULT 'none' CHECK (scope IN ('none', 'own', 'department', 'all')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, role, module, action)
);

CREATE TRIGGER update_role_permissions_updated_at
  BEFORE UPDATE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_role_permissions
  AFTER UPDATE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('scope');

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.role_permissions FROM anon, authenticated;
GRANT SELECT ON public.role_permissions TO authenticated;
GRANT UPDATE (scope) ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;

CREATE POLICY "Members can read role permissions"
  ON public.role_permissions FOR SELECT TO authenticated
  USING (private.is_org_member(org_id));

-- Сетка фиксирована: администратор меняет только область, строки не добавляет и не удаляет.
CREATE POLICY "Org admins can change permission scope"
  ON public.role_permissions FOR UPDATE TO authenticated
  USING (private.has_org_role(auth.uid(), 'admin', org_id))
  WITH CHECK (private.has_org_role(auth.uid(), 'admin', org_id));

-- Наибольшая область среди ролей пользователя в организации. Основа для политик
-- таблиц следующих шагов: where scope = 'all' or (scope = 'own' and ...).
CREATE OR REPLACE FUNCTION private.permission_scope(_user_id uuid, _org_id uuid, _module text, _action text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT coalesce(
    (SELECT rp.scope
       FROM public.user_roles ur
       JOIN public.role_permissions rp
         ON rp.org_id = ur.org_id AND rp.role = ur.role AND rp.module = _module AND rp.action = _action
      WHERE ur.user_id = _user_id AND ur.org_id = _org_id AND private.is_user_active(_user_id)
      ORDER BY CASE rp.scope WHEN 'all' THEN 1 WHEN 'department' THEN 2 WHEN 'own' THEN 3 ELSE 4 END
      LIMIT 1),
    'none')
$$;

REVOKE EXECUTE ON FUNCTION private.permission_scope(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.permission_scope(uuid, uuid, text, text) TO authenticated, service_role;

-- Права текущего пользователя для интерфейса (какие разделы показывать).
CREATE OR REPLACE FUNCTION public.my_permissions(_org_id uuid)
RETURNS TABLE (module text, action text, scope text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT rp.module, rp.action,
         (array_agg(rp.scope ORDER BY CASE rp.scope WHEN 'all' THEN 1 WHEN 'department' THEN 2 WHEN 'own' THEN 3 ELSE 4 END))[1]
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.org_id = ur.org_id AND rp.role = ur.role
   WHERE ur.user_id = auth.uid() AND ur.org_id = _org_id AND private.is_user_active(auth.uid())
   GROUP BY rp.module, rp.action
$$;

REVOKE EXECUTE ON FUNCTION public.my_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_permissions(uuid) TO authenticated, service_role;

-- ============================================================
-- 3. Справочники
-- ============================================================
CREATE TABLE public.directories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'worker_group', 'candidate_source', 'client_source',
    'no_show_reason', 'cancel_reason', 'candidate_reject_reason', 'holiday'
  )),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  -- Для праздничных дней — дата праздника.
  item_date date,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (org_id, kind, name, item_date),
  CONSTRAINT directories_holiday_has_date CHECK ((kind = 'holiday') = (item_date IS NOT NULL))
);

CREATE INDEX directories_org_kind_idx ON public.directories (org_id, kind, sort_order);

CREATE TRIGGER audit_directories
  AFTER INSERT OR UPDATE OR DELETE ON public.directories
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('kind', 'name', 'item_date', 'is_active');

ALTER TABLE public.directories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.directories FROM anon, authenticated;
-- DELETE не выдаётся никому (А-9): используемую запись скрывают флагом is_active.
GRANT SELECT, INSERT ON public.directories TO authenticated;
GRANT UPDATE (name, item_date, sort_order, is_active) ON public.directories TO authenticated;
GRANT ALL ON public.directories TO service_role;

CREATE POLICY "Members can read directories"
  ON public.directories FOR SELECT TO authenticated
  USING (private.is_org_member(org_id));

CREATE POLICY "Org admins can add directory items"
  ON public.directories FOR INSERT TO authenticated
  WITH CHECK (private.has_org_role(auth.uid(), 'admin', org_id));

CREATE POLICY "Org admins can edit directory items"
  ON public.directories FOR UPDATE TO authenticated
  USING (private.has_org_role(auth.uid(), 'admin', org_id))
  WITH CHECK (private.has_org_role(auth.uid(), 'admin', org_id));

-- ============================================================
-- 4. Стартовые данные организации: права по матрице ТЗ и справочники
-- ============================================================
-- Матрица прав из ТЗ (раздел 2). Код ячейки: P — полный доступ, S — только свои записи,
-- R — только чтение, SR — только чтение своих записей, A — аналитика вся организация,
-- D — аналитика своего отдела, «-» — нет доступа. Столбцы: director, sales, site_manager,
-- recruiter, accountant, admin.
CREATE OR REPLACE FUNCTION private.seed_org_defaults(_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  INSERT INTO public.tax_status_rates (org_id, status, ndfl_pct, contributions_pct, payout_fee_pct, effective_from, confirmed, note)
  VALUES
    (_org_id, 'ip',            0,  0, 0, DATE '2000-01-01', false, 'Предложено в ТЗ, подтвердить с бухгалтерией'),
    (_org_id, 'self_employed', 0,  0, 2, DATE '2000-01-01', false, 'Комиссия платформы 2% — предложено в ТЗ, подтвердить'),
    (_org_id, 'gph',          13, 30, 0, DATE '2000-01-01', false, 'НДФЛ 13% и взносы 30% — предложено в ТЗ, подтвердить'),
    (_org_id, 'employment',   13, 30, 0, DATE '2000-01-01', false, 'Ставки не заданы в ТЗ: взяты как у ГПХ, подтвердить')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.role_permissions (org_id, role, module, action, scope)
  SELECT _org_id, r.role::public.app_role, m.module, a.action,
    CASE m.codes[r.idx]
      WHEN 'P'  THEN 'all'
      WHEN 'R'  THEN CASE a.action WHEN 'view' THEN 'all' ELSE 'none' END
      WHEN 'S'  THEN CASE a.action WHEN 'delete' THEN 'none' ELSE 'own' END
      WHEN 'SR' THEN CASE a.action WHEN 'view' THEN 'own' ELSE 'none' END
      WHEN 'A'  THEN CASE a.action WHEN 'view' THEN 'all' WHEN 'export' THEN 'all' ELSE 'none' END
      WHEN 'D'  THEN CASE a.action WHEN 'view' THEN 'department' ELSE 'none' END
      ELSE 'none'
    END
  FROM (VALUES
    ('clients',               ARRAY['P','S','R','-','R','R']),
    ('tariffs',               ARRAY['P','S','R','-','R','R']),
    ('sites',                 ARRAY['P','R','S','R','R','R']),
    ('orders',                ARRAY['P','R','S','R','R','R']),
    ('assignments',           ARRAY['P','-','S','R','R','R']),
    ('timesheets',            ARRAY['P','-','S','-','R','R']),
    ('candidates',            ARRAY['P','-','-','S','-','R']),
    ('workers',               ARRAY['P','-','R','P','R','R']),
    ('worker_documents',      ARRAY['P','-','-','P','R','-']),
    ('worker_payout_details', ARRAY['P','-','-','R','P','-']),
    ('accruals',              ARRAY['P','SR','SR','-','P','-']),
    ('client_documents',      ARRAY['P','SR','-','-','P','-']),
    ('payout_registries',     ARRAY['P','-','-','-','P','-']),
    ('cashflow',              ARRAY['P','-','-','-','P','-']),
    ('analytics',             ARRAY['A','D','D','D','D','-']),
    ('users_directories',     ARRAY['P','-','-','-','-','P'])
  ) AS m(module, codes)
  CROSS JOIN (VALUES (1, 'director'), (2, 'sales'), (3, 'site_manager'), (4, 'recruiter'), (5, 'accountant'), (6, 'admin')) AS r(idx, role)
  CROSS JOIN (VALUES ('view'), ('create'), ('update'), ('delete'), ('export')) AS a(action)
  ON CONFLICT DO NOTHING;

  -- Источники кандидатов названы в ТЗ (раздел 10, Н-2).
  INSERT INTO public.directories (org_id, kind, name, sort_order) VALUES
    (_org_id, 'candidate_source', 'Регистрация на сайте', 1),
    (_org_id, 'candidate_source', 'Форма на сайте', 2),
    (_org_id, 'candidate_source', 'Вручную', 3),
    (_org_id, 'candidate_source', 'Импорт из Excel', 4),
    (_org_id, 'candidate_source', 'Привёл исполнитель', 5),
  -- Причины нужны сразу: без причины нельзя оформить неявку, отмену или отказ (О-17).
  -- Состав — рабочая заготовка, администратор правит под себя.
    (_org_id, 'no_show_reason', 'Не вышел без предупреждения', 1),
    (_org_id, 'no_show_reason', 'Заболел', 2),
    (_org_id, 'no_show_reason', 'Личные обстоятельства', 3),
    (_org_id, 'no_show_reason', 'Проблемы с транспортом', 4),
    (_org_id, 'cancel_reason', 'Изменились планы', 1),
    (_org_id, 'cancel_reason', 'Заболел', 2),
    (_org_id, 'cancel_reason', 'Нашёл другую работу', 3),
    (_org_id, 'cancel_reason', 'Смену отменил заказчик', 4),
    (_org_id, 'candidate_reject_reason', 'Не дозвонились', 1),
    (_org_id, 'candidate_reject_reason', 'Не подходят условия', 2),
    (_org_id, 'candidate_reject_reason', 'Нет нужных документов', 3),
    (_org_id, 'candidate_reject_reason', 'Не прошёл проверку', 4),
    (_org_id, 'candidate_reject_reason', 'Передумал', 5)
  ON CONFLICT DO NOTHING;

  -- Праздничные дни с фиксированной датой (ст. 112 ТК РФ) на 2026 и 2027 годы.
  -- Переносы выходных по производственному календарю администратор добавляет сам.
  INSERT INTO public.directories (org_id, kind, name, item_date)
  SELECT _org_id, 'holiday', h.name, make_date(y.year, h.month, h.day)
  FROM (VALUES (2026), (2027)) AS y(year)
  CROSS JOIN (VALUES
    ('Новогодние каникулы', 1, 1), ('Новогодние каникулы', 1, 2), ('Новогодние каникулы', 1, 3),
    ('Новогодние каникулы', 1, 4), ('Новогодние каникулы', 1, 5), ('Новогодние каникулы', 1, 6),
    ('Рождество Христово', 1, 7), ('Новогодние каникулы', 1, 8),
    ('День защитника Отечества', 2, 23), ('Международный женский день', 3, 8),
    ('Праздник Весны и Труда', 5, 1), ('День Победы', 5, 9),
    ('День России', 6, 12), ('День народного единства', 11, 4)
  ) AS h(name, month, day)
  ON CONFLICT DO NOTHING;
END;
$$;

-- Для организаций, созданных до этой миграции.
SELECT private.seed_org_defaults(id) FROM public.organizations;
