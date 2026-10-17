-- Служебные оповещения: сервер сообщает администратору и руководителю о сбоях (упал бэкап, мало места, сайт не отвечает).
INSERT INTO public.notification_events (code, title, channels, delivery, critical, audience) VALUES
  ('ops_alert', 'Сбой на сервере', ARRAY['max', 'push'], 'all', true, 'администратор, руководитель');

-- Вызывается из deploy/scripts/ops-check.sh: одно оповещение на вид сбоя в сутки каждому администратору и руководителю.
CREATE OR REPLACE FUNCTION private.ops_alert(_kind text, _title text, _body text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN SELECT DISTINCT ur.user_id, ur.org_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'director') AND private.is_user_active(ur.user_id) LOOP
    IF private.notify(r.org_id, r.user_id, 'ops_alert', _title, _body, NULL, 'ops:' || _kind || ':' || current_date) IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.ops_alert(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.ops_alert(text, text, text) TO service_role;
