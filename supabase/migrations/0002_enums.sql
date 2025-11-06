-- =====================================================
-- MIGRATION: Enums
-- =====================================================
-- Descrição: Cria todos os tipos ENUM necessários para o sistema
-- =====================================================

-- =================== PROJECT ENUMS ===================

CREATE TYPE review_type AS ENUM (
  'interventional',
  'predictive_model',
  'diagnostic',
  'prognostic',
  'qualitative',
  'other'
);

COMMENT ON TYPE review_type IS 'Tipo de revisão sistemática';

CREATE TYPE project_member_role AS ENUM (
  'manager',
  'reviewer',
  'viewer',
  'consensus'
);

COMMENT ON TYPE project_member_role IS 'Papel do membro no projeto';

-- =================== FILE ENUMS ===================

CREATE TYPE file_role AS ENUM (
  'MAIN',
  'SUPPLEMENT',
  'PROTOCOL',
  'DATASET',
  'APPENDIX',
  'FIGURE',
  'OTHER'
);

COMMENT ON TYPE file_role IS 'Papel/tipo do arquivo do artigo';

-- =================== EXTRACTION ENUMS ===================

CREATE TYPE extraction_framework AS ENUM (
  'CHARMS',
  'PICOS',
  'CUSTOM'
);

COMMENT ON TYPE extraction_framework IS 'Framework de extração de dados';

CREATE TYPE extraction_field_type AS ENUM (
  'text',
  'number',
  'date',
  'select',
  'multiselect',
  'boolean'
);

COMMENT ON TYPE extraction_field_type IS 'Tipo de campo de extração';

CREATE TYPE extraction_cardinality AS ENUM (
  'one',
  'many'
);

COMMENT ON TYPE extraction_cardinality IS 'Cardinalidade da entidade (um ou muitos)';

CREATE TYPE extraction_source AS ENUM (
  'human',
  'ai',
  'rule'
);

COMMENT ON TYPE extraction_source IS 'Fonte do valor extraído';

CREATE TYPE extraction_run_stage AS ENUM (
  'data_suggest',
  'parsing',
  'validation',
  'consensus'
);

COMMENT ON TYPE extraction_run_stage IS 'Estágio da execução de extração';

CREATE TYPE extraction_run_status AS ENUM (
  'pending',
  'running',
  'completed',
  'failed'
);

COMMENT ON TYPE extraction_run_status IS 'Status da execução de extração';

CREATE TYPE suggestion_status AS ENUM (
  'pending',
  'accepted',
  'rejected'
);

COMMENT ON TYPE suggestion_status IS 'Status da sugestão de IA';

-- =================== ASSESSMENT ENUMS ===================

CREATE TYPE assessment_status AS ENUM (
  'in_progress',
  'submitted',
  'locked',
  'archived'
);

COMMENT ON TYPE assessment_status IS 'Status da avaliação de qualidade';

