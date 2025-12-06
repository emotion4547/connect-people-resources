-- Add block reason to profiles for user blocking/suspension
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS block_reason TEXT DEFAULT NULL;