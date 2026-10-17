-- Этап 1, шаг 8: исполнители, документы, найм. ТЗ: разделы 4 и 10 (Н-1…Н-15).
--
-- Шифрование. Номера документов, ИНН, СНИЛС и реквизиты выплаты хранятся зашифрованными, маска
-- («•••• 1234») — отдельно. Ключ не лежит в таблицах и не попадает в логические бэкапы (pg_dump):
-- он задаётся параметром сервера app.pii_key (см. deploy/README.md), функции берут его оттуда.
-- Потеря ключа = потеря зашифрованных данных: копию ключа хранить отдельно от сервера.
--
-- Не входит в этот шаг: самостоятельная загрузка документов кандидатом по ссылке из SMS/MAX
-- (нужны провайдер сообщений и публичная функция, шаг 12), рассылка открытых смен группе
-- (шаг 12), регистрация на сайте как источник кандидатов (шаг 11: кабинет исполнителя перестраивается там).

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ============================================================
-- 1. Шифрование
-- ============================================================
CREATE OR REPLACE FUNCTION private.pii_key()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  k text := current_setting('app.pii_key', true);
BEGIN
  IF k IS NULL OR length(k) < 32 THEN
    RAISE EXCEPTION 'Ключ шифрования персональных данных не задан на сервере' USING ERRCODE = '55000';
  END IF;
  RETURN k;
END;
$$;

CREATE OR REPLACE FUNCTION private.pii_encrypt(_value text)
RETURNS bytea
LANGUAGE sql
STABLE
SET search_path = public, private, extensions
AS $$ SELECT extensions.pgp_sym_encrypt(_value, private.pii_key()) $$;

CREATE OR REPLACE FUNCTION private.pii_decrypt(_value bytea)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, private, extensions
AS $$ SELECT extensions.pgp_sym_decrypt(_value, private.pii_key()) $$;

