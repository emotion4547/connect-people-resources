-- Этап 3, шаг 27: воронка продаж.
-- ТЗ: раздел 18 (С-1…С-7).
--
-- Сделка ведёт потенциального заказчика от заявки до договора. Лиды с сайта и саморегистрации HR становятся сделками сами и
-- распределяются по менеджерам по очереди или остаются руководителю. КП хранится версиями со ставками заказчика и исполнителя;
-- выигранная сделка переводит заказчика в «Договор» и создаёт черновики тарифов из КП без повторного ввода.

INSERT INTO public.setting_definitions
  (key, group_name, label, description, value_type, default_value, nullable, unit, min_value, max_value, allowed_values, levels, needs_confirmation, sort_order)
VALUES
  ('sales.lead_distribution', 'Продажи', 'Распределение новых лидов', 'round_robin — по очереди между менеджерами продаж, manual — лид остаётся без ответственного, назначает руководитель',
   'text', '"round_robin"', false, NULL, NULL, NULL, '["round_robin","manual"]', ARRAY['org'], false, 90),
  ('sales.new_client_months', 'Продажи', 'Сколько месяцев заказчик считается новым', 'Для плана продаж менеджера: выручка заказчиков, заведённых не раньше чем столько месяцев назад',
   'number', '3', false, 'мес', 1, 24, NULL, ARRAY['org'], false, 91);

INSERT INTO public.notification_events (code, title, channels, delivery, critical, audience) VALUES
  ('deal_assigned', 'Новая сделка назначена', ARRAY['max'], 'all', false, 'менеджер продаж'),
  ('deal_task_due', 'Задача по сделке', ARRAY['max'], 'all', false, 'менеджер продаж');

-- ============================================================
-- 1. Права: модуль «Сделки»
-- ============================================================
CREATE OR REPLACE FUNCTION private.seed_deals_permissions(_org_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, private
AS $$
  INSERT INTO public.role_permissions (org_id, role, module, action, scope)
  SELECT _org_id, r.role::public.app_role, 'deals', a.action,
    CASE r.role
      WHEN 'director' THEN 'all'
      WHEN 'sales' THEN CASE a.action WHEN 'delete' THEN 'none' WHEN 'export' THEN 'own' ELSE 'own' END
      ELSE 'none' END
  FROM (VALUES ('director'), ('sales'), ('site_manager'), ('recruiter'), ('accountant'), ('admin')) AS r(role)
  CROSS JOIN (VALUES ('view'), ('create'), ('update'), ('delete'), ('export')) AS a(action)
  ON CONFLICT DO NOTHING
$$;

CREATE OR REPLACE FUNCTION private.organizations_seed_deals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  PERFORM private.seed_deals_permissions(NEW.id);
  RETURN NEW;
END;
$$;

-- Права вставляются после основного набора прав организации: триггер срабатывает следом за ним.
CREATE TRIGGER organizations_seed_deals AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION private.organizations_seed_deals();
SELECT private.seed_deals_permissions(id) FROM public.organizations;

-- ============================================================
-- 2. Сделки, потребность, касания
-- ============================================================
CREATE OR REPLACE FUNCTION private.stage_probability(_stage text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$ SELECT CASE _stage WHEN 'new' THEN 0.10 WHEN 'qualification' THEN 0.25 WHEN 'proposal' THEN 0.40 WHEN 'negotiation' THEN 0.60 WHEN 'contract' THEN 0.80 WHEN 'won' THEN 1 ELSE 0 END $$;

CREATE TABLE public.deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Существующий заказчик (лид из саморегистрации или действующий клиент); у чужого лида с сайта пока пусто.
  client_id uuid,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  company text,
  contact_name text,
  contact_phone text,
  contact_email text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'site_form', 'self_registration')),
  stage text NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'qualification', 'proposal', 'negotiation', 'contract', 'won', 'lost')),
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Ожидания в месяц: выручка и маржа.
  expected_revenue numeric(14,2) NOT NULL DEFAULT 0 CHECK (expected_revenue >= 0),
  expected_margin numeric(14,2) NOT NULL DEFAULT 0,
  next_step text,
  next_step_date date,
  expected_close date,
  lost_reason text,
  note text,
  won_at timestamptz,
  closed_at timestamptz,
  last_touch_at timestamptz,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, client_id) REFERENCES public.clients (org_id, id) ON DELETE SET NULL (client_id),
  UNIQUE (org_id, id),
  CONSTRAINT deals_lost_needs_reason CHECK (stage <> 'lost' OR length(btrim(coalesce(lost_reason, ''))) > 0)
);

