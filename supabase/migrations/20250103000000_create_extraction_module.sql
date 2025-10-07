-- =====================================================
-- MIGRAÇÃO: Módulo de Extração de Dados
-- =====================================================
-- Descrição: Implementa sistema completo de extração de dados
-- com templates, entidades hierárquicas e suporte a IA
-- 
-- ROLLBACK: Para reverter, execute os comandos DROP na ordem inversa
-- =====================================================

-- =================== TIPOS ENUM ===================
CREATE TYPE extraction_framework AS ENUM ('CHARMS', 'PICOS', 'CUSTOM');
CREATE TYPE extraction_field_type AS ENUM ('text', 'number', 'date', 'select', 'multiselect', 'boolean');
CREATE TYPE extraction_cardinality AS ENUM ('one', 'many');
CREATE TYPE extraction_source AS ENUM ('human', 'ai', 'rule');
CREATE TYPE extraction_run_stage AS ENUM ('data_suggest', 'parsing', 'validation', 'consensus');
CREATE TYPE extraction_run_status AS ENUM ('pending', 'running', 'completed', 'failed');
CREATE TYPE suggestion_status AS ENUM ('pending', 'accepted', 'rejected');

-- =================== TEMPLATES GLOBAIS ===================
CREATE TABLE extraction_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  framework extraction_framework NOT NULL,
  version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  is_global BOOLEAN NOT NULL DEFAULT true,
  schema JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT uq_extraction_template_name_version UNIQUE(name, version),
  CONSTRAINT chk_extraction_template_version CHECK (version ~ '^\d+\.\d+\.\d+$')
);

-- Trigger para updated_at
CREATE TRIGGER trg_extraction_templates_updated_at
  BEFORE UPDATE ON extraction_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =================== ENTIDADES DOS TEMPLATES ===================
CREATE TABLE extraction_entity_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES extraction_templates(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  label VARCHAR(255) NOT NULL,
  description TEXT,
  parent_entity_type_id UUID REFERENCES extraction_entity_types(id) ON DELETE CASCADE,
  cardinality extraction_cardinality NOT NULL DEFAULT 'one',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT chk_entity_type_name CHECK (name ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT chk_entity_type_sort_order CHECK (sort_order >= 0),
  
  -- Evitar referência circular
  CONSTRAINT chk_no_circular_reference CHECK (id != parent_entity_type_id)
);

-- =================== CAMPOS DAS ENTIDADES ===================
CREATE TABLE extraction_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type_id UUID NOT NULL REFERENCES extraction_entity_types(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  label VARCHAR(255) NOT NULL,
  description TEXT,
  field_type extraction_field_type NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT false,
  validation_schema JSONB DEFAULT '{}',
  allowed_values JSONB DEFAULT NULL,
  unit VARCHAR(50),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT chk_field_name CHECK (name ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT chk_field_sort_order CHECK (sort_order >= 0),
  CONSTRAINT chk_field_allowed_values CHECK (
    (field_type IN ('select', 'multiselect') AND allowed_values IS NOT NULL) OR
    (field_type NOT IN ('select', 'multiselect') AND allowed_values IS NULL)
  )
);

-- =================== TEMPLATES POR PROJETO ===================
CREATE TABLE project_extraction_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  global_template_id UUID REFERENCES extraction_templates(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  framework extraction_framework NOT NULL,
  version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  schema JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT uq_project_template_name UNIQUE(project_id, name),
  CONSTRAINT chk_project_template_version CHECK (version ~ '^\d+\.\d+\.\d+$')
);

-- Trigger para updated_at
CREATE TRIGGER trg_project_extraction_templates_updated_at
  BEFORE UPDATE ON project_extraction_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =================== INSTÂNCIAS DE EXTRAÇÃO ===================
CREATE TABLE extraction_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES project_extraction_templates(id) ON DELETE RESTRICT,
  entity_type_id UUID NOT NULL REFERENCES extraction_entity_types(id) ON DELETE RESTRICT,
  parent_instance_id UUID REFERENCES extraction_instances(id) ON DELETE CASCADE,
  label VARCHAR(255) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT uq_instance_article_entity_label UNIQUE(article_id, entity_type_id, label),
  CONSTRAINT chk_instance_sort_order CHECK (sort_order >= 0)
);

-- Trigger para updated_at
CREATE TRIGGER trg_extraction_instances_updated_at
  BEFORE UPDATE ON extraction_instances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =================== VALORES EXTRAÍDOS ===================
CREATE TABLE extracted_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  instance_id UUID NOT NULL REFERENCES extraction_instances(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES extraction_fields(id) ON DELETE RESTRICT,
  value JSONB NOT NULL DEFAULT '{}',
  source extraction_source NOT NULL,
  confidence_score DECIMAL(3,2) CHECK (confidence_score IS NULL OR (confidence_score >= 0.00 AND confidence_score <= 1.00)),
  evidence JSONB NOT NULL DEFAULT '[]',
  reviewer_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  is_consensus BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT uq_extracted_value_instance_field_reviewer UNIQUE(instance_id, field_id, reviewer_id),
  CONSTRAINT chk_extracted_value_consensus CHECK (
    (is_consensus = false) OR 
    (is_consensus = true AND reviewer_id IS NOT NULL)
  )
);

-- Trigger para updated_at
CREATE TRIGGER trg_extracted_values_updated_at
  BEFORE UPDATE ON extracted_values
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =================== EVIDÊNCIAS ===================
CREATE TABLE extraction_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  target_type VARCHAR(50) NOT NULL,
  target_id UUID NOT NULL,
  article_file_id UUID REFERENCES article_files(id) ON DELETE SET NULL,
  page_number INTEGER CHECK (page_number IS NULL OR page_number > 0),
  position JSONB DEFAULT '{}',
  text_content TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT chk_evidence_target_type CHECK (target_type IN ('value', 'instance')),
  CONSTRAINT chk_evidence_position CHECK (jsonb_typeof(position) = 'object')
);

