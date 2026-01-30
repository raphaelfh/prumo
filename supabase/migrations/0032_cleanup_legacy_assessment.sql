-- =====================================================
-- MIGRATION: Cleanup Legacy Assessment Tables
-- =====================================================
-- Descrição: Remove completamente tabelas e views legadas do assessment:
--
-- REMOVIDO:
-- - assessments_legacy: Tabela original (renomeada em 0031)
-- - assessments (VIEW): View de compatibilidade (não necessária)
-- - assessment_migration_status: Tabela de rastreamento de migração
-- - Triggers de compatibilidade (INSTEAD OF)
-- - Funções de compatibilidade
--
-- MOTIVO: App ainda não está em produção, não há necessidade de
-- manter compatibilidade retroativa. A nova estrutura
-- (assessment_instances + assessment_responses + assessment_evidence)
-- é a única estrutura ativa.
--
-- Referência: Limpeza pós-refatoração (migrações 0030-0031)
-- Data: 2026-01-28
-- =====================================================

-- =================== STEP 1: DROP VIEW E TRIGGERS ===================

-- Drop INSTEAD OF triggers
DROP TRIGGER IF EXISTS assessments_instead_of_insert ON assessments;
DROP TRIGGER IF EXISTS assessments_instead_of_update ON assessments;
DROP TRIGGER IF EXISTS assessments_instead_of_delete ON assessments;

-- Drop view de compatibilidade
DROP VIEW IF EXISTS assessments CASCADE;

COMMENT ON SCHEMA public IS
'Schema público. VIEW assessments removida em 2026-01-28 (migração 0032) - app não está em produção.';

-- =================== STEP 2: DROP FUNÇÕES DE COMPATIBILIDADE ===================

-- Funções usadas pelos triggers INSTEAD OF
DROP FUNCTION IF EXISTS assessments_insert_trigger() CASCADE;
DROP FUNCTION IF EXISTS assessments_update_trigger() CASCADE;
DROP FUNCTION IF EXISTS assessments_delete_trigger() CASCADE;

-- Função de warning de deprecation
DROP FUNCTION IF EXISTS log_assessment_legacy_usage() CASCADE;

-- Função de rollback (não necessária)
DROP FUNCTION IF EXISTS rollback_assessment_restructure() CASCADE;

-- =================== STEP 3: DROP TABELAS LEGADAS ===================

-- Remover tabela de rastreamento de migração
DROP TABLE IF EXISTS assessment_migration_status CASCADE;

-- Remover tabela legacy (original renomeada)
DROP TABLE IF EXISTS assessments_legacy CASCADE;

-- =================== STEP 4: VERIFICAÇÃO FINAL ===================

DO $$
DECLARE
  v_instances_count INTEGER;
  v_responses_count INTEGER;
  v_evidence_count INTEGER;
  v_view_exists BOOLEAN;
  v_legacy_exists BOOLEAN;
  v_migration_exists BOOLEAN;
BEGIN
  -- Contar registros na nova estrutura
  SELECT COUNT(*) INTO v_instances_count FROM assessment_instances;
  SELECT COUNT(*) INTO v_responses_count FROM assessment_responses;
  SELECT COUNT(*) INTO v_evidence_count FROM assessment_evidence;

  -- Verificar se tabelas/views legadas foram removidas
  SELECT EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'assessments'
  ) INTO v_view_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'assessments_legacy'
  ) INTO v_legacy_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'assessment_migration_status'
  ) INTO v_migration_exists;

  RAISE NOTICE '=== LIMPEZA DE ASSESSMENT LEGACY ===';
  RAISE NOTICE '';
  RAISE NOTICE 'ESTRUTURA NOVA (ATIVA):';
  RAISE NOTICE '  ✓ assessment_instances: % registros', v_instances_count;
  RAISE NOTICE '  ✓ assessment_responses: % registros', v_responses_count;
  RAISE NOTICE '  ✓ assessment_evidence: % registros', v_evidence_count;
  RAISE NOTICE '';
  RAISE NOTICE 'ESTRUTURA LEGACY (REMOVIDA):';
  RAISE NOTICE '  %s assessments (VIEW)', CASE WHEN NOT v_view_exists THEN '✓ Removida' ELSE '✗ Ainda existe' END;
  RAISE NOTICE '  %s assessments_legacy', CASE WHEN NOT v_legacy_exists THEN '✓ Removida' ELSE '✗ Ainda existe' END;
  RAISE NOTICE '  %s assessment_migration_status', CASE WHEN NOT v_migration_exists THEN '✓ Removida' ELSE '✗ Ainda existe' END;
  RAISE NOTICE '';

  -- Validação
  IF v_view_exists THEN
    RAISE EXCEPTION 'ERRO: VIEW assessments ainda existe!';
  END IF;

  IF v_legacy_exists THEN
    RAISE EXCEPTION 'ERRO: Tabela assessments_legacy ainda existe!';
  END IF;

  IF v_migration_exists THEN
    RAISE EXCEPTION 'ERRO: Tabela assessment_migration_status ainda existe!';
  END IF;

  RAISE NOTICE '✓ Limpeza concluída com sucesso!';
  RAISE NOTICE '====================================';
END $$;

-- =================== STEP 5: ATUALIZAR COMENTÁRIOS ===================

COMMENT ON TABLE assessment_instances IS
'Instâncias de avaliação (PROBAST por artigo ou por modelo).
Análogo a extraction_instances.
ESTRUTURA ATIVA desde migração 0030 (2026-01-27).
Tabela legada "assessments" removida em 0032 (2026-01-28).';

COMMENT ON TABLE assessment_responses IS
'Respostas individuais aos itens de avaliação.
Análogo a extracted_values.
Granularidade total: 1 linha = 1 resposta.
ESTRUTURA ATIVA desde migração 0030 (2026-01-27).';

COMMENT ON TABLE assessment_evidence IS
'Evidências que suportam respostas de avaliação ou instances.
Análogo a extraction_evidence.
ESTRUTURA ATIVA desde migração 0030 (2026-01-27).';

-- =================== FIM DA MIGRATION ===================
