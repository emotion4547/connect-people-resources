-- Remove the restrictive policy that blocks all access
DROP POLICY IF EXISTS "Authenticated users only for profiles" ON public.profiles;