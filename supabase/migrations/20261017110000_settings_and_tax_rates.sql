-- Этап 1, шаг 2: настройки и правила, которые зависят от ответов клиента.
-- ТЗ: раздел 6 (системные настройки), раздел 11 (налоговые статусы), раздел 21.
--
-- Принцип: значение, которое клиент может уточнить, живёт в данных, а не в коде.
-- Настройка версионируется датой вступления в силу и не пересчитывает прошлое:
-- задним числом менять нельзя, правка делается новой записью с датой не раньше сегодняшней.
-- Это же защищает начисления: ставки копируются в смену при её создании (раздел 4).
--
-- Не входит в этот шаг и придёт позже: обязательные документы по должностям
-- (нужны positions — шаг 5 и document_types — шаг 8) и праздничные дни (справочник, шаг 3).

-- ============================================================
-- 1. Каталог настроек: что можно настраивать и значение по умолчанию
-- ============================================================
CREATE TABLE public.setting_definitions (
  key text PRIMARY KEY,
  group_name text NOT NULL,
  label text NOT NULL,
  description text,
  value_type text NOT NULL CHECK (value_type IN ('number', 'time', 'text', 'boolean', 'json')),
  default_value jsonb NOT NULL,
  nullable boolean NOT NULL DEFAULT false,
  unit text,
  min_value numeric,
  max_value numeric,
  allowed_values jsonb,
  -- На каких уровнях значение можно переопределить: организация, заказчик, объект.
  levels text[] NOT NULL DEFAULT ARRAY['org'],
  -- Значение предложено в ТЗ, но клиент его ещё не подтвердил (раздел 21).
  needs_confirmation boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT setting_levels_valid CHECK (levels <@ ARRAY['org', 'client', 'site']::text[] AND 'org' = ANY (levels)),
  CONSTRAINT setting_default_matches_type CHECK (
    (default_value = 'null'::jsonb AND nullable)
    OR (value_type = 'number' AND jsonb_typeof(default_value) = 'number')
    OR (value_type IN ('time', 'text') AND jsonb_typeof(default_value) = 'string')
    OR (value_type = 'boolean' AND jsonb_typeof(default_value) = 'boolean')
    OR value_type = 'json'
  )
);

INSERT INTO public.setting_definitions
  (key, group_name, label, description, value_type, default_value, nullable, unit, min_value, max_value, allowed_values, levels, needs_confirmation, sort_order)
