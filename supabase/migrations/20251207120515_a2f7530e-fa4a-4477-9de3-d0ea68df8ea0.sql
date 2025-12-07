-- Add attachments column to chat_messages
ALTER TABLE public.chat_messages 
ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;

-- Create storage bucket for chat attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload files
CREATE POLICY "Authenticated users can upload chat attachments"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'chat-attachments');

-- Allow anyone to view chat attachments (since bucket is public)
CREATE POLICY "Anyone can view chat attachments"
ON storage.objects
FOR SELECT
USING (bucket_id = 'chat-attachments');

-- Allow users to delete their own attachments
CREATE POLICY "Users can delete their own chat attachments"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'chat-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);