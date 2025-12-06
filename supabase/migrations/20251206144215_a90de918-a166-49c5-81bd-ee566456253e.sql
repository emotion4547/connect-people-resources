-- Drop problematic policies that cause recursion
DROP POLICY IF EXISTS "Workers can view requests they responded to" ON public.requests;
DROP POLICY IF EXISTS "HR can view worker profiles for their requests" ON public.profiles;

-- Create security definer function to check if worker responded to request
CREATE OR REPLACE FUNCTION public.worker_responded_to_request(_worker_id uuid, _request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.responses
    WHERE worker_id = _worker_id
      AND request_id = _request_id
  )
$$;

-- Create security definer function to check if HR has worker through responses
CREATE OR REPLACE FUNCTION public.hr_has_worker(_hr_id uuid, _worker_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.responses r
    JOIN public.requests req ON r.request_id = req.id
    WHERE r.worker_id = _worker_user_id
      AND req.hr_id = _hr_id
  )
$$;

-- Recreate policy for workers viewing requests they responded to (using security definer function)
CREATE POLICY "Workers can view requests they responded to" 
ON public.requests 
FOR SELECT 
USING (
  has_role(auth.uid(), 'worker') AND 
  worker_responded_to_request(auth.uid(), id)
);

-- Recreate policy for HR viewing worker profiles (using security definer function)
CREATE POLICY "HR can view worker profiles for their requests" 
ON public.profiles 
FOR SELECT 
USING (
  has_role(auth.uid(), 'hr') AND 
  hr_has_worker(auth.uid(), user_id)
);