VALUES
  -- Смены и табель
  ('timesheet.autoconfirm_hours', 'Табель', 'Автоподтверждение табеля', 'Через сколько часов табель подтверждается сам, если заказчик не ответил', 'number', '48', false, 'ч', 1, 720, NULL, ARRAY['org','client'], true, 10),
  ('hours.rounding_minutes', 'Табель', 'Округление отработанного времени', 'Шаг округления; 0 — без округления', 'number', '15', false, 'мин', 0, 60, NULL, ARRAY['org','client','site'], false, 20),
  ('hours.rounding_mode', 'Табель', 'Направление округления', 'down — вниз, up — вверх, nearest — к ближайшему', 'text', '"down"', false, NULL, NULL, NULL, '["down","up","nearest"]', ARRAY['org','client','site'], false, 21),
  ('checkin.late_tolerance_min', 'Табель', 'Допуск опоздания', 'Опоздание в пределах допуска не снимает часы', 'number', '10', false, 'мин', 0, 120, NULL, ARRAY['org','client','site'], false, 30),
  ('checkin.geo_radius_m', 'Табель', 'Радиус отметки по геолокации', 'Отметка вне радиуса отклоняется', 'number', '200', false, 'м', 20, 5000, NULL, ARRAY['org','site'], false, 40),
  ('schedule.min_rest_hours', 'Планирование', 'Минимальный отдых между сменами', 'Исполнителя нельзя назначить, если до начала смены отдыхал меньше', 'number', '8', false, 'ч', 0, 48, NULL, ARRAY['org','site'], false, 50),
  -- Уведомления
  ('notify.worker_reminder_time', 'Уведомления', 'Напоминание исполнителю накануне смены', NULL, 'time', '"18:00"', false, NULL, NULL, NULL, NULL, ARRAY['org','site'], false, 60),
  ('notify.confirm_deadline_time', 'Уведомления', 'Срок подтверждения выхода', 'После этого времени менеджер получает список не подтвердивших', 'time', '"21:00"', false, NULL, NULL, NULL, NULL, ARRAY['org','site'], false, 61),
  ('notify.quiet_from', 'Уведомления', 'Не беспокоить исполнителей с', 'Кроме срочных замен', 'time', '"22:00"', false, NULL, NULL, NULL, NULL, ARRAY['org'], false, 62),
  ('notify.quiet_to', 'Уведомления', 'Не беспокоить исполнителей до', NULL, 'time', '"08:00"', false, NULL, NULL, NULL, NULL, ARRAY['org'], false, 63),
  ('notify.channels', 'Уведомления', 'Каналы уведомлений', 'app — в системе, max — MAX, email — почта, sms — SMS', 'json', '["app","max","email"]', false, NULL, NULL, NULL, NULL, ARRAY['org'], false, 64),
  -- Отмены
  ('cancel.worker_free_hours', 'Отмены', 'Исполнитель отменяет без последствий за', 'Позже — только через менеджера, отмена считается поздней и влияет на рейтинг', 'number', '12', false, 'ч', 0, 168, NULL, ARRAY['org','client','site'], true, 70),
  ('cancel.client_free_hours', 'Отмены', 'Заказчик отменяет бесплатно за', 'Пусто — оплачиваемой отмены нет. Срок обычно задаёт договор', 'number', 'null', true, 'ч', 0, 720, NULL, ARRAY['org','client'], true, 71),
  ('cancel.client_paid_pct', 'Отмены', 'Доля оплаты при поздней отмене заказчиком', 'Пусто — оплачиваемой отмены нет', 'number', 'null', true, '%', 0, 100, NULL, ARRAY['org','client'], true, 72),
  -- Деньги
  ('tariff.min_margin_pct', 'Деньги', 'Минимальная маржа тарифа без согласования', 'Тариф ниже порога уходит на согласование руководителю', 'number', '20', false, '%', 0, 100, NULL, ARRAY['org'], true, 80),
  ('accrual.deduction_approval_pct', 'Деньги', 'Удержание, требующее согласования', 'Удержание больше этой доли начисления за смену согласует руководитель', 'number', '30', false, '%', 0, 100, NULL, ARRAY['org'], false, 81),
  -- Рейтинг исполнителя
  ('rating.window_days', 'Рейтинг', 'Окно расчёта рейтинга', NULL, 'number', '90', false, 'дн', 7, 730, NULL, ARRAY['org'], true, 90),
  ('rating.penalty_no_show', 'Рейтинг', 'Штраф за неявку', 'Вычитается из средней оценки за каждую неявку', 'number', '0.5', false, 'балла', 0, 5, NULL, ARRAY['org'], true, 91),
  ('rating.penalty_late_cancel', 'Рейтинг', 'Штраф за позднюю отмену', 'Вычитается из средней оценки за каждую позднюю отмену', 'number', '0.2', false, 'балла', 0, 5, NULL, ARRAY['org'], true, 92),
  ('rating.min_value', 'Рейтинг', 'Нижняя граница рейтинга', NULL, 'number', '1', false, 'балл', 0, 5, NULL, ARRAY['org'], true, 93);

ALTER TABLE public.setting_definitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.setting_definitions FROM anon, authenticated;
GRANT SELECT ON public.setting_definitions TO authenticated;
GRANT ALL ON public.setting_definitions TO service_role;

CREATE POLICY "Authenticated can read setting definitions"
  ON public.setting_definitions FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 2. Значения настроек: организация, заказчик или объект, с датой вступления в силу
-- ============================================================
CREATE TABLE public.org_settings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key text NOT NULL REFERENCES public.setting_definitions(key),
  -- Заказчики и объекты привязываются по идентификатору. Внешних ключей нет:
  -- таблица clients появится в шаге 4, а в sites ещё нет org_id (шаг 5).
  scope_type text NOT NULL DEFAULT 'org' CHECK (scope_type IN ('org', 'client', 'site')),
  scope_id uuid,
  value jsonb NOT NULL,
  effective_from date NOT NULL DEFAULT current_date,
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_settings_scope_id_matches CHECK ((scope_type = 'org') = (scope_id IS NULL)),
  CONSTRAINT org_settings_unique_version UNIQUE NULLS NOT DISTINCT (org_id, key, scope_type, scope_id, effective_from)
);

CREATE INDEX org_settings_lookup_idx ON public.org_settings (org_id, key, effective_from DESC);

-- Проверка значения по каталогу. Выполняется для всех, включая администратора.
CREATE OR REPLACE FUNCTION private.validate_org_setting()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, private
AS $$
DECLARE
  d public.setting_definitions;
  t text := jsonb_typeof(NEW.value);
