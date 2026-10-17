-- Этап 3, шаг 28: контроль документов.
-- ТЗ: раздел 18 (ДК-1…ДК-3).
--
-- Новые назначения с истёкшим документом база запрещает уже сейчас (assignment_checks). Здесь — то, чего не хватало:
-- общий реестр сроков документов и договоров исполнителей, массовые напоминания и список смен, которые стали
-- недопустимыми после того, как человека уже назначили (документ истёк позже назначения).

INSERT INTO public.notification_events (code, title, channels, delivery, critical, audience) VALUES
  ('document_expiring_worker', 'Истекает документ или договор', ARRAY['push', 'max', 'sms'], 'first', false, 'исполнитель'),
  ('document_conflict',        'Назначен исполнитель с недействующим документом', ARRAY['max'], 'all', false, 'менеджер объекта');

-- ============================================================
-- 1. Смены, на которых требуемый документ или договор не действует
-- ============================================================
CREATE OR REPLACE FUNCTION private.document_conflicts_raw(_org_id uuid, _from date, _to date)
RETURNS TABLE (assignment_id uuid, shift_id uuid, worker_id uuid, worker_name text, shift_date date, site_id uuid, site_name text, problem text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT a.id, s.id, w.user_id, w.full_name, s.shift_date, st.id, st.name, 'Нет действующего документа: ' || d.name
  FROM public.assignments a
  JOIN public.shifts s ON s.id = a.shift_id AND s.status <> 'cancelled'
  JOIN public.workers w ON w.user_id = a.worker_id AND w.org_id = a.org_id
  JOIN public.sites st ON st.id = s.site_id
  CROSS JOIN LATERAL (
    SELECT dd.id, dd.name FROM public.directories dd
    WHERE dd.id IN (SELECT r.document_type_id FROM public.site_required_documents r WHERE r.site_id = s.site_id
                    UNION SELECT p.document_type_id FROM public.position_required_documents p WHERE p.position_id = s.position_id)
  ) d
  WHERE a.org_id = _org_id AND a.status IN ('assigned', 'confirmed') AND NOT a.is_reserve AND s.shift_date BETWEEN _from AND _to
    AND NOT EXISTS (SELECT 1 FROM public.worker_documents wd
                    WHERE wd.worker_id = a.worker_id AND wd.document_type_id = d.id AND wd.status = 'verified'
                      AND (wd.valid_until IS NULL OR wd.valid_until >= s.shift_date))
  UNION ALL
  SELECT a.id, s.id, w.user_id, w.full_name, s.shift_date, st.id, st.name, 'Договор с исполнителем истёк ' || to_char(w.contract_valid_until, 'DD.MM.YYYY')
  FROM public.assignments a
  JOIN public.shifts s ON s.id = a.shift_id AND s.status <> 'cancelled'
  JOIN public.workers w ON w.user_id = a.worker_id AND w.org_id = a.org_id
  JOIN public.sites st ON st.id = s.site_id
  WHERE a.org_id = _org_id AND a.status IN ('assigned', 'confirmed') AND NOT a.is_reserve AND s.shift_date BETWEEN _from AND _to
    AND w.contract_valid_until IS NOT NULL AND w.contract_valid_until < s.shift_date
$$;

CREATE OR REPLACE FUNCTION public.document_conflicts(_org_id uuid, _from date, _to date)
RETURNS TABLE (assignment_id uuid, shift_id uuid, worker_id uuid, worker_name text, shift_date date, site_id uuid, site_name text, problem text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  scope text := private.permission_scope(auth.uid(), _org_id, 'assignments', 'view');
BEGIN
  IF auth.uid() IS NULL OR scope = 'none' THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT c.* FROM private.document_conflicts_raw(_org_id, _from, _to) c
  WHERE scope = 'all' OR private.site_manager_of(c.site_id) = auth.uid()
  ORDER BY c.shift_date, c.worker_name;
END;
$$;

-- ============================================================
-- 2. Реестр документов и договоров (ДК-1, ДК-3)
-- ============================================================
-- Одна строка — действующий документ исполнителя каждого типа (последний по сроку) и договор с исполнителем.
CREATE OR REPLACE FUNCTION public.document_registry(_org_id uuid, _type uuid DEFAULT NULL, _bucket text DEFAULT NULL, _site uuid DEFAULT NULL,
                                                    _search text DEFAULT NULL, _limit integer DEFAULT 100, _offset integer DEFAULT 0)
RETURNS TABLE (kind text, doc_id uuid, worker_id uuid, worker_name text, phone text, type_id uuid, type_name text, number_masked text,
               valid_until date, days_left integer, status text, next_site text, total bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'worker_documents', 'view') <> 'all' THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  IF _bucket IS NOT NULL AND _bucket NOT IN ('expired', 'd3', 'd14', 'd30', 'none') THEN RAISE EXCEPTION 'Неизвестный срок' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
  WITH docs AS (
    SELECT DISTINCT ON (wd.worker_id, wd.document_type_id)
           'document'::text AS kind, wd.id AS doc_id, wd.worker_id, wd.document_type_id AS type_id, dt.name AS type_name, wd.number_masked, wd.valid_until, wd.status
    FROM public.worker_documents wd JOIN public.directories dt ON dt.id = wd.document_type_id
    WHERE wd.org_id = _org_id AND wd.status <> 'rejected'
    ORDER BY wd.worker_id, wd.document_type_id, wd.valid_until DESC NULLS FIRST, wd.created_at DESC
  ), contracts AS (
    SELECT 'contract'::text, w.user_id, w.user_id, NULL::uuid, 'Договор с исполнителем'::text, NULL::text, w.contract_valid_until, 'verified'::text
    FROM public.workers w WHERE w.org_id = _org_id AND w.contract_valid_until IS NOT NULL
  ), u AS (
    SELECT * FROM docs UNION ALL SELECT * FROM contracts
  )
  SELECT u.kind, u.doc_id, w.user_id, w.full_name, w.phone, u.type_id, u.type_name, u.number_masked, u.valid_until,
         (u.valid_until - current_date)::integer, u.status,
         (SELECT st.name FROM public.assignments a JOIN public.shifts s ON s.id = a.shift_id JOIN public.sites st ON st.id = s.site_id
           WHERE a.worker_id = w.user_id AND a.status IN ('assigned', 'confirmed', 'on_site') AND s.shift_date >= current_date AND s.status <> 'cancelled'
           ORDER BY s.start_at LIMIT 1),
         count(*) OVER ()
  FROM u JOIN public.workers w ON w.user_id = u.worker_id AND w.org_id = _org_id AND w.status <> 'not_working'
  WHERE (_type IS NULL OR u.type_id = _type)
    AND (_bucket IS NULL
         OR (_bucket = 'expired' AND u.valid_until < current_date)
         OR (_bucket = 'd3' AND u.valid_until BETWEEN current_date AND current_date + 3)
         OR (_bucket = 'd14' AND u.valid_until BETWEEN current_date AND current_date + 14)
         OR (_bucket = 'd30' AND u.valid_until BETWEEN current_date AND current_date + 30)
         OR (_bucket = 'none' AND u.valid_until IS NULL))
    AND (_site IS NULL OR EXISTS (SELECT 1 FROM public.assignments a JOIN public.shifts s ON s.id = a.shift_id
                                  WHERE a.worker_id = w.user_id AND s.site_id = _site AND a.status IN ('assigned', 'confirmed', 'on_site') AND s.shift_date >= current_date AND s.status <> 'cancelled'))
    AND (nullif(btrim(_search), '') IS NULL OR w.full_name ILIKE '%' || btrim(_search) || '%' OR w.phone ILIKE '%' || btrim(_search) || '%')
  ORDER BY u.valid_until NULLS LAST, w.full_name
  LIMIT greatest(_limit, 1) OFFSET greatest(_offset, 0);
END;
$$;

-- Массовое напоминание исполнителям: по выбранным документам и по договорам (идентификатор — исполнитель). Раз в сутки на документ.
CREATE OR REPLACE FUNCTION public.remind_documents(_org_id uuid, _doc_ids uuid[], _contract_worker_ids uuid[] DEFAULT ARRAY[]::uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  n integer := 0;
  r record;
  rid uuid;
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'worker_documents', 'update') <> 'all' THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  FOR r IN
    SELECT wd.id, wd.worker_id, dt.name, wd.valid_until FROM public.worker_documents wd JOIN public.directories dt ON dt.id = wd.document_type_id
    WHERE wd.org_id = _org_id AND wd.id = ANY (coalesce(_doc_ids, ARRAY[]::uuid[]))
  LOOP
    rid := private.notify(_org_id, r.worker_id, 'document_expiring_worker',
                          CASE WHEN r.valid_until < current_date THEN 'Срок документа истёк: ' ELSE 'Истекает документ: ' END || r.name,
                          CASE WHEN r.valid_until IS NULL THEN 'Загрузите действующий документ' ELSE 'Срок до ' || to_char(r.valid_until, 'DD.MM.YYYY') || '. Загрузите новый в профиле' END,
                          '/worker/profile', 'docremind:' || r.id || ':' || current_date);
    IF rid IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  FOR r IN
    SELECT w.user_id, w.contract_valid_until FROM public.workers w WHERE w.org_id = _org_id AND w.user_id = ANY (coalesce(_contract_worker_ids, ARRAY[]::uuid[]))
  LOOP
    rid := private.notify(_org_id, r.user_id, 'document_expiring_worker',
                          CASE WHEN r.contract_valid_until < current_date THEN 'Срок договора истёк' ELSE 'Истекает договор' END,
                          CASE WHEN r.contract_valid_until IS NULL THEN 'Свяжитесь с менеджером' ELSE 'Срок до ' || to_char(r.contract_valid_until, 'DD.MM.YYYY') || '. Свяжитесь с менеджером для продления' END,
                          '/worker/profile', 'contractremind:' || r.user_id || ':' || current_date);
    IF rid IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END;
$$;

-- Раз в сутки: менеджеру объекта — о назначенных на ближайшие две недели с недействующим документом или договором.
CREATE OR REPLACE FUNCTION private.notify_document_conflicts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  n integer := 0;
  o record;
  c record;
  mgr uuid;
  rid uuid;
BEGIN
  FOR o IN SELECT id FROM public.organizations LOOP
    FOR c IN SELECT * FROM private.document_conflicts_raw(o.id, current_date, current_date + 14) LOOP
      mgr := private.site_manager_of(c.site_id);
      IF mgr IS NULL THEN CONTINUE; END IF;
      rid := private.notify(o.id, mgr, 'document_conflict', c.worker_name || ': ' || c.problem,
                            c.site_name || ', смена ' || to_char(c.shift_date, 'DD.MM') || '. Решите, заменить ли исполнителя', '/planning',
                            'docconf:' || c.assignment_id || ':' || md5(c.problem));
      IF rid IS NOT NULL THEN n := n + 1; END IF;
    END LOOP;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.document_conflicts(uuid, date, date), public.document_registry(uuid, uuid, text, uuid, text, integer, integer),
  public.remind_documents(uuid, uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_conflicts(uuid, date, date), public.document_registry(uuid, uuid, text, uuid, text, integer, integer),
  public.remind_documents(uuid, uuid[], uuid[]) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.document_conflicts_raw(uuid, date, date), private.notify_document_conflicts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.document_conflicts_raw(uuid, date, date), private.notify_document_conflicts() TO service_role;
