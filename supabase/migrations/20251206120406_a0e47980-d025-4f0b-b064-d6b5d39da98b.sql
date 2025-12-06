-- Add pending_confirmation status to request_status enum
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'pending_confirmation';
