-- =====================================================
-- MIGRATION: Extraction Data Tables
-- =====================================================
-- Descrição: Cria tabelas de dados de extração: 
-- extraction_instances, extracted_values, extraction_evidence
-- =====================================================

-- =================== EXTRACTION INSTANCES ===================

CREATE TABLE extraction_instances (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  article_id uuid,
  template_id uuid NOT NULL,
  entity_type_id uuid NOT NULL,
  parent_instance_id uuid,
  label character varying NOT NULL,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  status character varying DEFAULT 'pending'::character varying,
  is_template boolean DEFAULT false,
  CONSTRAINT extraction_instances_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT extraction_instances_article_id_fkey FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  CONSTRAINT extraction_instances_template_id_fkey FOREIGN KEY (template_id) REFERENCES project_extraction_templates(id) ON DELETE RESTRICT,
  CONSTRAINT extraction_instances_entity_type_id_fkey FOREIGN KEY (entity_type_id) REFERENCES extraction_entity_types(id) ON DELETE RESTRICT,
  CONSTRAINT extraction_instances_parent_instance_id_fkey FOREIGN KEY (parent_instance_id) REFERENCES extraction_instances(id) ON DELETE CASCADE,
  CONSTRAINT extraction_instances_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT
);

COMMENT ON TABLE extraction_instances IS 'Instâncias específicas de entidades para cada artigo';
COMMENT ON COLUMN extraction_instances.label IS 'Rótulo da instância (ex: "Model 1", "Dataset A")';
COMMENT ON COLUMN extraction_instances.metadata IS 'Metadados adicionais da instância';
COMMENT ON COLUMN extraction_instances.status IS 'Status da instância (pending, completed, etc.)';
COMMENT ON COLUMN extraction_instances.is_template IS 'Indica se é uma instância template (padrão)';

-- =================== EXTRACTED VALUES ===================

CREATE TABLE extracted_values (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  article_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  field_id uuid NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  source extraction_source NOT NULL,
  confidence_score numeric CHECK (confidence_score IS NULL OR confidence_score >= 0.00 AND confidence_score <= 1.00),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewer_id uuid,
  is_consensus boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ai_suggestion_id uuid,
  unit character varying,
  CONSTRAINT extracted_values_field_id_fkey FOREIGN KEY (field_id) REFERENCES extraction_fields(id) ON DELETE RESTRICT,
  CONSTRAINT extracted_values_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES profiles(id) ON DELETE SET NULL,
  -- FK para ai_suggestions será adicionada na migration 0007 após criar a tabela
  CONSTRAINT extracted_values_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT extracted_values_article_id_fkey FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  CONSTRAINT extracted_values_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES extraction_instances(id) ON DELETE CASCADE
);

COMMENT ON TABLE extracted_values IS 'Valores extraídos para cada campo de cada instância';
COMMENT ON COLUMN extracted_values.value IS 'Valor extraído com metadados (tipo, unidade, etc.) em formato JSONB';
COMMENT ON COLUMN extracted_values.source IS 'Fonte do valor: humano, IA ou regra automática';
COMMENT ON COLUMN extracted_values.is_consensus IS 'Indica se é o valor consensual final';
COMMENT ON COLUMN extracted_values.ai_suggestion_id IS 'Referência à sugestão de IA que gerou este valor (se aplicável)';
COMMENT ON COLUMN extracted_values.unit IS 'Unidade do valor extraído';

-- =================== EXTRACTION EVIDENCE ===================

CREATE TABLE extraction_evidence (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  article_id uuid NOT NULL,
  target_type character varying NOT NULL 
    CHECK (target_type::text = ANY (ARRAY['value'::character varying, 'instance'::character varying]::text[])),
  target_id uuid NOT NULL,
  article_file_id uuid,
  page_number integer CHECK (page_number IS NULL OR page_number > 0),
  position jsonb DEFAULT '{}'::jsonb CHECK (jsonb_typeof("position") = 'object'::text),
  text_content text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT extraction_evidence_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT extraction_evidence_article_id_fkey FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  CONSTRAINT extraction_evidence_article_file_id_fkey FOREIGN KEY (article_file_id) REFERENCES article_files(id) ON DELETE SET NULL,
  CONSTRAINT extraction_evidence_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT
);

COMMENT ON TABLE extraction_evidence IS 'Evidências que suportam valores extraídos ou instâncias';
COMMENT ON COLUMN extraction_evidence.target_type IS 'Tipo do alvo: "value" ou "instance"';
COMMENT ON COLUMN extraction_evidence.target_id IS 'ID do valor extraído ou da instância';
COMMENT ON COLUMN extraction_evidence.position IS 'Posição no documento (página, coordenadas) em formato JSONB';
COMMENT ON COLUMN extraction_evidence.text_content IS 'Conteúdo de texto citado como evidência';