-- =================== EXECUÇÕES DE IA ===================
CREATE TABLE extraction_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES project_extraction_templates(id) ON DELETE RESTRICT,
  stage extraction_run_stage NOT NULL,
  status extraction_run_status NOT NULL DEFAULT 'pending',
  parameters JSONB NOT NULL DEFAULT '{}',
  results JSONB NOT NULL DEFAULT '{}',
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT chk_run_timing CHECK (
    (status = 'pending' AND started_at IS NULL AND completed_at IS NULL) OR
    (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL) OR
    (status IN ('completed', 'failed') AND started_at IS NOT NULL AND completed_at IS NOT NULL)
  )
);

-- =================== SUGESTÕES DE IA ===================
CREATE TABLE ai_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
  instance_id UUID REFERENCES extraction_instances(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES extraction_fields(id) ON DELETE RESTRICT,
  suggested_value JSONB NOT NULL,
  confidence_score DECIMAL(3,2) CHECK (confidence_score IS NULL OR (confidence_score >= 0.00 AND confidence_score <= 1.00)),
  reasoning TEXT,
  status suggestion_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT chk_suggestion_review CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR
    (status IN ('accepted', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

-- =================== ÍNDICES ===================

-- Índices para templates globais
CREATE INDEX idx_extraction_templates_framework ON extraction_templates(framework);
CREATE INDEX idx_extraction_templates_global ON extraction_templates(is_global);

-- Índices para entidades
CREATE INDEX idx_extraction_entity_types_template ON extraction_entity_types(template_id);
CREATE INDEX idx_extraction_entity_types_parent ON extraction_entity_types(parent_entity_type_id);
CREATE INDEX idx_extraction_entity_types_sort ON extraction_entity_types(template_id, sort_order);

-- Índices para campos
CREATE INDEX idx_extraction_fields_entity ON extraction_fields(entity_type_id);
CREATE INDEX idx_extraction_fields_sort ON extraction_fields(entity_type_id, sort_order);

-- Índices para templates de projeto
CREATE INDEX idx_project_extraction_templates_project ON project_extraction_templates(project_id);
CREATE INDEX idx_project_extraction_templates_active ON project_extraction_templates(project_id, is_active);

-- Índices para instâncias
CREATE INDEX idx_extraction_instances_project ON extraction_instances(project_id);
CREATE INDEX idx_extraction_instances_article ON extraction_instances(article_id);
CREATE INDEX idx_extraction_instances_template ON extraction_instances(template_id);
CREATE INDEX idx_extraction_instances_entity ON extraction_instances(entity_type_id);
CREATE INDEX idx_extraction_instances_parent ON extraction_instances(parent_instance_id);
CREATE INDEX idx_extraction_instances_sort ON extraction_instances(article_id, entity_type_id, sort_order);

-- Índices para valores extraídos
CREATE INDEX idx_extracted_values_project ON extracted_values(project_id);
CREATE INDEX idx_extracted_values_article ON extracted_values(article_id);
CREATE INDEX idx_extracted_values_instance ON extracted_values(instance_id);
CREATE INDEX idx_extracted_values_field ON extracted_values(field_id);
CREATE INDEX idx_extracted_values_consensus ON extracted_values(instance_id, field_id, is_consensus);

-- Índices para evidências
CREATE INDEX idx_extraction_evidence_project ON extraction_evidence(project_id);
CREATE INDEX idx_extraction_evidence_article ON extraction_evidence(article_id);
CREATE INDEX idx_extraction_evidence_target ON extraction_evidence(target_type, target_id);
CREATE INDEX idx_extraction_evidence_file ON extraction_evidence(article_file_id);

-- Índices para execuções de IA
CREATE INDEX idx_extraction_runs_project ON extraction_runs(project_id);
CREATE INDEX idx_extraction_runs_article ON extraction_runs(article_id);
CREATE INDEX idx_extraction_runs_template ON extraction_runs(template_id);
CREATE INDEX idx_extraction_runs_status ON extraction_runs(status, stage);

-- Índices para sugestões
CREATE INDEX idx_ai_suggestions_run ON ai_suggestions(run_id);
CREATE INDEX idx_ai_suggestions_instance ON ai_suggestions(instance_id);
CREATE INDEX idx_ai_suggestions_field ON ai_suggestions(field_id);
CREATE INDEX idx_ai_suggestions_status ON ai_suggestions(status);

-- Índices GIN para campos JSONB
CREATE INDEX idx_extraction_templates_schema_gin ON extraction_templates USING GIN (schema);
CREATE INDEX idx_project_extraction_templates_schema_gin ON project_extraction_templates USING GIN (schema);
CREATE INDEX idx_extraction_instances_metadata_gin ON extraction_instances USING GIN (metadata);
CREATE INDEX idx_extracted_values_value_gin ON extracted_values USING GIN (value);
CREATE INDEX idx_extracted_values_evidence_gin ON extracted_values USING GIN (evidence);
CREATE INDEX idx_extraction_evidence_position_gin ON extraction_evidence USING GIN (position);
CREATE INDEX idx_extraction_runs_parameters_gin ON extraction_runs USING GIN (parameters);
CREATE INDEX idx_extraction_runs_results_gin ON extraction_runs USING GIN (results);
CREATE INDEX idx_ai_suggestions_suggested_value_gin ON ai_suggestions USING GIN (suggested_value);

-- =================== ROW LEVEL SECURITY ===================

-- Habilitar RLS em todas as tabelas
ALTER TABLE extraction_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_entity_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_extraction_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracted_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;

-- =================== POLÍTICAS RLS ===================

-- Templates globais - todos podem ler, apenas admins podem modificar
CREATE POLICY "Everyone can view global templates"
  ON extraction_templates FOR SELECT
  USING (is_global = true);

CREATE POLICY "Admins can manage global templates"
  ON extraction_templates FOR ALL
  USING (
    is_global = true AND 
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() 
      AND p.email IN ('admin@reviewhub.com', 'raphael@reviewhub.com')
    )
  );

-- Entidades e campos - baseado no template
CREATE POLICY "Members can view entity types"
  ON extraction_entity_types FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM extraction_templates et 
      WHERE et.id = template_id 
      AND (et.is_global = true OR EXISTS (
        SELECT 1 FROM project_extraction_templates pet 
        WHERE pet.global_template_id = et.id 
        AND is_project_member(pet.project_id, auth.uid())
      ))
    )
  );

