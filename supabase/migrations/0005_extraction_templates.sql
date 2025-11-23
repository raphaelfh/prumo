-- =====================================================
-- MIGRATION: Extraction Templates
-- =====================================================
-- Descrição: Cria tabelas de templates de extração: 
-- extraction_templates_global, project_extraction_templates,
-- extraction_entity_types, extraction_fields
-- =====================================================

-- =================== EXTRACTION TEMPLATES GLOBAL ===================

CREATE TABLE extraction_templates_global (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  name character varying NOT NULL,
  description text,
  framework extraction_framework NOT NULL,
  version character varying NOT NULL DEFAULT '1.0.0'::character varying 
    CHECK (version::text ~ '^\d+\.\d+\.\d+$'),
  is_global boolean NOT NULL DEFAULT true,
  schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE extraction_templates_global IS 'Templates globais de extração (CHARMS, PICOS, etc.)';
COMMENT ON COLUMN extraction_templates_global.framework IS 'Framework de extração usado';
COMMENT ON COLUMN extraction_templates_global.is_global IS 'Sempre true para templates globais';

-- =================== PROJECT EXTRACTION TEMPLATES ===================

CREATE TABLE project_extraction_templates (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  global_template_id uuid,
  name character varying NOT NULL,
  description text,
  framework extraction_framework NOT NULL,
  version character varying NOT NULL DEFAULT '1.0.0'::character varying 
    CHECK (version::text ~ '^\d+\.\d+\.\d+$'),
  schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_extraction_templates_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT project_extraction_templates_global_template_id_fkey FOREIGN KEY (global_template_id) REFERENCES extraction_templates_global(id) ON DELETE SET NULL,
  CONSTRAINT project_extraction_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT
);

COMMENT ON TABLE project_extraction_templates IS 'Templates de extração clonados e customizados por projeto';
COMMENT ON COLUMN project_extraction_templates.global_template_id IS 'Referência ao template global do qual foi clonado (opcional)';

-- =================== EXTRACTION ENTITY TYPES ===================

CREATE TABLE extraction_entity_types (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid,
  name character varying NOT NULL CHECK (name::text ~ '^[a-z][a-z0-9_]*$'),
  label character varying NOT NULL,
  description text,
  parent_entity_type_id uuid,
  cardinality extraction_cardinality NOT NULL DEFAULT 'one'::extraction_cardinality,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  project_template_id uuid,
  CONSTRAINT extraction_entity_types_parent_entity_type_id_fkey FOREIGN KEY (parent_entity_type_id) REFERENCES extraction_entity_types(id) ON DELETE CASCADE,
  CONSTRAINT extraction_entity_types_template_id_fkey FOREIGN KEY (template_id) REFERENCES extraction_templates_global(id) ON DELETE CASCADE,
  CONSTRAINT extraction_entity_types_project_template_id_fkey FOREIGN KEY (project_template_id) REFERENCES project_extraction_templates(id) ON DELETE CASCADE,
  -- Constraint XOR: template_id e project_template_id são mutuamente exclusivos
  CONSTRAINT chk_entity_type_template_xor CHECK (
    (template_id IS NOT NULL AND project_template_id IS NULL) OR
    (template_id IS NULL AND project_template_id IS NOT NULL)
  )
);

COMMENT ON TABLE extraction_entity_types IS 'Tipos de entidades definidas nos templates (dataset, model, etc.)';
COMMENT ON COLUMN extraction_entity_types.template_id IS 'FK para extraction_templates_global (se entity type pertence a template global)';
COMMENT ON COLUMN extraction_entity_types.project_template_id IS 'FK para project_extraction_templates (se entity type pertence a template de projeto)';
COMMENT ON CONSTRAINT chk_entity_type_template_xor ON extraction_entity_types IS 'Garante que cada entity_type pertence ou a um template global ou a um template de projeto, mas nunca ambos ou nenhum';

-- =================== EXTRACTION FIELDS ===================

CREATE TABLE extraction_fields (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type_id uuid NOT NULL,
  name character varying NOT NULL CHECK (name::text ~ '^[a-z][a-z0-9_]*$'),
  label character varying NOT NULL,
  description text,
  field_type extraction_field_type NOT NULL,
  is_required boolean NOT NULL DEFAULT false,
  validation_schema jsonb DEFAULT '{}'::jsonb,
  allowed_values jsonb,
  unit character varying,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  allowed_units jsonb,
  llm_description text,
  CONSTRAINT extraction_fields_entity_type_id_fkey FOREIGN KEY (entity_type_id) REFERENCES extraction_entity_types(id) ON DELETE CASCADE
);

COMMENT ON TABLE extraction_fields IS 'Campos específicos de cada tipo de entidade';
COMMENT ON COLUMN extraction_fields.field_type IS 'Tipo do campo (text, number, date, etc.)';
COMMENT ON COLUMN extraction_fields.allowed_values IS 'Valores permitidos para campos select/multiselect';
COMMENT ON COLUMN extraction_fields.unit IS 'Unidade padrão do campo numérico';
COMMENT ON COLUMN extraction_fields.allowed_units IS 'Lista de unidades permitidas para o campo';
COMMENT ON COLUMN extraction_fields.llm_description IS 'Descrição específica para LLM sobre como extrair este campo';

-- =================== ADD FK FOR PROJECTS.ASSESSMENT_ENTITY_TYPE_ID ===================
-- Adicionar FK de assessment_entity_type_id após criar extraction_entity_types
ALTER TABLE projects 
  ADD CONSTRAINT projects_assessment_entity_type_id_fkey 
  FOREIGN KEY (assessment_entity_type_id) 
  REFERENCES extraction_entity_types(id) 
  ON DELETE SET NULL;

