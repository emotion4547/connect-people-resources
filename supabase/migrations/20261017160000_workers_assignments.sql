-- Этап 1, шаг 7: назначения исполнителей на смены, проверки допуска, стоп-лист, резерв, отклики.
-- ТЗ: разделы 4 и 8 (О-7…О-14, статусы назначения).
--
-- Для проверок допуска нужны исполнитель и его документы. Здесь создаётся их минимальная основа
-- (workers, worker_documents, worker_positions); полная карточка, загрузка файлов, шифрование
-- номеров и воронка найма — шаг 8.

-- ============================================================
-- 1. Исполнители (основа)
-- ============================================================
CREATE TABLE public.workers (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL DEFAULT private.default_org_id() REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text,
  city text,
  citizenship text,
  birth_date date,
  -- Активен, Больничный и Отпуск (до даты), Заблокирован, Не работает. Больничный и отпуск
  -- сами перестают мешать после даты status_until.
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sick', 'vacation', 'blocked', 'not_working')),
  status_until date,
  tax_status text CHECK (tax_status IN ('ip', 'self_employed', 'gph', 'employment')),
  contract_valid_until date,
  rating numeric(3,2) CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX workers_org_status_idx ON public.workers (org_id, status);

CREATE TRIGGER update_workers_updated_at
  BEFORE UPDATE ON public.workers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_workers
  AFTER INSERT OR UPDATE OR DELETE ON public.workers
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('user_id', 'full_name', 'status', 'status_until', 'tax_status', 'contract_valid_until');

-- Позиции, по которым исполнитель умеет работать.
CREATE TABLE public.worker_positions (
  org_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  position_id uuid NOT NULL,
  PRIMARY KEY (worker_id, position_id),
  FOREIGN KEY (org_id, worker_id) REFERENCES public.workers (org_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, position_id) REFERENCES public.positions (org_id, id) ON DELETE CASCADE
);

-- Документы исполнителя. Номер документа хранится маской; зашифрованный номер и файл добавит шаг 8.
CREATE TABLE public.worker_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  document_type_id uuid NOT NULL REFERENCES public.directories(id) ON DELETE RESTRICT,
  number_masked text,
  issued_on date,
  valid_until date,
  -- Загружен → Проверен рекрутером (или Отклонён). Допуск считает только «Проверен».
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'verified', 'rejected')),
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, worker_id) REFERENCES public.workers (org_id, user_id) ON DELETE CASCADE
);

CREATE INDEX worker_documents_worker_idx ON public.worker_documents (worker_id, document_type_id);

CREATE TRIGGER audit_worker_documents
  AFTER INSERT OR UPDATE OR DELETE ON public.worker_documents
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('worker_id', 'document_type_id', 'valid_until', 'status', 'verified_by');

-- Стоп-лист: исполнителя нельзя назначить на объект или к заказчику.
CREATE TABLE public.worker_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  client_id uuid,
  site_id uuid,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, worker_id) REFERENCES public.workers (org_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, client_id) REFERENCES public.clients (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, site_id) REFERENCES public.sites (org_id, id) ON DELETE CASCADE,
  CONSTRAINT worker_blocks_target CHECK (client_id IS NOT NULL OR site_id IS NOT NULL)
);

CREATE INDEX worker_blocks_worker_idx ON public.worker_blocks (worker_id);

CREATE TRIGGER audit_worker_blocks
  AFTER INSERT OR DELETE ON public.worker_blocks
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('worker_id', 'client_id', 'site_id', 'reason');

-- Существующие исполнители становятся записями workers: имя и телефон из профиля,
-- заблокированные в старом интерфейсе — со статусом «Заблокирован». Налоговый статус им предстоит
-- указать: без него назначить и выплатить нельзя.
INSERT INTO public.workers (user_id, org_id, full_name, phone, city, status, rating)
SELECT p.user_id, ur.org_id, coalesce(nullif(btrim(p.full_name), ''), p.email), p.phone, p.city,
       CASE WHEN p.is_active IS FALSE OR EXISTS (SELECT 1 FROM public.profile_admin_data a WHERE a.user_id = p.user_id AND a.block_reason IS NOT NULL)
            THEN 'blocked' ELSE 'active' END,
       CASE WHEN p.rating BETWEEN 1 AND 5 THEN p.rating END
FROM public.user_roles ur
JOIN public.profiles p ON p.user_id = ur.user_id
WHERE ur.role = 'worker'
ON CONFLICT (user_id) DO NOTHING;

-- Новая регистрация исполнителя сразу создаёт запись workers.
CREATE OR REPLACE FUNCTION private.user_roles_create_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NEW.role = 'worker' THEN
    INSERT INTO public.workers (user_id, org_id, full_name, phone, city)
    SELECT p.user_id, NEW.org_id, coalesce(nullif(btrim(p.full_name), ''), p.email), p.phone, p.city
    FROM public.profiles p WHERE p.user_id = NEW.user_id
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_roles_create_worker
  AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION private.user_roles_create_worker();

