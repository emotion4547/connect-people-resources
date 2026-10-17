-- Этап 1, шаг 5: объекты и запуск объекта. ТЗ: разделы 4 и 8 (О-1, О-2).
--
-- Объект становится площадкой заказчика с точкой на карте, способом отметки, QR, инструкцией
-- и чек-листом запуска. Пока чек-лист не закрыт, объект в статусе «Запуск», и смены на нём
-- не публикуются исполнителям (публикация — шаг 6).
--
-- Старые таблицы site_managers и site_workers (кто из заказчика и кто из исполнителей привязан
-- к объекту) сохраняются как есть.

-- ============================================================
-- 1. Справочник типов документов и обязательные документы
-- ============================================================
ALTER TABLE public.directories DROP CONSTRAINT directories_kind_check;
ALTER TABLE public.directories ADD CONSTRAINT directories_kind_check CHECK (kind IN (
  'worker_group', 'candidate_source', 'client_source',
  'no_show_reason', 'cancel_reason', 'candidate_reject_reason', 'holiday', 'document_type'
));

-- Типы документов названы в ТЗ (раздел 4, раздел 10, Н-6).
CREATE OR REPLACE FUNCTION private.seed_document_types(_org_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, private
AS $$
  INSERT INTO public.directories (org_id, kind, name, sort_order) VALUES
    (_org_id, 'document_type', 'Паспорт', 1),
    (_org_id, 'document_type', 'ИНН', 2),
    (_org_id, 'document_type', 'СНИЛС', 3),
    (_org_id, 'document_type', 'Патент', 4),
    (_org_id, 'document_type', 'РВП или ВНЖ', 5),
    (_org_id, 'document_type', 'Медицинская книжка', 6),
    (_org_id, 'document_type', 'Согласие на обработку персональных данных', 7),
    (_org_id, 'document_type', 'Договор с исполнителем', 8)
  ON CONFLICT DO NOTHING
$$;

CREATE OR REPLACE FUNCTION private.organizations_seed_document_types()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  PERFORM private.seed_document_types(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_seed_document_types
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.organizations_seed_document_types();

REVOKE EXECUTE ON FUNCTION private.seed_document_types(uuid), private.organizations_seed_document_types() FROM PUBLIC, anon, authenticated;
SELECT private.seed_document_types(id) FROM public.organizations;

-- ============================================================
-- 2. Объекты: организация, заказчик, точка, отметка, запуск
-- ============================================================
ALTER TABLE public.sites
  ADD COLUMN org_id uuid,
  ADD COLUMN client_id uuid,
  ADD COLUMN latitude numeric(9,6) CHECK (latitude BETWEEN -90 AND 90),
  ADD COLUMN longitude numeric(9,6) CHECK (longitude BETWEEN -180 AND 180),
  -- NULL — радиус берётся из настройки checkin.geo_radius_m (по умолчанию 200 м).
  ADD COLUMN checkin_radius_m integer CHECK (checkin_radius_m IS NULL OR checkin_radius_m BETWEEN 20 AND 5000),
  ADD COLUMN checkin_method text NOT NULL DEFAULT 'qr' CHECK (checkin_method IN ('qr', 'geo', 'both', 'manual')),
  ADD COLUMN status text NOT NULL DEFAULT 'launch' CHECK (status IN ('launch', 'active', 'paused', 'closed')),
  ADD COLUMN instructions text,
  ADD COLUMN contact_name text,
  ADD COLUMN contact_phone text,
  ADD COLUMN site_manager_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN qr_printed_at timestamptz,
  ADD COLUMN required_docs_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN timezone text NOT NULL DEFAULT 'Asia/Yekaterinburg';

-- Существующие объекты уже работают: они «Активные», в организации по умолчанию.
UPDATE public.sites SET org_id = private.default_org_id(), status = 'active';
-- Заказчик объекта — по компании его HR (раздел 13): берём первого привязанного.
UPDATE public.sites s SET client_id = (
  SELECT cc.client_id FROM public.site_managers sm
  JOIN public.client_contacts cc ON cc.user_id = sm.hr_user_id
  WHERE sm.site_id = s.id ORDER BY sm.created_at LIMIT 1);

ALTER TABLE public.sites
  ALTER COLUMN org_id SET NOT NULL,
  ALTER COLUMN org_id SET DEFAULT private.default_org_id(),
  ADD CONSTRAINT sites_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD CONSTRAINT sites_org_client_fkey FOREIGN KEY (org_id, client_id) REFERENCES public.clients (org_id, id) ON DELETE SET NULL (client_id),
  ADD CONSTRAINT sites_org_id_id_key UNIQUE (org_id, id);

CREATE INDEX sites_org_status_idx ON public.sites (org_id, status);
CREATE INDEX sites_client_idx ON public.sites (client_id);

-- Часовой пояс объекта: время отметок и смен показывается в нём (раздел 19).
CREATE OR REPLACE FUNCTION private.sites_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, private
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Неизвестный часовой пояс «%»', NEW.timezone USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sites_validate
  BEFORE INSERT OR UPDATE OF timezone ON public.sites
  FOR EACH ROW EXECUTE FUNCTION private.sites_validate();

CREATE TRIGGER audit_sites
  AFTER INSERT OR UPDATE OR DELETE ON public.sites
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes(
    'name', 'address', 'client_id', 'status', 'checkin_method', 'checkin_radius_m',
    'site_manager_id', 'timezone', 'latitude', 'longitude', 'is_active');

-- Тариф на конкретный объект возможен только для объекта того же заказчика и той же организации.
CREATE OR REPLACE FUNCTION private.tariffs_site_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NEW.site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sites s WHERE s.id = NEW.site_id AND s.org_id = NEW.org_id AND s.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'Объект тарифа должен принадлежать этому заказчику' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tariffs_site_check
  BEFORE INSERT OR UPDATE OF site_id, client_id ON public.tariffs
  FOR EACH ROW EXECUTE FUNCTION private.tariffs_site_check();

-- ============================================================
-- 3. QR объекта
-- ============================================================
-- Секрет лежит отдельно от объекта: объекты читают все участники организации, секрет —
-- только серверные функции.
CREATE TABLE public.site_secrets (
  site_id uuid PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  qr_secret text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '')
);

ALTER TABLE public.site_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_secrets FROM anon, authenticated;
GRANT ALL ON public.site_secrets TO service_role;

INSERT INTO public.site_secrets (site_id) SELECT id FROM public.sites;

CREATE OR REPLACE FUNCTION private.sites_create_secret()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  INSERT INTO public.site_secrets (site_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sites_create_secret
  AFTER INSERT ON public.sites
  FOR EACH ROW EXECUTE FUNCTION private.sites_create_secret();

-- Ответственные за объект: менеджер объекта и менеджер заказчика по ведению объектов.
CREATE OR REPLACE FUNCTION private.site_owner_ids(_client_id uuid, _site_manager_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT ARRAY[_site_manager_id, (SELECT c.sites_manager_id FROM public.clients c WHERE c.id = _client_id)]
$$;

CREATE OR REPLACE FUNCTION private.site_in_scope(_site_id uuid, _action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sites s
    WHERE s.id = _site_id
      AND (private.has_org_role(auth.uid(), 'admin', s.org_id)
           OR private.row_in_scope(s.org_id, 'sites', _action, private.site_owner_ids(s.client_id, s.site_manager_id)))
  )
$$;

REVOKE EXECUTE ON FUNCTION private.site_owner_ids(uuid, uuid), private.site_in_scope(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.site_owner_ids(uuid, uuid), private.site_in_scope(uuid, text) TO authenticated, service_role;

-- Код для печатной формы и режима «планшет на объекте» (О-2).
--   Постоянный: RV1.<объект>.<код> — перевыпускается одной кнопкой.
--   Меняющийся: RV1.<объект>.<минута>.<код> — действует в своей минуте и ещё одну следующую,
--   так что фото кода, снятое заранее, из дома не поможет.
CREATE OR REPLACE FUNCTION private.site_code(_site_id uuid, _window bigint)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT substr(encode(sha256(convert_to(
    (SELECT qr_secret FROM public.site_secrets WHERE site_id = _site_id) || ':' || coalesce(_window::text, 'static'),
    'UTF8')), 'hex'), 1, 16)
$$;

CREATE OR REPLACE FUNCTION public.site_qr_payload(_site_id uuid, _rotating boolean DEFAULT false, _at timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  w bigint := floor(extract(epoch FROM _at) / 60);
BEGIN
  IF auth.uid() IS NULL OR NOT private.site_in_scope(_site_id, 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF _rotating THEN
    RETURN 'RV1.' || _site_id || '.' || w || '.' || private.site_code(_site_id, w);
  END IF;
  RETURN 'RV1.' || _site_id || '.' || private.site_code(_site_id, NULL);
END;
$$;

-- Проверка кода при отметке (шаг 9): возвращает объект, если код верный.
CREATE OR REPLACE FUNCTION private.verify_site_qr(_payload text, _at timestamptz DEFAULT now())
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  parts text[] := string_to_array(_payload, '.');
  sid uuid;
  w bigint := floor(extract(epoch FROM _at) / 60);
BEGIN
  IF parts[1] IS DISTINCT FROM 'RV1' THEN RETURN NULL; END IF;
  BEGIN
    sid := parts[2]::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;

  IF array_length(parts, 1) = 3 THEN
    RETURN CASE WHEN parts[3] = private.site_code(sid, NULL) THEN sid END;
  ELSIF array_length(parts, 1) = 4 THEN
    BEGIN
      IF parts[3]::bigint IN (w, w - 1) AND parts[4] = private.site_code(sid, parts[3]::bigint) THEN RETURN sid; END IF;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN NULL;
    END;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.reissue_site_qr(_site_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  s public.sites;
BEGIN
  SELECT * INTO s FROM public.sites WHERE id = _site_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.site_in_scope(_site_id, 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  UPDATE public.site_secrets SET qr_secret = replace(gen_random_uuid()::text, '-', '') WHERE site_id = _site_id;
  UPDATE public.sites SET qr_printed_at = NULL WHERE id = _site_id;
  INSERT INTO public.audit_log (org_id, actor_id, action, table_name, record_id, field, note)
  VALUES (s.org_id, auth.uid(), 'update', 'site_secrets', _site_id::text, 'qr_secret', 'QR объекта перевыпущен');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.site_qr_payload(uuid, boolean, timestamptz), public.reissue_site_qr(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.site_qr_payload(uuid, boolean, timestamptz), public.reissue_site_qr(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.site_code(uuid, bigint), private.verify_site_qr(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.site_code(uuid, bigint), private.verify_site_qr(text, timestamptz) TO service_role;

-- ============================================================
-- 4. Чек-лист запуска (О-1)
-- ============================================================
CREATE OR REPLACE FUNCTION private.site_checklist(s public.sites)
RETURNS TABLE (item text, label text, done boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT t.item, t.label, coalesce(t.done, false) FROM (VALUES
    ('address', 'Адрес и точка на карте',
      nullif(btrim(coalesce(s.address, '')), '') IS NOT NULL AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL),
    ('qr', 'QR напечатан (если отметка по QR)',
      s.checkin_method NOT IN ('qr', 'both') OR s.qr_printed_at IS NOT NULL),
    ('documents', 'Обязательные документы подтверждены', s.required_docs_confirmed),
    ('instructions', 'Инструкция для исполнителя',
      nullif(btrim(coalesce(s.instructions, '')), '') IS NOT NULL),
    ('contact', 'Контакт на месте',
      nullif(btrim(coalesce(s.contact_name, '')), '') IS NOT NULL AND nullif(btrim(coalesce(s.contact_phone, '')), '') IS NOT NULL),
    ('tariffs', 'Утверждённые тарифы заказчика',
      EXISTS (SELECT 1 FROM public.tariffs tf
              WHERE tf.client_id = s.client_id AND tf.status = 'approved'
                AND (tf.site_id IS NULL OR tf.site_id = s.id)
                AND (tf.valid_to IS NULL OR tf.valid_to >= current_date))),
    ('managers', 'Приглашены менеджеры заказчика',
      EXISTS (SELECT 1 FROM public.client_contacts cc WHERE cc.client_id = s.client_id AND cc.user_id IS NOT NULL))
  ) AS t(item, label, done)
$$;

CREATE OR REPLACE FUNCTION public.site_launch_checklist(_site_id uuid)
RETURNS TABLE (item text, label text, done boolean)
LANGUAGE sql
STABLE
SET search_path = public, private
AS $$
  SELECT c.item, c.label, c.done FROM public.sites s, LATERAL private.site_checklist(s) c WHERE s.id = _site_id
$$;

REVOKE EXECUTE ON FUNCTION private.site_checklist(public.sites) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.site_checklist(public.sites) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.site_launch_checklist(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.site_launch_checklist(uuid) TO authenticated, service_role;

-- В «Активный» объект переходит только с закрытым чек-листом. Ограничение для ролей API;
-- система (миграции, service_role) вправе заводить готовые объекты.
CREATE OR REPLACE FUNCTION private.sites_launch_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, private
AS $$
DECLARE
  missing text;
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status = 'launch') THEN
    SELECT string_agg(label, '; ') INTO missing FROM private.site_checklist(NEW) WHERE NOT done;
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION 'Объект нельзя запустить, не закрыто: %', missing USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sites_launch_guard
  BEFORE INSERT OR UPDATE OF status ON public.sites
  FOR EACH ROW EXECUTE FUNCTION private.sites_launch_guard();

-- ============================================================
-- 5. Политики объектов: по организации и по матрице прав
-- ============================================================
-- Раньше объекты читал любой вошедший и правил любой администратор. Теперь читают участники своей
-- организации (исполнителям и заказчикам объекты нужны), правят администратор организации и те,
-- у кого есть право в матрице. Секрет QR в самой таблице больше не лежит.
DROP POLICY IF EXISTS "Sites readable by authenticated" ON public.sites;
DROP POLICY IF EXISTS "Admins manage sites" ON public.sites;

CREATE POLICY "Sites: members of the organization can read" ON public.sites FOR SELECT TO authenticated
  USING (private.is_org_member(org_id));

CREATE POLICY "Sites: create" ON public.sites FOR INSERT TO authenticated
  WITH CHECK (
    private.has_org_role(auth.uid(), 'admin', org_id)
    OR private.row_in_scope(org_id, 'sites', 'create', private.site_owner_ids(client_id, site_manager_id)));

CREATE POLICY "Sites: update" ON public.sites FOR UPDATE TO authenticated
  USING (
    private.has_org_role(auth.uid(), 'admin', org_id)
    OR private.row_in_scope(org_id, 'sites', 'update', private.site_owner_ids(client_id, site_manager_id)))
  WITH CHECK (
    private.has_org_role(auth.uid(), 'admin', org_id)
    OR private.row_in_scope(org_id, 'sites', 'update', private.site_owner_ids(client_id, site_manager_id)));

CREATE POLICY "Sites: delete" ON public.sites FOR DELETE TO authenticated
  USING (
    private.has_org_role(auth.uid(), 'admin', org_id)
    OR private.row_in_scope(org_id, 'sites', 'delete', private.site_owner_ids(client_id, site_manager_id)));

-- Заказ по старому интерфейсу (HR выбирает объект) продолжает работать: HR видит объекты
-- своей организации, как и раньше видел все.

-- ============================================================
-- 6. Обязательные документы объекта и позиции
-- ============================================================
CREATE OR REPLACE FUNCTION private.required_document_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.directories d WHERE d.id = NEW.document_type_id AND d.kind = 'document_type' AND d.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'Это не тип документа организации' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE public.site_required_documents (
  org_id uuid NOT NULL,
  site_id uuid NOT NULL,
  document_type_id uuid NOT NULL REFERENCES public.directories(id) ON DELETE RESTRICT,
  PRIMARY KEY (site_id, document_type_id),
  FOREIGN KEY (org_id, site_id) REFERENCES public.sites (org_id, id) ON DELETE CASCADE
);

CREATE TABLE public.position_required_documents (
  org_id uuid NOT NULL,
  position_id uuid NOT NULL,
  document_type_id uuid NOT NULL REFERENCES public.directories(id) ON DELETE RESTRICT,
  PRIMARY KEY (position_id, document_type_id),
  FOREIGN KEY (org_id, position_id) REFERENCES public.positions (org_id, id) ON DELETE CASCADE
);

CREATE TRIGGER site_required_documents_check BEFORE INSERT ON public.site_required_documents
  FOR EACH ROW EXECUTE FUNCTION private.required_document_check();
CREATE TRIGGER position_required_documents_check BEFORE INSERT ON public.position_required_documents
  FOR EACH ROW EXECUTE FUNCTION private.required_document_check();

CREATE TRIGGER audit_site_required_documents
  AFTER INSERT OR DELETE ON public.site_required_documents
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('site_id', 'document_type_id');
CREATE TRIGGER audit_position_required_documents
  AFTER INSERT OR DELETE ON public.position_required_documents
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('position_id', 'document_type_id');

ALTER TABLE public.site_required_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.position_required_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_required_documents, public.position_required_documents FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.site_required_documents, public.position_required_documents TO authenticated;
GRANT ALL ON public.site_required_documents, public.position_required_documents TO service_role;

CREATE POLICY "Site documents: read" ON public.site_required_documents FOR SELECT TO authenticated
  USING (private.is_org_member(org_id));
CREATE POLICY "Site documents: add" ON public.site_required_documents FOR INSERT TO authenticated
  WITH CHECK (private.site_in_scope(site_id, 'update'));
CREATE POLICY "Site documents: remove" ON public.site_required_documents FOR DELETE TO authenticated
  USING (private.site_in_scope(site_id, 'update'));

CREATE POLICY "Position documents: read" ON public.position_required_documents FOR SELECT TO authenticated
  USING (private.is_org_member(org_id));
CREATE POLICY "Position documents: add" ON public.position_required_documents FOR INSERT TO authenticated
  WITH CHECK (private.has_org_role(auth.uid(), 'admin', org_id));
CREATE POLICY "Position documents: remove" ON public.position_required_documents FOR DELETE TO authenticated
  USING (private.has_org_role(auth.uid(), 'admin', org_id));
