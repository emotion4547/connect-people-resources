
-- 1. Private schema for SECURITY DEFINER helpers
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

ALTER FUNCTION public.has_role(uuid, app_role) SET SCHEMA private;
ALTER FUNCTION public.get_user_role(uuid) SET SCHEMA private;
ALTER FUNCTION public.hr_owns_request(uuid, uuid) SET SCHEMA private;
ALTER FUNCTION public.hr_has_worker(uuid, uuid) SET SCHEMA private;
ALTER FUNCTION public.worker_responded_to_request(uuid, uuid) SET SCHEMA private;
ALTER FUNCTION public.hr_assigned_to_site(uuid, uuid) SET SCHEMA private;
ALTER FUNCTION public.worker_assigned_to_site(uuid, uuid) SET SCHEMA private;
ALTER FUNCTION public.hr_shares_site_with_worker(uuid, uuid) SET SCHEMA private;
ALTER FUNCTION public.hr_can_rate_worker(uuid, uuid) SET SCHEMA private;

REVOKE EXECUTE ON FUNCTION private.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.get_user_role(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.hr_owns_request(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.hr_has_worker(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.worker_responded_to_request(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.hr_assigned_to_site(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.worker_assigned_to_site(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.hr_shares_site_with_worker(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.hr_can_rate_worker(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION private.get_user_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.hr_owns_request(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.hr_has_worker(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.worker_responded_to_request(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.hr_assigned_to_site(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.worker_assigned_to_site(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.hr_shares_site_with_worker(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.hr_can_rate_worker(uuid, uuid) TO authenticated;

-- 2. Harden new-user trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _meta_role text;
  _role app_role;
BEGIN
  _meta_role := NEW.raw_user_meta_data ->> 'role';
  IF _meta_role IN ('hr','worker') THEN
    _role := _meta_role::app_role;
  ELSE
    _role := 'worker'::app_role;
  END IF;

  INSERT INTO public.profiles (user_id, email, full_name, company, login)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'company',
    NEW.raw_user_meta_data ->> 'login'
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _role);

  RETURN NEW;
END;
$$;

-- 3. user_roles: admins-only inserts/updates
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can insert roles"
  ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update roles"
  ON public.user_roles
  FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

-- 4. Admin-only profile fields → separate table
CREATE TABLE IF NOT EXISTS public.profile_admin_data (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  admin_notes text,
  block_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_admin_data TO authenticated;
GRANT ALL ON public.profile_admin_data TO service_role;

ALTER TABLE public.profile_admin_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage profile_admin_data"
  ON public.profile_admin_data
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_profile_admin_data_updated_at
  BEFORE UPDATE ON public.profile_admin_data
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.profile_admin_data (user_id, admin_notes, block_reason)
SELECT user_id, admin_notes, block_reason
FROM public.profiles
WHERE admin_notes IS NOT NULL OR block_reason IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS admin_notes;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS block_reason;

-- 5. chat-attachments storage policies (bucket flipped to private separately)
DROP POLICY IF EXISTS "Authenticated users can upload chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view chat attachments" ON storage.objects;

CREATE POLICY "Users upload own chat attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users view own chat attachments"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR private.has_role(auth.uid(), 'admin'::app_role)
    )
  );

-- 6. Avatars: public SELECT only on actual avatar files
DROP POLICY IF EXISTS "Public avatar access" ON storage.objects;
CREATE POLICY "Public avatar access"
  ON storage.objects FOR SELECT TO public
  USING (
    bucket_id = 'avatars'
    AND name ~ '^[0-9a-fA-F-]+/avatar\.[A-Za-z0-9]+$'
  );

-- 7. Contact form: replace WITH CHECK (true)
DROP POLICY IF EXISTS "Anyone can submit contact form" ON public.contact_messages;
CREATE POLICY "Anyone can submit contact form"
  ON public.contact_messages
  FOR INSERT TO public
  WITH CHECK (
    char_length(name)    BETWEEN 1 AND 200
    AND char_length(email)   BETWEEN 3 AND 320
    AND char_length(subject) BETWEEN 1 AND 300
    AND char_length(message) BETWEEN 1 AND 5000
  );

-- 8. Realtime broadcast/presence deny (app uses only postgres_changes)
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny all realtime broadcast" ON realtime.messages;
CREATE POLICY "deny all realtime broadcast"
  ON realtime.messages FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);