REVOKE EXECUTE ON FUNCTION private.user_roles_create_worker() FROM PUBLIC, anon, authenticated;

-- Допустимые организации налоговые статусы исполнителей (раздел 21, вопрос 2).
INSERT INTO public.setting_definitions
  (key, group_name, label, description, value_type, default_value, nullable, unit, min_value, max_value, allowed_values, levels, needs_confirmation, sort_order)
VALUES
  ('workers.allowed_tax_statuses', 'Исполнители', 'Допустимые налоговые статусы исполнителей',
   'ip — ИП, self_employed — самозанятый, gph — ГПХ, employment — трудовой договор. Исполнителя с другим статусом назначить на смену нельзя',
   'json', '["ip","self_employed","gph","employment"]', false, NULL, NULL, NULL, NULL, ARRAY['org'], true, 110);

-- ============================================================
-- 2. Назначения
-- ============================================================
CREATE TABLE public.assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  -- Отклик или приглашение → Назначен → Подтвердил выход → На месте → Отработал.
  -- Исходы: Не вышел, Отменил исполнитель, Отменил менеджер, Снят заказчиком, Отклонён.
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN (
    'responded', 'invited', 'assigned', 'confirmed', 'on_site', 'worked',
    'no_show', 'cancelled_worker', 'cancelled_manager', 'removed_by_client', 'rejected')),
  source text NOT NULL DEFAULT 'assigned' CHECK (source IN ('response', 'assigned')),
  is_reserve boolean NOT NULL DEFAULT false,
  -- Время смены копируется сюда, чтобы база сама запрещала пересечения у одного исполнителя.
  shift_start timestamptz NOT NULL,
  shift_end timestamptz NOT NULL,
  confirmed_at timestamptz,
  check_in_at timestamptz,
  check_in_method text,
  check_in_lat numeric(9,6),
  check_in_lon numeric(9,6),
  check_in_accuracy_m numeric(8,1),
  check_out_at timestamptz,
  check_out_method text,
  planned_hours numeric(6,2),
  actual_hours numeric(6,2),
  approved_hours numeric(6,2),
  client_rating smallint CHECK (client_rating BETWEEN 1 AND 5),
  manager_rating smallint CHECK (manager_rating BETWEEN 1 AND 5),
  reason_id uuid REFERENCES public.directories(id) ON DELETE SET NULL,
  late_cancel boolean NOT NULL DEFAULT false,
  note text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, shift_id) REFERENCES public.shifts (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, worker_id) REFERENCES public.workers (org_id, user_id) ON DELETE RESTRICT,
  UNIQUE (shift_id, worker_id),
  CONSTRAINT assignments_shift_times CHECK (shift_end > shift_start),
  -- Один исполнитель — не более одного действующего назначения на пересекающиеся по времени смены.
  CONSTRAINT assignments_no_overlap EXCLUDE USING gist (
    worker_id WITH =, tstzrange(shift_start, shift_end, '[)') WITH &&
  ) WHERE (status IN ('assigned', 'confirmed', 'on_site', 'worked'))
);

CREATE INDEX assignments_shift_idx ON public.assignments (shift_id, status);
CREATE INDEX assignments_worker_idx ON public.assignments (worker_id, shift_start);

CREATE TRIGGER update_assignments_updated_at
  BEFORE UPDATE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_assignments
  AFTER INSERT OR UPDATE OR DELETE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('shift_id', 'worker_id', 'status', 'is_reserve', 'reason_id', 'late_cancel');

-- Время смены в назначении всегда равно времени смены.
CREATE OR REPLACE FUNCTION private.assignments_copy_shift_times()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  SELECT s.start_at, s.end_at INTO NEW.shift_start, NEW.shift_end FROM public.shifts s WHERE s.id = NEW.shift_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assignments_copy_shift_times
  BEFORE INSERT ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION private.assignments_copy_shift_times();