BEGIN
  SELECT * INTO d FROM public.setting_definitions WHERE key = NEW.key;

  IF NOT (NEW.scope_type = ANY (d.levels)) THEN
    RAISE EXCEPTION 'Настройку «%» нельзя задать на уровне «%»', d.label, NEW.scope_type USING ERRCODE = '22023';
  END IF;

  -- Прошлое не переписываем. Ограничение для ролей API; система (миграции, стартовые значения, service_role) вправе писать любую дату.
  IF current_user IN ('authenticated', 'anon') AND NEW.effective_from < current_date THEN
    RAISE EXCEPTION 'Дата вступления в силу не может быть в прошлом' USING ERRCODE = '22023';
  END IF;

  IF t = 'null' THEN
    IF NOT d.nullable THEN
      RAISE EXCEPTION 'Настройка «%» не может быть пустой', d.label USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  IF d.value_type = 'number' THEN
    IF t <> 'number' THEN RAISE EXCEPTION 'Настройка «%» — число', d.label USING ERRCODE = '22023'; END IF;
    IF d.min_value IS NOT NULL AND (NEW.value #>> '{}')::numeric < d.min_value
       OR d.max_value IS NOT NULL AND (NEW.value #>> '{}')::numeric > d.max_value THEN
      RAISE EXCEPTION 'Настройка «%»: допустимо от % до %', d.label, d.min_value, d.max_value USING ERRCODE = '22023';
    END IF;
  ELSIF d.value_type = 'time' THEN
    IF t <> 'string' OR (NEW.value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'Настройка «%» — время в формате ЧЧ:ММ', d.label USING ERRCODE = '22023';
    END IF;
  ELSIF d.value_type = 'text' THEN
    IF t <> 'string' THEN RAISE EXCEPTION 'Настройка «%» — текст', d.label USING ERRCODE = '22023'; END IF;
    IF d.allowed_values IS NOT NULL AND NOT (d.allowed_values @> NEW.value) THEN
      RAISE EXCEPTION 'Настройка «%»: допустимо только %', d.label, d.allowed_values USING ERRCODE = '22023';
    END IF;
  ELSIF d.value_type = 'boolean' THEN
    IF t <> 'boolean' THEN RAISE EXCEPTION 'Настройка «%» — да или нет', d.label USING ERRCODE = '22023'; END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER org_settings_validate
  BEFORE INSERT ON public.org_settings
  FOR EACH ROW EXECUTE FUNCTION private.validate_org_setting();

CREATE TRIGGER audit_org_settings
  AFTER INSERT OR UPDATE OR DELETE ON public.org_settings
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes();

ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_settings FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.org_settings TO authenticated;
GRANT ALL ON public.org_settings TO service_role;

CREATE POLICY "Members can read settings of their organization"
  ON public.org_settings FOR SELECT TO authenticated
  USING (private.is_org_member(org_id));

CREATE POLICY "Org admins can add settings"
  ON public.org_settings FOR INSERT TO authenticated
  WITH CHECK (private.has_org_role(auth.uid(), 'admin', org_id));

-- Менять записи нельзя вообще (нет UPDATE). Удалить можно только запись, которая
-- ещё не вступила в силу: ошибочно заведённую на будущее.
CREATE POLICY "Org admins can delete settings not yet in force"
  ON public.org_settings FOR DELETE TO authenticated
  USING (private.has_org_role(auth.uid(), 'admin', org_id) AND effective_from > current_date);

-- Значение настройки на дату: сначала объект, затем заказчик, затем организация,
-- затем значение по умолчанию из каталога. Внутри уровня — последняя вступившая в силу запись.
CREATE OR REPLACE FUNCTION public.get_setting(
  _org_id uuid, _key text, _at date DEFAULT current_date,
  _client_id uuid DEFAULT NULL, _site_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, private
AS $$
  SELECT coalesce(
    (SELECT s.value FROM public.org_settings s
      WHERE s.org_id = _org_id AND s.key = _key AND s.effective_from <= _at
        AND (s.scope_type = 'org'
             OR (s.scope_type = 'client' AND s.scope_id = _client_id)
             OR (s.scope_type = 'site' AND s.scope_id = _site_id))
      ORDER BY CASE s.scope_type WHEN 'site' THEN 1 WHEN 'client' THEN 2 ELSE 3 END,
               s.effective_from DESC, s.id DESC
      LIMIT 1),
    (SELECT default_value FROM public.setting_definitions WHERE key = _key)
  )
$$;

CREATE OR REPLACE FUNCTION public.get_setting_numeric(
  _org_id uuid, _key text, _at date DEFAULT current_date,
  _client_id uuid DEFAULT NULL, _site_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, private
AS $$
  SELECT nullif(public.get_setting(_org_id, _key, _at, _client_id, _site_id) #>> '{}', 'null')::numeric
$$;

REVOKE EXECUTE ON FUNCTION public.get_setting(uuid, text, date, uuid, uuid),
  public.get_setting_numeric(uuid, text, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_setting(uuid, text, date, uuid, uuid),
  public.get_setting_numeric(uuid, text, date, uuid, uuid) TO authenticated, service_role;

-- ============================================================
-- 3. Налоговые статусы исполнителей: ставки с датой вступления в силу
-- ============================================================
-- К выплате исполнителю (на руки) прибавляются налоги и взносы работодателя; формулу
-- считает серверная функция начислений (шаг 10):
--   брутто = на руки / (1 − НДФЛ);  налоги = брутто − на руки + брутто × взносы;  комиссия = на руки × комиссия.
-- Значения по умолчанию взяты из примера в ТЗ и НЕ подтверждены бухгалтерией (раздел 21, вопрос 3):
-- флаг confirmed снимается, пока бухгалтер не подтвердит ставку.
CREATE TABLE public.tax_status_rates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('ip', 'self_employed', 'gph', 'employment')),
  ndfl_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (ndfl_pct >= 0 AND ndfl_pct < 100),
  contributions_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (contributions_pct >= 0 AND contributions_pct <= 100),
  payout_fee_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (payout_fee_pct >= 0 AND payout_fee_pct <= 100),
  effective_from date NOT NULL DEFAULT current_date,
  confirmed boolean NOT NULL DEFAULT false,
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, status, effective_from)
);

CREATE INDEX tax_status_rates_lookup_idx ON public.tax_status_rates (org_id, status, effective_from DESC);

CREATE OR REPLACE FUNCTION private.validate_tax_status_rate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, private
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NEW.effective_from < current_date THEN
    RAISE EXCEPTION 'Дата вступления в силу не может быть в прошлом' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tax_status_rates_validate
  BEFORE INSERT ON public.tax_status_rates
  FOR EACH ROW EXECUTE FUNCTION private.validate_tax_status_rate();

CREATE TRIGGER audit_tax_status_rates
  AFTER INSERT OR UPDATE OR DELETE ON public.tax_status_rates
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes();

ALTER TABLE public.tax_status_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tax_status_rates FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.tax_status_rates TO authenticated;
GRANT ALL ON public.tax_status_rates TO service_role;

CREATE POLICY "Members can read tax rates of their organization"
  ON public.tax_status_rates FOR SELECT TO authenticated
  USING (private.is_org_member(org_id));

-- Роль «бухгалтер» появится в шаге 3 и будет добавлена в эти политики.
CREATE POLICY "Org admins can add tax rates"
  ON public.tax_status_rates FOR INSERT TO authenticated
  WITH CHECK (private.has_org_role(auth.uid(), 'admin', org_id));

CREATE POLICY "Org admins can delete tax rates not yet in force"
  ON public.tax_status_rates FOR DELETE TO authenticated
  USING (private.has_org_role(auth.uid(), 'admin', org_id) AND effective_from > current_date);

-- Ставка на дату: последняя вступившая в силу запись для статуса.
CREATE OR REPLACE FUNCTION public.get_tax_rate(_org_id uuid, _status text, _at date DEFAULT current_date)
RETURNS public.tax_status_rates
LANGUAGE sql
STABLE
SET search_path = public, private
AS $$
  SELECT r.* FROM public.tax_status_rates r
  WHERE r.org_id = _org_id AND r.status = _status AND r.effective_from <= _at
  ORDER BY r.effective_from DESC, r.id DESC
  LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.get_tax_rate(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tax_rate(uuid, text, date) TO authenticated, service_role;

-- Стартовые ставки новой организации (и уже существующих: см. ниже). Действуют «с начала времён»,
-- чтобы начисления за прошлые периоды тоже нашли ставку.
CREATE OR REPLACE FUNCTION private.seed_org_defaults(_org_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, private
AS $$
  INSERT INTO public.tax_status_rates (org_id, status, ndfl_pct, contributions_pct, payout_fee_pct, effective_from, confirmed, note)
  VALUES
    (_org_id, 'ip',            0,  0, 0, DATE '2000-01-01', false, 'Предложено в ТЗ, подтвердить с бухгалтерией'),
    (_org_id, 'self_employed', 0,  0, 2, DATE '2000-01-01', false, 'Комиссия платформы 2% — предложено в ТЗ, подтвердить'),
    (_org_id, 'gph',          13, 30, 0, DATE '2000-01-01', false, 'НДФЛ 13% и взносы 30% — предложено в ТЗ, подтвердить'),
    (_org_id, 'employment',   13, 30, 0, DATE '2000-01-01', false, 'Ставки не заданы в ТЗ: взяты как у ГПХ, подтвердить')
  ON CONFLICT DO NOTHING
$$;

CREATE OR REPLACE FUNCTION private.organizations_seed_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  PERFORM private.seed_org_defaults(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_seed_defaults
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.organizations_seed_defaults();

REVOKE EXECUTE ON FUNCTION private.seed_org_defaults(uuid), private.organizations_seed_defaults() FROM PUBLIC, anon, authenticated;

-- Для организаций, созданных до этой миграции.
SELECT private.seed_org_defaults(id) FROM public.organizations;
