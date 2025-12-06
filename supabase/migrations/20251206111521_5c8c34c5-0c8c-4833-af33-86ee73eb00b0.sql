-- Create app role enum
CREATE TYPE public.app_role AS ENUM ('hr', 'worker', 'admin');

-- Create user_roles table for secure role management
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create profiles table
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    email TEXT NOT NULL,
    full_name TEXT,
    company TEXT,
    phone TEXT,
    city TEXT,
    experience TEXT,
    preferred_schedule TEXT,
    preferred_positions TEXT[],
    is_active BOOLEAN DEFAULT true,
    rating DECIMAL(3,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create request status enum
CREATE TYPE public.request_status AS ENUM ('new', 'in_progress', 'assigned', 'completed', 'cancelled');

-- Create requests table (HR job requests)
CREATE TABLE public.requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hr_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    position TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    address TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    requirements TEXT,
    comments TEXT,
    pay TEXT,
    status request_status NOT NULL DEFAULT 'new',
    webhook_sent BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on requests
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;

-- Create response status enum
CREATE TYPE public.response_status AS ENUM ('pending', 'assigned', 'rejected', 'completed', 'no_show');

-- Create responses table (worker applications)
CREATE TABLE public.responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID REFERENCES public.requests(id) ON DELETE CASCADE NOT NULL,
    worker_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    status response_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (request_id, worker_id)
);

-- Enable RLS on responses
ALTER TABLE public.responses ENABLE ROW LEVEL SECURITY;

-- Create user type enum for chat
CREATE TYPE public.user_type AS ENUM ('hr', 'worker');

-- Create support_chats table
CREATE TABLE public.support_chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    user_type user_type NOT NULL,
    unread_count INTEGER DEFAULT 0,
    is_closed BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on support_chats
ALTER TABLE public.support_chats ENABLE ROW LEVEL SECURITY;

-- Create sender type enum
CREATE TYPE public.sender_type AS ENUM ('user', 'admin');

-- Create chat_messages table
CREATE TABLE public.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID REFERENCES public.support_chats(id) ON DELETE CASCADE NOT NULL,
    sender_type sender_type NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on chat_messages
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Create webhook_settings table
CREATE TABLE public.webhook_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_url TEXT,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on webhook_settings
ALTER TABLE public.webhook_settings ENABLE ROW LEVEL SECURITY;

-- Create webhook_logs table
CREATE TABLE public.webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID REFERENCES public.requests(id) ON DELETE CASCADE NOT NULL,
    url TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    response TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on webhook_logs
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

-- Security definer function to check user role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Function to get user role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id LIMIT 1
$$;

-- RLS Policies for user_roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admins can view all roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage roles"
ON public.user_roles FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view all profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "HR can view worker profiles for their requests"
ON public.profiles FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'hr') AND
  EXISTS (
    SELECT 1 FROM public.responses r
    JOIN public.requests req ON r.request_id = req.id
    WHERE r.worker_id = profiles.user_id AND req.hr_id = auth.uid()
  )
);

-- RLS Policies for requests
CREATE POLICY "HR can view their own requests"
ON public.requests FOR SELECT
TO authenticated
USING (hr_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "HR can create requests"
ON public.requests FOR INSERT
TO authenticated
WITH CHECK (hr_id = auth.uid() AND public.has_role(auth.uid(), 'hr'));

CREATE POLICY "HR can update their own requests"
ON public.requests FOR UPDATE
TO authenticated
USING (hr_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Workers can view available requests"
ON public.requests FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'worker') AND status IN ('new', 'in_progress'));

-- RLS Policies for responses
CREATE POLICY "Workers can view their own responses"
ON public.responses FOR SELECT
TO authenticated
USING (worker_id = auth.uid());

CREATE POLICY "Workers can create responses"
ON public.responses FOR INSERT
TO authenticated
WITH CHECK (worker_id = auth.uid() AND public.has_role(auth.uid(), 'worker'));

CREATE POLICY "HR can view responses for their requests"
ON public.responses FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.requests
    WHERE requests.id = responses.request_id AND requests.hr_id = auth.uid()
  )
);

CREATE POLICY "Admins can manage all responses"
ON public.responses FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for support_chats
CREATE POLICY "Users can view their own chats"
ON public.support_chats FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can create their own chats"
ON public.support_chats FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can manage all chats"
ON public.support_chats FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for chat_messages
CREATE POLICY "Users can view messages in their chats"
ON public.chat_messages FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.support_chats
    WHERE support_chats.id = chat_messages.chat_id
    AND (support_chats.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
);

CREATE POLICY "Users can send messages in their chats"
ON public.chat_messages FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.support_chats
    WHERE support_chats.id = chat_messages.chat_id
    AND (support_chats.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
);

-- RLS Policies for webhook_settings (admin only)
CREATE POLICY "Admins can manage webhook settings"
ON public.webhook_settings FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for webhook_logs (admin only)
CREATE POLICY "Admins can view webhook logs"
ON public.webhook_logs FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_requests_updated_at
BEFORE UPDATE ON public.requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_responses_updated_at
BEFORE UPDATE ON public.responses
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_support_chats_updated_at
BEFORE UPDATE ON public.support_chats
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_webhook_settings_updated_at
BEFORE UPDATE ON public.webhook_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function to handle new user registration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name, company)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'company'
  );
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    (NEW.raw_user_meta_data ->> 'role')::app_role
  );
  
  RETURN NEW;
END;
$$;

-- Trigger for new user registration
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Enable realtime for chat messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_chats;