-- Количество действующих (не резервных) назначений: основа статуса «Укомплектована».
CREATE OR REPLACE FUNCTION private.shift_assignment_count(_shift_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT count(*)::integer FROM public.assignments
  WHERE shift_id = _shift_id AND status IN ('assigned', 'confirmed', 'on_site', 'worked')
$$;

CREATE OR REPLACE FUNCTION private.refresh_shift_staffing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  sid uuid := coalesce(NEW.shift_id, OLD.shift_id);
BEGIN
  UPDATE public.shifts s SET status = CASE
      WHEN (SELECT count(*) FROM public.assignments a
            WHERE a.shift_id = s.id AND NOT a.is_reserve AND a.status IN ('assigned', 'confirmed', 'on_site', 'worked')) >= s.headcount
      THEN 'staffed' ELSE 'open' END
   WHERE s.id = sid AND s.status IN ('open', 'staffed');
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE TRIGGER assignments_refresh_staffing
  AFTER INSERT OR UPDATE OF status, is_reserve OR DELETE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION private.refresh_shift_staffing();

-- ============================================================
-- 3. Проверки допуска (О-14)
-- ============================================================
CREATE OR REPLACE FUNCTION private.assignment_checks(_shift_id uuid, _worker_id uuid)
RETURNS TABLE (severity text, code text, message text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  s public.shifts;
  w public.workers;
  rest_hours numeric;
  allowed jsonb;
  doc record;
BEGIN
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id;
  SELECT * INTO w FROM public.workers WHERE user_id = _worker_id AND org_id = s.org_id;
  IF s.id IS NULL OR w.user_id IS NULL THEN
    severity := 'deny'; code := 'not_found'; message := 'Смена или исполнитель не найдены'; RETURN NEXT; RETURN;
  END IF;

  IF s.status IN ('cancelled', 'completed') THEN
    severity := 'deny'; code := 'shift_closed'; message := 'Смена отменена или завершена'; RETURN NEXT;
  END IF;

  -- Статус исполнителя и срок договора.
  IF NOT (w.status = 'active' OR (w.status IN ('sick', 'vacation') AND w.status_until IS NOT NULL AND w.status_until < s.shift_date)) THEN
    severity := 'deny'; code := 'worker_status';
    message := 'Статус исполнителя не позволяет работать: ' || CASE w.status
      WHEN 'sick' THEN 'больничный' WHEN 'vacation' THEN 'отпуск' WHEN 'blocked' THEN 'заблокирован' ELSE 'не работает' END;
    RETURN NEXT;
  END IF;
  IF w.contract_valid_until IS NOT NULL AND w.contract_valid_until < s.shift_date THEN
    severity := 'deny'; code := 'contract_expired'; message := 'Договор с исполнителем истёк к дате смены'; RETURN NEXT;
  END IF;

  -- Налоговый статус должен быть указан и разрешён организацией.
  allowed := public.get_setting(s.org_id, 'workers.allowed_tax_statuses', s.shift_date);
  IF w.tax_status IS NULL THEN
    severity := 'deny'; code := 'tax_status_missing'; message := 'У исполнителя не указан налоговый статус'; RETURN NEXT;
  ELSIF NOT (allowed ? w.tax_status) THEN
    severity := 'deny'; code := 'tax_status_not_allowed'; message := 'Налоговый статус исполнителя не разрешён для организации'; RETURN NEXT;
  END IF;

  -- Стоп-лист заказчика или объекта.
  IF EXISTS (SELECT 1 FROM public.worker_blocks b
             WHERE b.worker_id = _worker_id AND (b.client_id = s.client_id OR b.site_id = s.site_id)) THEN
    severity := 'deny'; code := 'blocklist'; message := 'Исполнитель в стоп-листе заказчика или объекта'; RETURN NEXT;
  END IF;

  -- Обязательные документы объекта и позиции: проверенный документ, действующий на дату смены.
  FOR doc IN
    SELECT d.id, d.name FROM public.directories d
    WHERE d.id IN (SELECT document_type_id FROM public.site_required_documents WHERE site_id = s.site_id
                   UNION SELECT document_type_id FROM public.position_required_documents WHERE position_id = s.position_id)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.worker_documents wd
                   WHERE wd.worker_id = _worker_id AND wd.document_type_id = doc.id AND wd.status = 'verified'
                     AND (wd.valid_until IS NULL OR wd.valid_until >= s.shift_date)) THEN
      severity := 'deny'; code := 'document'; message := 'Нет действующего документа: ' || doc.name; RETURN NEXT;
    END IF;
  END LOOP;

  -- Пересечение с другой действующей сменой исполнителя.
  IF EXISTS (SELECT 1 FROM public.assignments a
             WHERE a.worker_id = _worker_id AND a.shift_id <> _shift_id
               AND a.status IN ('assigned', 'confirmed', 'on_site', 'worked')
               AND tstzrange(a.shift_start, a.shift_end, '[)') && tstzrange(s.start_at, s.end_at, '[)')) THEN
    severity := 'deny'; code := 'overlap'; message := 'У исполнителя уже есть смена в это время'; RETURN NEXT;
  END IF;

  -- Предупреждения: отдых и опыт по позиции.
  rest_hours := public.get_setting_numeric(s.org_id, 'schedule.min_rest_hours', s.shift_date, s.client_id, s.site_id);
  IF rest_hours IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.assignments a
       WHERE a.worker_id = _worker_id AND a.shift_id <> _shift_id
         AND a.status IN ('assigned', 'confirmed', 'on_site', 'worked')
         AND ((a.shift_end <= s.start_at AND a.shift_end > s.start_at - make_interval(secs => rest_hours * 3600))
           OR (a.shift_start >= s.end_at AND a.shift_start < s.end_at + make_interval(secs => rest_hours * 3600)))) THEN
    severity := 'warn'; code := 'rest'; message := 'Отдых между сменами меньше ' || rest_hours || ' ч'; RETURN NEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.worker_positions wp WHERE wp.worker_id = _worker_id AND wp.position_id = s.position_id)
     AND NOT EXISTS (SELECT 1 FROM public.assignments a JOIN public.shifts sh ON sh.id = a.shift_id
                     WHERE a.worker_id = _worker_id AND a.status = 'worked' AND sh.position_id = s.position_id) THEN
    severity := 'warn'; code := 'position_experience'; message := 'Исполнитель не работал по этой позиции'; RETURN NEXT;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.shift_assign_in_scope(_shift_id uuid, _action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shifts s
    WHERE s.id = _shift_id AND private.row_in_scope(s.org_id, 'assignments', _action, private.site_row_owners(s.site_id))
  )
