-- Переводит тестового исполнителя test-worker@… в демо-организацию и даёт ему смены: прошлые отработаны (с начислениями), ближайшие назначены.
-- Запускается после demo-org.sql. Повторный запуск ничего не делает.
begin;
do $d$
declare
  org uuid; wid uuid; pos uuid; s record; aid uuid; n integer := 0;
begin
  select id into org from public.organizations where name = 'ТЕСТ Демо-организация';
  select id into wid from auth.users where email = 'test-worker@test.rabota-vsem-56.ru';
  if org is null or wid is null then raise exception 'Нет демо-организации или тестового исполнителя'; end if;
  if exists (select 1 from public.assignments where worker_id = wid) then raise notice 'уже есть смены'; return; end if;
  delete from public.worker_positions where worker_id = wid;
  update public.workers set org_id = org, status = 'active', tax_status = 'self_employed' where user_id = wid;
  update public.user_roles set org_id = org where user_id = wid and role = 'worker';
  insert into public.worker_positions (org_id, worker_id, position_id) select org, wid, id from public.positions where org_id = org and name in ('Грузчик', 'Упаковщик');
  set local app.timesheet_internal = 'on';
  -- Прошлые смены на складе «Север» (грузчики): отработаны
  for s in select sh.* from public.shifts sh join public.orders o on o.id = sh.order_id
           where sh.org_id = org and o.position_id = (select id from public.positions where org_id = org and name = 'Грузчик') and sh.site_id = (select id from public.sites where org_id = org and name = 'ТЕСТ Склад Север')
             and sh.shift_date < current_date order by sh.shift_date desc limit 8 loop
    insert into public.assignments (org_id, shift_id, worker_id, status, source, shift_start, shift_end, check_in_at, check_out_at, planned_hours, actual_hours, approved_hours)
    values (org, s.id, wid, 'worked', 'assigned', s.start_at, s.end_at, s.start_at + interval '4 minutes', s.end_at, 8, 8, 8) returning id into aid;
    perform private.create_accrual_for_assignment(aid);
    n := n + 1;
  end loop;
  -- Ближайшие смены: назначен и подтверждён
  for s in select sh.* from public.shifts sh join public.orders o on o.id = sh.order_id
           where sh.org_id = org and o.position_id = (select id from public.positions where org_id = org and name = 'Грузчик') and sh.site_id = (select id from public.sites where org_id = org and name = 'ТЕСТ Склад Север')
             and sh.shift_date >= current_date order by sh.shift_date limit 3 loop
    insert into public.assignments (org_id, shift_id, worker_id, status, source, shift_start, shift_end, planned_hours)
    values (org, s.id, wid, case when n % 2 = 0 then 'confirmed' else 'assigned' end, 'assigned', s.start_at, s.end_at, 8);
    n := n + 1;
  end loop;
  raise notice 'Смен тестовому исполнителю: %', n;
end $d$;
commit;
