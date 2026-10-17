-- Журнал ошибок интерфейса (ТЗ, раздел 19: ошибки фронта собираются в лог). Браузер сообщает об упавшей странице и необработанных ошибках;
-- администратор и руководитель смотрят журнал и видят, на какой странице и у кого сломалось.
CREATE TABLE public.client_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  role text,
  message text NOT NULL,
  stack text,
  url text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX client_errors_created_idx ON public.client_errors (created_at DESC);
ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_errors FROM anon, authenticated;
GRANT SELECT ON public.client_errors TO authenticated;
GRANT ALL ON public.client_errors TO service_role;
CREATE POLICY "Client errors: admins view" ON public.client_errors FOR SELECT TO authenticated
  USING (org_id IS NOT NULL AND (private.has_org_role(auth.uid(), 'admin', org_id) OR private.has_org_role(auth.uid(), 'director', org_id)));

-- Только вошедший пользователь; один и тот же текст от одного человека не чаще раза в минуту; тексты обрезаются.
CREATE OR REPLACE FUNCTION public.log_client_error(_message text, _stack text DEFAULT NULL, _url text DEFAULT NULL, _user_agent text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  uid uuid := auth.uid();
  msg text := left(coalesce(nullif(btrim(_message), ''), 'без текста'), 500);
  org uuid;
BEGIN
  IF uid IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.client_errors e WHERE e.user_id = uid AND e.message = msg AND e.created_at > now() - interval '1 minute') THEN RETURN; END IF;
  SELECT ur.org_id INTO org FROM public.user_roles ur WHERE ur.user_id = uid ORDER BY ur.created_at LIMIT 1;
  INSERT INTO public.client_errors (org_id, user_id, role, message, stack, url, user_agent)
  VALUES (org, uid, (SELECT string_agg(ur.role::text, ',') FROM public.user_roles ur WHERE ur.user_id = uid), msg, left(_stack, 4000), left(_url, 500), left(_user_agent, 300));
  -- Журнал не растёт бесконечно: записи старше 60 дней удаляются при очередной записи
  DELETE FROM public.client_errors WHERE created_at < now() - interval '60 days';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_client_error(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_client_error(text, text, text, text) TO authenticated, service_role;
