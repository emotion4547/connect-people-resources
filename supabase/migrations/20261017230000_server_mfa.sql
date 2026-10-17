-- Приёмка: обязательный MFA проверяется в БД, включая прямые RPC и RLS.
-- Без этого переход мимо MfaGate позволял читать документы и проводить начисления.
CREATE OR REPLACE FUNCTION private.session_mfa_ok(_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR auth.role() = 'service_role' THEN true
    WHEN NOT EXISTS (SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND org_id = _org_id
        AND role IN ('admin', 'director', 'accountant', 'recruiter')) THEN true
    WHEN coalesce(public.get_setting(_org_id, 'auth.mfa_enforced'), 'false'::jsonb) <> 'true'::jsonb THEN true
    ELSE coalesce(auth.jwt()->>'aal', '') = 'aal2'
  END
$$;
REVOKE ALL ON FUNCTION private.session_mfa_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.session_mfa_ok(uuid) TO authenticated, service_role;

-- Edge-функции проверяют сессию вызывающего до перехода к служебному ключу.
CREATE OR REPLACE FUNCTION public.session_mfa_ok(_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, private
AS $$ SELECT auth.uid() IS NOT NULL AND private.is_org_member(_org_id) AND private.session_mfa_ok(_org_id) $$;
REVOKE ALL ON FUNCTION public.session_mfa_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_mfa_ok(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.has_org_role(_user_id uuid, _role app_role, _org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT private.session_mfa_ok(_org_id) AND private.is_user_active(_user_id)
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role AND org_id = _org_id)
$$;

CREATE OR REPLACE FUNCTION private.permission_scope(_user_id uuid, _org_id uuid, _module text, _action text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT coalesce(
    (SELECT rp.scope
       FROM public.user_roles ur
       JOIN public.role_permissions rp
         ON rp.org_id = ur.org_id AND rp.role = ur.role AND rp.module = _module AND rp.action = _action
      WHERE ur.user_id = _user_id AND ur.org_id = _org_id AND private.is_user_active(_user_id) AND private.session_mfa_ok(_org_id)
      ORDER BY CASE rp.scope WHEN 'all' THEN 1 WHEN 'department' THEN 2 WHEN 'own' THEN 3 ELSE 4 END
      LIMIT 1),
    'none')
$$;
