-- Этап 3, шаг 30: импорт из Excel.
-- ТЗ: раздел 18 (ИЭ-1, ИЭ-2).
--
-- Файл разбирается в браузере в список строк, сервер проверяет каждую строку отдельно: плохие строки не мешают хорошим.
-- Сначала предпросмотр (ничего не записывается: изменения откатываются), затем загрузка. Для каждой строки ответ — создано,
-- обновлено, пропущено или ошибка с причиной. Дубли определяются по телефону (кандидаты), ИНН или названию (заказчики),
-- заказчику и названию (объекты), заказчику, объекту, позиции и дате (тарифы) и либо обновляются, либо пропускаются.

CREATE OR REPLACE FUNCTION private.import_date(_v text, _label text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text := btrim(coalesce(_v, ''));
BEGIN
  IF s = '' THEN RETURN NULL; END IF;
  IF s ~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN s::date; END IF;
  IF s ~ '^\d{1,2}\.\d{1,2}\.\d{4}$' THEN RETURN to_date(s, 'DD.MM.YYYY'); END IF;
  RAISE EXCEPTION '%: дата указана неверно («%»), нужен формат ДД.ММ.ГГГГ', _label, s USING ERRCODE = '22023';
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
  RAISE EXCEPTION '%: такой даты нет («%»)', _label, s USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION private.import_number(_v text, _label text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text := replace(replace(btrim(coalesce(_v, '')), ' ', ''), ',', '.');
BEGIN
  IF s = '' THEN RETURN NULL; END IF;
  IF s !~ '^-?\d+(\.\d+)?$' THEN RAISE EXCEPTION '%: нужно число, указано «%»', _label, _v USING ERRCODE = '22023'; END IF;
  RETURN s::numeric;
END;
$$;

-- Обработка одной строки. Возвращает результат, пояснение и идентификатор записи.
CREATE OR REPLACE FUNCTION private.import_one(_org_id uuid, _entity text, _r jsonb, _on_duplicate text, _uid uuid, _scope text)
RETURNS TABLE (result text, message text, id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  nm text := nullif(btrim(coalesce(_r ->> 'full_name', _r ->> 'name', '')), '');
  ph text := nullif(btrim(coalesce(_r ->> 'phone', '')), '');
  key text;
  ts text := nullif(btrim(coalesce(_r ->> 'tax_status', '')), '');
  inn_v text := nullif(regexp_replace(coalesce(_r ->> 'inn', ''), '\s', '', 'g'), '');
  st text := nullif(btrim(coalesce(_r ->> 'status', '')), '');
  cl public.clients;
  site_row public.sites;
  pos_id uuid;
  ex_id uuid;
  ex_name text;
  ex_rec uuid;
  src uuid;
  lat numeric;
  lon numeric;
  unit_v text;
  cr numeric;
  wr numeric;
  vf date;
  tf public.tariffs;
  n integer;
BEGIN
  IF _entity = 'candidates' THEN
    IF nm IS NULL THEN RAISE EXCEPTION 'Не указано ФИО' USING ERRCODE = '22023'; END IF;
    key := right(regexp_replace(coalesce(ph, ''), '\D', '', 'g'), 10);
    IF length(key) < 10 THEN RAISE EXCEPTION 'Телефон указан неверно: нужно 10 цифр номера' USING ERRCODE = '22023'; END IF;
    IF ts IS NOT NULL AND ts NOT IN ('ip', 'self_employed', 'gph', 'employment') THEN
      RAISE EXCEPTION 'Налоговый статус: допустимо ИП, самозанятый, ГПХ, трудовой договор' USING ERRCODE = '22023';
    END IF;
    SELECT w.full_name INTO ex_name FROM public.workers w WHERE w.org_id = _org_id AND right(regexp_replace(coalesce(w.phone, ''), '\D', '', 'g'), 10) = key LIMIT 1;
    IF ex_name IS NOT NULL THEN RETURN QUERY SELECT 'skipped', 'Уже есть исполнитель с этим телефоном: ' || ex_name, NULL::uuid; RETURN; END IF;
    SELECT c.id, c.full_name, c.recruiter_id INTO ex_id, ex_name, ex_rec FROM public.candidates c WHERE c.org_id = _org_id AND c.phone_key = key ORDER BY c.created_at LIMIT 1;
    IF ex_id IS NOT NULL THEN
      IF _on_duplicate <> 'update' THEN RETURN QUERY SELECT 'skipped', 'Кандидат с этим телефоном уже есть: ' || ex_name, ex_id; RETURN; END IF;
      IF _scope <> 'all' AND ex_rec IS DISTINCT FROM _uid THEN RETURN QUERY SELECT 'skipped', 'Кандидат с этим телефоном ведёт другой рекрутёр: ' || ex_name, ex_id; RETURN; END IF;
      UPDATE public.candidates c SET
        full_name = coalesce(nm, c.full_name), city = coalesce(nullif(btrim(_r ->> 'city'), ''), c.city), district = coalesce(nullif(btrim(_r ->> 'district'), ''), c.district),
        citizenship = coalesce(nullif(btrim(_r ->> 'citizenship'), ''), c.citizenship), experience = coalesce(nullif(btrim(_r ->> 'experience'), ''), c.experience),
        birth_date = coalesce(private.import_date(_r ->> 'birth_date', 'Дата рождения'), c.birth_date), tax_status = coalesce(ts, c.tax_status)
      WHERE c.id = ex_id;
      RETURN QUERY SELECT 'updated', 'Обновлён кандидат ' || ex_name, ex_id; RETURN;
    END IF;
    SELECT d.id INTO src FROM public.directories d WHERE d.org_id = _org_id AND d.kind = 'candidate_source' AND d.name = 'Импорт из Excel' LIMIT 1;
    INSERT INTO public.candidates (org_id, full_name, phone, city, district, citizenship, experience, birth_date, tax_status, source_id, recruiter_id, created_by)
    VALUES (_org_id, nm, ph, nullif(btrim(_r ->> 'city'), ''), nullif(btrim(_r ->> 'district'), ''), nullif(btrim(_r ->> 'citizenship'), ''), nullif(btrim(_r ->> 'experience'), ''),
            private.import_date(_r ->> 'birth_date', 'Дата рождения'), ts, src, _uid, _uid)
    RETURNING public.candidates.id INTO ex_id;
    RETURN QUERY SELECT 'created', 'Создан кандидат', ex_id; RETURN;

  ELSIF _entity = 'clients' THEN
    IF nm IS NULL THEN RAISE EXCEPTION 'Не указано название заказчика' USING ERRCODE = '22023'; END IF;
    IF inn_v IS NOT NULL AND inn_v !~ '^([0-9]{10}|[0-9]{12})$' THEN RAISE EXCEPTION 'ИНН должен состоять из 10 или 12 цифр' USING ERRCODE = '22023'; END IF;
    IF st IS NOT NULL AND st NOT IN ('lead', 'negotiation', 'contract', 'active', 'paused') THEN
      RAISE EXCEPTION 'Статус: допустимо лид, переговоры, договор, активный, пауза' USING ERRCODE = '22023';
    END IF;
    SELECT c.id, c.name INTO ex_id, ex_name FROM public.clients c
    WHERE c.org_id = _org_id AND ((inn_v IS NOT NULL AND c.inn = inn_v) OR (inn_v IS NULL AND lower(btrim(c.name)) = lower(nm))) ORDER BY c.created_at LIMIT 1;
    IF ex_id IS NOT NULL THEN
      IF _on_duplicate <> 'update' THEN RETURN QUERY SELECT 'skipped', 'Заказчик уже есть: ' || ex_name, ex_id; RETURN; END IF;
      IF NOT private.client_in_scope(ex_id, 'clients', 'update') THEN RETURN QUERY SELECT 'skipped', 'Заказчик ' || ex_name || ' закреплён за другим менеджером', ex_id; RETURN; END IF;
      UPDATE public.clients c SET
        legal_name = coalesce(nullif(btrim(_r ->> 'legal_name'), ''), c.legal_name), inn = coalesce(inn_v, c.inn), kpp = coalesce(nullif(btrim(_r ->> 'kpp'), ''), c.kpp),
        legal_address = coalesce(nullif(btrim(_r ->> 'legal_address'), ''), c.legal_address), city = coalesce(nullif(btrim(_r ->> 'city'), ''), c.city),
        notes = coalesce(nullif(btrim(_r ->> 'notes'), ''), c.notes)
      WHERE c.id = ex_id;
      RETURN QUERY SELECT 'updated', 'Обновлён заказчик ' || ex_name, ex_id; RETURN;
    END IF;
    INSERT INTO public.clients (org_id, name, legal_name, inn, kpp, legal_address, city, status, notes, sales_manager_id, created_by)
    VALUES (_org_id, nm, nullif(btrim(_r ->> 'legal_name'), ''), inn_v, nullif(btrim(_r ->> 'kpp'), ''), nullif(btrim(_r ->> 'legal_address'), ''), nullif(btrim(_r ->> 'city'), ''),
            coalesce(st, 'lead'), nullif(btrim(_r ->> 'notes'), ''), CASE WHEN _scope = 'all' THEN NULL ELSE _uid END, _uid)
    RETURNING public.clients.id INTO ex_id;
    RETURN QUERY SELECT 'created', 'Создан заказчик', ex_id; RETURN;

  ELSIF _entity IN ('sites', 'tariffs') THEN
    -- Заказчик задаётся названием и должен существовать в организации.
    SELECT count(*) INTO n FROM public.clients c WHERE c.org_id = _org_id AND lower(btrim(c.name)) = lower(btrim(coalesce(_r ->> 'client', '')));
    IF n = 0 THEN RAISE EXCEPTION 'Заказчик «%» не найден: сначала загрузите заказчиков', coalesce(_r ->> 'client', '') USING ERRCODE = '22023'; END IF;
    IF n > 1 THEN RAISE EXCEPTION 'Заказчиков с названием «%» несколько: уточните название', _r ->> 'client' USING ERRCODE = '22023'; END IF;
    SELECT * INTO cl FROM public.clients c WHERE c.org_id = _org_id AND lower(btrim(c.name)) = lower(btrim(_r ->> 'client'));

    IF _entity = 'sites' THEN
      IF nm IS NULL THEN RAISE EXCEPTION 'Не указано название объекта' USING ERRCODE = '22023'; END IF;
      IF st IS NOT NULL AND st NOT IN ('launch', 'active', 'paused') THEN RAISE EXCEPTION 'Статус объекта: допустимо запуск, активный, пауза' USING ERRCODE = '22023'; END IF;
      IF st IS NOT NULL AND st <> 'launch' AND _scope <> 'all' THEN RAISE EXCEPTION 'Запускать объект без проверок может только руководитель' USING ERRCODE = '42501'; END IF;
      lat := private.import_number(_r ->> 'latitude', 'Широта'); lon := private.import_number(_r ->> 'longitude', 'Долгота');
      IF lat IS NOT NULL AND lat NOT BETWEEN -90 AND 90 THEN RAISE EXCEPTION 'Широта должна быть от −90 до 90' USING ERRCODE = '22023'; END IF;
      IF lon IS NOT NULL AND lon NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Долгота должна быть от −180 до 180' USING ERRCODE = '22023'; END IF;
      IF nullif(btrim(_r ->> 'checkin_method'), '') IS NOT NULL AND (_r ->> 'checkin_method') NOT IN ('qr', 'geo', 'both', 'manual') THEN
        RAISE EXCEPTION 'Способ отметки: допустимо QR, геолокация, оба, вручную' USING ERRCODE = '22023';
      END IF;
      SELECT s.id INTO ex_id FROM public.sites s WHERE s.org_id = _org_id AND s.client_id = cl.id AND lower(btrim(s.name)) = lower(nm) LIMIT 1;
      IF ex_id IS NOT NULL THEN
        IF _on_duplicate <> 'update' THEN RETURN QUERY SELECT 'skipped', 'Объект уже есть у заказчика: ' || nm, ex_id; RETURN; END IF;
        UPDATE public.sites s SET address = coalesce(nullif(btrim(_r ->> 'address'), ''), s.address), city = coalesce(nullif(btrim(_r ->> 'city'), ''), s.city),
          latitude = coalesce(lat, s.latitude), longitude = coalesce(lon, s.longitude), instructions = coalesce(nullif(btrim(_r ->> 'instructions'), ''), s.instructions),
          contact_name = coalesce(nullif(btrim(_r ->> 'contact_name'), ''), s.contact_name), contact_phone = coalesce(nullif(btrim(_r ->> 'contact_phone'), ''), s.contact_phone)
        WHERE s.id = ex_id;
        RETURN QUERY SELECT 'updated', 'Обновлён объект ' || nm, ex_id; RETURN;
      END IF;
      INSERT INTO public.sites (org_id, client_id, name, address, city, latitude, longitude, checkin_method, status, instructions, contact_name, contact_phone, site_manager_id, created_by)
      VALUES (_org_id, cl.id, nm, nullif(btrim(_r ->> 'address'), ''), nullif(btrim(_r ->> 'city'), ''), lat, lon, coalesce(nullif(btrim(_r ->> 'checkin_method'), ''), 'qr'), coalesce(st, 'launch'),
              nullif(btrim(_r ->> 'instructions'), ''), nullif(btrim(_r ->> 'contact_name'), ''), nullif(btrim(_r ->> 'contact_phone'), ''), CASE WHEN _scope = 'all' THEN NULL ELSE _uid END, _uid)
      RETURNING public.sites.id INTO ex_id;
      RETURN QUERY SELECT 'created', 'Создан объект', ex_id; RETURN;
    END IF;

    -- Тариф: объект необязателен, позиция должна существовать, ставки обязательны.
    IF nullif(btrim(coalesce(_r ->> 'site', '')), '') IS NOT NULL THEN
      SELECT * INTO site_row FROM public.sites s WHERE s.org_id = _org_id AND s.client_id = cl.id AND lower(btrim(s.name)) = lower(btrim(_r ->> 'site')) LIMIT 1;
      IF site_row.id IS NULL THEN RAISE EXCEPTION 'Объект «%» у заказчика не найден', _r ->> 'site' USING ERRCODE = '22023'; END IF;
    END IF;
    SELECT p.id INTO pos_id FROM public.positions p WHERE p.org_id = _org_id AND lower(btrim(p.name)) = lower(btrim(coalesce(_r ->> 'position', ''))) LIMIT 1;
    IF pos_id IS NULL THEN RAISE EXCEPTION 'Позиция «%» не найдена в справочнике', coalesce(_r ->> 'position', '') USING ERRCODE = '22023'; END IF;
    unit_v := coalesce(nullif(btrim(_r ->> 'unit'), ''), 'hour');
    IF unit_v NOT IN ('hour', 'shift', 'piece') THEN RAISE EXCEPTION 'Единица ставки: допустимо час, смена, штука' USING ERRCODE = '22023'; END IF;
    cr := private.import_number(_r ->> 'client_rate', 'Ставка заказчику'); wr := private.import_number(_r ->> 'worker_rate', 'Ставка исполнителю');
    IF cr IS NULL OR wr IS NULL THEN RAISE EXCEPTION 'Укажите обе ставки: заказчику и исполнителю' USING ERRCODE = '22023'; END IF;
    IF cr < 0 OR wr < 0 THEN RAISE EXCEPTION 'Ставки не могут быть отрицательными' USING ERRCODE = '22023'; END IF;
    vf := private.import_date(_r ->> 'valid_from', 'Действует с');
    IF vf IS NULL THEN RAISE EXCEPTION 'Не указана дата начала действия тарифа' USING ERRCODE = '22023'; END IF;
    SELECT * INTO tf FROM public.tariffs t WHERE t.org_id = _org_id AND t.client_id = cl.id AND t.site_id IS NOT DISTINCT FROM site_row.id AND t.position_id = pos_id AND t.unit = unit_v AND t.valid_from = vf
      ORDER BY t.created_at DESC LIMIT 1;
    IF tf.id IS NOT NULL THEN
      IF _on_duplicate <> 'update' OR tf.status <> 'draft' THEN
        RETURN QUERY SELECT 'skipped', 'Тариф на эту дату уже есть (' || CASE tf.status WHEN 'draft' THEN 'черновик' WHEN 'pending' THEN 'на согласовании' WHEN 'approved' THEN 'утверждён' ELSE 'закрыт' END || ')', tf.id; RETURN;
      END IF;
      UPDATE public.tariffs t SET client_rate = cr, worker_rate = wr WHERE t.id = tf.id;
      RETURN QUERY SELECT 'updated', 'Обновлён черновик тарифа', tf.id; RETURN;
    END IF;
    INSERT INTO public.tariffs (org_id, client_id, site_id, position_id, unit, client_rate, worker_rate, valid_from, status, note, created_by)
    VALUES (_org_id, cl.id, site_row.id, pos_id, unit_v, cr, wr, vf, 'draft', 'Импорт из Excel', _uid)
    RETURNING public.tariffs.id INTO ex_id;
    RETURN QUERY SELECT 'created', 'Создан черновик тарифа: утвердите его в карточке заказчика', ex_id; RETURN;
  END IF;
  RAISE EXCEPTION 'Неизвестный вид импорта' USING ERRCODE = '22023';
END;
$$;

-- Предпросмотр (_apply = false) выполняет те же проверки и записи, но откатывает их; загрузка (_apply = true) сохраняет.
CREATE OR REPLACE FUNCTION public.import_rows(_org_id uuid, _entity text, _rows jsonb, _apply boolean DEFAULT false, _on_duplicate text DEFAULT 'skip')
RETURNS TABLE (row_no integer, result text, message text, entity_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  uid uuid := auth.uid();
  module_name text := CASE _entity WHEN 'candidates' THEN 'candidates' WHEN 'clients' THEN 'clients' WHEN 'sites' THEN 'sites' WHEN 'tariffs' THEN 'tariffs' END;
  sc text;
  r jsonb;
  idx integer := 0;
  res text;
  msg text;
  eid uuid;
  out jsonb := '[]'::jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  IF module_name IS NULL THEN RAISE EXCEPTION 'Неизвестный вид импорта' USING ERRCODE = '22023'; END IF;
  sc := private.permission_scope(uid, _org_id, module_name, 'create');
  IF sc = 'none' THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  IF _on_duplicate NOT IN ('skip', 'update') THEN RAISE EXCEPTION 'Дубли: пропустить или обновить' USING ERRCODE = '22023'; END IF;
  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' THEN RAISE EXCEPTION 'Ожидается список строк' USING ERRCODE = '22023'; END IF;
  IF jsonb_array_length(_rows) > 2000 THEN RAISE EXCEPTION 'За один раз можно загрузить не больше 2000 строк' USING ERRCODE = '22023'; END IF;

  BEGIN
    FOR r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
      idx := idx + 1;
      BEGIN
        SELECT x.result, x.message, x.id INTO res, msg, eid FROM private.import_one(_org_id, _entity, r, _on_duplicate, uid, sc) x;
      EXCEPTION WHEN OTHERS THEN
        res := 'error'; msg := SQLERRM; eid := NULL;
        IF SQLSTATE = '42501' THEN msg := 'Недостаточно прав для этой строки'; END IF;
        IF SQLSTATE IN ('23505', '23503', '23514', '22P02', '22001', '22003') THEN msg := 'Данные строки не прошли проверку базы: ' || SQLERRM; END IF;
      END;
      out := out || jsonb_build_array(jsonb_build_object('row', idx + 1, 'result', res, 'message', msg, 'id', eid));
    END LOOP;
    IF NOT _apply THEN RAISE EXCEPTION 'import_preview' USING ERRCODE = 'IM001'; END IF;
  EXCEPTION WHEN SQLSTATE 'IM001' THEN
    NULL;
  END;

  RETURN QUERY SELECT (e ->> 'row')::integer, e ->> 'result', e ->> 'message', nullif(e ->> 'id', '')::uuid FROM jsonb_array_elements(out) e;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.import_rows(uuid, text, jsonb, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_rows(uuid, text, jsonb, boolean, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.import_one(uuid, text, jsonb, text, uuid, text), private.import_date(text, text), private.import_number(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.import_one(uuid, text, jsonb, text, uuid, text), private.import_date(text, text), private.import_number(text, text) TO service_role;
