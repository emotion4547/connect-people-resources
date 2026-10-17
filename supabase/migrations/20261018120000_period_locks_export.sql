-- Этап 2, шаг 16: закрытие месяца и выгрузка в 1С.
-- ТЗ: раздел 14 (Б-10, Б-11), раздел 5 (сущность «Закрытие периода»).
--
-- Бухгалтер закрывает месяц, когда все табели подтверждены, споры решены и акты выставлены; система показывает, что мешает.
-- Закрытый месяц только читается: табель, часы и начисления в нём не меняются, поправки идут корректировкой в текущем периоде.
-- Открыть месяц может только руководитель, с причиной, запись остаётся в журнале.

-- ============================================================
-- 1. Закрытие периода
-- ============================================================
CREATE TABLE public.period_locks (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Первое число месяца.
  month date NOT NULL CHECK (month = date_trunc('month', month)::date),
  is_closed boolean NOT NULL DEFAULT true,
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at timestamptz,
  reopened_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reopened_at timestamptz,
  reopen_reason text,
  PRIMARY KEY (org_id, month)
);

CREATE TRIGGER audit_period_locks
  AFTER INSERT OR UPDATE ON public.period_locks
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('month', 'is_closed', 'reopen_reason');

CREATE OR REPLACE FUNCTION private.month_locked(_org_id uuid, _date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (SELECT 1 FROM public.period_locks l WHERE l.org_id = _org_id AND l.month = date_trunc('month', _date)::date AND l.is_closed)
$$;

-- Что мешает закрыть месяц: «block» — не даст закрыть, «warn» — предупреждение.
CREATE OR REPLACE FUNCTION public.month_close_blockers(_org_id uuid, _month date)
RETURNS TABLE (severity text, code text, title text, cnt integer, link text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  m1 date := date_trunc('month', _month)::date;
  m2 date := (date_trunc('month', _month) + interval '1 month - 1 day')::date;
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'client_documents', 'view') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT x.severity, x.code, x.title, x.cnt, x.link FROM (VALUES
    ('block', 'open_shifts', 'Смены без итога: назначены или на месте, но не отработаны', (
       SELECT count(*)::integer FROM public.assignments a JOIN public.shifts s ON s.id = a.shift_id
       WHERE a.org_id = _org_id AND s.shift_date BETWEEN m1 AND m2 AND a.status IN ('assigned', 'confirmed', 'on_site') AND s.end_at < now()), '/planning'),
    ('block', 'no_timesheet', 'Отработанные смены ещё не вошли в табель', (
       SELECT count(*)::integer FROM public.assignments a JOIN public.shifts s ON s.id = a.shift_id
       WHERE a.org_id = _org_id AND s.shift_date BETWEEN m1 AND m2 AND a.status = 'worked' AND a.timesheet_id IS NULL), '/timesheets'),
    ('block', 'timesheets_open', 'Табели не подтверждены заказчиком', (
       SELECT count(*)::integer FROM public.timesheets t
       WHERE t.org_id = _org_id AND t.period_from <= m2 AND t.period_to >= m1 AND t.status IN ('draft', 'pending')), '/timesheets'),
    ('block', 'disputes', 'Есть нерешённые споры по строкам табеля', (
       SELECT count(*)::integer FROM public.timesheet_disputes d JOIN public.timesheets t ON t.id = d.timesheet_id
       WHERE d.org_id = _org_id AND d.status = 'open' AND t.period_from <= m2 AND t.period_to >= m1), '/timesheets'),
    ('block', 'deductions', 'Удержания ждут согласования руководителя', (
       SELECT count(*)::integer FROM public.accruals x
       WHERE x.org_id = _org_id AND x.shift_date BETWEEN m1 AND m2 AND x.needs_approval AND x.status = 'draft'), '/accruals'),
    ('block', 'not_invoiced', 'Утверждённые начисления не вошли в акт', (
       SELECT count(*)::integer FROM public.accruals x
       WHERE x.org_id = _org_id AND x.shift_date BETWEEN m1 AND m2 AND x.kind <> 'correction' AND x.status <> 'draft'
         AND x.client_document_id IS NULL AND x.amount_client <> 0), '/documents'),
    ('block', 'drafts', 'Остались черновики актов и счетов за месяц', (
       SELECT count(*)::integer FROM public.client_documents d
       WHERE d.org_id = _org_id AND d.status = 'draft' AND d.kind IN ('act', 'upd') AND d.period_to BETWEEN m1 AND m2), '/documents'),
    ('warn', 'payments', 'Есть неразнесённые платежи месяца', (
       SELECT count(*)::integer FROM public.client_payments p
       WHERE p.org_id = _org_id AND p.payment_date BETWEEN m1 AND m2 AND p.allocated_amount < p.amount), '/payments')
  ) AS x(severity, code, title, cnt, link)
  WHERE x.cnt > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_month(_org_id uuid, _month date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  m1 date := date_trunc('month', _month)::date;
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'client_documents', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF m1 >= date_trunc('month', current_date)::date THEN
    RAISE EXCEPTION 'Закрыть можно только завершившийся месяц' USING ERRCODE = '22023';
  END IF;
  IF private.month_locked(_org_id, m1) THEN
    RAISE EXCEPTION 'Месяц уже закрыт' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.month_close_blockers(_org_id, m1) b WHERE b.severity = 'block') THEN
    RAISE EXCEPTION 'Месяц закрыть нельзя: есть незавершённые дела' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.period_locks (org_id, month, is_closed, closed_by, closed_at) VALUES (_org_id, m1, true, auth.uid(), now())
  ON CONFLICT (org_id, month) DO UPDATE SET is_closed = true, closed_by = auth.uid(), closed_at = now();
END;
$$;

-- Открыть закрытый месяц может только руководитель, с причиной.
CREATE OR REPLACE FUNCTION public.reopen_month(_org_id uuid, _month date, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  m1 date := date_trunc('month', _month)::date;
BEGIN
  IF auth.uid() IS NULL OR NOT private.has_org_role(auth.uid(), 'director', _org_id) THEN
    RAISE EXCEPTION 'Открыть закрытый месяц может только руководитель' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Укажите причину открытия месяца' USING ERRCODE = '22023';
  END IF;
  IF NOT private.month_locked(_org_id, m1) THEN
    RAISE EXCEPTION 'Месяц не закрыт' USING ERRCODE = '22023';
  END IF;
  UPDATE public.period_locks SET is_closed = false, reopened_by = auth.uid(), reopened_at = now(), reopen_reason = _reason
   WHERE org_id = _org_id AND month = m1;
END;
$$;

-- ============================================================
-- 2. Закрытый месяц только читается
-- ============================================================
-- Новое начисление в закрытый месяц не создаётся. Корректировка принадлежит месяцу, в котором её оформили (текущему).
CREATE OR REPLACE FUNCTION private.accruals_period_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF private.month_locked(NEW.org_id, CASE WHEN NEW.kind = 'correction' THEN NEW.period_month ELSE NEW.shift_date END) THEN
    RAISE EXCEPTION 'Месяц закрыт: оформите корректировку в текущем периоде' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accruals_period_guard BEFORE INSERT ON public.accruals FOR EACH ROW EXECUTE FUNCTION private.accruals_period_guard();

-- Часы, отметки и состав смены закрытого месяца не меняются.
CREATE OR REPLACE FUNCTION private.assignments_period_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  d date;
BEGIN
  IF (NEW.status, NEW.check_in_at, NEW.check_out_at, NEW.planned_hours, NEW.actual_hours, NEW.approved_hours, NEW.night_hours, NEW.holiday_hours,
      NEW.overtime_hours, NEW.overtime_approved_hours, NEW.shift_id, NEW.worker_id)
     IS NOT DISTINCT FROM
     (OLD.status, OLD.check_in_at, OLD.check_out_at, OLD.planned_hours, OLD.actual_hours, OLD.approved_hours, OLD.night_hours, OLD.holiday_hours,
      OLD.overtime_hours, OLD.overtime_approved_hours, OLD.shift_id, OLD.worker_id) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.period_locks WHERE org_id = NEW.org_id AND is_closed) THEN RETURN NEW; END IF;
  SELECT shift_date INTO d FROM public.shifts WHERE id = OLD.shift_id;
  IF private.month_locked(NEW.org_id, d) THEN
    RAISE EXCEPTION 'Месяц закрыт: часы и отметки этой смены не меняются' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assignments_period_guard BEFORE UPDATE ON public.assignments FOR EACH ROW EXECUTE FUNCTION private.assignments_period_guard();

CREATE OR REPLACE FUNCTION private.timesheets_period_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF private.month_locked(NEW.org_id, NEW.period_from) OR private.month_locked(NEW.org_id, NEW.period_to) THEN
    RAISE EXCEPTION 'Месяц закрыт: табель этого периода только читается' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER timesheets_period_guard BEFORE INSERT OR UPDATE ON public.timesheets FOR EACH ROW EXECUTE FUNCTION private.timesheets_period_guard();

-- ============================================================
-- 3. Выгрузка в 1С
-- ============================================================
-- Формат согласуется с бухгалтерией (ТЗ, Б-11): пока отдаются таблицы для загрузки в 1С через Excel — документы, строки,
-- оплаты и справочник заказчиков. Подбор под EnterpriseData добавляется по готовому шаблону, не меняя эти выборки.
CREATE OR REPLACE FUNCTION private.can_export(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$ SELECT auth.uid() IS NOT NULL AND private.permission_scope(auth.uid(), _org_id, 'client_documents', 'export') = 'all' $$;

CREATE OR REPLACE FUNCTION public.export_1c_documents(_org_id uuid, _from date, _to date)
RETURNS TABLE (doc_kind text, doc_number text, doc_date date, client_inn text, client_kpp text, client_name text, contract_number text,
               period_from date, period_to date, amount_net numeric, vat_rate numeric, vat_amount numeric, amount_total numeric, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NOT private.can_export(_org_id) THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT CASE d.kind WHEN 'invoice' THEN 'Счёт' WHEN 'act' THEN 'Акт' WHEN 'upd' THEN 'УПД' ELSE 'Сверка' END,
         d.number, d.issue_date, c.inn, c.kpp, coalesce(c.legal_name, c.name), k.number, d.period_from, d.period_to,
         d.amount_net, d.vat_rate, d.vat_amount, d.amount_total, d.status
  FROM public.client_documents d
  JOIN public.clients c ON c.id = d.client_id
  LEFT JOIN public.contracts k ON k.id = d.contract_id
  WHERE d.org_id = _org_id AND d.status NOT IN ('draft', 'cancelled') AND d.issue_date BETWEEN _from AND _to
  ORDER BY d.issue_date, d.kind, d.number_seq;
END;
$$;

CREATE OR REPLACE FUNCTION public.export_1c_document_lines(_org_id uuid, _from date, _to date)
RETURNS TABLE (doc_kind text, doc_number text, line_no integer, item_name text, quantity numeric, unit text, price numeric, amount numeric, vat_rate numeric, note text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NOT private.can_export(_org_id) THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT CASE d.kind WHEN 'invoice' THEN 'Счёт' WHEN 'act' THEN 'Акт' ELSE 'УПД' END, d.number,
         (row_number() OVER (PARTITION BY d.id ORDER BY l.sort_order))::integer,
         concat_ws(' · ', l.site_name, l.position_name), l.quantity, l.unit, l.rate, l.amount, d.vat_rate, l.note
  FROM public.client_documents d JOIN public.client_document_lines l ON l.document_id = d.id
  WHERE d.org_id = _org_id AND d.status NOT IN ('draft', 'cancelled') AND d.issue_date BETWEEN _from AND _to
  ORDER BY d.issue_date, d.kind, d.number_seq, l.sort_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.export_1c_payments(_org_id uuid, _from date, _to date)
RETURNS TABLE (payment_date date, doc_number text, amount numeric, payer_inn text, payer_name text, client_name text, purpose text, invoices text, unallocated numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NOT private.can_export(_org_id) THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT p.payment_date, p.doc_number, p.amount, coalesce(p.payer_inn, c.inn), coalesce(p.payer_name, c.name), c.name, p.purpose,
         (SELECT string_agg(d.number, ', ' ORDER BY d.number) FROM public.payment_allocations a JOIN public.client_documents d ON d.id = a.document_id WHERE a.payment_id = p.id),
         p.amount - p.allocated_amount
  FROM public.client_payments p LEFT JOIN public.clients c ON c.id = p.client_id
  WHERE p.org_id = _org_id AND p.payment_date BETWEEN _from AND _to
  ORDER BY p.payment_date, p.doc_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.export_1c_clients(_org_id uuid)
RETURNS TABLE (client_name text, legal_name text, inn text, kpp text, ogrn text, legal_address text, bank_name text, bank_account text, bik text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NOT private.can_export(_org_id) THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT c.name, c.legal_name, c.inn, c.kpp, c.ogrn, c.legal_address, c.bank_name, c.bank_account, c.bik
  FROM public.clients c WHERE c.org_id = _org_id AND c.status <> 'lead' ORDER BY c.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.month_close_blockers(uuid, date), public.close_month(uuid, date), public.reopen_month(uuid, date, text),
  public.export_1c_documents(uuid, date, date), public.export_1c_document_lines(uuid, date, date), public.export_1c_payments(uuid, date, date),
  public.export_1c_clients(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.month_close_blockers(uuid, date), public.close_month(uuid, date), public.reopen_month(uuid, date, text),
  public.export_1c_documents(uuid, date, date), public.export_1c_document_lines(uuid, date, date), public.export_1c_payments(uuid, date, date),
  public.export_1c_clients(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.month_locked(uuid, date), private.can_export(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.month_locked(uuid, date), private.can_export(uuid) TO service_role;

-- ============================================================
-- 4. Доступ
-- ============================================================
ALTER TABLE public.period_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.period_locks FROM anon, authenticated;
GRANT SELECT ON public.period_locks TO authenticated;
GRANT ALL ON public.period_locks TO service_role;
CREATE POLICY "Period locks: view with accounting" ON public.period_locks FOR SELECT TO authenticated
  USING (private.permission_scope(auth.uid(), org_id, 'client_documents', 'view') = 'all');
