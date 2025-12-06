-- Create templates table for HR request templates
CREATE TABLE public.request_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hr_id UUID NOT NULL,
  name TEXT NOT NULL,
  position TEXT NOT NULL,
  address TEXT,
  quantity INTEGER DEFAULT 1,
  requirements TEXT,
  comments TEXT,
  pay TEXT,
  start_time TIME,
  end_time TIME,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.request_templates ENABLE ROW LEVEL SECURITY;

-- Policies for templates
CREATE POLICY "HR can view their own templates"
ON public.request_templates
FOR SELECT
USING (hr_id = auth.uid());

CREATE POLICY "HR can create their own templates"
ON public.request_templates
FOR INSERT
WITH CHECK (hr_id = auth.uid() AND has_role(auth.uid(), 'hr'::app_role));

CREATE POLICY "HR can update their own templates"
ON public.request_templates
FOR UPDATE
USING (hr_id = auth.uid());

CREATE POLICY "HR can delete their own templates"
ON public.request_templates
FOR DELETE
USING (hr_id = auth.uid());

-- Add trigger for updated_at
CREATE TRIGGER update_request_templates_updated_at
BEFORE UPDATE ON public.request_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add request_id to support_chats for per-request support
ALTER TABLE public.support_chats ADD COLUMN request_id UUID REFERENCES public.requests(id) ON DELETE SET NULL;