CREATE INDEX deals_org_stage_idx ON public.deals (org_id, stage);
CREATE INDEX deals_owner_idx ON public.deals (owner_id) WHERE stage NOT IN ('won', 'lost');
CREATE UNIQUE INDEX deals_client_lead_key ON public.deals (client_id) WHERE source = 'self_registration';
CREATE TRIGGER update_deals_updated_at BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER audit_deals AFTER INSERT OR UPDATE OR DELETE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('title', 'stage', 'owner_id', 'expected_revenue', 'lost_reason');

CREATE TABLE public.deal_needs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  deal_id uuid NOT NULL,
  position_id uuid NOT NULL,
  headcount integer NOT NULL CHECK (headcount >= 1),
  hours_per_month numeric(8,1) NOT NULL DEFAULT 0 CHECK (hours_per_month >= 0),
  FOREIGN KEY (org_id, deal_id) REFERENCES public.deals (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, position_id) REFERENCES public.positions (org_id, id) ON DELETE RESTRICT,
  UNIQUE (deal_id, position_id)
);

CREATE TABLE public.deal_touches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  deal_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('call', 'meeting', 'email', 'task')),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  note text,
  -- Для касания, которое уже было, — когда; для задачи — срок, к которому приходит напоминание.
  due_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, deal_id) REFERENCES public.deals (org_id, id) ON DELETE CASCADE
);

CREATE INDEX deal_touches_open_idx ON public.deal_touches (owner_id, due_at) WHERE done_at IS NULL;
CREATE INDEX deal_touches_deal_idx ON public.deal_touches (deal_id, due_at DESC);

-- Версии КП: ставки заказчика видны в PDF, ставки исполнителя — только сотрудникам.
CREATE TABLE public.deal_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  deal_id uuid NOT NULL,
  version integer NOT NULL,
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) > 0),
  valid_until date,
  note text,
  sent_at timestamptz,
  sent_to text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, deal_id) REFERENCES public.deals (org_id, id) ON DELETE CASCADE,
  UNIQUE (deal_id, version)
);

CREATE TABLE public.sales_plans (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  manager_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month date NOT NULL CHECK (month = date_trunc('month', month)::date),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, manager_id, month)
);

