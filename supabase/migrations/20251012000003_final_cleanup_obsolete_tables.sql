-- =====================================================
-- MIGRATION: Limpeza Final de Tabelas Obsoletas
-- =====================================================
-- Descrição: Remove VIEW redundante e tabelas nunca implementadas
-- Mantém arquitetura de templates opcionais (extraction_templates_global)
-- =====================================================

-- =================== DROPAR VIEW REDUNDANTE ===================

-- VIEW extraction_templates é redundante (aponta para extraction_templates_global)
-- Nenhum código usa esta VIEW, apenas extraction_templates_global diretamente
DROP VIEW IF EXISTS extraction_templates;

RAISE NOTICE 'VIEW extraction_templates removida (redundante)';

-- =================== DROPAR TABELAS NÃO IMPLEMENTADAS ===================

-- audit_log nunca foi implementada (sem triggers, sem UI, sem código)
DROP TABLE IF EXISTS audit_log CASCADE;

RAISE NOTICE 'Tabela audit_log removida (nunca implementada)';

-- article_pdf_versions - feature de versionamento nunca foi implementada
DROP TABLE IF EXISTS article_pdf_versions CASCADE;

RAISE NOTICE 'Tabela article_pdf_versions removida (feature não existe)';

-- =================== VERIFICAR INTEGRIDADE ===================

-- Confirmar que extraction_forms e extractions já foram deletadas
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name IN ('extraction_forms', 'extractions')
  ) THEN
    RAISE WARNING 'Tabelas extraction_forms ou extractions ainda existem!';
    DROP TABLE IF EXISTS extractions CASCADE;
    DROP TABLE IF EXISTS extraction_forms CASCADE;
    RAISE NOTICE 'Tabelas extraction_forms e extractions removidas';
  END IF;
END $$;

-- =================== LOG FINAL ===================

DO $$
DECLARE
  total_tables INT;
  extraction_tables INT;
BEGIN
  -- Contar tabelas totais
  SELECT COUNT(*) INTO total_tables
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
  
  -- Contar tabelas de extraction
  SELECT COUNT(*) INTO extraction_tables
  FROM information_schema.tables
  WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
    AND table_name LIKE '%extraction%';
  
  RAISE NOTICE '========================================';
  RAISE NOTICE 'LIMPEZA FINAL COMPLETA';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Tabelas deletadas:';
  RAISE NOTICE '  - extraction_templates (VIEW)';
  RAISE NOTICE '  - audit_log';
  RAISE NOTICE '  - article_pdf_versions';
  RAISE NOTICE '  - extraction_forms (se existia)';
  RAISE NOTICE '  - extractions (se existia)';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Schema limpo:';
  RAISE NOTICE '  Total de tabelas: %', total_tables;
  RAISE NOTICE '  Tabelas extraction: %', extraction_tables;
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Arquitetura de templates mantida:';
  RAISE NOTICE '  ✓ extraction_templates_global (master)';
  RAISE NOTICE '  ✓ project_extraction_templates (projetos)';
  RAISE NOTICE '  ✓ extraction_entity_types (seções)';
  RAISE NOTICE '  ✓ extraction_fields (campos)';
  RAISE NOTICE '  ✓ extraction_instances (dados)';
  RAISE NOTICE '  ✓ extracted_values (valores)';
  RAISE NOTICE '========================================';
END $$;

