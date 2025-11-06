-- =====================================================
-- MIGRATION: Extraction AI Tables
-- =====================================================
-- Descrição: Cria tabelas para execução de IA na extração:
-- extraction_runs, ai_suggestions
-- =====================================================

-- =================== EXTRACTION RUNS ===================

CREATE TABLE extraction_runs (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  article_id uuid NOT NULL,
  template_id uuid NOT NULL,
  stage extraction_run_stage NOT NULL,
  status extraction_run_status NOT NULL DEFAULT 'pending'::extraction_run_status,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT extraction_runs_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT extraction_runs_article_id_fkey FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  CONSTRAINT extraction_runs_template_id_fkey FOREIGN KEY (template_id) REFERENCES project_extraction_templates(id) ON DELETE RESTRICT,
  CONSTRAINT extraction_runs_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT
);

COMMENT ON TABLE extraction_runs IS 'Execuções de IA para sugerir valores de extração';
COMMENT ON COLUMN extraction_runs.stage IS 'Estágio da execução (data_suggest, parsing, validation, consensus)';
COMMENT ON COLUMN extraction_runs.status IS 'Status da execução (pending, running, completed, failed)';
COMMENT ON COLUMN extraction_runs.parameters IS 'Parâmetros da execução (modelo, temperatura, etc.)';
COMMENT ON COLUMN extraction_runs.results IS 'Resultados da execução em formato JSONB';

-- =================== AI SUGGESTIONS ===================

CREATE TABLE ai_suggestions (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  instance_id uuid,
  field_id uuid NOT NULL,
  suggested_value jsonb NOT NULL,
  confidence_score numeric CHECK (confidence_score IS NULL OR confidence_score >= 0.00 AND confidence_score <= 1.00),
  reasoning text,
  status suggestion_status NOT NULL DEFAULT 'pending'::suggestion_status,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ai_suggestions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT ai_suggestions_run_id_fkey FOREIGN KEY (run_id) REFERENCES extraction_runs(id) ON DELETE CASCADE,
  CONSTRAINT ai_suggestions_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES extraction_instances(id) ON DELETE CASCADE,
  CONSTRAINT ai_suggestions_field_id_fkey FOREIGN KEY (field_id) REFERENCES extraction_fields(id) ON DELETE RESTRICT
);

COMMENT ON TABLE ai_suggestions IS 'Sugestões específicas geradas pela IA para valores de extração';
COMMENT ON COLUMN ai_suggestions.suggested_value IS 'Valor sugerido pela IA em formato JSONB';
COMMENT ON COLUMN ai_suggestions.confidence_score IS 'Score de confiança da sugestão (0.0 a 1.0)';
COMMENT ON COLUMN ai_suggestions.reasoning IS 'Justificativa da sugestão';
COMMENT ON COLUMN ai_suggestions.status IS 'Status da sugestão (pending, accepted, rejected)';
COMMENT ON COLUMN ai_suggestions.metadata IS 'Metadados adicionais da sugestão';

-- =================== ADD FOREIGN KEY FOR EXTRACTED_VALUES ===================
-- Adicionar FK de extracted_values.ai_suggestion_id agora que ai_suggestions existe

ALTER TABLE extracted_values
  ADD CONSTRAINT extracted_values_ai_suggestion_id_fkey 
  FOREIGN KEY (ai_suggestion_id) 
  REFERENCES ai_suggestions(id) 
  ON DELETE SET NULL;

