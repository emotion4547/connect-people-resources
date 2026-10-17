-- Этап 1, шаг 1: организации (своё юрлицо/ИП), привязка ролей к организации,
-- журнал изменений. ТЗ: разделы 4, 6 (А-1, А-2), 13 (Ж-1, Ж-2).
--
-- ВАЖНО. Эта миграция делает изолированными организации, роли и журнал.
-- Остальные таблицы (sites, requests, responses и т.д.) получат org_id и
-- политики по организации в шагах, где их перестраивают (4–7). До тех пор
-- private.has_role() остаётся глобальной: администратор любой организации
-- видит и правит старые таблицы целиком. Пока в системе одна организация,
-- это безопасно; вторую организацию с реальными данными заводить только
-- после шагов 4–7.

-- ============================================================
-- 1. Организации
-- ============================================================
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  legal_form text NOT NULL DEFAULT 'ООО' CHECK (legal_form IN ('ООО', 'ИП')),
  inn text,
  kpp text,
  ogrn text,
  address text,
  bank_name text,
  bank_account text,
  bik text,
  -- Налоговый режим и НДС: список и ставки уточняются у клиента (ТЗ, раздел 21, вопрос 1).
  tax_regime text NOT NULL DEFAULT 'usn6' CHECK (tax_regime IN ('usn6', 'usn15', 'osno')),
  vat_rate numeric(4,2) NOT NULL DEFAULT 0 CHECK (vat_rate >= 0 AND vat_rate <= 100),
  signer_name text,
  signer_position text,
  logo_path text,
  stamp_path text,
  signature_path text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Организация по умолчанию: к ней привязываются все уже существующие роли.
-- Название администратор поменяет в карточке организации.
INSERT INTO public.organizations (name) VALUES ('Основная организация');

-- Самая старая организация. Нужна как значение по умолчанию для user_roles.org_id,
-- чтобы регистрация (handle_new_user) и текущий интерфейс продолжали работать без правок.
CREATE OR REPLACE FUNCTION private.default_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT id FROM public.organizations ORDER BY created_at, id LIMIT 1
$$;

-- ============================================================
-- 2. Роли привязываются к организации
-- ============================================================
ALTER TABLE public.user_roles ADD COLUMN org_id uuid;
UPDATE public.user_roles SET org_id = private.default_org_id() WHERE org_id IS NULL;
ALTER TABLE public.user_roles
  ALTER COLUMN org_id SET NOT NULL,
  ALTER COLUMN org_id SET DEFAULT private.default_org_id(),
  ADD CONSTRAINT user_roles_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;

ALTER TABLE public.user_roles DROP CONSTRAINT user_roles_user_id_role_key;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_role_org_id_key UNIQUE (user_id, role, org_id);
CREATE INDEX user_roles_org_id_idx ON public.user_roles (org_id);

-- ============================================================
-- 3. Функции проверки доступа по организации (для RLS и серверных функций)
-- ============================================================
CREATE OR REPLACE FUNCTION private.has_org_role(_user_id uuid, _role app_role, _org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role AND org_id = _org_id
  )
$$;

CREATE OR REPLACE FUNCTION private.is_org_member(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND org_id = _org_id
  )
$$;

-- Организации текущего пользователя: основа переключателя в шапке (А-2).
CREATE OR REPLACE FUNCTION private.user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT DISTINCT org_id FROM public.user_roles WHERE user_id = auth.uid()
$$;

REVOKE EXECUTE ON FUNCTION private.default_org_id(), private.has_org_role(uuid, app_role, uuid),
  private.is_org_member(uuid), private.user_org_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.default_org_id(), private.has_org_role(uuid, app_role, uuid),
  private.is_org_member(uuid), private.user_org_ids() TO authenticated, service_role;

-- ============================================================
-- 4. Политики: организации
-- ============================================================
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.organizations FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;

CREATE POLICY "Members can view their organizations"
  ON public.organizations FOR SELECT TO authenticated
  USING (private.is_org_member(id));

CREATE POLICY "Org admins can update their organization"
  ON public.organizations FOR UPDATE TO authenticated
  USING (private.has_org_role(auth.uid(), 'admin', id))
  WITH CHECK (private.has_org_role(auth.uid(), 'admin', id));

-- Создание организации идёт только через функцию ниже: у новой организации нет
-- участников, поэтому обычная политика вставки не подошла бы никому.
-- Удаления нет: организацию отключают флагом is_active.

CREATE OR REPLACE FUNCTION public.create_organization(_name text, _legal_form text DEFAULT 'ООО')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT private.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Недостаточно прав для создания организации' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.organizations (name, legal_form, created_by)
  VALUES (_name, _legal_form, auth.uid())
  RETURNING id INTO _id;

  -- Создатель сразу становится администратором новой организации.
  INSERT INTO public.user_roles (user_id, role, org_id) VALUES (auth.uid(), 'admin', _id);

  RETURN _id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_organization(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text) TO authenticated, service_role;

-- ============================================================
-- 5. Политики: роли теперь действуют в пределах организации
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete user_roles" ON public.user_roles;

