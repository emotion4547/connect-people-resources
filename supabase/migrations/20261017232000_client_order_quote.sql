-- Стоимость заказа и итог конкретного табеля считает сервер; чужие объекты не участвуют.
CREATE OR REPLACE FUNCTION public.quote_client_order(_site_id uuid, _position_id uuid, _unit text,
  _from date, _to date, _start time, _end time, _headcount integer, _break integer, _weekdays integer[] DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, private
AS $$
DECLARE
  s public.sites;
  t public.tariffs;
  d date;
  begins timestamptz;
  ends timestamptz;
  split record;
  hours numeric;
  quantity numeric;
  total numeric(12,2) := 0;
BEGIN
  SELECT * INTO s FROM public.sites WHERE id = _site_id AND client_id = ANY(private.my_client_ids());
  IF NOT FOUND THEN RAISE EXCEPTION 'Нет доступа к объекту' USING ERRCODE = '42501'; END IF;
  IF s.status <> 'active' OR _from IS NULL OR _to IS NULL OR _to < _from OR _to - _from > 366
    OR _start IS NULL OR _end IS NULL OR _headcount IS NULL OR _headcount < 1 OR _headcount > 10000
    OR _break IS NULL OR _break < 0 OR (_weekdays IS NOT NULL AND NOT _weekdays <@ ARRAY[1,2,3,4,5,6,7]) THEN
    RAISE EXCEPTION 'Проверьте даты, время, количество людей и перерыв' USING ERRCODE = '22023';
  END IF;
  FOR d IN SELECT x::date FROM generate_series(_from::timestamp, _to::timestamp, interval '1 day') x
    WHERE coalesce(cardinality(_weekdays), 0) = 0 OR extract(isodow FROM x)::integer = ANY(_weekdays)
  LOOP
    t := public.get_tariff(s.client_id, s.id, _position_id, _unit, d);
    IF t.id IS NULL THEN RAISE EXCEPTION 'Нет утверждённого тарифа на %', d USING ERRCODE = '22023'; END IF;
    begins := (d + _start) AT TIME ZONE s.timezone;
    ends := (d + CASE WHEN _end <= _start THEN 1 ELSE 0 END + _end) AT TIME ZONE s.timezone;
    hours := extract(epoch FROM (ends - begins)) / 3600 - _break::numeric / 60;
    IF hours <= 0 THEN RAISE EXCEPTION 'Перерыв должен быть короче смены' USING ERRCODE = '22023'; END IF;
    IF t.unit = 'hour' THEN
      SELECT * INTO split FROM private.split_minutes(begins, ends, s.timezone, s.org_id);
      quantity := greatest(hours * (1 + (t.night_coef - 1) * split.night::numeric / nullif(split.total, 0)
        + (t.holiday_coef - 1) * split.holiday::numeric / nullif(split.total, 0)), t.min_paid_hours);
    ELSE
      quantity := 1;
    END IF;
    total := total + round(quantity * t.client_rate, 2) * _headcount;
  END LOOP;
  RETURN total;
END;
$$;
REVOKE ALL ON FUNCTION public.quote_client_order(uuid, uuid, text, date, date, time, time, integer, integer, integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quote_client_order(uuid, uuid, text, date, date, time, time, integer, integer, integer[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.client_timesheet_summary(_timesheet_id uuid)
RETURNS TABLE (hours numeric, amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.timesheet_client_access(_timesheet_id) THEN
    RAISE EXCEPTION 'Нет доступа к табелю' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT
    (SELECT coalesce(sum(a.approved_hours), 0) FROM public.assignments a WHERE a.timesheet_id = _timesheet_id),
    (SELECT coalesce(sum(x.amount_client), 0) FROM public.accruals x
      JOIN public.assignments a ON a.id = x.assignment_id
      WHERE a.timesheet_id = _timesheet_id AND x.visible_to_client AND x.status <> 'draft');
END;
$$;
REVOKE ALL ON FUNCTION public.client_timesheet_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_timesheet_summary(uuid) TO authenticated;
