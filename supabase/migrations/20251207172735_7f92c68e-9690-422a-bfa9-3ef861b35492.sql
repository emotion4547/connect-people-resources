-- Add admin_notes column to profiles table for storing admin comments about workers
ALTER TABLE public.profiles ADD COLUMN admin_notes text;