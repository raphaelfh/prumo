-- =====================================================
-- MIGRATION: Reset Completo e Limpo do Sistema de Extraction
-- =====================================================
-- Descrição: Remove redundâncias e cria schema definitivo
-- ATENÇÃO: Esta migration deleta dados. Use apenas em desenvolvimento.
-- =====================================================

-- =================== LIMPEZA ===================

-- 1. Dropar tabelas antigas se existirem (extraction_forms, extractions)
DROP TABLE IF EXISTS extractions CASCADE;
DROP TABLE IF EXISTS extraction_forms CASCADE;

-- 2. Dropar tipos enum antigos se não usados
DROP TYPE IF EXISTS extraction_status CASCADE;

-- 3. Deletar templates antigos (manter apenas estrutura)
-- Deletar CHARMS 1.0 e seus entity_types/fields
DELETE FROM extraction_fields WHERE entity_type_id IN (
  SELECT id FROM extraction_entity_types WHERE template_id IN (
    SELECT id FROM extraction_templates_global WHERE name = 'CHARMS' AND version = '1.0.0'
  )
);
DELETE FROM extraction_entity_types WHERE template_id IN (
  SELECT id FROM extraction_templates_global WHERE name = 'CHARMS' AND version = '1.0.0'
);
DELETE FROM extraction_templates_global WHERE name = 'CHARMS' AND version = '1.0.0';

-- 4. Limpar project_extraction_templates e entity_types órfãos
DELETE FROM extraction_fields WHERE entity_type_id IN (
  SELECT id FROM extraction_entity_types WHERE project_template_id IN (
    SELECT id FROM project_extraction_templates WHERE is_active = false
  )
);
DELETE FROM extraction_entity_types WHERE project_template_id IN (
  SELECT id FROM project_extraction_templates WHERE is_active = false
);
DELETE FROM project_extraction_templates WHERE is_active = false;

-- 5. Remover coluna is_template de extraction_instances (simplificação)
-- Não dropar a coluna para não quebrar código existente, mas marcar como deprecated
COMMENT ON COLUMN extraction_instances.is_template IS 
  'DEPRECATED: Not used in new system. Templates work directly with entity_types.';

-- =================== GARANTIR SCHEMA CORRETO ===================

-- Verificar que extraction_entity_types tem ambas as colunas
DO $$
BEGIN
  -- Adicionar project_template_id se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'extraction_entity_types' AND column_name = 'project_template_id'
  ) THEN
    ALTER TABLE extraction_entity_types
    ADD COLUMN project_template_id UUID REFERENCES project_extraction_templates(id) ON DELETE CASCADE;
    
    CREATE INDEX idx_extraction_entity_types_project_template 
      ON extraction_entity_types(project_template_id);
  END IF;
END $$;

-- =================== CRIAR ÍNDICES OTIMIZADOS ===================

-- Índices para queries de hierarquia (se não existirem)
CREATE INDEX IF NOT EXISTS idx_extraction_entity_types_parent 
  ON extraction_entity_types(parent_entity_type_id)
  WHERE parent_entity_type_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_extraction_instances_parent 
  ON extraction_instances(parent_instance_id)
  WHERE parent_instance_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_extraction_instances_article_entity_parent
  ON extraction_instances(article_id, entity_type_id, parent_instance_id);

-- Índices para assessment por instância
CREATE INDEX IF NOT EXISTS idx_assessments_extraction_instance 
  ON assessments(extraction_instance_id)
  WHERE extraction_instance_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assessments_article_instance
  ON assessments(article_id, extraction_instance_id);

-- =================== FUNÇÕES HELPER ===================

-- Função para obter children recursivamente (se não existir)
CREATE OR REPLACE FUNCTION get_instance_children(p_parent_id UUID)
RETURNS TABLE (
  id UUID,
  label VARCHAR,
  entity_type_id UUID,
  level INTEGER
) AS $$
  WITH RECURSIVE children AS (
    SELECT 
      id, 
      label, 
      entity_type_id, 
      parent_instance_id, 
      1 as level
    FROM extraction_instances
    WHERE parent_instance_id = p_parent_id
    
    UNION ALL
    
    SELECT 
      ei.id, 
      ei.label, 
      ei.entity_type_id, 
      ei.parent_instance_id, 
      c.level + 1
    FROM extraction_instances ei
    JOIN children c ON ei.parent_instance_id = c.id
  )
  SELECT id, label, entity_type_id, level 
  FROM children
  ORDER BY level, label;
$$ LANGUAGE SQL STABLE;

-- Função para obter path completo
CREATE OR REPLACE FUNCTION get_instance_path(p_instance_id UUID)
RETURNS TEXT AS $$
  WITH RECURSIVE path AS (
    SELECT 
      id, 
      label, 
      parent_instance_id,
      label::TEXT as full_path,
      1 as level
    FROM extraction_instances
    WHERE id = p_instance_id
    
    UNION ALL
    
    SELECT 
      ei.id, 
      ei.label, 
      ei.parent_instance_id,
      ei.label || ' > ' || p.full_path,
      p.level + 1
    FROM extraction_instances ei
    JOIN path p ON ei.id = p.parent_instance_id
  )
  SELECT full_path 
  FROM path
  WHERE parent_instance_id IS NULL
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- =================== LOG FINAL ===================

DO $$
DECLARE
  charms_count INT;
  entity_types_count INT;
  fields_count INT;
BEGIN
  SELECT COUNT(*) INTO charms_count 
  FROM extraction_templates_global WHERE name = 'CHARMS';
  
  SELECT COUNT(*) INTO entity_types_count 
  FROM extraction_entity_types WHERE template_id IN (
    SELECT id FROM extraction_templates_global WHERE name = 'CHARMS'
  );
  
  SELECT COUNT(*) INTO fields_count 
  FROM extraction_fields WHERE entity_type_id IN (
    SELECT id FROM extraction_entity_types WHERE template_id IN (
      SELECT id FROM extraction_templates_global WHERE name = 'CHARMS'
    )
  );
  
  RAISE NOTICE '========================================';
  RAISE NOTICE 'RESET COMPLETO E LIMPO FINALIZADO';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Templates CHARMS: %', charms_count;
  RAISE NOTICE 'Entity Types: %', entity_types_count;
  RAISE NOTICE 'Fields: %', fields_count;
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Sistema limpo e pronto para produção!';
  RAISE NOTICE '========================================';
END $$;


