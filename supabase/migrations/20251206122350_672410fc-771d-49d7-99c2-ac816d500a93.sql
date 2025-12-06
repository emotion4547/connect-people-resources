-- Add policies to deny anonymous access to profiles table
CREATE POLICY "Authenticated users only for profiles" 
ON public.profiles 
FOR SELECT 
TO anon
USING (false);

-- Add policies to deny anonymous access to requests table  
CREATE POLICY "Authenticated users only for requests"
ON public.requests 
FOR SELECT 
TO anon
USING (false);