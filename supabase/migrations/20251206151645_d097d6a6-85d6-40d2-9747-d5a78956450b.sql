-- Remove the restrictive policy that blocks all request access
DROP POLICY IF EXISTS "Authenticated users only for requests" ON public.requests;