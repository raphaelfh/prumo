-- Create ai_assessment_prompts table
CREATE TABLE public.ai_assessment_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_item_id UUID NOT NULL REFERENCES public.assessment_items(id) ON DELETE CASCADE,
  system_prompt TEXT NOT NULL DEFAULT 'You are an expert research quality assessor. Analyze the provided research article and answer the specific question based on the evidence found in the text.',
  user_prompt_template TEXT NOT NULL DEFAULT 'Based on the article content, assess: {{question}}

Available response levels: {{levels}}

Provide your assessment with clear justification and cite specific passages from the text that support your conclusion.',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create ai_assessment_configs table
CREATE TABLE public.ai_assessment_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  instrument_id UUID REFERENCES public.assessment_instruments(id) ON DELETE SET NULL,
  model_name VARCHAR NOT NULL DEFAULT 'google/gemini-2.5-flash',
  temperature NUMERIC(3,2) NOT NULL DEFAULT 0.3,
  max_tokens INTEGER NOT NULL DEFAULT 2000,
  system_instruction TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id, instrument_id)
);

-- Create ai_assessments table
CREATE TABLE public.ai_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  assessment_item_id UUID NOT NULL REFERENCES public.assessment_items(id) ON DELETE CASCADE,
  instrument_id UUID NOT NULL REFERENCES public.assessment_instruments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- AI response fields
  selected_level VARCHAR NOT NULL,
  confidence_score NUMERIC(3,2),
  justification TEXT NOT NULL,
  evidence_passages JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Metadata
  ai_model_used VARCHAR NOT NULL,
  processing_time_ms INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  
  -- Status tracking
  status VARCHAR NOT NULL DEFAULT 'pending_review', -- pending_review, accepted, rejected, modified
  reviewed_at TIMESTAMP WITH TIME ZONE,
  human_response VARCHAR,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(article_id, assessment_item_id, user_id)
);

-- Enable RLS
ALTER TABLE public.ai_assessment_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_assessment_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_assessments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_assessment_prompts
CREATE POLICY "Everyone can view prompts"
  ON public.ai_assessment_prompts FOR SELECT
  USING (true);

CREATE POLICY "Managers can manage prompts"
  ON public.ai_assessment_prompts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM assessment_items ai
      JOIN assessment_instruments inst ON ai.instrument_id = inst.id
      WHERE ai.id = ai_assessment_prompts.assessment_item_id
    )
  );

-- RLS Policies for ai_assessment_configs
CREATE POLICY "Members can view configs"
  ON public.ai_assessment_configs FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Managers can manage configs"
  ON public.ai_assessment_configs FOR ALL
  USING (is_project_manager(project_id, auth.uid()));

-- RLS Policies for ai_assessments
CREATE POLICY "Members can view AI assessments"
  ON public.ai_assessments FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Users can create AI assessments"
  ON public.ai_assessments FOR INSERT
  WITH CHECK (
    is_project_member(project_id, auth.uid()) AND
    user_id = auth.uid()
  );

CREATE POLICY "Users can update own AI assessments"
  ON public.ai_assessments FOR UPDATE
  USING (
    is_project_member(project_id, auth.uid()) AND
    user_id = auth.uid()
  );

CREATE POLICY "Users can delete own AI assessments"
  ON public.ai_assessments FOR DELETE
  USING (
    is_project_member(project_id, auth.uid()) AND
    user_id = auth.uid()
  );

-- Create updated_at triggers
CREATE TRIGGER set_ai_assessment_prompts_updated_at
  BEFORE UPDATE ON public.ai_assessment_prompts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_ai_assessment_configs_updated_at
  BEFORE UPDATE ON public.ai_assessment_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_ai_assessments_updated_at
  BEFORE UPDATE ON public.ai_assessments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Create indexes for performance
CREATE INDEX idx_ai_assessment_prompts_item ON public.ai_assessment_prompts(assessment_item_id);
CREATE INDEX idx_ai_assessment_configs_project ON public.ai_assessment_configs(project_id, instrument_id);
CREATE INDEX idx_ai_assessments_article_item ON public.ai_assessments(article_id, assessment_item_id);
CREATE INDEX idx_ai_assessments_user ON public.ai_assessments(user_id);
CREATE INDEX idx_ai_assessments_status ON public.ai_assessments(status);

COMMENT ON TABLE public.ai_assessment_prompts IS 'Customizable prompt templates for each assessment item';
COMMENT ON TABLE public.ai_assessment_configs IS 'AI model configurations per project/instrument';
COMMENT ON TABLE public.ai_assessments IS 'AI-generated assessment responses with evidence and justification';