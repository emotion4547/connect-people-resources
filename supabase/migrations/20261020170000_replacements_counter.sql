-- Дашборд ведения объектов: счётчик замен (ТЗ, раздел 17).
CREATE OR REPLACE FUNCTION public.analytics_counters(_org_ids uuid[], _from date, _to date)
RETURNS TABLE (key text, name text, unit text, value numeric, link text, grp text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  uid uuid := auth.uid();
  ops uuid[] := private.analytics_orgs(_org_ids, 'ops');
  fin uuid[] := private.analytics_orgs(_org_ids, 'fin');
  hire uuid[] := private.analytics_orgs(_org_ids, 'hire');
  paying uuid[]; cash uuid[];
BEGIN
  IF uid IS NULL OR cardinality(ops) + cardinality(fin) + cardinality(hire) = 0 THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(array_agg(o), ARRAY[]::uuid[]) INTO paying FROM unnest(fin) o WHERE private.permission_scope(uid, o, 'payout_registries', 'view') = 'all';
  SELECT coalesce(array_agg(o), ARRAY[]::uuid[]) INTO cash FROM unnest(fin) o WHERE private.permission_scope(uid, o, 'cashflow', 'view') = 'all';

  IF cardinality(ops) > 0 THEN
    RETURN QUERY SELECT 'timesheets_pending', 'Табели на подтверждении', 'шт.', count(*)::numeric, '/timesheets', 'ops'
      FROM public.timesheets t WHERE t.org_id = ANY (ops) AND t.status = 'pending' AND private.analytics_client_ok(t.org_id, t.client_id, uid);
    RETURN QUERY SELECT 'timesheets_disputed', 'Споры по табелям', 'шт.', count(*)::numeric, '/timesheets', 'ops'
      FROM public.timesheet_disputes x JOIN public.timesheets t ON t.id = x.timesheet_id
      WHERE x.org_id = ANY (ops) AND x.status = 'open' AND private.analytics_client_ok(t.org_id, t.client_id, uid);
    RETURN QUERY SELECT 'unconfirmed_tomorrow', 'Не подтвердили выход на завтра', 'чел.', count(*)::numeric, '/planning', 'ops'
      FROM public.assignments a JOIN public.shifts s ON s.id = a.shift_id AND s.status <> 'cancelled'
      WHERE a.org_id = ANY (ops) AND a.status = 'assigned' AND NOT a.is_reserve AND s.shift_date = current_date + 1 AND private.analytics_client_ok(s.org_id, s.client_id, uid);
    -- Замены: исполнитель выбыл (неявка, отмена, снят заказчиком), и на ту же смену позже назначен другой
    RETURN QUERY SELECT 'replacements', 'Замены на сменах', 'шт.', count(*)::numeric, NULL::text, 'ops'
      FROM public.assignments a JOIN public.shifts s ON s.id = a.shift_id
      WHERE a.org_id = ANY (ops) AND a.status IN ('no_show', 'cancelled_worker', 'cancelled_manager', 'removed_by_client') AND NOT a.is_reserve AND s.shift_date BETWEEN _from AND _to
        AND private.analytics_client_ok(s.org_id, s.client_id, uid)
        AND EXISTS (SELECT 1 FROM public.assignments b WHERE b.shift_id = a.shift_id AND b.id <> a.id AND NOT b.is_reserve AND b.created_at > a.updated_at
                      AND b.status IN ('assigned', 'confirmed', 'on_site', 'worked'));
    RETURN QUERY SELECT 'rating_avg', 'Средняя оценка заказчиков', '★', round(avg(a.client_rating)::numeric, 2), NULL::text, 'ops'
      FROM public.assignments a JOIN public.shifts s ON s.id = a.shift_id
      WHERE a.org_id = ANY (ops) AND a.client_rating IS NOT NULL AND s.shift_date BETWEEN _from AND _to AND private.analytics_client_ok(s.org_id, s.client_id, uid);
    RETURN QUERY SELECT 'idle_clients_30', 'Заказчики без заказов 30 дней', 'шт.', count(*)::numeric, '/clients', 'ops'
      FROM public.clients c
      WHERE c.org_id = ANY (ops) AND c.status = 'active' AND private.analytics_client_ok(c.org_id, c.id, uid)
        AND EXISTS (SELECT 1 FROM public.shifts s WHERE s.client_id = c.id AND s.status <> 'cancelled')
        AND NOT EXISTS (SELECT 1 FROM public.shifts s WHERE s.client_id = c.id AND s.status <> 'cancelled' AND s.shift_date > current_date - 30);
  END IF;

  IF cardinality(fin) > 0 THEN
    RETURN QUERY SELECT 'unbilled_accruals', 'Невыставленные начисления', '₽', coalesce(sum(a.amount_client), 0), '/documents', 'fin'
      FROM public.accruals a WHERE a.org_id = ANY (fin) AND a.status <> 'draft' AND a.client_document_id IS NULL AND private.analytics_client_ok(a.org_id, a.client_id, uid);
  END IF;

  IF cardinality(paying) > 0 THEN
    RETURN QUERY SELECT 'to_pay', 'К выплате исполнителям', '₽', coalesce(sum(a.amount_worker), 0), '/payout-registries', 'fin'
      FROM public.accruals a WHERE a.org_id = ANY (paying) AND a.status IN ('approved', 'in_act') AND a.payout_line_id IS NULL AND a.amount_worker > 0;
    RETURN QUERY SELECT 'paid_out', 'Выплачено за период', '₽', coalesce(sum(l.amount_to_pay), 0), '/payout-registries', 'fin'
      FROM public.payout_lines l JOIN public.payout_registries r ON r.id = l.registry_id
      WHERE r.org_id = ANY (paying) AND l.status = 'paid' AND l.paid_at::date BETWEEN _from AND _to;
    RETURN QUERY SELECT 'registry_errors', 'Ошибки выплат', 'шт.', count(*)::numeric, '/payout-registries', 'fin'
      FROM public.payout_lines l JOIN public.payout_registries r ON r.id = l.registry_id WHERE r.org_id = ANY (paying) AND l.status = 'error';
  END IF;

  IF cardinality(cash) > 0 THEN
    RETURN QUERY SELECT 'unsorted_cash', 'Неразнесённые операции ДДС', 'шт.', count(*)::numeric, '/cash?category=none', 'fin'
      FROM public.cashflow_entries e
      WHERE e.org_id = ANY (cash) AND e.category_id IS NULL;
    RETURN QUERY SELECT 'unallocated_payments', 'Платежи заказчиков без разнесения', '₽', coalesce(sum(p.amount - p.allocated_amount), 0), '/payments', 'fin'
      FROM public.client_payments p WHERE p.org_id = ANY (cash) AND p.amount > p.allocated_amount;
  END IF;

  IF cardinality(hire) > 0 THEN
    RETURN QUERY SELECT 'docs_expiring_30', 'Документы истекают за 30 дней', 'шт.', count(*)::numeric, '/workers', 'hire'
      FROM public.worker_documents wd JOIN public.workers w ON w.user_id = wd.worker_id AND w.org_id = wd.org_id
      WHERE wd.org_id = ANY (hire) AND wd.status = 'verified' AND wd.valid_until BETWEEN current_date AND current_date + 30 AND w.status <> 'not_working';
    RETURN QUERY SELECT 'no_shift_14', 'Допущены, но без смен 14 дней', 'чел.', count(*)::numeric, '/hiring/today', 'hire'
      FROM public.workers w
      WHERE w.org_id = ANY (hire) AND w.status = 'active' AND coalesce(w.admitted_at, w.created_at) < now() - interval '14 days'
        AND NOT EXISTS (SELECT 1 FROM public.assignments a WHERE a.worker_id = w.user_id AND a.status IN ('assigned', 'confirmed', 'on_site', 'worked'));
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.analytics_counters(uuid[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_counters(uuid[], date, date) TO authenticated, service_role;
