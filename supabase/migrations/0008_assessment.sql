-- =====================================================
-- MIGRATION: Assessment Tables
-- =====================================================
-- Descrição: Cria tabelas para avaliação de qualidade:
-- assessment_instruments, assessment_items, assessments,
-- ai_assessment_configs, ai_assessment_prompts, ai_assessments
-- =====================================================

-- =================== ASSESSMENT INSTRUMENTS ===================

CREATE TABLE assessment_instruments (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_type character varying NOT NULL,
  name character varying NOT NULL,
  version character varying NOT NULL,
  mode character varying NOT NULL DEFAULT 'human'::character varying,
  is_active boolean NOT NULL DEFAULT true,
  aggregation_rules jsonb,
  schema jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE assessment_instruments IS 'Instrumentos de avaliação de qualidade (PROBAST, ROBIS, etc.)';
COMMENT ON COLUMN assessment_instruments.tool_type IS 'Tipo de ferramenta (PROBAST, ROBIS, etc.)';
COMMENT ON COLUMN assessment_instruments.mode IS 'Modo de avaliação (human, ai, hybrid)';
COMMENT ON COLUMN assessment_instruments.aggregation_rules IS 'Regras de agregação de respostas';
COMMENT ON COLUMN assessment_instruments.schema IS 'Schema do instrumento em formato JSONB';

-- =================== ASSESSMENT ITEMS ===================

CREATE TABLE assessment_items (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL,
  domain character varying NOT NULL,
  item_code character varying NOT NULL,
  question text NOT NULL,
  sort_order integer NOT NULL,
  required boolean NOT NULL DEFAULT true,
  allowed_levels_override jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  allowed_levels jsonb NOT NULL,
  CONSTRAINT assessment_items_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES assessment_instruments(id) ON DELETE CASCADE
);

COMMENT ON TABLE assessment_items IS 'Itens/perguntas individuais de cada instrumento de avaliação';
COMMENT ON COLUMN assessment_items.domain IS 'Domínio do item (ex: "Participant Selection")';
COMMENT ON COLUMN assessment_items.item_code IS 'Código único do item no instrumento';
COMMENT ON COLUMN assessment_items.allowed_levels IS 'Níveis de resposta permitidos (ex: ["low", "high", "unclear"])';

-- =================== ASSESSMENTS ===================

CREATE TABLE assessments (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL,
  user_id uuid NOT NULL,
  tool_type character varying NOT NULL,
  instrument_id uuid,
  responses jsonb NOT NULL DEFAULT '{}'::jsonb,
  overall_assessment jsonb,
  confidence_level integer,
  status assessment_status NOT NULL DEFAULT 'in_progress'::assessment_status,
  completion_percentage numeric,
  version integer NOT NULL DEFAULT 1,
  is_current_version boolean NOT NULL DEFAULT true,
  parent_assessment_id uuid,
  is_blind boolean NOT NULL DEFAULT false,
  can_see_others boolean NOT NULL DEFAULT true,
  comments jsonb NOT NULL DEFAULT '[]'::jsonb,
  private_notes text,
  project_id uuid,
  assessed_by_type character varying NOT NULL DEFAULT 'human'::character varying,
  run_id uuid,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  extraction_instance_id uuid,
  CONSTRAINT assessments_article_id_fkey FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  CONSTRAINT assessments_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT,
  CONSTRAINT assessments_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES assessment_instruments(id) ON DELETE SET NULL,
  CONSTRAINT assessments_parent_assessment_id_fkey FOREIGN KEY (parent_assessment_id) REFERENCES assessments(id) ON DELETE SET NULL,
  CONSTRAINT assessments_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT assessments_extraction_instance_id_fkey FOREIGN KEY (extraction_instance_id) REFERENCES extraction_instances(id) ON DELETE SET NULL
);

COMMENT ON TABLE assessments IS 'Avaliações de qualidade realizadas por usuários';
COMMENT ON COLUMN assessments.responses IS 'Respostas aos itens do instrumento em formato JSONB';
COMMENT ON COLUMN assessments.status IS 'Status da avaliação (in_progress, submitted, locked, archived)';
COMMENT ON COLUMN assessments.is_blind IS 'Indica se a avaliação é cega (sem ver outras avaliações)';
COMMENT ON COLUMN assessments.extraction_instance_id IS 'FK para extraction_instance quando assessment_scope = extraction_instance';

-- =================== AI ASSESSMENT CONFIGS ===================

CREATE TABLE ai_assessment_configs (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  instrument_id uuid,
  model_name character varying NOT NULL DEFAULT 'google/gemini-2.5-flash'::character varying,
  temperature numeric NOT NULL DEFAULT 0.3,
  max_tokens integer NOT NULL DEFAULT 2000,
  system_instruction text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_assessment_configs_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT ai_assessment_configs_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES assessment_instruments(id) ON DELETE SET NULL
);

COMMENT ON TABLE ai_assessment_configs IS 'Configurações de IA para avaliação de qualidade por projeto';
COMMENT ON COLUMN ai_assessment_configs.model_name IS 'Modelo de IA a ser usado';
COMMENT ON COLUMN ai_assessment_configs.temperature IS 'Temperatura do modelo (0.0 a 1.0)';

-- =================== AI ASSESSMENT PROMPTS ===================

CREATE TABLE ai_assessment_prompts (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_item_id uuid NOT NULL UNIQUE,
  system_prompt text NOT NULL DEFAULT 'You are an expert research quality assessor. Analyze the provided research article and answer the specific question based on the evidence found in the text.'::text,
  user_prompt_template text NOT NULL DEFAULT 'Based on the article content, assess: {{question}}

Available response levels: {{levels}}

Provide your assessment with clear justification and cite specific passages from the text that support your conclusion.'::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_assessment_prompts_assessment_item_id_fkey FOREIGN KEY (assessment_item_id) REFERENCES assessment_items(id) ON DELETE CASCADE
);

COMMENT ON TABLE ai_assessment_prompts IS 'Prompts customizados para cada item de avaliação';
COMMENT ON COLUMN ai_assessment_prompts.system_prompt IS 'Prompt do sistema para o modelo de IA';
COMMENT ON COLUMN ai_assessment_prompts.user_prompt_template IS 'Template do prompt do usuário com placeholders';

-- =================== AI ASSESSMENTS ===================

CREATE TABLE ai_assessments (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  article_id uuid NOT NULL,
  assessment_item_id uuid NOT NULL,
  instrument_id uuid NOT NULL,
  user_id uuid NOT NULL,
  selected_level character varying NOT NULL,
  confidence_score numeric,
  justification text NOT NULL,
  evidence_passages jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_model_used character varying NOT NULL,
  processing_time_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  status character varying NOT NULL DEFAULT 'pending_review'::character varying,
  reviewed_at timestamptz,
  human_response character varying,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  article_file_id uuid,
  CONSTRAINT ai_assessments_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT ai_assessments_article_id_fkey FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  CONSTRAINT ai_assessments_assessment_item_id_fkey FOREIGN KEY (assessment_item_id) REFERENCES assessment_items(id) ON DELETE RESTRICT,
  CONSTRAINT ai_assessments_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES assessment_instruments(id) ON DELETE RESTRICT,
  CONSTRAINT ai_assessments_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT,
  CONSTRAINT ai_assessments_article_file_id_fkey FOREIGN KEY (article_file_id) REFERENCES article_files(id) ON DELETE SET NULL
);

COMMENT ON TABLE ai_assessments IS 'Avaliações de qualidade geradas por IA';
COMMENT ON COLUMN ai_assessments.selected_level IS 'Nível selecionado pela IA (ex: "low", "high", "unclear")';
COMMENT ON COLUMN ai_assessments.justification IS 'Justificativa da avaliação da IA';
COMMENT ON COLUMN ai_assessments.evidence_passages IS 'Passagens do texto citadas como evidência';
COMMENT ON COLUMN ai_assessments.status IS 'Status da avaliação (pending_review, accepted, rejected)';

