-- Доработки после приёмки этапа 3: управление счетами денег из интерфейса и передача заказчика менеджерам объектов при выигрыше сделки.

INSERT INTO public.notification_events (code, title, channels, delivery, critical, audience) VALUES
  ('client_handoff', 'Новый заказчик передан в ведение объектов', ARRAY['max'], 'all', false, 'менеджер объекта');

-- Счета денег: создание и правка (остаток на начало, дата остатка, реквизиты). Счёт с операциями не удаляется, а выключается.
CREATE OR REPLACE FUNCTION public.save_cash_account(_org_id uuid, _id uuid, _kind text, _name text, _bank_name text, _account_number text,
                                                    _opening_balance numeric, _opening_date date, _is_active boolean DEFAULT true)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  rid uuid := _id;
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'cashflow', CASE WHEN _id IS NULL THEN 'create' ELSE 'update' END) <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF _kind NOT IN ('bank', 'cash', 'platform') THEN RAISE EXCEPTION 'Вид счёта: расчётный, касса или платформа выплат' USING ERRCODE = '22023'; END IF;
  IF length(btrim(coalesce(_name, ''))) = 0 THEN RAISE EXCEPTION 'Укажите название счёта' USING ERRCODE = '22023'; END IF;
  IF _opening_date IS NULL THEN RAISE EXCEPTION 'Укажите дату, на которую задан остаток' USING ERRCODE = '22023'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.cash_accounts (org_id, kind, name, bank_name, account_number, opening_balance, opening_date, sort_order, is_active)
    VALUES (_org_id, _kind, btrim(_name), nullif(btrim(_bank_name), ''), nullif(btrim(_account_number), ''), coalesce(_opening_balance, 0), _opening_date,
            coalesce((SELECT max(sort_order) FROM public.cash_accounts WHERE org_id = _org_id), 0) + 10, coalesce(_is_active, true))
    RETURNING id INTO rid;
  ELSE
    UPDATE public.cash_accounts SET name = btrim(_name), bank_name = nullif(btrim(_bank_name), ''), account_number = nullif(btrim(_account_number), ''),
           opening_balance = coalesce(_opening_balance, 0), opening_date = _opening_date, is_active = coalesce(_is_active, true)
     WHERE id = _id AND org_id = _org_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Счёт не найден' USING ERRCODE = '22023'; END IF;
  END IF;
  RETURN rid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_cash_account(uuid, uuid, text, text, text, text, numeric, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_cash_account(uuid, uuid, text, text, text, text, numeric, date, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.win_deal(_deal_id uuid, _quote_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  d public.deals;
  q public.deal_quotes;
  cid uuid;
  n integer := 0;
  l jsonb;
  r record;
BEGIN
  SELECT * INTO d FROM public.deals WHERE id = _deal_id FOR UPDATE;
  IF NOT FOUND OR NOT private.deal_can(_deal_id, 'update') THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  IF d.stage IN ('won', 'lost') THEN RAISE EXCEPTION 'Сделка уже закрыта' USING ERRCODE = '22023'; END IF;
  IF _quote_id IS NOT NULL THEN
    SELECT * INTO q FROM public.deal_quotes WHERE id = _quote_id AND deal_id = _deal_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'КП не найдено в этой сделке' USING ERRCODE = '22023'; END IF;
  ELSE
    SELECT * INTO q FROM public.deal_quotes WHERE deal_id = _deal_id ORDER BY version DESC LIMIT 1;
  END IF;

  cid := d.client_id;
  IF cid IS NULL THEN
    INSERT INTO public.clients (org_id, name, status, sales_manager_id)
    VALUES (d.org_id, coalesce(nullif(btrim(d.company), ''), d.title), 'contract', d.owner_id) RETURNING id INTO cid;
    IF d.contact_name IS NOT NULL THEN
      INSERT INTO public.client_contacts (org_id, client_id, full_name, phone, email) VALUES (d.org_id, cid, d.contact_name, d.contact_phone, d.contact_email);
    END IF;
  ELSE
    UPDATE public.clients SET status = 'contract', sales_manager_id = coalesce(sales_manager_id, d.owner_id) WHERE id = cid AND status IN ('lead', 'negotiation');
  END IF;

  IF q.id IS NOT NULL THEN
    FOR l IN SELECT * FROM jsonb_array_elements(q.lines) LOOP
      INSERT INTO public.tariffs (org_id, client_id, position_id, unit, client_rate, worker_rate, valid_from, status, note, created_by)
      VALUES (d.org_id, cid, (l ->> 'position_id')::uuid, coalesce(l ->> 'unit', 'hour'), (l ->> 'client_rate')::numeric, (l ->> 'worker_rate')::numeric,
              current_date, 'draft', 'Из КП, сделка «' || d.title || '», версия ' || q.version, auth.uid());
      n := n + 1;
    END LOOP;
  END IF;

  UPDATE public.deals SET stage = 'won', client_id = cid, won_at = now(), closed_at = now(), lost_reason = NULL, next_step = NULL, next_step_date = NULL WHERE id = _deal_id;
  -- Передача в ведение объектов (П-11): менеджеры объектов узнают о новом заказчике и готовят объекты
  FOR r IN SELECT ur.user_id FROM public.user_roles ur WHERE ur.org_id = d.org_id AND ur.role = 'site_manager' AND private.is_user_active(ur.user_id) LOOP
    PERFORM private.notify(d.org_id, r.user_id, 'client_handoff', 'Новый заказчик к запуску: ' || coalesce(nullif(btrim(d.company), ''), d.title),
                           'Договор подписан, тарифов-черновиков: ' || n || '. Подготовьте объекты и запуск', '/clients/' || cid, 'handoff:' || _deal_id);
  END LOOP;
  RETURN n;
END;
$$;
