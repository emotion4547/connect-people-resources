-- Allow HR to delete their own requests
CREATE POLICY "HR can delete their own requests"
ON public.requests
FOR DELETE
USING (hr_id = auth.uid());

-- Allow admins to delete any request
CREATE POLICY "Admins can delete any request"
ON public.requests
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Allow users to delete messages in their own chats
CREATE POLICY "Users can delete messages in their chats"
ON public.chat_messages
FOR DELETE
USING (EXISTS (
  SELECT 1 FROM support_chats
  WHERE support_chats.id = chat_messages.chat_id
  AND (support_chats.user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
));

-- Allow admins to delete support chats
CREATE POLICY "Admins can delete chats"
ON public.support_chats
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Allow users to delete their own chats
CREATE POLICY "Users can delete their own chats"
ON public.support_chats
FOR DELETE
USING (user_id = auth.uid());