CREATE POLICY "Admins can manage entity types"
  ON extraction_entity_types FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM extraction_templates et 
      WHERE et.id = template_id 
      AND et.is_global = true
    ) AND 
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() 
      AND p.email IN ('admin@reviewhub.com', 'raphael@reviewhub.com')
    )
  );

CREATE POLICY "Members can view fields"
  ON extraction_fields FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM extraction_entity_types eet
      JOIN extraction_templates et ON et.id = eet.template_id
      WHERE eet.id = entity_type_id
      AND (et.is_global = true OR EXISTS (
        SELECT 1 FROM project_extraction_templates pet 
        WHERE pet.global_template_id = et.id 
        AND is_project_member(pet.project_id, auth.uid())
      ))
    )
  );

CREATE POLICY "Admins can manage fields"
  ON extraction_fields FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM extraction_entity_types eet
      JOIN extraction_templates et ON et.id = eet.template_id
      WHERE eet.id = entity_type_id
      AND et.is_global = true
    ) AND 
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() 
      AND p.email IN ('admin@reviewhub.com', 'raphael@reviewhub.com')
    )
  );

-- Templates de projeto - baseado em membership
CREATE POLICY "Members can view project templates"
  ON project_extraction_templates FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Managers can manage project templates"
  ON project_extraction_templates FOR ALL
  USING (is_project_manager(project_id, auth.uid()));

