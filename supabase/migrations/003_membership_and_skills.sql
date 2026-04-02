-- Add membership_tier to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS membership_tier text DEFAULT 'free',
ADD COLUMN IF NOT EXISTS is_membership_active boolean DEFAULT true;

-- Table for tracking course progress (Financial Literacy & Life Skills)
CREATE TABLE IF NOT EXISTS public.user_progress (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    module_name text NOT NULL, -- e.g., 'Uplift Wealth', 'Uplift Learn'
    content_id text NOT NULL, -- course or lesson ID
    status text DEFAULT 'in_progress', -- 'not_started', 'in_progress', 'completed'
    completed_at timestamp with time zone,
    score integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_progress ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own progress"
    ON public.user_progress FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own progress"
    ON public.user_progress FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can modify their own progress"
    ON public.user_progress FOR UPDATE
    USING (auth.uid() = user_id);

-- Mentorship Matching Table
CREATE TABLE IF NOT EXISTS public.mentorship_matches (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    mentor_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    mentee_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    status text DEFAULT 'pending', -- 'pending', 'active', 'completed'
    module_domain text, -- 'Finance', 'Education', 'Entrepreneurship'
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.mentorship_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see their own matches"
    ON public.mentorship_matches FOR SELECT
    USING (auth.uid() = mentor_id OR auth.uid() = mentee_id);