$$;

-- Проверка для интерфейса: что мешает и о чём стоит предупредить.
CREATE OR REPLACE FUNCTION public.check_assignment(_shift_id uuid, _worker_id uuid)
RETURNS TABLE (severity text, code text, message text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.shift_assign_in_scope(_shift_id, 'view') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM private.assignment_checks(_shift_id, _worker_id);
END;
$$;

-- Назначение одного исполнителя на смену. Нарушение запрета — исключение с причинами; предупреждения
-- возвращаются в ответе. Если основные места заняты, исполнитель становится в резерв (пока он есть).
CREATE OR REPLACE FUNCTION private.do_assign(_shift_id uuid, _worker_id uuid, _auto_reserve boolean, _source text DEFAULT 'assigned')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  s public.shifts;
  denies text;
  warns text[];
  main_taken integer;
  reserve_taken integer;
  as_reserve boolean := false;
  aid uuid;
BEGIN
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id FOR UPDATE;

  SELECT string_agg(c.message, '; ') FILTER (WHERE c.severity = 'deny'),
         coalesce(array_agg(c.message) FILTER (WHERE c.severity = 'warn'), ARRAY[]::text[])
    INTO denies, warns
  FROM private.assignment_checks(_shift_id, _worker_id) c;
  IF denies IS NOT NULL THEN
    RAISE EXCEPTION 'Назначить нельзя: %', denies USING ERRCODE = '22023';
  END IF;

  SELECT count(*) FILTER (WHERE NOT is_reserve), count(*) FILTER (WHERE is_reserve)
    INTO main_taken, reserve_taken
  FROM public.assignments
  WHERE shift_id = _shift_id AND status IN ('assigned', 'confirmed', 'on_site', 'worked') AND worker_id <> _worker_id;

  IF main_taken >= s.headcount THEN
    IF NOT _auto_reserve OR reserve_taken >= s.reserve_count THEN
      RAISE EXCEPTION 'На смене нет свободных мест' USING ERRCODE = '22023';
    END IF;
    as_reserve := true;
  END IF;

  INSERT INTO public.assignments (org_id, shift_id, worker_id, status, source, is_reserve, shift_start, shift_end, created_by)
  VALUES (s.org_id, _shift_id, _worker_id, 'assigned', _source, as_reserve, s.start_at, s.end_at, auth.uid())
  ON CONFLICT (shift_id, worker_id) DO UPDATE
    SET status = 'assigned', is_reserve = as_reserve, reason_id = NULL, late_cancel = false
    WHERE public.assignments.status IN ('responded', 'invited', 'rejected', 'cancelled_worker', 'cancelled_manager', 'removed_by_client')
  RETURNING id INTO aid;

  IF aid IS NULL THEN
    RAISE EXCEPTION 'Исполнитель уже назначен на эту смену' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('assignment_id', aid, 'placement', CASE WHEN as_reserve THEN 'reserve' ELSE 'main' END, 'warnings', to_jsonb(warns));
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_worker(_shift_id uuid, _worker_id uuid, _auto_reserve boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.shift_assign_in_scope(_shift_id, 'create') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  RETURN private.do_assign(_shift_id, _worker_id, _auto_reserve);
END;
$$;

-- Массовое назначение (О-11): несколько исполнителей на несколько смен одним действием.
-- Ничего не прерывается на первой ошибке: возвращается отчёт «кого и почему не удалось».
CREATE OR REPLACE FUNCTION public.assign_workers(_shift_ids uuid[], _worker_ids uuid[])
RETURNS TABLE (shift_id uuid, worker_id uuid, result text, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  sid uuid;
  wid uuid;
  r jsonb;
BEGIN
  FOREACH sid IN ARRAY (SELECT coalesce(array_agg(s.id ORDER BY s.start_at), ARRAY[]::uuid[]) FROM public.shifts s WHERE s.id = ANY (_shift_ids)) LOOP
    IF auth.uid() IS NULL OR NOT private.shift_assign_in_scope(sid, 'create') THEN
      RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
    END IF;
    FOREACH wid IN ARRAY _worker_ids LOOP
      shift_id := sid; worker_id := wid;
      BEGIN
        r := private.do_assign(sid, wid, true);
        result := CASE WHEN r ->> 'placement' = 'reserve' THEN 'reserve' ELSE 'assigned' END;
        reason := NULLIF(array_to_string(ARRAY(SELECT jsonb_array_elements_text(r -> 'warnings')), '; '), '');
      EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '23P01' THEN
        result := 'rejected'; reason := regexp_replace(SQLERRM, '^Назначить нельзя: ', '');
      END;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$$;

-- Поиск исполнителя для смены (О-10): свободен ли, рейтинг, неявки за 90 дней, работал ли на объекте, документы.
CREATE OR REPLACE FUNCTION public.find_workers(_shift_id uuid, _query text DEFAULT NULL, _limit integer DEFAULT 50)
RETURNS TABLE (worker_id uuid, full_name text, phone text, status text, rating numeric, free boolean,
               no_shows_90d integer, worked_here integer, can_assign boolean, problems text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  s public.shifts;
BEGIN
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.shift_assign_in_scope(_shift_id, 'create') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT w.user_id, w.full_name, w.phone, w.status, w.rating,
         NOT EXISTS (SELECT 1 FROM public.assignments a
                     WHERE a.worker_id = w.user_id AND a.status IN ('assigned', 'confirmed', 'on_site', 'worked')
                       AND tstzrange(a.shift_start, a.shift_end, '[)') && tstzrange(s.start_at, s.end_at, '[)')),
         (SELECT count(*)::integer FROM public.assignments a WHERE a.worker_id = w.user_id AND a.status = 'no_show' AND a.shift_start > now() - interval '90 days'),
         (SELECT count(*)::integer FROM public.assignments a JOIN public.shifts sh ON sh.id = a.shift_id
           WHERE a.worker_id = w.user_id AND a.status = 'worked' AND sh.site_id = s.site_id),
         NOT EXISTS (SELECT 1 FROM private.assignment_checks(_shift_id, w.user_id) c WHERE c.severity = 'deny'),
         (SELECT string_agg(c.message, '; ') FROM private.assignment_checks(_shift_id, w.user_id) c WHERE c.severity = 'deny')
  FROM public.workers w
  WHERE w.org_id = s.org_id AND w.status <> 'not_working'
    AND (_query IS NULL OR btrim(_query) = '' OR w.full_name ILIKE '%' || btrim(_query) || '%' OR w.phone ILIKE '%' || btrim(_query) || '%')
  ORDER BY w.full_name
  LIMIT least(coalesce(_limit, 50), 200);
END;
$$;

-- ============================================================
-- 4. Резерв, отмены, неявки, отклики, подтверждение
-- ============================================================
-- Резервист переводится в основной состав одним действием (О-13).
CREATE OR REPLACE FUNCTION public.promote_reserve(_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.assignments;
  s public.shifts;
BEGIN
  SELECT * INTO a FROM public.assignments WHERE id = _assignment_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.shift_assign_in_scope(a.shift_id, 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF NOT a.is_reserve OR a.status NOT IN ('assigned', 'confirmed') THEN
    RAISE EXCEPTION 'Это не действующий резервист' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.shifts WHERE id = a.shift_id;
  IF (SELECT count(*) FROM public.assignments x WHERE x.shift_id = a.shift_id AND NOT x.is_reserve
        AND x.status IN ('assigned', 'confirmed', 'on_site', 'worked')) >= s.headcount THEN
    RAISE EXCEPTION 'Основные места заняты: сначала освободите место' USING ERRCODE = '22023';
  END IF;
  UPDATE public.assignments SET is_reserve = false WHERE id = _assignment_id;
END;
$$;

-- Снять с назначения. Исполнитель отменяет сам до срока из настройки (по умолчанию за 12 часов);
-- позже — только через менеджера, и отмена записывается как поздняя (О-15). Причина обязательна (О-17).
CREATE OR REPLACE FUNCTION public.cancel_assignment(_assignment_id uuid, _reason_id uuid, _on_behalf_of_worker boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.assignments;
  s public.shifts;
  free_hours numeric;
  late boolean;
  by_worker boolean;
BEGIN
  SELECT * INTO a FROM public.assignments WHERE id = _assignment_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.shifts WHERE id = a.shift_id;
  IF a.status NOT IN ('assigned', 'confirmed') THEN
    RAISE EXCEPTION 'Это назначение нельзя отменить' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.directories d WHERE d.id = _reason_id AND d.kind = 'cancel_reason' AND d.org_id = a.org_id AND d.is_active) THEN
    RAISE EXCEPTION 'Выберите причину отмены из справочника' USING ERRCODE = '22023';
  END IF;

  free_hours := coalesce(public.get_setting_numeric(a.org_id, 'cancel.worker_free_hours', s.shift_date, s.client_id, s.site_id), 12);
  late := s.start_at - now() < make_interval(secs => free_hours * 3600);

  IF auth.uid() = a.worker_id THEN
    IF late THEN
      RAISE EXCEPTION 'Отмена позже чем за % ч до начала: обратитесь к менеджеру', free_hours USING ERRCODE = '22023';
    END IF;
    by_worker := true;
  ELSIF private.shift_assign_in_scope(a.shift_id, 'update') THEN
    by_worker := _on_behalf_of_worker;
  ELSE
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;

  UPDATE public.assignments
     SET status = CASE WHEN by_worker THEN 'cancelled_worker' ELSE 'cancelled_manager' END,
         reason_id = _reason_id, late_cancel = by_worker AND late
   WHERE id = _assignment_id;
END;
$$;

-- Неявка с причиной из справочника.
CREATE OR REPLACE FUNCTION public.mark_no_show(_assignment_id uuid, _reason_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.assignments;
  s public.shifts;
BEGIN
  SELECT * INTO a FROM public.assignments WHERE id = _assignment_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.shift_assign_in_scope(a.shift_id, 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.shifts WHERE id = a.shift_id;
  IF a.status NOT IN ('assigned', 'confirmed') OR s.start_at > now() THEN
    RAISE EXCEPTION 'Неявку можно отметить только у начавшейся смены' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.directories d WHERE d.id = _reason_id AND d.kind = 'no_show_reason' AND d.org_id = a.org_id AND d.is_active) THEN
    RAISE EXCEPTION 'Выберите причину неявки из справочника' USING ERRCODE = '22023';
  END IF;
  UPDATE public.assignments SET status = 'no_show', reason_id = _reason_id WHERE id = _assignment_id;
END;
$$;

-- Исполнитель откликается на конкретные даты (О-12). Автоматического принятия на этапах 1–3 нет.
CREATE OR REPLACE FUNCTION public.respond_to_shifts(_shift_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  n integer := 0;
  s public.shifts;
  sid uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.workers WHERE user_id = auth.uid() AND status = 'active') THEN
    RAISE EXCEPTION 'Откликаться могут действующие исполнители' USING ERRCODE = '42501';
  END IF;
  FOREACH sid IN ARRAY _shift_ids LOOP
    SELECT * INTO s FROM public.shifts WHERE id = sid;
    -- Откликнуться можно на опубликованную открытую смену своей организации по своей позиции.
    IF s.id IS NULL OR s.published_at IS NULL OR s.status NOT IN ('open', 'staffed') OR s.start_at <= now()
       OR NOT EXISTS (SELECT 1 FROM public.workers w WHERE w.user_id = auth.uid() AND w.org_id = s.org_id)
       OR NOT EXISTS (SELECT 1 FROM public.worker_positions wp WHERE wp.worker_id = auth.uid() AND wp.position_id = s.position_id) THEN
      CONTINUE;
    END IF;
    INSERT INTO public.assignments (org_id, shift_id, worker_id, status, source, shift_start, shift_end)
    VALUES (s.org_id, sid, auth.uid(), 'responded', 'response', s.start_at, s.end_at)
    ON CONFLICT (shift_id, worker_id) DO NOTHING;
    IF FOUND THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END;
$$;

-- Менеджер принимает или отклоняет отклики пачкой. Принять можно только то, что проходит проверки.
CREATE OR REPLACE FUNCTION public.review_responses(_assignment_ids uuid[], _accept boolean)
RETURNS TABLE (assignment_id uuid, result text, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.assignments;
  aid uuid;
BEGIN
  FOREACH aid IN ARRAY _assignment_ids LOOP
    SELECT * INTO a FROM public.assignments WHERE id = aid AND status IN ('responded', 'invited');
    assignment_id := aid;
    IF NOT FOUND THEN
      result := 'skipped'; reason := 'Отклик не найден или уже обработан'; RETURN NEXT; CONTINUE;
    END IF;
    IF auth.uid() IS NULL OR NOT private.shift_assign_in_scope(a.shift_id, 'update') THEN
      RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
    END IF;
    IF NOT _accept THEN
      UPDATE public.assignments SET status = 'rejected' WHERE id = aid;
      result := 'rejected'; reason := NULL; RETURN NEXT; CONTINUE;
    END IF;
    BEGIN
      PERFORM private.do_assign(a.shift_id, a.worker_id, true, a.source);
      result := 'assigned'; reason := NULL;
    EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '23P01' THEN
      result := 'blocked'; reason := regexp_replace(SQLERRM, '^Назначить нельзя: ', '');
    END;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Подтверждение выхода исполнителем: «Выйду».
CREATE OR REPLACE FUNCTION public.confirm_assignment(_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  UPDATE public.assignments SET status = 'confirmed', confirmed_at = now()
   WHERE id = _assignment_id AND worker_id = auth.uid() AND status = 'assigned';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Подтвердить можно только своё назначенное участие' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_assignment(uuid, uuid), public.assign_worker(uuid, uuid, boolean),
  public.assign_workers(uuid[], uuid[]), public.find_workers(uuid, text, integer), public.promote_reserve(uuid),
  public.cancel_assignment(uuid, uuid, boolean), public.mark_no_show(uuid, uuid), public.respond_to_shifts(uuid[]),
  public.review_responses(uuid[], boolean), public.confirm_assignment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_assignment(uuid, uuid), public.assign_worker(uuid, uuid, boolean),
  public.assign_workers(uuid[], uuid[]), public.find_workers(uuid, text, integer), public.promote_reserve(uuid),
  public.cancel_assignment(uuid, uuid, boolean), public.mark_no_show(uuid, uuid), public.respond_to_shifts(uuid[]),
  public.review_responses(uuid[], boolean), public.confirm_assignment(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.assignment_checks(uuid, uuid), private.do_assign(uuid, uuid, boolean, text),
  private.shift_assign_in_scope(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.assignment_checks(uuid, uuid), private.do_assign(uuid, uuid, boolean, text),
  private.shift_assign_in_scope(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION private.shift_assign_in_scope(uuid, text) TO authenticated;

-- «Повторить неделю» вместе с назначениями (О-6): те, кто проходит проверки, получают приглашения.
CREATE OR REPLACE FUNCTION public.repeat_order_week(_order_id uuid, _copy_assignments boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  o public.orders;
  new_id uuid;
  r record;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.order_in_scope(_order_id, 'create') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF o.status = 'new' THEN
    RAISE EXCEPTION 'Сначала примите заказ' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.orders (org_id, client_id, site_id, position_id, unit, date_from, date_to, weekdays, dates,
                             start_time, end_time, break_minutes, headcount, reserve_count, requirements, comment, source)
  VALUES (o.org_id, o.client_id, o.site_id, o.position_id, o.unit, o.date_from + 7, o.date_to + 7, o.weekdays,
          (SELECT array_agg(x + 7) FROM unnest(o.dates) x),
          o.start_time, o.end_time, o.break_minutes, o.headcount, o.reserve_count, o.requirements, o.comment, 'manager')
  RETURNING id INTO new_id;

  PERFORM private.generate_shifts(new_id);
  UPDATE public.orders SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now() WHERE id = new_id;

  IF _copy_assignments THEN
    FOR r IN
      SELECT a.worker_id, a.is_reserve, ns.id AS new_shift_id
      FROM public.assignments a
      JOIN public.shifts os ON os.id = a.shift_id AND os.order_id = _order_id
      JOIN public.shifts ns ON ns.order_id = new_id AND ns.shift_date = os.shift_date + 7
      WHERE a.status IN ('assigned', 'confirmed', 'on_site', 'worked')
    LOOP
      -- Приглашение получает только тот, кого можно назначить; остальные пропускаются без ошибки.
      IF NOT EXISTS (SELECT 1 FROM private.assignment_checks(r.new_shift_id, r.worker_id) c WHERE c.severity = 'deny') THEN
        INSERT INTO public.assignments (org_id, shift_id, worker_id, status, source, is_reserve, shift_start, shift_end, created_by)
        SELECT o.org_id, r.new_shift_id, r.worker_id, 'invited', 'assigned', r.is_reserve, ns.start_at, ns.end_at, auth.uid()
        FROM public.shifts ns WHERE ns.id = r.new_shift_id
        ON CONFLICT (shift_id, worker_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;
  RETURN new_id;
END;
$$;

-- ============================================================
-- 5. Укомплектованность смен для сетки планирования (О-7)
-- ============================================================
-- Права доступа берутся у вызывающего: сотрудник видит укомплектованность тех смен, что видит сам.
CREATE OR REPLACE VIEW public.shift_staffing WITH (security_invoker = true) AS
SELECT s.id AS shift_id, s.org_id, s.order_id, s.client_id, s.site_id, s.position_id, s.shift_date, s.start_at, s.end_at,
       s.headcount, s.reserve_count, s.status, s.published_at,
       count(a.id) FILTER (WHERE NOT a.is_reserve AND a.status IN ('assigned', 'confirmed', 'on_site', 'worked'))::integer AS assigned_count,
       count(a.id) FILTER (WHERE NOT a.is_reserve AND a.status IN ('confirmed', 'on_site', 'worked'))::integer AS confirmed_count,
       count(a.id) FILTER (WHERE NOT a.is_reserve AND a.status IN ('on_site', 'worked'))::integer AS on_site_count,
       count(a.id) FILTER (WHERE a.is_reserve AND a.status IN ('assigned', 'confirmed'))::integer AS reserve_count_taken,
       count(a.id) FILTER (WHERE a.status = 'responded')::integer AS responses_count
FROM public.shifts s
LEFT JOIN public.assignments a ON a.shift_id = s.id
GROUP BY s.id;

GRANT SELECT ON public.shift_staffing TO authenticated;

-- ============================================================
-- 6. Политики
-- ============================================================
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workers, public.worker_positions, public.worker_documents, public.worker_blocks, public.assignments FROM anon, authenticated;
GRANT SELECT ON public.workers, public.worker_positions, public.worker_documents, public.assignments TO authenticated;
GRANT UPDATE (full_name, phone, city, citizenship, birth_date, status, status_until, tax_status, contract_valid_until) ON public.workers TO authenticated;
GRANT INSERT, DELETE ON public.worker_positions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.worker_documents TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.worker_blocks TO authenticated;
GRANT ALL ON public.workers, public.worker_positions, public.worker_documents, public.worker_blocks, public.assignments TO service_role;

-- Исполнители: сотрудники по матрице прав, сам исполнитель — себя.
CREATE POLICY "Workers: view in scope or self" ON public.workers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.row_in_scope(org_id, 'workers', 'view', ARRAY[user_id]));
CREATE POLICY "Workers: update in scope" ON public.workers FOR UPDATE TO authenticated
  USING (private.row_in_scope(org_id, 'workers', 'update', ARRAY[user_id]))
  WITH CHECK (private.row_in_scope(org_id, 'workers', 'update', ARRAY[user_id]));

CREATE POLICY "Worker positions: view" ON public.worker_positions FOR SELECT TO authenticated
  USING (worker_id = auth.uid() OR private.row_in_scope(org_id, 'workers', 'view', ARRAY[worker_id]));
CREATE POLICY "Worker positions: add" ON public.worker_positions FOR INSERT TO authenticated
  WITH CHECK (private.row_in_scope(org_id, 'workers', 'update', ARRAY[worker_id]));
CREATE POLICY "Worker positions: remove" ON public.worker_positions FOR DELETE TO authenticated
  USING (private.row_in_scope(org_id, 'workers', 'update', ARRAY[worker_id]));

CREATE POLICY "Worker documents: view" ON public.worker_documents FOR SELECT TO authenticated
  USING (worker_id = auth.uid() OR private.row_in_scope(org_id, 'worker_documents', 'view', ARRAY[worker_id]));
CREATE POLICY "Worker documents: add" ON public.worker_documents FOR INSERT TO authenticated
  WITH CHECK (private.row_in_scope(org_id, 'worker_documents', 'create', ARRAY[worker_id]));
CREATE POLICY "Worker documents: edit" ON public.worker_documents FOR UPDATE TO authenticated
  USING (private.row_in_scope(org_id, 'worker_documents', 'update', ARRAY[worker_id]))
  WITH CHECK (private.row_in_scope(org_id, 'worker_documents', 'update', ARRAY[worker_id]));
CREATE POLICY "Worker documents: remove" ON public.worker_documents FOR DELETE TO authenticated
  USING (private.row_in_scope(org_id, 'worker_documents', 'delete', ARRAY[worker_id]));

-- Стоп-лист ведут те, кто назначает людей на объекты и к заказчикам.
CREATE POLICY "Blocks: view" ON public.worker_blocks FOR SELECT TO authenticated
  USING (
    (site_id IS NOT NULL AND private.row_in_scope(org_id, 'assignments', 'view', private.site_row_owners(site_id)))
    OR (client_id IS NOT NULL AND private.client_in_scope(client_id, 'assignments', 'view'))
  );
CREATE POLICY "Blocks: add" ON public.worker_blocks FOR INSERT TO authenticated
  WITH CHECK (
    (site_id IS NOT NULL AND private.row_in_scope(org_id, 'assignments', 'update', private.site_row_owners(site_id)))
    OR (client_id IS NOT NULL AND private.client_in_scope(client_id, 'assignments', 'update'))
  );
CREATE POLICY "Blocks: remove" ON public.worker_blocks FOR DELETE TO authenticated
  USING (
    (site_id IS NOT NULL AND private.row_in_scope(org_id, 'assignments', 'update', private.site_row_owners(site_id)))
    OR (client_id IS NOT NULL AND private.client_in_scope(client_id, 'assignments', 'update'))
  );

-- Назначения меняются только функциями выше.
CREATE POLICY "Assignments: view in scope or own" ON public.assignments FOR SELECT TO authenticated
  USING (
    worker_id = auth.uid()
    OR private.shift_assign_in_scope(shift_id, 'view')
  );

-- Исполнитель видит опубликованные открытые смены по своим позициям и смены, на которые у него есть
-- назначение или отклик. Ставок смены он здесь не видит.
CREATE POLICY "Shifts: workers see open published and own" ON public.shifts FOR SELECT TO authenticated
  USING (
    (published_at IS NOT NULL AND status IN ('open', 'staffed') AND start_at > now()
      AND EXISTS (SELECT 1 FROM public.worker_positions wp WHERE wp.worker_id = auth.uid() AND wp.position_id = shifts.position_id AND wp.org_id = shifts.org_id))
    OR EXISTS (SELECT 1 FROM public.assignments a WHERE a.shift_id = shifts.id AND a.worker_id = auth.uid())
  );