CREATE OR REPLACE FUNCTION private.mask_value(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT '•••• ' || right(regexp_replace(coalesce(_value, ''), '\s', '', 'g'), 4) $$;

REVOKE EXECUTE ON FUNCTION private.pii_key(), private.pii_encrypt(text), private.pii_decrypt(bytea), private.mask_value(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.pii_key(), private.pii_encrypt(text), private.pii_decrypt(bytea), private.mask_value(text) TO service_role;

-- ============================================================
-- 2. Коды типов документов (правила чек-листа ссылаются на код, а не на название)
-- ============================================================
ALTER TABLE public.directories ADD COLUMN code text;
CREATE UNIQUE INDEX directories_org_kind_code_key ON public.directories (org_id, kind, code) WHERE code IS NOT NULL;

UPDATE public.directories SET code = CASE name
  WHEN 'Паспорт' THEN 'passport' WHEN 'ИНН' THEN 'inn' WHEN 'СНИЛС' THEN 'snils' WHEN 'Патент' THEN 'patent'
  WHEN 'РВП или ВНЖ' THEN 'residence_permit' WHEN 'Медицинская книжка' THEN 'medical_book'
  WHEN 'Согласие на обработку персональных данных' THEN 'pd_consent' WHEN 'Договор с исполнителем' THEN 'contract'
  END
WHERE kind = 'document_type';

CREATE OR REPLACE FUNCTION private.seed_document_types(_org_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, private
AS $$
  INSERT INTO public.directories (org_id, kind, name, code, sort_order) VALUES
    (_org_id, 'document_type', 'Паспорт', 'passport', 1),
    (_org_id, 'document_type', 'ИНН', 'inn', 2),
    (_org_id, 'document_type', 'СНИЛС', 'snils', 3),
    (_org_id, 'document_type', 'Патент', 'patent', 4),
    (_org_id, 'document_type', 'РВП или ВНЖ', 'residence_permit', 5),
    (_org_id, 'document_type', 'Медицинская книжка', 'medical_book', 6),
    (_org_id, 'document_type', 'Согласие на обработку персональных данных', 'pd_consent', 7),
    (_org_id, 'document_type', 'Договор с исполнителем', 'contract', 8)
  ON CONFLICT DO NOTHING
$$;

-- Иностранный гражданин: гражданство указано и не российское.
CREATE OR REPLACE FUNCTION private.is_foreign(_citizenship text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(btrim(coalesce(_citizenship, '')), '') IS NOT NULL
     AND lower(btrim(_citizenship)) NOT IN ('россия', 'рф', 'российская федерация', 'russia', 'ru')
$$;

REVOKE EXECUTE ON FUNCTION private.is_foreign(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_foreign(text) TO authenticated, service_role;

-- ============================================================
-- 3. Исполнитель: полная карточка
-- ============================================================
ALTER TABLE public.workers
  ADD COLUMN recruiter_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN source_id uuid REFERENCES public.directories(id) ON DELETE SET NULL,
  ADD COLUMN referrer_id uuid REFERENCES public.workers(user_id) ON DELETE SET NULL,
  ADD COLUMN referral_code text NOT NULL DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  ADD COLUMN address_actual text,
  ADD COLUMN address_registered text,
  ADD COLUMN notes text,
  ADD COLUMN admitted_at timestamptz;

CREATE UNIQUE INDEX workers_referral_code_key ON public.workers (referral_code);
CREATE INDEX workers_recruiter_idx ON public.workers (recruiter_id);

-- Номер документа, срок оплаты налога по патенту и файл.
ALTER TABLE public.worker_documents
  ADD COLUMN number_encrypted bytea,
  ADD COLUMN paid_until date,
  ADD COLUMN file_path text;

CREATE TABLE public.worker_groups (
  org_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  group_id uuid NOT NULL REFERENCES public.directories(id) ON DELETE RESTRICT,
  PRIMARY KEY (worker_id, group_id),
  FOREIGN KEY (org_id, worker_id) REFERENCES public.workers (org_id, user_id) ON DELETE CASCADE
);

-- Реквизиты, ИНН и СНИЛС — только зашифрованными. Прямого доступа у клиента нет.
CREATE TABLE public.person_secrets (
  subject_type text NOT NULL CHECK (subject_type IN ('candidate', 'worker')),
  subject_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  inn_encrypted bytea, inn_masked text,
  snils_encrypted bytea, snils_masked text,
  payout_encrypted bytea, payout_masked text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_type, subject_id)
);

ALTER TABLE public.person_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.person_secrets FROM anon, authenticated;
GRANT ALL ON public.person_secrets TO service_role;

-- ============================================================
-- 4. Кандидаты
-- ============================================================
CREATE TABLE public.candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (length(btrim(full_name)) > 0),
  phone text,
  -- Последние 10 цифр: так находятся дубли независимо от написания номера.
  phone_key text GENERATED ALWAYS AS (nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '')) STORED,
  city text,
  district text,
  citizenship text,
  experience text,
  birth_date date,
  tax_status text CHECK (tax_status IN ('ip', 'self_employed', 'gph', 'employment')),
  source_id uuid REFERENCES public.directories(id) ON DELETE SET NULL,
  referrer_id uuid REFERENCES public.workers(user_id) ON DELETE SET NULL,
  recruiter_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Новый → Связались → Собеседование → Документы → Допущен; в сторону: Не дозвонились, Резерв, Отказ.
  stage text NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'contacted', 'interview', 'documents', 'admitted', 'no_answer', 'reserve', 'rejected')),
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  reject_reason_id uuid REFERENCES public.directories(id) ON DELETE SET NULL,
  next_contact_at timestamptz,
  next_contact_note text,
  admitted_worker_id uuid REFERENCES public.workers(user_id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  CONSTRAINT candidates_reject_needs_reason CHECK (stage <> 'rejected' OR reject_reason_id IS NOT NULL)
);

CREATE INDEX candidates_org_stage_idx ON public.candidates (org_id, stage);
CREATE INDEX candidates_recruiter_idx ON public.candidates (recruiter_id, next_contact_at);
CREATE INDEX candidates_phone_key_idx ON public.candidates (org_id, phone_key);

CREATE TRIGGER update_candidates_updated_at
  BEFORE UPDATE ON public.candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION private.candidates_stage_time()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN NEW.stage_changed_at := now(); END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER candidates_stage_time
  BEFORE UPDATE ON public.candidates
  FOR EACH ROW EXECUTE FUNCTION private.candidates_stage_time();

CREATE TRIGGER audit_candidates
  AFTER INSERT OR UPDATE OR DELETE ON public.candidates
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('full_name', 'phone', 'stage', 'recruiter_id', 'reject_reason_id', 'admitted_worker_id');

CREATE TABLE public.candidate_positions (
  org_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  position_id uuid NOT NULL,
  PRIMARY KEY (candidate_id, position_id),
  FOREIGN KEY (org_id, candidate_id) REFERENCES public.candidates (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, position_id) REFERENCES public.positions (org_id, id) ON DELETE CASCADE
);

-- История касаний: звонок, сообщение, встреча — результат и следующий шаг.
CREATE TABLE public.candidate_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('call', 'message', 'meeting', 'note')),
  result text,
  next_step text,
  next_at timestamptz,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, candidate_id) REFERENCES public.candidates (org_id, id) ON DELETE CASCADE
);

CREATE INDEX candidate_activities_candidate_idx ON public.candidate_activities (candidate_id, created_at DESC);

-- Следующий шаг из касания становится «следующим контактом» кандидата.
CREATE OR REPLACE FUNCTION private.activities_set_next_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  UPDATE public.candidates SET next_contact_at = NEW.next_at, next_contact_note = NEW.next_step WHERE id = NEW.candidate_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER activities_set_next_contact
  AFTER INSERT ON public.candidate_activities
  FOR EACH ROW EXECUTE FUNCTION private.activities_set_next_contact();

CREATE TABLE public.candidate_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  document_type_id uuid NOT NULL REFERENCES public.directories(id) ON DELETE RESTRICT,
  number_masked text,
  number_encrypted bytea,
  issued_on date,
  valid_until date,
  paid_until date,
  file_path text,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'verified', 'rejected')),
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, candidate_id) REFERENCES public.candidates (org_id, id) ON DELETE CASCADE
);

CREATE INDEX candidate_documents_candidate_idx ON public.candidate_documents (candidate_id, document_type_id);

CREATE TRIGGER audit_candidate_documents
  AFTER INSERT OR UPDATE OR DELETE ON public.candidate_documents
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('candidate_id', 'document_type_id', 'valid_until', 'status', 'verified_by');

-- ============================================================
-- 5. Задачи сотрудников (МВД, истекающие документы)
-- ============================================================
CREATE TABLE public.staff_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Если ответственный не назначен, задачу видят и выполняют все с этой ролью.
  assignee_role public.app_role,
  kind text NOT NULL,
  title text NOT NULL,
  due_date date NOT NULL,
  related_type text,
  related_id uuid,
  done_at timestamptz,
  done_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (kind, related_id, due_date)
);

