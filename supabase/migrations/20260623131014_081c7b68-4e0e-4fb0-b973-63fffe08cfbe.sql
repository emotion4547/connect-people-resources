
-- =========================================================
-- 1. SITES
-- =========================================================
CREATE TABLE public.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  city text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sites TO authenticated;
GRANT ALL ON public.sites TO service_role;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sites readable by authenticated"
  ON public.sites FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage sites"
  ON public.sites FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE TRIGGER update_sites_updated_at BEFORE UPDATE ON public.sites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- 2. SITE_MANAGERS (HR <-> site)
-- =========================================================
CREATE TABLE public.site_managers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  hr_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, hr_user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_managers TO authenticated;
GRANT ALL ON public.site_managers TO service_role;
ALTER TABLE public.site_managers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Site managers readable by authenticated"
  ON public.site_managers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage site_managers"
  ON public.site_managers FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- =========================================================
-- 3. SITE_WORKERS (worker <-> site)
-- =========================================================
CREATE TABLE public.site_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  worker_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, worker_user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_workers TO authenticated;
GRANT ALL ON public.site_workers TO service_role;
ALTER TABLE public.site_workers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Site workers readable by authenticated"
  ON public.site_workers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage site_workers"
  ON public.site_workers FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- =========================================================
-- 4. requests.site_id
-- =========================================================
ALTER TABLE public.requests
  ADD COLUMN site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL;

-- =========================================================
-- 5. Helper functions
-- =========================================================
CREATE OR REPLACE FUNCTION public.hr_assigned_to_site(_hr uuid, _site uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.site_managers WHERE hr_user_id = _hr AND site_id = _site)
$$;

CREATE OR REPLACE FUNCTION public.worker_assigned_to_site(_worker uuid, _site uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.site_workers WHERE worker_user_id = _worker AND site_id = _site)
$$;

CREATE OR REPLACE FUNCTION public.hr_shares_site_with_worker(_hr uuid, _worker uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.site_managers sm
    JOIN public.site_workers sw ON sw.site_id = sm.site_id
    WHERE sm.hr_user_id = _hr AND sw.worker_user_id = _worker
  )
$$;

CREATE OR REPLACE FUNCTION public.hr_can_rate_worker(_hr uuid, _worker uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.responses r
    JOIN public.requests req ON req.id = r.request_id
    WHERE r.worker_id = _worker
      AND req.hr_id = _hr
      AND r.status IN ('assigned','completed')
  )
$$;

-- =========================================================
-- 6. profiles: extend HR visibility to site-mates, allow rating updates
-- =========================================================
DROP POLICY IF EXISTS "HR can view worker profiles for their requests" ON public.profiles;
CREATE POLICY "HR can view worker profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(),'hr'::app_role) AND (
      hr_has_worker(auth.uid(), user_id)
      OR hr_shares_site_with_worker(auth.uid(), user_id)
    )
  );

CREATE POLICY "HR can update worker ratings"
  ON public.profiles FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'hr'::app_role) AND hr_can_rate_worker(auth.uid(), user_id))
  WITH CHECK (has_role(auth.uid(),'hr'::app_role) AND hr_can_rate_worker(auth.uid(), user_id));

-- =========================================================
-- 7. requests: enforce site visibility / creation
-- =========================================================
DROP POLICY IF EXISTS "HR can view their own requests" ON public.requests;
CREATE POLICY "HR can view their own requests"
  ON public.requests FOR SELECT TO authenticated
  USING (
    hr_id = auth.uid()
    OR has_role(auth.uid(),'admin'::app_role)
    OR (
      has_role(auth.uid(),'hr'::app_role)
      AND site_id IS NOT NULL
      AND hr_assigned_to_site(auth.uid(), site_id)
    )
  );

DROP POLICY IF EXISTS "HR can create requests" ON public.requests;
CREATE POLICY "HR can create requests"
  ON public.requests FOR INSERT TO authenticated
  WITH CHECK (
    hr_id = auth.uid()
    AND has_role(auth.uid(),'hr'::app_role)
    AND (
      site_id IS NULL
      OR hr_assigned_to_site(auth.uid(), site_id)
    )
  );

DROP POLICY IF EXISTS "HR can update their own requests" ON public.requests;
CREATE POLICY "HR can update requests"
  ON public.requests FOR UPDATE TO authenticated
  USING (
    hr_id = auth.uid()
    OR has_role(auth.uid(),'admin'::app_role)
    OR (
      has_role(auth.uid(),'hr'::app_role)
      AND site_id IS NOT NULL
      AND hr_assigned_to_site(auth.uid(), site_id)
    )
  )
  WITH CHECK (
    hr_id = auth.uid()
    OR has_role(auth.uid(),'admin'::app_role)
    OR (
      has_role(auth.uid(),'hr'::app_role)
      AND site_id IS NOT NULL
      AND hr_assigned_to_site(auth.uid(), site_id)
    )
  );

DROP POLICY IF EXISTS "Workers can view available requests" ON public.requests;
CREATE POLICY "Workers can view available requests"
  ON public.requests FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(),'worker'::app_role)
    AND status = ANY (ARRAY['new'::request_status,'in_progress'::request_status])
    AND (
      site_id IS NULL
      OR worker_assigned_to_site(auth.uid(), site_id)
    )
  );