CREATE POLICY "Org admins can view roles of their organization"
  ON public.user_roles FOR SELECT TO authenticated
  USING (private.has_org_role(auth.uid(), 'admin', org_id));

CREATE POLICY "Org admins can insert roles in their organization"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (private.has_org_role(auth.uid(), 'admin', org_id));

CREATE POLICY "Org admins can update roles in their organization"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (private.has_org_role(auth.uid(), 'admin', org_id))
  WITH CHECK (private.has_org_role(auth.uid(), 'admin', org_id));

CREATE POLICY "Org admins can delete roles in their organization"
  ON public.user_roles FOR DELETE TO authenticated
  USING (private.has_org_role(auth.uid(), 'admin', org_id));

-- ============================================================
-- 6. Журнал изменений (только добавление)
-- ============================================================
CREATE TABLE public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  actor_id uuid,  -- auth.uid(); NULL, если изменение сделала система (регистрация, миграция)
  at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL CHECK (action IN ('insert', 'update', 'delete', 'view')),
  table_name text NOT NULL,
  record_id text,
  field text,
  old_value text,
  new_value text,
  note text
);

CREATE INDEX audit_log_org_at_idx ON public.audit_log (org_id, at DESC);
CREATE INDEX audit_log_record_idx ON public.audit_log (table_name, record_id);
CREATE INDEX audit_log_actor_idx ON public.audit_log (actor_id, at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Только чтение, и только администратору своей организации. Роль «руководитель»
-- (шаг 3) добавится в эту же политику. Записывают в журнал триггеры и функция
-- write_audit: прямой вставки у клиента нет.
REVOKE ALL ON public.audit_log FROM anon, authenticated;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT SELECT, INSERT ON public.audit_log TO service_role;

CREATE POLICY "Org admins can view audit log of their organization"
  ON public.audit_log FOR SELECT TO authenticated
  USING (org_id IS NOT NULL AND private.has_org_role(auth.uid(), 'admin', org_id));

-- Записи нельзя менять и удалять никому, включая владельца таблицы и service_role.
CREATE OR REPLACE FUNCTION private.audit_log_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Журнал изменений нельзя менять или удалять' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION private.audit_log_immutable();
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION private.audit_log_immutable();

-- Универсальный триггер: INSERT/DELETE пишет одну строку со всей записью,
-- UPDATE — по строке на каждое изменившееся поле. Аргументы триггера — список
-- полей, которые журналируются (без аргументов — все, кроме служебных меток времени).
-- Для таблиц с чувствительными данными список полей задавать явно и не включать
-- в него сами номера документов: там пишутся только факты (статус, срок, кто проверил).
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
  _rec text := _row ->> 'id';
  _cols text[];
  _col text;
BEGIN
  IF TG_NARGS > 0 THEN
    _cols := TG_ARGV;
  ELSE
    SELECT array_agg(key) INTO _cols FROM jsonb_object_keys(_row) AS key
    WHERE key NOT IN ('created_at', 'updated_at');
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOREACH _col IN ARRAY _cols LOOP
      IF _old -> _col IS DISTINCT FROM _new -> _col THEN
        INSERT INTO public.audit_log (org_id, actor_id, action, table_name, record_id, field, old_value, new_value)
        VALUES (_org, auth.uid(), 'update', TG_TABLE_NAME, _rec, _col, _old ->> _col, _new ->> _col);
      END IF;
    END LOOP;
  ELSE
    INSERT INTO public.audit_log (org_id, actor_id, action, table_name, record_id, old_value, new_value)
    VALUES (
      _org, auth.uid(), lower(TG_OP), TG_TABLE_NAME, _rec,
      CASE WHEN TG_OP = 'DELETE' THEN (SELECT jsonb_object_agg(k, _old -> k) FROM unnest(_cols) k)::text END,
      CASE WHEN TG_OP = 'INSERT' THEN (SELECT jsonb_object_agg(k, _new -> k) FROM unnest(_cols) k)::text END
    );
  END IF;

  RETURN coalesce(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION private.audit_changes() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER audit_organizations
  AFTER INSERT OR UPDATE OR DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes();

-- Роли и права — прямое требование Ж-1.
CREATE TRIGGER audit_user_roles
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('user_id', 'role', 'org_id');

-- Событие, которое не является правкой строки, например просмотр полного номера
-- документа (шаги 8 и далее). Автор всегда auth.uid(): подделать нельзя.
-- Писать можно только в журнал организации, где пользователь состоит.
CREATE OR REPLACE FUNCTION public.write_audit(
  _org_id uuid, _action text, _table_name text, _record_id text, _note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_org_member(_org_id) THEN
    RAISE EXCEPTION 'Недостаточно прав для записи в журнал' USING ERRCODE = '42501';
  END IF;
  IF _action <> 'view' THEN
    RAISE EXCEPTION 'Из приложения в журнал пишутся только просмотры' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_log (org_id, actor_id, action, table_name, record_id, note)
  VALUES (_org_id, auth.uid(), _action, _table_name, _record_id, _note);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.write_audit(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.write_audit(uuid, text, text, text, text) TO authenticated, service_role;