CREATE INDEX staff_tasks_open_idx ON public.staff_tasks (org_id, due_date) WHERE done_at IS NULL;

-- ============================================================
-- 6. Рабочие дни (с учётом праздников из справочника)
-- ============================================================
CREATE OR REPLACE FUNCTION private.add_working_days(_from date, _n integer, _org_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public, private
AS $$
DECLARE
  d date := _from;
  left_days integer := _n;
BEGIN
  WHILE left_days > 0 LOOP
    d := d + 1;
    IF extract(isodow FROM d) < 6
       AND NOT EXISTS (SELECT 1 FROM public.directories h WHERE h.org_id = _org_id AND h.kind = 'holiday' AND h.is_active AND h.item_date = d) THEN
      left_days := left_days - 1;
    END IF;
  END LOOP;
  RETURN d;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.add_working_days(date, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.add_working_days(date, integer, uuid) TO authenticated, service_role;

-- Иностранец прекращает работу — задача «Уведомить МВД» со сроком 3 рабочих дня (Н-10).
CREATE OR REPLACE FUNCTION private.workers_termination_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  citizenship_value text;
BEGIN
  IF NEW.status = 'not_working' AND OLD.status IS DISTINCT FROM 'not_working' AND private.is_foreign(NEW.citizenship) THEN
    INSERT INTO public.staff_tasks (org_id, assignee_id, assignee_role, kind, title, due_date, related_type, related_id)
    VALUES (NEW.org_id, NEW.recruiter_id, 'recruiter', 'mvd_termination',
            'Уведомить МВД о прекращении работы: ' || NEW.full_name,
            private.add_working_days(current_date, 3, NEW.org_id), 'workers', NEW.user_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workers_termination_task
  AFTER UPDATE OF status ON public.workers
  FOR EACH ROW EXECUTE FUNCTION private.workers_termination_task();

-- Ежедневная проверка сроков: документы истекают через 30, 14 и 3 дня; налог по патенту — за 7 дней.
-- Вызывается по расписанию, повторный запуск ничего не дублирует.
CREATE OR REPLACE FUNCTION private.generate_document_tasks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  n integer := 0;
  k integer;
BEGIN
  INSERT INTO public.staff_tasks (org_id, assignee_id, assignee_role, kind, title, due_date, related_type, related_id)
  SELECT wd.org_id, w.recruiter_id, 'recruiter', 'document_expires_' || t.days,
         'Истекает документ «' || dt.name || '»: ' || w.full_name,
         wd.valid_until, 'worker_documents', wd.id
  FROM public.worker_documents wd
  JOIN public.workers w ON w.user_id = wd.worker_id
  JOIN public.directories dt ON dt.id = wd.document_type_id
  CROSS JOIN (VALUES (30), (14), (3)) AS t(days)
  WHERE wd.status = 'verified' AND wd.valid_until IS NOT NULL AND w.status <> 'not_working'
    AND wd.valid_until >= current_date AND wd.valid_until - current_date <= t.days
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;

  INSERT INTO public.staff_tasks (org_id, assignee_id, assignee_role, kind, title, due_date, related_type, related_id)
  SELECT wd.org_id, w.recruiter_id, 'recruiter', 'patent_tax_due',
         'Подходит срок оплаты налога по патенту: ' || w.full_name, wd.paid_until, 'worker_documents', wd.id
  FROM public.worker_documents wd
  JOIN public.workers w ON w.user_id = wd.worker_id
  JOIN public.directories dt ON dt.id = wd.document_type_id AND dt.code = 'patent'
  WHERE wd.paid_until IS NOT NULL AND w.status <> 'not_working'
    AND wd.paid_until >= current_date AND wd.paid_until - current_date <= 7
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.generate_document_tasks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.generate_document_tasks() TO service_role;

-- ============================================================
-- 7. Доступ
-- ============================================================
CREATE OR REPLACE FUNCTION private.candidate_in_scope(_candidate_id uuid, _action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.candidates c
    WHERE c.id = _candidate_id AND private.row_in_scope(c.org_id, 'candidates', _action, ARRAY[c.recruiter_id])
  )
$$;

REVOKE EXECUTE ON FUNCTION private.candidate_in_scope(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.candidate_in_scope(uuid, text) TO authenticated, service_role;

ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.candidates, public.candidate_positions, public.candidate_activities, public.candidate_documents,
  public.staff_tasks, public.worker_groups FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.candidates TO authenticated;
GRANT UPDATE (full_name, phone, city, district, citizenship, experience, birth_date, tax_status, source_id, referrer_id,
              recruiter_id, stage, reject_reason_id, next_contact_at, next_contact_note) ON public.candidates TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.candidate_positions TO authenticated;
GRANT SELECT, INSERT ON public.candidate_activities TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.candidate_documents TO authenticated;
GRANT UPDATE (issued_on, valid_until, paid_until, file_path, status, verified_by, verified_at) ON public.candidate_documents TO authenticated;
GRANT SELECT ON public.staff_tasks TO authenticated;
GRANT UPDATE (done_at, done_by) ON public.staff_tasks TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.worker_groups TO authenticated;
GRANT ALL ON public.candidates, public.candidate_positions, public.candidate_activities, public.candidate_documents,
  public.staff_tasks, public.worker_groups TO service_role;

CREATE POLICY "Candidates: view" ON public.candidates FOR SELECT TO authenticated
  USING (private.row_in_scope(org_id, 'candidates', 'view', ARRAY[recruiter_id]));
CREATE POLICY "Candidates: create" ON public.candidates FOR INSERT TO authenticated
  WITH CHECK (private.row_in_scope(org_id, 'candidates', 'create', ARRAY[recruiter_id]) AND stage = 'new' AND admitted_worker_id IS NULL);
CREATE POLICY "Candidates: update" ON public.candidates FOR UPDATE TO authenticated
  USING (private.row_in_scope(org_id, 'candidates', 'update', ARRAY[recruiter_id]))
  WITH CHECK (private.row_in_scope(org_id, 'candidates', 'update', ARRAY[recruiter_id]) AND stage <> 'admitted');
CREATE POLICY "Candidates: delete" ON public.candidates FOR DELETE TO authenticated
  USING (private.row_in_scope(org_id, 'candidates', 'delete', ARRAY[recruiter_id]));

CREATE POLICY "Candidate positions: view" ON public.candidate_positions FOR SELECT TO authenticated
  USING (private.candidate_in_scope(candidate_id, 'view'));
CREATE POLICY "Candidate positions: add" ON public.candidate_positions FOR INSERT TO authenticated
  WITH CHECK (private.candidate_in_scope(candidate_id, 'update'));
CREATE POLICY "Candidate positions: remove" ON public.candidate_positions FOR DELETE TO authenticated
  USING (private.candidate_in_scope(candidate_id, 'update'));

CREATE POLICY "Candidate activities: view" ON public.candidate_activities FOR SELECT TO authenticated
  USING (private.candidate_in_scope(candidate_id, 'view'));
CREATE POLICY "Candidate activities: add" ON public.candidate_activities FOR INSERT TO authenticated
  WITH CHECK (private.candidate_in_scope(candidate_id, 'update'));

CREATE POLICY "Candidate documents: view" ON public.candidate_documents FOR SELECT TO authenticated
  USING (private.candidate_in_scope(candidate_id, 'view'));
CREATE POLICY "Candidate documents: add" ON public.candidate_documents FOR INSERT TO authenticated
  WITH CHECK (status = 'uploaded' AND private.candidate_in_scope(candidate_id, 'update'));
CREATE POLICY "Candidate documents: edit" ON public.candidate_documents FOR UPDATE TO authenticated
  USING (private.candidate_in_scope(candidate_id, 'update'))
  WITH CHECK (private.candidate_in_scope(candidate_id, 'update'));
CREATE POLICY "Candidate documents: remove" ON public.candidate_documents FOR DELETE TO authenticated
  USING (status <> 'verified' AND private.candidate_in_scope(candidate_id, 'update'));

-- Задачи: назначенному, а при роли без конкретного человека — всем с этой ролью; руководителю и администратору — все.
CREATE POLICY "Tasks: view" ON public.staff_tasks FOR SELECT TO authenticated
  USING (
    assignee_id = auth.uid()
    OR (assignee_role IS NOT NULL AND private.has_org_role(auth.uid(), assignee_role, org_id))
    OR private.has_org_role(auth.uid(), 'director', org_id)
    OR private.has_org_role(auth.uid(), 'admin', org_id)
  );
CREATE POLICY "Tasks: mark done" ON public.staff_tasks FOR UPDATE TO authenticated
  USING (assignee_id = auth.uid() OR (assignee_role IS NOT NULL AND private.has_org_role(auth.uid(), assignee_role, org_id))
         OR private.has_org_role(auth.uid(), 'director', org_id))
  WITH CHECK (done_by = auth.uid());

CREATE POLICY "Worker groups: view" ON public.worker_groups FOR SELECT TO authenticated
  USING (private.row_in_scope(org_id, 'workers', 'view', ARRAY[worker_id]));
CREATE POLICY "Worker groups: add" ON public.worker_groups FOR INSERT TO authenticated
  WITH CHECK (private.row_in_scope(org_id, 'workers', 'update', ARRAY[worker_id]));
CREATE POLICY "Worker groups: remove" ON public.worker_groups FOR DELETE TO authenticated
  USING (private.row_in_scope(org_id, 'workers', 'update', ARRAY[worker_id]));

-- ============================================================
-- 8. Номера документов и реквизиты: ввод и просмотр с записью в журнал
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_document_number(_table text, _id uuid, _number text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _org uuid;
  _subject uuid;
  _allowed boolean;
BEGIN
  IF _table = 'worker_documents' THEN
    SELECT org_id, worker_id INTO _org, _subject FROM public.worker_documents WHERE id = _id;
    _allowed := private.row_in_scope(_org, 'worker_documents', 'update', ARRAY[_subject]);
  ELSIF _table = 'candidate_documents' THEN
    SELECT org_id, candidate_id INTO _org, _subject FROM public.candidate_documents WHERE id = _id;
    _allowed := private.candidate_in_scope(_subject, 'update');
  ELSE
    RAISE EXCEPTION 'Неизвестная таблица документов' USING ERRCODE = '22023';
  END IF;
  IF _org IS NULL OR auth.uid() IS NULL OR NOT coalesce(_allowed, false) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Укажите номер документа' USING ERRCODE = '22023';
  END IF;

  EXECUTE format('UPDATE public.%I SET number_encrypted = $1, number_masked = $2 WHERE id = $3', _table)
    USING private.pii_encrypt(btrim(_number)), private.mask_value(_number), _id;
END;
$$;

-- Полный номер — по запросу, и каждый запрос остаётся в журнале доступа (Н-8).
CREATE OR REPLACE FUNCTION public.reveal_document_number(_table text, _id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _org uuid;
  _subject uuid;
  _enc bytea;
  _allowed boolean;
BEGIN
  IF _table = 'worker_documents' THEN
    SELECT org_id, worker_id, number_encrypted INTO _org, _subject, _enc FROM public.worker_documents WHERE id = _id;
    _allowed := private.row_in_scope(_org, 'worker_documents', 'view', ARRAY[_subject]);
  ELSIF _table = 'candidate_documents' THEN
    SELECT org_id, candidate_id, number_encrypted INTO _org, _subject, _enc FROM public.candidate_documents WHERE id = _id;
    _allowed := private.candidate_in_scope(_subject, 'view') AND private.permission_scope(auth.uid(), _org, 'worker_documents', 'view') <> 'none';
  ELSE
    RAISE EXCEPTION 'Неизвестная таблица документов' USING ERRCODE = '22023';
  END IF;
  IF _org IS NULL OR auth.uid() IS NULL OR NOT coalesce(_allowed, false) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF _enc IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.audit_log (org_id, actor_id, action, table_name, record_id, field, note)
  VALUES (_org, auth.uid(), 'view', _table, _id::text, 'number', 'открыт полный номер документа');
  RETURN private.pii_decrypt(_enc);
END;
$$;

-- ИНН, СНИЛС и реквизиты выплаты. Право определяется полем: реквизиты и ИНН — модуль
-- «реквизиты и налоговый статус», СНИЛС — модуль «документы».
CREATE OR REPLACE FUNCTION private.secret_module(_field text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT CASE _field WHEN 'inn' THEN 'worker_payout_details' WHEN 'payout' THEN 'worker_payout_details' WHEN 'snils' THEN 'worker_documents' END $$;

CREATE OR REPLACE FUNCTION private.secret_owner_org(_subject_type text, _subject_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT CASE _subject_type
    WHEN 'worker' THEN (SELECT org_id FROM public.workers WHERE user_id = _subject_id)
    WHEN 'candidate' THEN (SELECT org_id FROM public.candidates WHERE id = _subject_id)
  END
$$;

CREATE OR REPLACE FUNCTION public.set_person_secret(_subject_type text, _subject_id uuid, _field text, _value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _org uuid := private.secret_owner_org(_subject_type, _subject_id);
  _module text := private.secret_module(_field);
  _allowed boolean;
BEGIN
  IF _module IS NULL THEN RAISE EXCEPTION 'Неизвестное поле' USING ERRCODE = '22023'; END IF;
  IF _subject_type = 'candidate' THEN
    _allowed := private.candidate_in_scope(_subject_id, 'update');
  ELSE
    _allowed := private.row_in_scope(_org, _module, 'update', ARRAY[_subject_id]);
  END IF;
  IF _org IS NULL OR auth.uid() IS NULL OR NOT coalesce(_allowed, false) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(_value, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Значение не может быть пустым' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.person_secrets (subject_type, subject_id, org_id) VALUES (_subject_type, _subject_id, _org)
  ON CONFLICT DO NOTHING;
  EXECUTE format('UPDATE public.person_secrets SET %I = $1, %I = $2, updated_at = now() WHERE subject_type = $3 AND subject_id = $4',
                 _field || '_encrypted', _field || '_masked')
    USING private.pii_encrypt(btrim(_value)), private.mask_value(_value), _subject_type, _subject_id;

  INSERT INTO public.audit_log (org_id, actor_id, action, table_name, record_id, field, note)
  VALUES (_org, auth.uid(), 'update', 'person_secrets', _subject_id::text, _field, 'значение изменено');
END;
$$;

CREATE OR REPLACE FUNCTION public.reveal_person_secret(_subject_type text, _subject_id uuid, _field text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _org uuid := private.secret_owner_org(_subject_type, _subject_id);
  _module text := private.secret_module(_field);
  _enc bytea;
BEGIN
  IF _module IS NULL THEN RAISE EXCEPTION 'Неизвестное поле' USING ERRCODE = '22023'; END IF;
  IF _org IS NULL OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org, _module, 'view') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  EXECUTE format('SELECT %I FROM public.person_secrets WHERE subject_type = $1 AND subject_id = $2', _field || '_encrypted')
    INTO _enc USING _subject_type, _subject_id;
  IF _enc IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.audit_log (org_id, actor_id, action, table_name, record_id, field, note)
  VALUES (_org, auth.uid(), 'view', 'person_secrets', _subject_id::text, _field, 'открыто значение');
  RETURN private.pii_decrypt(_enc);
END;
$$;

-- Маски для интерфейса: что заполнено, без самих значений.
CREATE OR REPLACE FUNCTION public.person_secret_masks(_subject_type text, _subject_id uuid)
RETURNS TABLE (field text, masked text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _org uuid := private.secret_owner_org(_subject_type, _subject_id);
BEGIN
  IF _org IS NULL OR auth.uid() IS NULL OR NOT (
       private.permission_scope(auth.uid(), _org, 'worker_payout_details', 'view') <> 'none'
       OR (_subject_type = 'candidate' AND private.candidate_in_scope(_subject_id, 'view'))) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT 'inn', s.inn_masked FROM public.person_secrets s WHERE s.subject_type = _subject_type AND s.subject_id = _subject_id AND s.inn_masked IS NOT NULL
    UNION ALL SELECT 'snils', s.snils_masked FROM public.person_secrets s WHERE s.subject_type = _subject_type AND s.subject_id = _subject_id AND s.snils_masked IS NOT NULL
    UNION ALL SELECT 'payout', s.payout_masked FROM public.person_secrets s WHERE s.subject_type = _subject_type AND s.subject_id = _subject_id AND s.payout_masked IS NOT NULL;
END;
$$;

-- ============================================================
-- 9. Чек-лист допуска и допуск (Н-6, Н-9, Н-10)
-- ============================================================
CREATE OR REPLACE FUNCTION private.candidate_checklist(_candidate_id uuid)
RETURNS TABLE (code text, label text, done boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  c public.candidates;
  foreign_person boolean;
  doc_ok text[];
  needs_medical boolean;
BEGIN
  SELECT * INTO c FROM public.candidates WHERE id = _candidate_id;
  IF NOT FOUND THEN RETURN; END IF;
  foreign_person := private.is_foreign(c.citizenship);

  -- Проверенные документы, действующие сейчас (патент ещё и с оплаченным налогом).
  SELECT coalesce(array_agg(DISTINCT dt.code), ARRAY[]::text[]) INTO doc_ok
  FROM public.candidate_documents d JOIN public.directories dt ON dt.id = d.document_type_id
  WHERE d.candidate_id = _candidate_id AND d.status = 'verified'
    AND (d.valid_until IS NULL OR d.valid_until >= current_date)
    AND (dt.code <> 'patent' OR (d.paid_until IS NOT NULL AND d.paid_until >= current_date));

  SELECT EXISTS (
    SELECT 1 FROM public.position_required_documents prd
    JOIN public.directories dt ON dt.id = prd.document_type_id AND dt.code = 'medical_book'
    JOIN public.candidate_positions cp ON cp.position_id = prd.position_id AND cp.candidate_id = _candidate_id
  ) INTO needs_medical;

  code := 'citizenship'; label := 'Указано гражданство'; done := nullif(btrim(coalesce(c.citizenship, '')), '') IS NOT NULL; RETURN NEXT;
  code := 'tax_status'; label := 'Выбран налоговый статус'; done := c.tax_status IS NOT NULL; RETURN NEXT;
  code := 'passport'; label := 'Паспорт проверен'; done := 'passport' = ANY (doc_ok); RETURN NEXT;
  code := 'inn'; label := 'ИНН проверен'; done := 'inn' = ANY (doc_ok); RETURN NEXT;
  code := 'snils'; label := 'СНИЛС проверен'; done := 'snils' = ANY (doc_ok); RETURN NEXT;
  IF foreign_person THEN
    code := 'patent_or_rvp'; label := 'Патент с оплаченным налогом или РВП/ВНЖ проверен';
    done := 'patent' = ANY (doc_ok) OR 'residence_permit' = ANY (doc_ok); RETURN NEXT;
  END IF;
  IF needs_medical THEN
    code := 'medical_book'; label := 'Медицинская книжка проверена (нужна выбранным позициям)'; done := 'medical_book' = ANY (doc_ok); RETURN NEXT;
  END IF;
  code := 'pd_consent'; label := 'Согласие на обработку персональных данных'; done := 'pd_consent' = ANY (doc_ok); RETURN NEXT;
  code := 'contract'; label := 'Договор или принятие оферты'; done := 'contract' = ANY (doc_ok); RETURN NEXT;
  code := 'payout'; label := 'Реквизиты выплаты указаны';
  done := EXISTS (SELECT 1 FROM public.person_secrets s WHERE s.subject_type = 'candidate' AND s.subject_id = _candidate_id AND s.payout_encrypted IS NOT NULL);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.candidate_checklist(_candidate_id uuid)
RETURNS TABLE (code text, label text, done boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.candidate_in_scope(_candidate_id, 'view') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM private.candidate_checklist(_candidate_id);
END;
$$;

-- Допуск: создаёт исполнителя из кандидата. Учётную запись заводит edge-функция admit-candidate
-- (доступ к GoTrue), затем вызывает эту функцию с идентификатором созданного пользователя.
CREATE OR REPLACE FUNCTION private.complete_admission(_candidate_id uuid, _user_id uuid, _actor uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  c public.candidates;
  missing text;
BEGIN
  SELECT * INTO c FROM public.candidates WHERE id = _candidate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Кандидат не найден' USING ERRCODE = 'P0002'; END IF;
  IF c.stage = 'admitted' THEN RAISE EXCEPTION 'Кандидат уже допущен' USING ERRCODE = '22023'; END IF;

  SELECT string_agg(label, '; ') INTO missing FROM private.candidate_checklist(_candidate_id) WHERE NOT done;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Допуск невозможен, не закрыто: %', missing USING ERRCODE = '22023';
  END IF;

  -- Новая учётная запись получила роль в организации по умолчанию; переносим в организацию кандидата.
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'worker') THEN
    INSERT INTO public.user_roles (user_id, role, org_id) VALUES (_user_id, 'worker', c.org_id);
  END IF;
  UPDATE public.user_roles SET org_id = c.org_id WHERE user_id = _user_id AND role = 'worker' AND org_id <> c.org_id;

  INSERT INTO public.workers (user_id, org_id, full_name, phone, city, citizenship, birth_date, tax_status, status,
                              recruiter_id, source_id, referrer_id, admitted_at)
  VALUES (_user_id, c.org_id, c.full_name, c.phone, c.city, c.citizenship, c.birth_date, c.tax_status, 'active',
          c.recruiter_id, c.source_id, c.referrer_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET org_id = EXCLUDED.org_id, full_name = EXCLUDED.full_name, phone = EXCLUDED.phone, city = EXCLUDED.city,
        citizenship = EXCLUDED.citizenship, birth_date = EXCLUDED.birth_date, tax_status = EXCLUDED.tax_status,
        status = 'active', recruiter_id = EXCLUDED.recruiter_id, source_id = EXCLUDED.source_id,
        referrer_id = EXCLUDED.referrer_id, admitted_at = EXCLUDED.admitted_at;

  INSERT INTO public.worker_positions (org_id, worker_id, position_id)
  SELECT c.org_id, _user_id, cp.position_id FROM public.candidate_positions cp WHERE cp.candidate_id = _candidate_id
  ON CONFLICT DO NOTHING;

  INSERT INTO public.worker_documents (org_id, worker_id, document_type_id, number_masked, number_encrypted, issued_on,
                                       valid_until, paid_until, file_path, status, verified_by, verified_at)
  SELECT c.org_id, _user_id, d.document_type_id, d.number_masked, d.number_encrypted, d.issued_on,
         d.valid_until, d.paid_until, d.file_path, d.status, d.verified_by, d.verified_at
  FROM public.candidate_documents d WHERE d.candidate_id = _candidate_id AND d.status = 'verified';

  UPDATE public.person_secrets SET subject_type = 'worker', subject_id = _user_id
   WHERE subject_type = 'candidate' AND subject_id = _candidate_id;

  UPDATE public.candidates SET stage = 'admitted', admitted_worker_id = _user_id WHERE id = _candidate_id;

  -- Иностранец: уведомить МВД в течение 3 рабочих дней (Н-10). Интеграции с МВД нет, только контроль срока.
  IF private.is_foreign(c.citizenship) THEN
    INSERT INTO public.staff_tasks (org_id, assignee_id, assignee_role, kind, title, due_date, related_type, related_id)
    VALUES (c.org_id, c.recruiter_id, 'recruiter', 'mvd_admission', 'Уведомить МВД о начале работы: ' || c.full_name,
            private.add_working_days(current_date, 3, c.org_id), 'workers', _user_id)
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.audit_log (org_id, actor_id, action, table_name, record_id, field, new_value, note)
  VALUES (c.org_id, _actor, 'update', 'candidates', _candidate_id::text, 'stage', 'admitted', 'кандидат допущен, создан исполнитель');
  RETURN _user_id;
END;
$$;

-- Проверка допуска для интерфейса и для edge-функции: что мешает (пусто — можно допускать).
CREATE OR REPLACE FUNCTION public.check_admission(_candidate_id uuid)
RETURNS TABLE (label text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.candidate_in_scope(_candidate_id, 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT c.label FROM private.candidate_checklist(_candidate_id) c WHERE NOT c.done;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.complete_admission(uuid, uuid, uuid), private.candidate_checklist(uuid),
  private.secret_owner_org(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.complete_admission(uuid, uuid, uuid), private.candidate_checklist(uuid),
  private.secret_owner_org(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION private.secret_module(text) TO authenticated, service_role;

-- ============================================================
-- 10. Дубли, слияние, списки активации, рефералы
-- ============================================================
CREATE OR REPLACE FUNCTION public.find_duplicates(_org_id uuid, _phone text)
RETURNS TABLE (kind text, id uuid, full_name text, phone text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _key text := nullif(right(regexp_replace(coalesce(_phone, ''), '\D', '', 'g'), 10), '');
BEGIN
  IF auth.uid() IS NULL OR _key IS NULL
     OR private.permission_scope(auth.uid(), _org_id, 'candidates', 'view') = 'none' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT 'candidate', c.id, c.full_name, c.phone FROM public.candidates c WHERE c.org_id = _org_id AND c.phone_key = _key
    UNION ALL
    SELECT 'worker', w.user_id, w.full_name, w.phone FROM public.workers w
     WHERE w.org_id = _org_id AND right(regexp_replace(coalesce(w.phone, ''), '\D', '', 'g'), 10) = _key;
END;
$$;

-- Слияние двух карточек кандидата: касания, документы и позиции переходят к оставляемой.
CREATE OR REPLACE FUNCTION public.merge_candidates(_keep uuid, _drop uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF _keep = _drop THEN RAISE EXCEPTION 'Нельзя слить карточку с самой собой' USING ERRCODE = '22023'; END IF;
  IF auth.uid() IS NULL OR NOT (private.candidate_in_scope(_keep, 'update') AND private.candidate_in_scope(_drop, 'delete')) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF (SELECT org_id FROM public.candidates WHERE id = _keep) IS DISTINCT FROM (SELECT org_id FROM public.candidates WHERE id = _drop) THEN
    RAISE EXCEPTION 'Карточки из разных организаций слить нельзя' USING ERRCODE = '22023';
  END IF;

  UPDATE public.candidate_activities SET candidate_id = _keep WHERE candidate_id = _drop;
  UPDATE public.candidate_documents SET candidate_id = _keep WHERE candidate_id = _drop;
  INSERT INTO public.candidate_positions (org_id, candidate_id, position_id)
    SELECT org_id, _keep, position_id FROM public.candidate_positions WHERE candidate_id = _drop ON CONFLICT DO NOTHING;
  DELETE FROM public.person_secrets WHERE subject_type = 'candidate' AND subject_id = _drop
    AND EXISTS (SELECT 1 FROM public.person_secrets k WHERE k.subject_type = 'candidate' AND k.subject_id = _keep);
  UPDATE public.person_secrets SET subject_id = _keep WHERE subject_type = 'candidate' AND subject_id = _drop;
  DELETE FROM public.candidates WHERE id = _drop;
END;
$$;

-- Списки для обзвона (Н-14): «допущен, но ни одной смены за 14 дней» и «не выходил 30 дней».
CREATE OR REPLACE FUNCTION public.worker_activation_list(_org_id uuid, _kind text)
RETURNS TABLE (worker_id uuid, full_name text, phone text, admitted_at timestamptz, last_shift_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'workers', 'view') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF _kind NOT IN ('no_shift_14', 'idle_30') THEN
    RAISE EXCEPTION 'Неизвестный список' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT w.user_id, w.full_name, w.phone, w.admitted_at,
         (SELECT max(a.shift_start) FROM public.assignments a WHERE a.worker_id = w.user_id AND a.status IN ('worked', 'on_site'))
  FROM public.workers w
  WHERE w.org_id = _org_id AND w.status = 'active'
    AND CASE _kind
      WHEN 'no_shift_14' THEN coalesce(w.admitted_at, w.created_at) < now() - interval '14 days'
        AND NOT EXISTS (SELECT 1 FROM public.assignments a WHERE a.worker_id = w.user_id AND a.status IN ('assigned', 'confirmed', 'on_site', 'worked'))
      ELSE coalesce(w.admitted_at, w.created_at) < now() - interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM public.assignments a WHERE a.worker_id = w.user_id AND a.status IN ('worked', 'on_site') AND a.shift_start > now() - interval '30 days')
    END
  ORDER BY w.full_name;
END;
$$;

-- Реферальный отчёт (Н-15): приведённые, отработавшие 5 смен, — основание для бонуса.
CREATE OR REPLACE FUNCTION public.referral_report(_org_id uuid)
RETURNS TABLE (referrer_id uuid, referrer_name text, referred_id uuid, referred_name text, shifts_worked integer, qualifies boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'workers', 'view') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT r.user_id, r.full_name, w.user_id, w.full_name,
         (SELECT count(*)::integer FROM public.assignments a WHERE a.worker_id = w.user_id AND a.status = 'worked'),
         (SELECT count(*) FROM public.assignments a WHERE a.worker_id = w.user_id AND a.status = 'worked') >= 5
  FROM public.workers w JOIN public.workers r ON r.user_id = w.referrer_id
  WHERE w.org_id = _org_id
  ORDER BY r.full_name, w.full_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_document_number(text, uuid, text), public.reveal_document_number(text, uuid),
  public.set_person_secret(text, uuid, text, text), public.reveal_person_secret(text, uuid, text),
  public.person_secret_masks(text, uuid), public.candidate_checklist(uuid), public.check_admission(uuid),
  public.find_duplicates(uuid, text), public.merge_candidates(uuid, uuid), public.worker_activation_list(uuid, text),
  public.referral_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_document_number(text, uuid, text), public.reveal_document_number(text, uuid),
  public.set_person_secret(text, uuid, text, text), public.reveal_person_secret(text, uuid, text),
  public.person_secret_masks(text, uuid), public.candidate_checklist(uuid), public.check_admission(uuid),
  public.find_duplicates(uuid, text), public.merge_candidates(uuid, uuid), public.worker_activation_list(uuid, text),
  public.referral_report(uuid) TO authenticated, service_role;

-- ============================================================
-- 11. Файлы документов: закрытое хранилище
-- ============================================================
-- Путь: <организация>/<candidate|worker>/<идентификатор>/<файл>. Читать и грузить могут сотрудники
-- с правом на документы во всей организации; исполнитель — в своей папке. Ссылки выдаются временные.
INSERT INTO storage.buckets (id, name, public) VALUES ('person-documents', 'person-documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.person_file_allowed(_name text, _action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT CASE
    WHEN (storage.foldername(_name))[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN false
    WHEN (storage.foldername(_name))[2] = 'worker' AND (storage.foldername(_name))[3] = auth.uid()::text THEN true
    ELSE private.permission_scope(auth.uid(), ((storage.foldername(_name))[1])::uuid, 'worker_documents', _action) = 'all'
  END
$$;

REVOKE EXECUTE ON FUNCTION private.person_file_allowed(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.person_file_allowed(text, text) TO authenticated, service_role;

CREATE POLICY "Person documents: read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'person-documents' AND private.person_file_allowed(name, 'view'));
CREATE POLICY "Person documents: upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'person-documents' AND private.person_file_allowed(name, 'create'));
CREATE POLICY "Person documents: delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'person-documents' AND private.person_file_allowed(name, 'update'));

-- ============================================================
-- 12. Вызов допуска из edge-функции
-- ============================================================
-- PostgREST отдаёт только схему public, поэтому серверная функция допуска получает обёртку, доступную
-- одному service_role: edge-функция admit-candidate вызывает её после создания учётной записи.
CREATE OR REPLACE FUNCTION public.admit_candidate_internal(_candidate_id uuid, _user_id uuid, _actor uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, private
AS $$ SELECT private.complete_admission(_candidate_id, _user_id, _actor) $$;

REVOKE EXECUTE ON FUNCTION public.admit_candidate_internal(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_candidate_internal(uuid, uuid, uuid) TO service_role;