-- Instâncias - baseado em membership
CREATE POLICY "Members can view instances"
  ON extraction_instances FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Members can manage instances"
  ON extraction_instances FOR ALL
  USING (is_project_member(project_id, auth.uid()));

-- Valores extraídos - baseado em membership
CREATE POLICY "Members can view extracted values"
  ON extracted_values FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Members can manage extracted values"
  ON extracted_values FOR ALL
  USING (is_project_member(project_id, auth.uid()));

-- Evidências - baseado em membership
CREATE POLICY "Members can view evidence"
  ON extraction_evidence FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Members can manage evidence"
  ON extraction_evidence FOR ALL
  USING (is_project_member(project_id, auth.uid()));

-- Execuções de IA - baseado em membership
CREATE POLICY "Members can view extraction runs"
  ON extraction_runs FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Members can manage extraction runs"
  ON extraction_runs FOR ALL
  USING (is_project_member(project_id, auth.uid()));

-- Sugestões de IA - baseado em membership
CREATE POLICY "Members can view ai suggestions"
  ON ai_suggestions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM extraction_runs er 
      WHERE er.id = run_id 
      AND is_project_member(er.project_id, auth.uid())
    )
  );

CREATE POLICY "Members can manage ai suggestions"
  ON ai_suggestions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM extraction_runs er 
      WHERE er.id = run_id 
      AND is_project_member(er.project_id, auth.uid())
    )
  );

-- =================== COMENTÁRIOS ===================

COMMENT ON TABLE extraction_templates IS 'Templates globais de extração (CHARMS, PICOS, etc.)';
COMMENT ON TABLE extraction_entity_types IS 'Tipos de entidades definidas nos templates (dataset, model, etc.)';
COMMENT ON TABLE extraction_fields IS 'Campos específicos de cada tipo de entidade';
COMMENT ON TABLE project_extraction_templates IS 'Templates clonados e customizados por projeto';
COMMENT ON TABLE extraction_instances IS 'Instâncias específicas de entidades para cada artigo';
COMMENT ON TABLE extracted_values IS 'Valores extraídos para cada campo de cada instância';
COMMENT ON TABLE extraction_evidence IS 'Evidências que suportam valores extraídos';
COMMENT ON TABLE extraction_runs IS 'Execuções de IA para sugerir valores';
COMMENT ON TABLE ai_suggestions IS 'Sugestões específicas geradas pela IA';

COMMENT ON COLUMN extraction_instances.label IS 'Rótulo da instância (ex: "Model 1", "Dataset A")';
COMMENT ON COLUMN extracted_values.value IS 'Valor extraído com metadados (tipo, unidade, etc.)';
COMMENT ON COLUMN extracted_values.source IS 'Fonte do valor: humano, IA ou regra automática';
COMMENT ON COLUMN extracted_values.is_consensus IS 'Indica se é o valor consensual final';
COMMENT ON COLUMN extraction_evidence.target_type IS 'Tipo do alvo: "value" ou "instance"';
COMMENT ON COLUMN extraction_evidence.position IS 'Posição no documento (página, coordenadas)';