-- ============================================================
-- 3. Права на строки
-- ============================================================
CREATE OR REPLACE FUNCTION private.deal_can(_deal_id uuid, _action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT coalesce((SELECT CASE private.permission_scope(auth.uid(), d.org_id, 'deals', _action)
                     WHEN 'all' THEN true WHEN 'none' THEN false ELSE d.owner_id = auth.uid() END
                   FROM public.deals d WHERE d.id = _deal_id), false)
$$;

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_needs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_touches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deals, public.deal_needs, public.deal_touches, public.deal_quotes, public.sales_plans FROM anon, authenticated;
GRANT ALL ON public.deals, public.deal_needs, public.deal_touches, public.deal_quotes, public.sales_plans TO service_role;
GRANT SELECT, INSERT, DELETE ON public.deals TO authenticated;
-- Этап, ответственный и итог меняются только функциями.
GRANT UPDATE (client_id, title, company, contact_name, contact_phone, contact_email, expected_revenue, expected_margin, next_step, next_step_date, expected_close, note) ON public.deals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_needs TO authenticated;
GRANT SELECT ON public.deal_touches, public.deal_quotes, public.sales_plans TO authenticated;

CREATE POLICY "Deals: view" ON public.deals FOR SELECT TO authenticated
  USING (CASE private.permission_scope(auth.uid(), org_id, 'deals', 'view') WHEN 'all' THEN true WHEN 'none' THEN false ELSE owner_id = auth.uid() END);
CREATE POLICY "Deals: add" ON public.deals FOR INSERT TO authenticated
  WITH CHECK (private.permission_scope(auth.uid(), org_id, 'deals', 'create') <> 'none' AND stage = 'new' AND source = 'manual' AND won_at IS NULL AND closed_at IS NULL
              AND (private.permission_scope(auth.uid(), org_id, 'deals', 'create') = 'all' OR owner_id = auth.uid()));
CREATE POLICY "Deals: edit" ON public.deals FOR UPDATE TO authenticated
  USING (private.deal_can(id, 'update') AND stage NOT IN ('won', 'lost')) WITH CHECK (private.deal_can(id, 'update'));
CREATE POLICY "Deals: delete" ON public.deals FOR DELETE TO authenticated USING (private.deal_can(id, 'delete') AND stage <> 'won');

CREATE POLICY "Deal needs: view" ON public.deal_needs FOR SELECT TO authenticated USING (private.deal_can(deal_id, 'view'));
CREATE POLICY "Deal needs: add" ON public.deal_needs FOR INSERT TO authenticated WITH CHECK (private.deal_can(deal_id, 'update'));
CREATE POLICY "Deal needs: edit" ON public.deal_needs FOR UPDATE TO authenticated USING (private.deal_can(deal_id, 'update')) WITH CHECK (private.deal_can(deal_id, 'update'));
CREATE POLICY "Deal needs: delete" ON public.deal_needs FOR DELETE TO authenticated USING (private.deal_can(deal_id, 'update'));
CREATE POLICY "Deal touches: view" ON public.deal_touches FOR SELECT TO authenticated USING (private.deal_can(deal_id, 'view'));
CREATE POLICY "Deal quotes: view" ON public.deal_quotes FOR SELECT TO authenticated USING (private.deal_can(deal_id, 'view'));
CREATE POLICY "Sales plans: view" ON public.sales_plans FOR SELECT TO authenticated
  USING (CASE private.permission_scope(auth.uid(), org_id, 'deals', 'view') WHEN 'all' THEN true WHEN 'none' THEN false ELSE manager_id = auth.uid() END);

-- ============================================================
-- 4. Распределение лидов
-- ============================================================
-- Следующий менеджер по очереди: тот, кому дольше всех не назначали лид.
CREATE OR REPLACE FUNCTION private.next_sales_owner(_org_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT ur.user_id FROM public.user_roles ur
  WHERE ur.org_id = _org_id AND ur.role = 'sales' AND private.is_user_active(ur.user_id)
  ORDER BY (SELECT max(d.created_at) FROM public.deals d WHERE d.owner_id = ur.user_id AND d.source IN ('site_form', 'self_registration')) NULLS FIRST, ur.user_id
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION private.create_lead_deal(_org_id uuid, _source text, _title text, _company text, _name text, _phone text, _email text, _client_id uuid, _note text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  owner uuid;
  did uuid;
BEGIN
  IF coalesce(public.get_setting(_org_id, 'sales.lead_distribution') #>> '{}', 'round_robin') = 'round_robin' THEN
    owner := private.next_sales_owner(_org_id);
  END IF;
  INSERT INTO public.deals (org_id, client_id, title, company, contact_name, contact_phone, contact_email, source, owner_id, note, next_step, next_step_date, created_by)
  VALUES (_org_id, _client_id, coalesce(nullif(btrim(_title), ''), 'Новая заявка'), _company, _name, _phone, _email, _source, owner, _note,
          'Связаться с заказчиком', current_date, NULL)
  RETURNING id INTO did;
  IF owner IS NOT NULL THEN
    PERFORM private.notify(_org_id, owner, 'deal_assigned', 'Новая сделка: ' || coalesce(nullif(btrim(_title), ''), 'Новая заявка'),
                           coalesce(_name, '') || ' ' || coalesce(_phone, _email, ''), '/deals/' || did, 'deal:' || did);
    IF _client_id IS NOT NULL THEN UPDATE public.clients SET sales_manager_id = owner WHERE id = _client_id AND sales_manager_id IS NULL; END IF;
  END IF;
  RETURN did;
END;
$$;

-- Форма обратной связи на сайте.
CREATE OR REPLACE FUNCTION private.contact_message_to_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  PERFORM private.create_lead_deal(private.default_org_id(), 'site_form', NEW.subject, NULL, NEW.name, NEW.phone, NEW.email, NULL, NEW.message);
  RETURN NEW;
END;
$$;
CREATE TRIGGER contact_message_deal AFTER INSERT ON public.contact_messages FOR EACH ROW EXECUTE FUNCTION private.contact_message_to_deal();

-- Саморегистрация HR создаёт лид-заказчика; к нему сразу заводится сделка.
CREATE OR REPLACE FUNCTION private.client_lead_to_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NEW.status = 'lead' THEN
    PERFORM private.create_lead_deal(NEW.org_id, 'self_registration', NEW.name, NEW.name, NULL, NULL, NULL, NEW.id, 'Саморегистрация HR');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER client_lead_deal AFTER INSERT ON public.clients FOR EACH ROW EXECUTE FUNCTION private.client_lead_to_deal();

-- ============================================================
-- 5. Этапы, ответственный, касания
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_deal_stage(_deal_id uuid, _stage text, _lost_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  d public.deals;
BEGIN
  SELECT * INTO d FROM public.deals WHERE id = _deal_id FOR UPDATE;
  IF NOT FOUND OR NOT private.deal_can(_deal_id, 'update') THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  IF _stage NOT IN ('new', 'qualification', 'proposal', 'negotiation', 'contract', 'lost') THEN
    RAISE EXCEPTION 'Выигранной сделку делает кнопка «Выиграна»: она создаёт тарифы и переводит заказчика в договор' USING ERRCODE = '22023';
  END IF;
  IF d.stage = 'won' THEN RAISE EXCEPTION 'Выигранную сделку изменить нельзя' USING ERRCODE = '22023'; END IF;
  IF d.stage = 'lost' AND private.permission_scope(auth.uid(), d.org_id, 'deals', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Закрытую сделку может вернуть в работу только руководитель' USING ERRCODE = '42501';
  END IF;
  IF _stage = 'lost' AND length(btrim(coalesce(_lost_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'Укажите причину отказа' USING ERRCODE = '22023';
  END IF;
  UPDATE public.deals SET stage = _stage, lost_reason = CASE WHEN _stage = 'lost' THEN btrim(_lost_reason) ELSE NULL END,
         closed_at = CASE WHEN _stage = 'lost' THEN now() ELSE NULL END WHERE id = _deal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_deal(_deal_id uuid, _owner_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  d public.deals;
BEGIN
  SELECT * INTO d FROM public.deals WHERE id = _deal_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), d.org_id, 'deals', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF _owner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _owner_id AND ur.org_id = d.org_id AND ur.role IN ('sales', 'director')) THEN
    RAISE EXCEPTION 'Ответственным может быть менеджер продаж или руководитель' USING ERRCODE = '22023';
  END IF;
  UPDATE public.deals SET owner_id = _owner_id WHERE id = _deal_id;
  IF _owner_id IS NOT NULL AND _owner_id IS DISTINCT FROM d.owner_id THEN
    PERFORM private.notify(d.org_id, _owner_id, 'deal_assigned', 'Вам передана сделка: ' || d.title, coalesce(d.contact_name, ''), '/deals/' || d.id, 'deal:' || d.id || ':' || _owner_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_deal_touch(_deal_id uuid, _kind text, _title text, _due_at timestamptz DEFAULT now(), _note text DEFAULT NULL, _done boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  d public.deals;
  tid uuid;
BEGIN
  SELECT * INTO d FROM public.deals WHERE id = _deal_id;
  IF NOT FOUND OR NOT private.deal_can(_deal_id, 'update') THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.deal_touches (org_id, deal_id, kind, title, note, due_at, done_at, owner_id)
  VALUES (d.org_id, _deal_id, _kind, _title, _note, coalesce(_due_at, now()), CASE WHEN _done THEN now() END, coalesce(d.owner_id, auth.uid()))
  RETURNING id INTO tid;
  IF _done THEN UPDATE public.deals SET last_touch_at = now() WHERE id = _deal_id; END IF;
  RETURN tid;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_deal_touch(_touch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  t public.deal_touches;
BEGIN
  SELECT * INTO t FROM public.deal_touches WHERE id = _touch_id;
  IF NOT FOUND OR NOT private.deal_can(t.deal_id, 'update') THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  UPDATE public.deal_touches SET done_at = coalesce(done_at, now()) WHERE id = _touch_id;
  UPDATE public.deals SET last_touch_at = now() WHERE id = t.deal_id;
END;
$$;

-- «Мой день»: мои открытые задачи на сегодня и просроченные, сделки со следующим шагом на сегодня и раньше.
CREATE OR REPLACE FUNCTION public.my_sales_day(_org_id uuid)
RETURNS TABLE (kind text, ref_id uuid, deal_id uuid, deal_title text, title text, due date, overdue boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'deals', 'view') = 'none' THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT 'task'::text, t.id, d.id, d.title, t.kind || ': ' || t.title, t.due_at::date, t.due_at::date < current_date
  FROM public.deal_touches t JOIN public.deals d ON d.id = t.deal_id
  WHERE d.org_id = _org_id AND t.owner_id = auth.uid() AND t.done_at IS NULL AND t.due_at::date <= current_date AND d.stage NOT IN ('won', 'lost')
  UNION ALL
  SELECT 'next_step'::text, d.id, d.id, d.title, coalesce(d.next_step, 'Следующий шаг'), d.next_step_date, d.next_step_date < current_date
  FROM public.deals d
  WHERE d.org_id = _org_id AND d.owner_id = auth.uid() AND d.next_step_date IS NOT NULL AND d.next_step_date <= current_date AND d.stage NOT IN ('won', 'lost')
  ORDER BY 6, 5;
END;
$$;

-- Напоминания о задачах и следующих шагах — по расписанию.
CREATE OR REPLACE FUNCTION private.notify_deal_tasks()
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
  FOR r IN
    SELECT t.id, t.org_id, t.owner_id, t.kind, t.title, d.title AS deal_title, d.id AS deal_id
    FROM public.deal_touches t JOIN public.deals d ON d.id = t.deal_id
    WHERE t.done_at IS NULL AND t.due_at <= now() AND t.owner_id IS NOT NULL AND d.stage NOT IN ('won', 'lost')
  LOOP
    rid := private.notify(r.org_id, r.owner_id, 'deal_task_due', 'Задача по сделке: ' || r.title, r.deal_title, '/deals/' || r.deal_id, 'dealtask:' || r.id);
    IF rid IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  FOR r IN
    SELECT d.id, d.org_id, d.owner_id, d.title, d.next_step, d.next_step_date FROM public.deals d
    WHERE d.next_step_date <= current_date AND d.owner_id IS NOT NULL AND d.stage NOT IN ('won', 'lost')
  LOOP
    rid := private.notify(r.org_id, r.owner_id, 'deal_task_due', 'Следующий шаг: ' || coalesce(r.next_step, 'свяжитесь с заказчиком'), r.title, '/deals/' || r.id, 'dealstep:' || r.id || ':' || r.next_step_date);
    IF rid IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END;
$$;

-- ============================================================
-- 6. КП и выигрыш сделки
-- ============================================================
-- Строки КП: [{position_id, unit, client_rate, worker_rate, headcount, hours_per_month}]. Версия увеличивается сама.
CREATE OR REPLACE FUNCTION public.create_deal_quote(_deal_id uuid, _lines jsonb, _valid_until date DEFAULT NULL, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  d public.deals;
  l jsonb;
  qid uuid;
BEGIN
  SELECT * INTO d FROM public.deals WHERE id = _deal_id FOR UPDATE;
  IF NOT FOUND OR NOT private.deal_can(_deal_id, 'update') THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  IF d.stage IN ('won', 'lost') THEN RAISE EXCEPTION 'Сделка закрыта' USING ERRCODE = '22023'; END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN RAISE EXCEPTION 'В КП нужна хотя бы одна позиция' USING ERRCODE = '22023'; END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.positions p WHERE p.id = (l ->> 'position_id')::uuid AND p.org_id = d.org_id) THEN
      RAISE EXCEPTION 'Позиция не найдена' USING ERRCODE = '22023';
    END IF;
    IF coalesce((l ->> 'client_rate')::numeric, -1) < 0 OR coalesce((l ->> 'worker_rate')::numeric, -1) < 0 THEN
      RAISE EXCEPTION 'Ставки заказчика и исполнителя должны быть заданы' USING ERRCODE = '22023';
    END IF;
    IF coalesce(l ->> 'unit', 'hour') NOT IN ('hour', 'shift', 'piece') THEN RAISE EXCEPTION 'Единица ставки: час, смена или штука' USING ERRCODE = '22023'; END IF;
  END LOOP;
  INSERT INTO public.deal_quotes (org_id, deal_id, version, lines, valid_until, note)
  VALUES (d.org_id, _deal_id, coalesce((SELECT max(version) FROM public.deal_quotes WHERE deal_id = _deal_id), 0) + 1, _lines, _valid_until, _note)
  RETURNING id INTO qid;
  RETURN qid;
END;
$$;

-- Отметка об отправке КП: сделка переходит на этап «КП отправлено», если была раньше.
CREATE OR REPLACE FUNCTION public.mark_quote_sent(_quote_id uuid, _sent_to text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  q public.deal_quotes;
BEGIN
  SELECT * INTO q FROM public.deal_quotes WHERE id = _quote_id;
  IF NOT FOUND OR NOT private.deal_can(q.deal_id, 'update') THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  UPDATE public.deal_quotes SET sent_at = now(), sent_to = _sent_to WHERE id = _quote_id;
  UPDATE public.deals SET stage = 'proposal', last_touch_at = now() WHERE id = q.deal_id AND stage IN ('new', 'qualification');
  INSERT INTO public.deal_touches (org_id, deal_id, kind, title, due_at, done_at, owner_id)
  VALUES (q.org_id, q.deal_id, 'email', 'Отправлено КП, версия ' || q.version, now(), now(), auth.uid());
END;
$$;

-- Выигрыш: заказчик — в «Договор» (если заказчика нет, он создаётся), тарифы — черновиками из выбранного КП.
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
  RETURN n;
END;
$$;

-- ============================================================
-- 7. Отчёты: воронка, причины отказов, план продаж
-- ============================================================
CREATE OR REPLACE FUNCTION public.deal_funnel(_org_id uuid)
RETURNS TABLE (stage text, deals bigint, revenue numeric, weighted numeric, margin numeric, sort_order integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'deals', 'view') = 'none' THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT s.stage, count(d.id), coalesce(sum(d.expected_revenue), 0), coalesce(round(sum(d.expected_revenue * private.stage_probability(s.stage)), 2), 0), coalesce(sum(d.expected_margin), 0), s.ord
  FROM (VALUES ('new', 1), ('qualification', 2), ('proposal', 3), ('negotiation', 4), ('contract', 5)) AS s(stage, ord)
  LEFT JOIN public.deals d ON d.stage = s.stage AND d.org_id = _org_id
    AND (private.permission_scope(auth.uid(), _org_id, 'deals', 'view') = 'all' OR d.owner_id = auth.uid())
  GROUP BY s.stage, s.ord ORDER BY s.ord;
END;
$$;

CREATE OR REPLACE FUNCTION public.deal_lost_reasons(_org_id uuid, _from date, _to date)
RETURNS TABLE (reason text, deals bigint, revenue numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'deals', 'view') = 'none' THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT d.lost_reason, count(*), coalesce(sum(d.expected_revenue), 0)
  FROM public.deals d
  WHERE d.org_id = _org_id AND d.stage = 'lost' AND d.closed_at::date BETWEEN _from AND _to
    AND (private.permission_scope(auth.uid(), _org_id, 'deals', 'view') = 'all' OR d.owner_id = auth.uid())
  GROUP BY d.lost_reason ORDER BY count(*) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_sales_plan(_org_id uuid, _manager_id uuid, _month date, _amount numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'deals', 'update') <> 'all' THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'Сумма плана не может быть отрицательной' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _manager_id AND ur.org_id = _org_id AND ur.role = 'sales') THEN
    RAISE EXCEPTION 'План ставится менеджеру продаж' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.sales_plans (org_id, manager_id, month, amount) VALUES (_org_id, _manager_id, date_trunc('month', _month)::date, _amount)
  ON CONFLICT (org_id, manager_id, month) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now();
END;
$$;

-- План и факт менеджеров: факт — выручка новых заказчиков менеджера (заведённых не раньше чем N месяцев назад) по начислениям месяца.
CREATE OR REPLACE FUNCTION public.sales_plan_fact(_org_id uuid, _from date, _to date)
RETURNS TABLE (manager_id uuid, manager_name text, month date, plan numeric, fact numeric)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  scope text := private.permission_scope(auth.uid(), _org_id, 'deals', 'view');
  months integer := coalesce(public.get_setting_numeric(_org_id, 'sales.new_client_months'), 3)::integer;
BEGIN
  IF auth.uid() IS NULL OR scope = 'none' THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH m AS (
    SELECT DISTINCT ur.user_id, date_trunc('month', g)::date AS month FROM public.user_roles ur, generate_series(date_trunc('month', _from), date_trunc('month', _to), interval '1 month') g
    WHERE ur.org_id = _org_id AND ur.role = 'sales' AND (scope = 'all' OR ur.user_id = auth.uid())
  )
  SELECT m.user_id, coalesce(sp.full_name, 'Без имени'), m.month, coalesce(pl.amount, 0),
         coalesce((SELECT sum(a.amount_client) FROM public.accruals a JOIN public.clients c ON c.id = a.client_id
                    WHERE a.org_id = _org_id AND a.status <> 'draft' AND c.sales_manager_id = m.user_id
                      AND date_trunc('month', private.accrual_date(a.kind, a.shift_date, a.period_month)) = m.month
                      AND c.created_at >= (m.month + interval '1 month') - make_interval(months => months)), 0)
  FROM m LEFT JOIN public.staff_profiles sp ON sp.user_id = m.user_id
  LEFT JOIN public.sales_plans pl ON pl.org_id = _org_id AND pl.manager_id = m.user_id AND pl.month = m.month
  ORDER BY m.month, 2;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_deal_stage(uuid, text, text), public.assign_deal(uuid, uuid), public.add_deal_touch(uuid, text, text, timestamptz, text, boolean),
  public.complete_deal_touch(uuid), public.my_sales_day(uuid), public.create_deal_quote(uuid, jsonb, date, text), public.mark_quote_sent(uuid, text), public.win_deal(uuid, uuid),
  public.deal_funnel(uuid), public.deal_lost_reasons(uuid, date, date), public.save_sales_plan(uuid, uuid, date, numeric), public.sales_plan_fact(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_deal_stage(uuid, text, text), public.assign_deal(uuid, uuid), public.add_deal_touch(uuid, text, text, timestamptz, text, boolean),
  public.complete_deal_touch(uuid), public.my_sales_day(uuid), public.create_deal_quote(uuid, jsonb, date, text), public.mark_quote_sent(uuid, text), public.win_deal(uuid, uuid),
  public.deal_funnel(uuid), public.deal_lost_reasons(uuid, date, date), public.save_sales_plan(uuid, uuid, date, numeric), public.sales_plan_fact(uuid, date, date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.seed_deals_permissions(uuid), private.organizations_seed_deals(), private.next_sales_owner(uuid),
  private.create_lead_deal(uuid, text, text, text, text, text, text, uuid, text), private.contact_message_to_deal(), private.client_lead_to_deal(), private.notify_deal_tasks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.next_sales_owner(uuid), private.create_lead_deal(uuid, text, text, text, text, text, text, uuid, text), private.notify_deal_tasks() TO service_role;
REVOKE EXECUTE ON FUNCTION private.deal_can(uuid, text), private.stage_probability(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.deal_can(uuid, text), private.stage_probability(text) TO authenticated, service_role;
