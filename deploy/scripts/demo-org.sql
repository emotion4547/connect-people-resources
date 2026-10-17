-- Демонстрационная организация «ТЕСТ Демо-организация»: 4 недели работы, чтобы дашборды, БДР, ДДС, документы, сделки и вахта было что показывать.
-- Всё лежит в ОТДЕЛЬНОЙ организации и не смешивается с рабочими данными; тестовые сотрудники получают в ней роли и переключаются на неё
-- переключателем организации в меню. Чтобы убрать демо, достаточно выключить организацию («Организации» → снять «Активна»).
--
-- Требует тестовых учётных записей test-*@test.rabota-vsem-56.ru. Запуск (на сервере):
--   docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < demo-org.sql
-- Повторный запуск ничего не делает.
begin;

do $demo$
declare
  org uuid;
  dir uuid; sal uuid; sit uuid; rec uuid; acc uuid; cli uuid;
  cl1 uuid; cl2 uuid;
  site1 uuid; site2 uuid; site3 uuid; site4 uuid;
  pos record;
  o record; s record; arec record;
  i integer;
  w_ids uuid[] := '{}';
  wid uuid;
  base date := current_date + 40;
  delta integer := 64;
  pools integer[][] := array[[1,4],[5,7],[8,10],[11,12],[13,14]];
  hc integer[] := array[4,3,3,2,2];
  order_ids uuid[] := '{}';
  oid uuid;
  src_site uuid;
  a1 uuid; d1 uuid; d2 uuid;
  bank uuid; cat_rent uuid; cat_salary uuid; cat_ads uuid;
  tariff_pos text[] := array['Грузчик','Упаковщик','Сортировщик','Грузчик','Комплектовщик'];
  pos_rates numeric[][] := array[[450,300],[420,280],[400,270],[450,300],[430,290]];
  site_of integer[] := array[1,1,2,3,4];
  pos_id uuid;
  ts uuid;
