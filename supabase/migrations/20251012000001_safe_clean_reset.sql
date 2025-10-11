-- =====================================================
-- MIGRATION: Reset Seguro e Completo
-- =====================================================
-- Descrição: Remove dados de forma ordenada respeitando foreign keys
-- ATENÇÃO: Deleta TODOS os dados de extraction. Use apenas em dev.
-- =====================================================

-- =================== DELETAR DADOS EM ORDEM REVERSA ===================

-- 1. Deletar valores extraídos
DELETE FROM extracted_values;

-- 2. Deletar evidências
DELETE FROM extraction_evidence;

-- 3. Deletar sugestões de IA
DELETE FROM ai_suggestions;

-- 4. Deletar extraction runs
DELETE FROM extraction_runs;

-- 5. Deletar extraction instances
DELETE FROM extraction_instances;

-- 6. Deletar fields de project templates
DELETE FROM extraction_fields WHERE entity_type_id IN (
  SELECT id FROM extraction_entity_types WHERE project_template_id IS NOT NULL
);

-- 7. Deletar entity_types de project templates
DELETE FROM extraction_entity_types WHERE project_template_id IS NOT NULL;

-- 8. Deletar project templates
DELETE FROM project_extraction_templates;

-- 9. Deletar fields de templates globais antigos
DELETE FROM extraction_fields WHERE entity_type_id IN (
  SELECT id FROM extraction_entity_types WHERE template_id IN (
    SELECT id FROM extraction_templates_global WHERE version != '2.0.0'
  )
);

-- 10. Deletar entity_types de templates globais antigos
DELETE FROM extraction_entity_types WHERE template_id IN (
  SELECT id FROM extraction_templates_global WHERE version != '2.0.0'
);

-- 11. Deletar templates globais antigos (manter apenas 2.0.0)
DELETE FROM extraction_templates_global WHERE version != '2.0.0';

-- =================== DROPAR TABELAS OBSOLETAS ===================

DROP TABLE IF EXISTS extractions CASCADE;
DROP TABLE IF EXISTS extraction_forms CASCADE;

-- =================== GARANTIR SCHEMA LIMPO ===================

-- Comentar coluna deprecated
COMMENT ON COLUMN extraction_instances.is_template IS 
  'DEPRECATED: Not used in new system. All configuration works through entity_types.';

-- Garantir que status e progress existem
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'extraction_instances' AND column_name = 'status'
  ) THEN
    ALTER TABLE extraction_instances
    ADD COLUMN status VARCHAR(20) DEFAULT 'pending'
      CHECK (status IN ('pending', 'in_progress', 'completed', 'reviewed'));
  END IF;
END $$;

-- =================== VERIFICAR CONSTRAINTS ===================

-- Garantir que assessments tem constraints corretos
DROP INDEX IF EXISTS uq_assessment_article_user_tool_ver;

CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_article_user_tool
  ON assessments(article_id, user_id, tool_type, version)
  WHERE extraction_instance_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_instance_user_tool
  ON assessments(extraction_instance_id, user_id, tool_type, version)
  WHERE extraction_instance_id IS NOT NULL;

-- =================== LOG FINAL ===================

DO $$
DECLARE
  templates_count INT;
  entity_types_count INT;
  fields_count INT;
  instances_count INT;
  values_count INT;
BEGIN
  SELECT COUNT(*) INTO templates_count FROM extraction_templates_global;
  SELECT COUNT(*) INTO entity_types_count FROM extraction_entity_types WHERE template_id IS NOT NULL;
  SELECT COUNT(*) INTO fields_count FROM extraction_fields WHERE entity_type_id IN (
    SELECT id FROM extraction_entity_types WHERE template_id IS NOT NULL
  );
  SELECT COUNT(*) INTO instances_count FROM extraction_instances;
  SELECT COUNT(*) INTO values_count FROM extracted_values;
  
  RAISE NOTICE '========================================';
  RAISE NOTICE 'RESET SEGURO COMPLETO';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Templates globais: %', templates_count;
  RAISE NOTICE 'Entity types globais: %', entity_types_count;
  RAISE NOTICE 'Fields globais: %', fields_count;
  RAISE NOTICE 'Extraction instances: %', instances_count;
  RAISE NOTICE 'Extracted values: %', values_count;
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Sistema limpo e pronto!';
  RAISE NOTICE 'Apenas CHARMS 2.0 permanece como template global';
  RAISE NOTICE '========================================';
END $$;


