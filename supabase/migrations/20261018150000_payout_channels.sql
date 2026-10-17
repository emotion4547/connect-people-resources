-- Этап 2, шаг 19: каналы выплат, сверка, кабинет исполнителя.
-- ТЗ: раздел 15 (В-4, В-5, В-6, В-11, В-12).
--
-- Банк: выгрузка файла платежей для интернет-банка и отметка «проведено» по выписке. Платформа самозанятых: интерфейс
-- подключения (конкретная платформа — открытый вопрос ТЗ). Ручной режим для любого канала: выгрузка в Excel и отметка вручную —
-- работа не останавливается, если API недоступен. Ответ банка или платформы переводит строку в «проведена» или «ошибка» с текстом.

INSERT INTO public.notification_events (code, title, channels, delivery, critical, audience) VALUES
  ('payout_paid',   'Выплата проведена',        ARRAY['push', 'max', 'sms'], 'first', false, 'исполнитель'),
  ('payout_failed', 'Выплата не прошла',        ARRAY['push', 'max', 'sms'], 'first', true,  'исполнитель, бухгалтер');

-- ============================================================
-- 1. Итоги по строкам с уведомлениями (замена функций шага 18)
-- ============================================================
CREATE OR REPLACE FUNCTION private.mark_line_paid(_line_id uuid, _provider_id text DEFAULT NULL, _receipt text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  l public.payout_lines;
BEGIN
  SELECT * INTO l FROM public.payout_lines WHERE id = _line_id FOR UPDATE;
  IF NOT FOUND OR l.status <> 'pending' THEN RETURN; END IF;
  UPDATE public.payout_lines SET status = 'paid', provider_payment_id = _provider_id, receipt = _receipt, paid_at = now(), error_text = NULL WHERE id = _line_id;
  UPDATE public.accruals SET status = 'paid' WHERE payout_line_id = _line_id AND status = 'in_registry';
  IF l.advance_id IS NOT NULL THEN
    UPDATE public.worker_advances SET status = 'issued', remaining = amount, issued_at = now() WHERE id = l.advance_id;
  END IF;
  PERFORM private.refresh_registry_status(l.registry_id);
  IF l.amount_to_pay > 0 THEN
    PERFORM private.notify(l.org_id, l.worker_id, 'payout_paid', 'Выплата проведена: ' || l.amount_to_pay || ' ₽', CASE WHEN _receipt IS NOT NULL THEN 'Чек: ' || _receipt END,
                           '/worker/payments', 'paid:' || _line_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.mark_line_error(_line_id uuid, _error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  l public.payout_lines;
  txt text := coalesce(nullif(btrim(_error), ''), 'Ошибка при проведении');
  u uuid;
BEGIN
  SELECT * INTO l FROM public.payout_lines WHERE id = _line_id FOR UPDATE;
  IF NOT FOUND OR l.status <> 'pending' THEN RETURN; END IF;
  PERFORM private.release_payout_line(_line_id);
  UPDATE public.payout_lines SET status = 'error', error_text = txt WHERE id = _line_id;
  PERFORM private.refresh_registry_status(l.registry_id);
  -- Исполнитель и бухгалтер узнают об ошибке сразу (В-11)
  PERFORM private.notify(l.org_id, l.worker_id, 'payout_failed', 'Выплата не прошла', 'Бухгалтер свяжется с вами и проверит реквизиты. ' || txt, '/worker/payments', 'fail:' || _line_id);
  FOR u IN SELECT DISTINCT user_id FROM public.user_roles WHERE org_id = l.org_id AND role = 'accountant' LOOP
    PERFORM private.notify(l.org_id, u, 'payout_failed', 'Выплата не прошла: ' || l.worker_name, txt, '/payout-registries/' || l.registry_id, 'failacc:' || _line_id);
  END LOOP;
END;
$$;

-- ============================================================
-- 2. Файл платежей банка (В-4) и ручной режим (В-6)
-- ============================================================
-- Данные для файла платежей: реквизиты расшифровываются на сервере, каждое обращение записывается в журнал. Доступно только
-- для подтверждённого реестра и только тем, у кого есть право смотреть реквизиты выплат во всей организации.
CREATE OR REPLACE FUNCTION public.payout_registry_export(_registry_id uuid)
RETURNS TABLE (line_id uuid, worker_name text, tax_status text, requisites text, account text, bik text, amount numeric, registry_number text, purpose text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  r public.payout_registries;
BEGIN
  SELECT * INTO r FROM public.payout_registries WHERE id = _registry_id;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), r.org_id, 'payout_registries', 'export') <> 'all'
     OR private.permission_scope(auth.uid(), r.org_id, 'worker_payout_details', 'view') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF r.status NOT IN ('confirmed', 'sent', 'paid_partial', 'errors') THEN
    RAISE EXCEPTION 'Выгрузить можно только подтверждённый реестр' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.audit_log (org_id, actor_id, action, table_name, record_id, field, note)
  VALUES (r.org_id, auth.uid(), 'view', 'payout_registries', r.id::text, 'requisites', 'выгружены реквизиты реестра ' || r.number);
  RETURN QUERY
  SELECT l.id, l.worker_name, l.tax_status, d.txt,
         (regexp_match(d.txt, '(?<![0-9])[0-9]{20}(?![0-9])'))[1],
         (regexp_match(d.txt, '(?<![0-9])0[0-9]{8}(?![0-9])'))[1],
         l.amount_to_pay, r.number,
         CASE r.kind WHEN 'advance' THEN 'Аванс по договору, реестр ' ELSE 'Оплата услуг по договору, реестр ' END || r.number || ', без НДС'
  FROM public.payout_lines l
  LEFT JOIN LATERAL (SELECT private.pii_decrypt(q.details_encrypted) AS txt FROM public.payout_requisites q WHERE q.worker_id = l.worker_id AND q.status = 'confirmed') d ON true
  WHERE l.registry_id = _registry_id AND l.status = 'pending' AND l.amount_to_pay > 0
  ORDER BY l.worker_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_registry_sent(_registry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  r public.payout_registries;
BEGIN
  SELECT * INTO r FROM public.payout_registries WHERE id = _registry_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), r.org_id, 'payout_registries', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'confirmed' THEN RAISE EXCEPTION 'Отправить можно только подтверждённый реестр' USING ERRCODE = '22023'; END IF;
  UPDATE public.payout_registries SET status = 'sent', sent_at = now() WHERE id = _registry_id;
END;
$$;

-- Ручная отметка проведения или ошибки по строкам: когда нет API или банк ответил письмом.
CREATE OR REPLACE FUNCTION public.settle_payout_lines(_registry_id uuid, _line_ids uuid[], _status text, _text text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  r public.payout_registries;
  lid uuid;
  n integer := 0;
BEGIN
  SELECT * INTO r FROM public.payout_registries WHERE id = _registry_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), r.org_id, 'payout_registries', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF r.status NOT IN ('confirmed', 'sent', 'paid_partial', 'errors') THEN RAISE EXCEPTION 'Реестр не подтверждён' USING ERRCODE = '22023'; END IF;
  IF _status NOT IN ('paid', 'error') THEN RAISE EXCEPTION 'Неизвестный итог' USING ERRCODE = '22023'; END IF;
  IF _status = 'error' AND nullif(btrim(coalesce(_text, '')), '') IS NULL THEN RAISE EXCEPTION 'Опишите ошибку' USING ERRCODE = '22023'; END IF;
  IF r.status = 'confirmed' THEN UPDATE public.payout_registries SET status = 'sent', sent_at = now() WHERE id = _registry_id; END IF;
  FOREACH lid IN ARRAY _line_ids LOOP
    IF EXISTS (SELECT 1 FROM public.payout_lines WHERE id = lid AND registry_id = _registry_id AND status = 'pending') THEN
      IF _status = 'paid' THEN PERFORM private.mark_line_paid(lid, 'вручную', _text); ELSE PERFORM private.mark_line_error(lid, _text); END IF;
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

-- Исходящие платежи из банковской выписки отмечают строки реестра банка «проведена» (В-4). Строка находится по сумме и номеру реестра
-- в назначении платежа либо по ФИО получателя; неоднозначное остаётся без отметки.
CREATE OR REPLACE FUNCTION public.reconcile_bank_statement(_org_id uuid, _payments jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  p jsonb;
  amt numeric;
  cnt integer;
  lid uuid;
  matched integer := 0;
  unmatched jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'payout_registries', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_payments) <> 'array' THEN RAISE EXCEPTION 'Нет платежей' USING ERRCODE = '22023'; END IF;
  FOR p IN SELECT * FROM jsonb_array_elements(_payments) LOOP
    amt := (p->>'amount')::numeric;
    SELECT count(*), min(l.id::text)::uuid INTO cnt, lid
    FROM public.payout_lines l JOIN public.payout_registries r ON r.id = l.registry_id
    WHERE l.org_id = _org_id AND l.status = 'pending' AND r.channel = 'bank' AND r.status IN ('confirmed', 'sent', 'paid_partial', 'errors')
      AND l.amount_to_pay = amt
      AND (position(r.number IN coalesce(p->>'purpose', '')) > 0 OR lower(l.worker_name) = lower(coalesce(p->>'recipient_name', '')));
    IF cnt = 1 THEN
      UPDATE public.payout_registries SET status = 'sent', sent_at = coalesce(sent_at, now())
       WHERE id = (SELECT registry_id FROM public.payout_lines WHERE id = lid) AND status = 'confirmed';
      PERFORM private.mark_line_paid(lid, 'п/п ' || coalesce(p->>'number', ''), NULL);
      matched := matched + 1;
    ELSE
      unmatched := unmatched || jsonb_build_array(p);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('matched', matched, 'unmatched', unmatched);
END;
$$;

-- Отчёт сверки по реестру: сколько проведено, сколько ошибок и на какую сумму.
CREATE OR REPLACE FUNCTION public.payout_registry_report(_registry_id uuid)
RETURNS TABLE (status text, lines integer, amount numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  org uuid;
BEGIN
  SELECT org_id INTO org FROM public.payout_registries WHERE id = _registry_id;
  IF org IS NULL OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), org, 'payout_registries', 'view') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT l.status, count(*)::integer, coalesce(sum(l.amount_to_pay), 0) FROM public.payout_lines l WHERE l.registry_id = _registry_id GROUP BY l.status ORDER BY l.status;
END;
$$;

-- ============================================================
-- 3. Платформа самозанятых (В-5)
-- ============================================================
-- Edge-функция send-platform-payouts получает данные строк реестра (служебная роль), передаёт их адаптеру выбранной платформы и
-- записывает ответ. Конкретная платформа выбирается по решению клиента; пока подключена заглушка, которая честно сообщает об этом,
-- и реестр проводится в ручном режиме.
CREATE OR REPLACE FUNCTION public.platform_registry_payload(_registry_id uuid)
RETURNS TABLE (line_id uuid, worker_id uuid, worker_name text, requisites text, amount numeric, registry_number text, inn text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT l.id, l.worker_id, l.worker_name, private.pii_decrypt(q.details_encrypted), l.amount_to_pay, r.number, private.pii_decrypt(s.inn_encrypted)
  FROM public.payout_registries r
  JOIN public.payout_lines l ON l.registry_id = r.id AND l.status = 'pending' AND l.amount_to_pay > 0
  LEFT JOIN public.payout_requisites q ON q.worker_id = l.worker_id AND q.status = 'confirmed'
  LEFT JOIN public.person_secrets s ON s.subject_type = 'worker' AND s.subject_id = l.worker_id
  WHERE r.id = _registry_id AND r.channel = 'platform' AND r.status IN ('confirmed', 'sent', 'paid_partial', 'errors')
$$;

CREATE OR REPLACE FUNCTION public.platform_record_result(_line_id uuid, _status text, _provider_id text DEFAULT NULL, _receipt text DEFAULT NULL, _error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  rid uuid;
BEGIN
  SELECT registry_id INTO rid FROM public.payout_lines WHERE id = _line_id;
  IF rid IS NULL THEN RETURN; END IF;
  UPDATE public.payout_registries SET status = 'sent', sent_at = coalesce(sent_at, now()) WHERE id = rid AND status = 'confirmed';
  IF _status = 'paid' THEN PERFORM private.mark_line_paid(_line_id, _provider_id, _receipt);
  ELSIF _status = 'error' THEN PERFORM private.mark_line_error(_line_id, _error);
  ELSIF _status = 'accepted' THEN UPDATE public.payout_lines SET provider_payment_id = _provider_id WHERE id = _line_id AND status = 'pending';
  END IF;
END;
$$;

-- Может ли пользователь отправлять реестр на платформу (проверка в edge-функции от имени пользователя)
CREATE OR REPLACE FUNCTION public.platform_send_allowed(_registry_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (SELECT 1 FROM public.payout_registries r WHERE r.id = _registry_id AND r.channel = 'platform'
                 AND r.status IN ('confirmed', 'sent', 'paid_partial', 'errors')
                 AND auth.uid() IS NOT NULL AND private.permission_scope(auth.uid(), r.org_id, 'payout_registries', 'update') = 'all')
$$;

-- ============================================================
-- 4. Выплаты и справка в кабинете исполнителя (В-12)
-- ============================================================
CREATE OR REPLACE FUNCTION public.worker_payouts(_from date, _to date)
RETURNS TABLE (line_id uuid, registry_number text, kind text, planned_on date, paid_at timestamptz, amount numeric, advance_held numeric, status text, receipt text, error_text text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT l.id, r.number, r.kind, r.period_to, l.paid_at, l.amount_to_pay, l.advance_held, l.status, l.receipt, l.error_text
  FROM public.payout_lines l JOIN public.payout_registries r ON r.id = l.registry_id
  WHERE l.worker_id = auth.uid() AND l.status <> 'cancelled' AND r.status <> 'cancelled' AND r.status <> 'composed'
    AND coalesce(l.paid_at::date, r.period_to) BETWEEN _from AND _to
  ORDER BY coalesce(l.paid_at, r.created_at) DESC
$$;

-- Справка о заработке за период: помесячно начислено и выплачено. Печатается из кабинета.
CREATE OR REPLACE FUNCTION public.worker_income_certificate(_from date, _to date)
RETURNS TABLE (month date, accrued numeric, paid numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  WITH months AS (SELECT generate_series(date_trunc('month', _from), date_trunc('month', _to), interval '1 month')::date AS m)
  SELECT m.m,
         coalesce((SELECT sum(x.amount_worker) FROM public.accruals x WHERE x.worker_id = auth.uid() AND x.status <> 'draft' AND x.kind <> 'client_penalty'
                    AND date_trunc('month', x.shift_date)::date = m.m), 0),
         coalesce((SELECT sum(l.amount_to_pay) FROM public.payout_lines l WHERE l.worker_id = auth.uid() AND l.status = 'paid'
                    AND date_trunc('month', l.paid_at)::date = m.m), 0)
  FROM months m ORDER BY m.m
$$;

REVOKE EXECUTE ON FUNCTION public.payout_registry_export(uuid), public.mark_registry_sent(uuid), public.settle_payout_lines(uuid, uuid[], text, text),
  public.reconcile_bank_statement(uuid, jsonb), public.payout_registry_report(uuid), public.platform_send_allowed(uuid),
  public.worker_payouts(date, date), public.worker_income_certificate(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payout_registry_export(uuid), public.mark_registry_sent(uuid), public.settle_payout_lines(uuid, uuid[], text, text),
  public.reconcile_bank_statement(uuid, jsonb), public.payout_registry_report(uuid), public.platform_send_allowed(uuid),
  public.worker_payouts(date, date), public.worker_income_certificate(date, date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.platform_registry_payload(uuid), public.platform_record_result(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_registry_payload(uuid), public.platform_record_result(uuid, text, text, text, text) TO service_role;