begin
  if exists (select 1 from public.organizations where name = 'ТЕСТ Демо-организация') then
    raise notice 'Демо-организация уже есть, ничего не делаю';
    return;
  end if;
  select id into dir from auth.users where email = 'test-director@test.rabota-vsem-56.ru';
  select id into sal from auth.users where email = 'test-sales@test.rabota-vsem-56.ru';
  select id into sit from auth.users where email = 'test-sites@test.rabota-vsem-56.ru';
  select id into rec from auth.users where email = 'test-recruiter@test.rabota-vsem-56.ru';
  select id into acc from auth.users where email = 'test-accountant@test.rabota-vsem-56.ru';
  select id into cli from auth.users where email = 'test-client@test.rabota-vsem-56.ru';
  if dir is null or sal is null or sit is null or rec is null or acc is null or cli is null then raise exception 'Нет тестовых учётных записей'; end if;

  insert into public.organizations (name, legal_form, inn, kpp, address, bank_name, bank_account, bik, tax_regime, vat_rate, signer_name, signer_position)
  values ('ТЕСТ Демо-организация', 'ООО', '5600000000', '560001001', 'г. Оренбург, ул. Демонстрационная, 1', 'Т-Банк', '40702810000000000099', '044525974', 'usn6', 0, 'Тестов Тест Тестович', 'Директор')
  returning id into org;

  -- Роли тестовых сотрудников в демо-организации
  insert into public.user_roles (user_id, role, org_id) values
    (dir, 'director', org), (sal, 'sales', org), (sit, 'site_manager', org), (rec, 'recruiter', org), (acc, 'accountant', org), (cli, 'client_admin', org);

  -- Исполнители (без триггеров регистрации, сразу в демо-организации)
  set local session_replication_role = replica;
  for i in 1..17 loop
    wid := gen_random_uuid();
    w_ids := w_ids || wid;
    insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
    values ('00000000-0000-0000-0000-000000000000', wid, 'authenticated', 'authenticated', 'demo-worker-' || i || '@test.rabota-vsem-56.ru', jsonb_build_object('full_name', 'ТЕСТ Исполнитель ' || i), now(), now(), now());
    insert into public.profiles (user_id, email, full_name) values (wid, 'demo-worker-' || i || '@test.rabota-vsem-56.ru', 'ТЕСТ Исполнитель ' || i);
    insert into public.user_roles (user_id, role, org_id) values (wid, 'worker', org);
    insert into public.workers (user_id, org_id, full_name, phone, city, status, tax_status, admitted_at, citizenship)
    values (wid, org, 'ТЕСТ Исполнитель ' || i, '+7 900 100-00-' || lpad(i::text, 2, '0'), 'Оренбург', 'active', case when i % 3 = 0 then 'self_employed' else 'ip' end, now() - ((20 + i * 3) || ' days')::interval, 'РФ');
  end loop;
  set local session_replication_role = origin;

  -- Заказчики, объекты, договоры, тарифы
  insert into public.clients (org_id, name, status, sales_manager_id, sites_manager_id, city, inn) values (org, 'ТЕСТ Логистик', 'active', sal, sit, 'Оренбург', '5612345001') returning id into cl1;
  insert into public.clients (org_id, name, status, sales_manager_id, sites_manager_id, city, inn) values (org, 'ТЕСТ Фабрика', 'active', sal, sit, 'Оренбург', '5612345002') returning id into cl2;
  insert into public.client_contacts (org_id, client_id, full_name, user_id, cabinet_role, email) values (org, cl1, 'ТЕСТ Представитель заказчика', cli, 'client_admin', 'test-client@test.rabota-vsem-56.ru');
  insert into public.contracts (org_id, client_id, number, signed_on, billing_period, payment_delay_days, status) values (org, cl1, 'ДЕМО-1', current_date - 90, 'week', 10, 'active'), (org, cl2, 'ДЕМО-2', current_date - 90, 'week', 14, 'active');
  insert into public.sites (org_id, client_id, name, address, city, site_manager_id, status, latitude, longitude, checkin_method) values (org, cl1, 'ТЕСТ Склад Север', 'ул. Складская, 1', 'Оренбург', sit, 'active', 51.7682, 55.0970, 'manual') returning id into site1;
  insert into public.sites (org_id, client_id, name, address, city, site_manager_id, status, latitude, longitude, checkin_method) values (org, cl1, 'ТЕСТ Склад Юг', 'ул. Южная, 5', 'Оренбург', sit, 'active', 51.7000, 55.1000, 'manual') returning id into site2;
  insert into public.sites (org_id, client_id, name, address, city, site_manager_id, status, latitude, longitude, checkin_method) values (org, cl2, 'ТЕСТ Цех 1', 'ул. Заводская, 10', 'Оренбург', sit, 'active', 51.7500, 55.0500, 'manual') returning id into site3;
  insert into public.sites (org_id, client_id, name, address, city, site_manager_id, status, latitude, longitude, checkin_method) values (org, cl2, 'ТЕСТ Вахтовый посёлок', 'п. Северный', 'Оренбург', sit, 'active', 51.9000, 55.3000, 'manual') returning id into site4;
  insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status, note)
    select org, c.cid, p.id, r.cr, r.wr, current_date - 90, 'approved', 'Демо-тариф'
    from (values (cl1), (cl2)) c(cid), public.positions p
    join (values ('Грузчик', 450, 300), ('Упаковщик', 420, 280), ('Сортировщик', 400, 270), ('Комплектовщик', 430, 290), ('Разнорабочий', 380, 250)) r(name, cr, wr) on r.name = p.name
    where p.org_id = org;
  insert into public.worker_positions (org_id, worker_id, position_id)
    select org, w, p.id from unnest(w_ids) w, public.positions p where p.org_id = org;

  -- Заказы на 4 недели (будни), у каждого свой пул исполнителей: пересечений нет
  for i in 1..5 loop
    select id into pos_id from public.positions where org_id = org and name = tariff_pos[i];
    insert into public.orders (org_id, client_id, site_id, position_id, date_from, date_to, weekdays, start_time, end_time, break_minutes, headcount, status)
    values (org, case when site_of[i] in (1,2) then cl1 else cl2 end, (array[site1, site2, site3, site4])[site_of[i]], pos_id, base, base + 27, array[1,2,3,4,5]::smallint[], '08:00', '17:00', 60, hc[i], 'new')
    returning id into oid;
    perform private.generate_shifts(oid);
    update public.orders set status = 'accepted', accepted_at = now() - interval '5 hours' where id = oid;
    order_ids := order_ids || oid;
    for s in select id from public.shifts where order_id = oid order by shift_date loop
      for wid in select w_ids[k] from generate_series(pools[i][1], pools[i][2]) k loop
        perform private.do_assign(s.id, wid, true, 'assigned');
      end loop;
    end loop;
  end loop;

  -- Сдвигаем всё назад: окно -24…+3 дня от сегодня
  set local app.timesheet_internal = 'on';
  update public.orders set date_from = date_from - delta, date_to = date_to - delta, starts_at = starts_at - delta * interval '1 day' where org_id = org;
  update public.shifts set shift_date = shift_date - delta, start_at = start_at - delta * interval '1 day', end_at = end_at - delta * interval '1 day' where org_id = org;
  update public.assignments set shift_start = shift_start - delta * interval '1 day', shift_end = shift_end - delta * interval '1 day' where org_id = org;
  update public.shifts set status = 'completed' where org_id = org and shift_date < current_date;

  -- Итоги смен: прошедшие отработаны (6% неявок), будущие подтверждены
  update public.assignments a set status = case when abs(hashtext(a.id::text)) % 17 = 0 then 'no_show' else 'worked' end,
         check_in_at = a.shift_start + (abs(hashtext(a.id::text)) % 10) * interval '1 minute', check_out_at = a.shift_end,
         planned_hours = 8, actual_hours = 8, approved_hours = 8
   where a.org_id = org and a.shift_start < now() - interval '1 day';
  update public.assignments set check_in_at = null, check_out_at = null, approved_hours = null, planned_hours = null where org_id = org and status = 'no_show';
  update public.assignments a set status = case when abs(hashtext(a.id::text)) % 5 = 0 then 'assigned' else 'confirmed' end
   where a.org_id = org and a.shift_start >= now() - interval '1 day';
  for arec in select id from public.assignments where org_id = org and status = 'worked' loop
    perform private.create_accrual_for_assignment(arec.id);
  end loop;

  -- Табели: старый подтверждён заказчиком, свежий ждёт подтверждения, последний — черновик
  perform set_config('request.jwt.claim.sub', sit::text, true);
  ts := public.build_timesheet(site1, current_date - 24, current_date - 11);
  perform public.send_timesheet(ts);
  perform set_config('request.jwt.claim.sub', cli::text, true);
  perform public.confirm_timesheet(ts);
  perform set_config('request.jwt.claim.sub', sit::text, true);
  ts := public.build_timesheet(site1, current_date - 10, current_date - 4);
  perform public.send_timesheet(ts);
  ts := public.build_timesheet(site2, current_date - 10, current_date - 4);
  perform public.send_timesheet(ts);
  perform public.build_timesheet(site3, current_date - 10, current_date - 4);

  -- Деньги: остаток, акты и счета за две недели, оплата первой
  perform set_config('request.jwt.claim.sub', acc::text, true);
  update public.cash_accounts set opening_balance = 180000, opening_date = current_date - 40 where org_id = org and kind = 'bank';
  select id into bank from public.cash_accounts where org_id = org and kind = 'bank' limit 1;
  select id into cat_rent from public.cashflow_categories where org_id = org and code = 'rent';
  select id into cat_salary from public.cashflow_categories where org_id = org and code = 'office_salary';
  select id into cat_ads from public.cashflow_categories where org_id = org and code = 'advertising';
  perform public.add_cashflow_entry(org, bank, current_date - 12, 'out', 35000, cat_rent, 'ИП Арендодатель', 'Аренда офиса');
  perform public.add_cashflow_entry(org, bank, current_date - 9, 'out', 120000, cat_salary, null, 'Зарплата штата');
  perform public.add_cashflow_entry(org, bank, current_date - 5, 'out', 12000, cat_ads, 'Реклама', 'Рекламный бюджет');
  for o in select cid from (values (cl1), (cl2)) x(cid) loop
    d1 := public.generate_client_documents(o.cid, current_date - 30, current_date - 17);
    if d1 is not null then perform public.issue_client_documents(d1); end if;
    d2 := public.generate_client_documents(o.cid, current_date - 16, current_date - 9);
    if d2 is not null then perform public.issue_client_documents(d2); end if;
  end loop;
  -- Часть счетов просрочена: срок оплаты — через неделю после конца периода
  update public.client_documents set due_date = period_to + 7 where org_id = org and kind = 'invoice' and status in ('issued', 'paid_partial');
  perform public.add_client_payment(org, cl1, current_date - 6, (select coalesce(sum(amount_total), 0) from public.client_documents where client_id = cl1 and kind = 'invoice' and period_to = current_date - 17), 'П-101', 'Оплата по счёту');
  perform public.save_bdr_plan(org, date_trunc('month', current_date)::date, 'revenue', 600000);
  perform public.save_bdr_plan(org, date_trunc('month', current_date)::date, 'worker_costs', 380000);
  perform public.save_bdr_plan(org, date_trunc('month', current_date)::date, 'worker_taxes', 40000);
  perform public.save_bdr_plan(org, date_trunc('month', current_date)::date, 'admin_costs', 90000);

  -- Продажи: сделки на разных этапах, КП, план менеджера
  perform set_config('request.jwt.claim.sub', sal::text, true);
  insert into public.deals (org_id, title, company, contact_name, contact_phone, owner_id, stage, expected_revenue, expected_margin, next_step, next_step_date, source) values
    (org, 'Грузчики на оптовую базу', 'ТЕСТ Опт-Сервис', 'Анна', '+7 900 200-00-01', sal, 'new', 250000, 50000, 'Позвонить', current_date, 'site_form'),
    (org, 'Фасовка продуктов', 'ТЕСТ Продукты+', 'Игорь', '+7 900 200-00-02', sal, 'qualification', 180000, 40000, 'Уточнить объёмы', current_date + 1, 'manual'),
    (org, 'Сортировка посылок', 'ТЕСТ Почта Плюс', 'Марина', '+7 900 200-00-03', sal, 'proposal', 420000, 90000, 'Дожать по КП', current_date - 1, 'manual'),
    (org, 'Сезонный набор на склад', 'ТЕСТ Маркет', 'Олег', '+7 900 200-00-04', sal, 'negotiation', 500000, 110000, 'Согласовать договор', current_date + 2, 'self_registration'),
    (org, 'Разгрузка фур', 'ТЕСТ Транзит', 'Павел', '+7 900 200-00-05', sal, 'contract', 300000, 70000, 'Подписать', current_date + 3, 'manual');
  perform public.create_deal_quote((select id from public.deals where org_id = org and title = 'Сортировка посылок'),
    jsonb_build_array(jsonb_build_object('position_id', (select id from public.positions where org_id = org and name = 'Сортировщик'), 'unit', 'hour', 'client_rate', 410, 'worker_rate', 275, 'headcount', 8, 'hours_per_month', 1300)), current_date + 14, 'Демо-КП');
  insert into public.deals (org_id, title, company, owner_id, stage, expected_revenue, lost_reason, closed_at, source) values (org, 'Мелкий заказ на выходные', 'ТЕСТ Мини', sal, 'lost', 40000, 'Дорого', now() - interval '3 days', 'manual');
  perform public.add_deal_touch((select id from public.deals where org_id = org and title = 'Грузчики на оптовую базу'), 'call', 'Первичный звонок', now(), null, false);
  perform set_config('request.jwt.claim.sub', dir::text, true);
  perform public.save_sales_plan(org, sal, date_trunc('month', current_date)::date, 400000);

  -- Найм: кандидаты на разных этапах
  insert into public.candidates (org_id, full_name, phone, city, stage, recruiter_id, source_id, created_at)
    select org, 'ТЕСТ Кандидат ' || g, '+7 900 300-00-' || lpad(g::text, 2, '0'), 'Оренбург',
           (array['new','contacted','interview','documents','admitted','reserve','rejected'])[1 + g % 7], rec,
           (select id from public.directories where org_id = org and kind = 'candidate_source' order by sort_order offset (g % 4) limit 1), now() - (g || ' days')::interval
    from generate_series(1, 14) g
    where (array['new','contacted','interview','documents','admitted','reserve','rejected'])[1 + g % 7] <> 'rejected';

  -- Документы: на складах нужна медкнижка; у части исполнителей срок вот-вот истечёт (смены под угрозой)
  insert into public.site_required_documents (org_id, site_id, document_type_id)
    select org, site1, id from public.directories where org_id = org and kind = 'document_type' and name = 'Медицинская книжка';
  insert into public.worker_documents (org_id, worker_id, document_type_id, status, valid_until, number_masked)
    select org, w_ids[gi], d.id, 'verified', case when gi = 2 then current_date - 2 when gi in (3, 5) then current_date + 2 when gi in (6, 7) then current_date + 12 else current_date + 200 end, '**' || lpad(gi::text, 4, '0')
    from generate_series(1, 14) gi, public.directories d where d.org_id = org and d.kind = 'document_type' and d.name = 'Медицинская книжка';

  -- Вахта: заказ в вахтовом посёлке на следующую неделю
  perform set_config('request.jwt.claim.sub', sit::text, true);
  select id into pos_id from public.positions where org_id = org and name = 'Разнорабочий';
  insert into public.orders (org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, break_minutes, headcount, status)
    values (org, cl2, site4, pos_id, current_date + 5, current_date + 11, '08:00', '20:00', 60, 3, 'new') returning id into oid;
  perform private.generate_shifts(oid);
  update public.orders set status = 'accepted', accepted_at = now() where id = oid;
  perform public.set_order_rotation(oid, current_date + 4, current_date + 12, 'Общежитие №3, п. Северный', 2, 300, true, 200, 700, 300, 1500, 500, 'Демо-вахта');
  for s in select id from public.shifts where order_id = oid loop
    perform private.do_assign(s.id, w_ids[15], true, 'assigned');
    perform private.do_assign(s.id, w_ids[16], true, 'assigned');
    perform private.do_assign(s.id, w_ids[17], true, 'assigned');
  end loop;

  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'Демо-организация создана: %', org;
end
$demo$;

commit;
