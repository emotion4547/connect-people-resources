-- Drop the problematic policy that causes recursion
DROP POLICY IF EXISTS "HR can view responses for their requests" ON public.responses;

-- Create security definer function to check if HR owns the request
CREATE OR REPLACE FUNCTION public.hr_owns_request(_hr_id uuid, _request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.requests
    WHERE id = _request_id
      AND hr_id = _hr_id
  )
$$;

-- Recreate policy for HR viewing responses using security definer function
CREATE POLICY "HR can view responses for their requests" 
ON public.responses 
FOR SELECT 
USING (
  hr_owns_request(auth.uid(), request_id)
);

-- Also fix HR can update responses if they own the request
DROP POLICY IF EXISTS "HR can update responses for their requests" ON public.responses;

CREATE POLICY "HR can update responses for their requests" 
ON public.responses 
FOR UPDATE 
USING (
  hr_owns_request(auth.uid(), request_id)
);