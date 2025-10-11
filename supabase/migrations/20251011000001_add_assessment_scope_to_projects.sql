-- =====================================================
-- MIGRATION: Adicionar Assessment Scope em Projects
-- =====================================================
-- Descrição: Adiciona campos para configurar assessment 
-- por artigo ou por instância de extraction
-- =====================================================

-- Adicionar campos para configuração de assessment
ALTER TABLE projects 
ADD COLUMN assessment_scope VARCHAR(20) DEFAULT 'article'
  CHECK (assessment_scope IN ('article', 'extraction_instance')),
ADD COLUMN assessment_entity_type_id UUID 
  REFERENCES extraction_entity_types(id) ON DELETE SET NULL;

-- Índices para queries
CREATE INDEX idx_projects_assessment_scope ON projects(assessment_scope);
CREATE INDEX idx_projects_assessment_entity_type ON projects(assessment_entity_type_id);

-- Comentários para documentação
COMMENT ON COLUMN projects.assessment_scope IS 
  'Defines assessment scope: article (one per article) or extraction_instance (one per model/instance)';

COMMENT ON COLUMN projects.assessment_entity_type_id IS 
  'If assessment_scope = extraction_instance, specifies which entity_type to assess (e.g., prediction_models)';


