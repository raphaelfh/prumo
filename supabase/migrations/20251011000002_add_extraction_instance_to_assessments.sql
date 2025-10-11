-- =====================================================
-- MIGRATION: Adicionar Extraction Instance em Assessments
-- =====================================================
-- Descrição: Permite assessments por instância de extraction
-- (ex: um PROBAST por modelo)
-- =====================================================

-- Adicionar coluna para assessment por instância
ALTER TABLE assessments
ADD COLUMN extraction_instance_id UUID 
  REFERENCES extraction_instances(id) ON DELETE CASCADE;

-- Índice para queries de assessment por instância
CREATE INDEX idx_assessments_extraction_instance 
  ON assessments(extraction_instance_id)
  WHERE extraction_instance_id IS NOT NULL;

-- Remover constraint único antigo
ALTER TABLE assessments
DROP CONSTRAINT IF EXISTS uq_assessment_article_user_tool_ver;

-- Criar constraints únicos condicionais
-- Para assessments por artigo (legacy)
CREATE UNIQUE INDEX uq_assessment_article_user_tool
  ON assessments(article_id, user_id, tool_type, version)
  WHERE extraction_instance_id IS NULL;

-- Para assessments por instância (novo)
CREATE UNIQUE INDEX uq_assessment_instance_user_tool
  ON assessments(extraction_instance_id, user_id, tool_type, version)
  WHERE extraction_instance_id IS NOT NULL;

-- Comentário para documentação
COMMENT ON COLUMN assessments.extraction_instance_id IS 
  'If NULL, assessment is for entire article. If set, assessment is for specific extraction instance (e.g., a prediction model)';


