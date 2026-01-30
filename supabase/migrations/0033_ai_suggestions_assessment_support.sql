-- =====================================================
-- MIGRATION: Add Assessment Support to ai_suggestions
-- =====================================================
-- Descrição: Adiciona suporte para assessment suggestions na tabela ai_suggestions.
--
-- PROBLEMA:
-- O frontend aiAssessmentSuggestionService.ts tenta fazer JOIN entre
-- ai_suggestions e ai_assessment_runs, mas não existe FK entre essas tabelas.
--
-- SOLUÇÃO:
-- 1. Renomear run_id para extraction_run_id (mais específico)
-- 2. Adicionar assessment_run_id (FK opcional para ai_assessment_runs)
-- 3. Garantir que run_id seja extraction_run_id OU assessment_run_id
--    (not both, not neither)
--
-- ESTRUTURA APÓS MIGRATION:
-- ai_suggestions pode ser de:
-- - Extraction: extraction_run_id NOT NULL, assessment_run_id IS NULL
-- - Assessment: assessment_run_id NOT NULL, extraction_run_id IS NULL
--
-- Data: 2026-01-28
-- =====================================================

-- =================== STEP 1: ADICIONAR NOVA COLUNA ===================

-- Adicionar assessment_run_id (FK opcional para ai_assessment_runs)
ALTER TABLE ai_suggestions
  ADD COLUMN assessment_run_id uuid REFERENCES ai_assessment_runs(id) ON DELETE CASCADE;

COMMENT ON COLUMN ai_suggestions.assessment_run_id IS
'FK para ai_assessment_runs. Preenchido quando sugestão é de assessment. Mutuamente exclusivo com extraction_run_id.';

-- =================== STEP 2: RENOMEAR run_id PARA extraction_run_id ===================

-- 2.1. Remover FK antiga
ALTER TABLE ai_suggestions
  DROP CONSTRAINT IF EXISTS ai_suggestions_run_id_fkey;

-- 2.2. Renomear coluna
ALTER TABLE ai_suggestions
  RENAME COLUMN run_id TO extraction_run_id;

-- 2.3. Recriar FK com novo nome
ALTER TABLE ai_suggestions
  ADD CONSTRAINT ai_suggestions_extraction_run_id_fkey
  FOREIGN KEY (extraction_run_id)
  REFERENCES extraction_runs(id)
  ON DELETE CASCADE;

COMMENT ON COLUMN ai_suggestions.extraction_run_id IS
'FK para extraction_runs. Preenchido quando sugestão é de extraction. Mutuamente exclusivo com assessment_run_id.';

-- =================== STEP 3: CHECK CONSTRAINT ===================

-- Garantir que EXATAMENTE UMA das FKs está preenchida
ALTER TABLE ai_suggestions
  ADD CONSTRAINT ai_suggestions_run_type_check
  CHECK (
    (extraction_run_id IS NOT NULL AND assessment_run_id IS NULL) OR
    (extraction_run_id IS NULL AND assessment_run_id IS NOT NULL)
  );

COMMENT ON CONSTRAINT ai_suggestions_run_type_check ON ai_suggestions IS
'Garante que sugestão pertence a EXATAMENTE um tipo de run (extraction OU assessment, nunca ambos ou nenhum).';

-- =================== STEP 4: INDEXES ===================

-- Index para buscar sugestões por assessment_run_id
CREATE INDEX idx_ai_suggestions_assessment_run_id
  ON ai_suggestions(assessment_run_id)
  WHERE assessment_run_id IS NOT NULL;

-- Index para buscar sugestões por extraction_run_id (já existia como idx_ai_suggestions_run_id)
-- Apenas renomear para consistência
DROP INDEX IF EXISTS idx_ai_suggestions_run_id;

CREATE INDEX idx_ai_suggestions_extraction_run_id
  ON ai_suggestions(extraction_run_id)
  WHERE extraction_run_id IS NOT NULL;

-- =================== STEP 5: ATUALIZAR COMENTÁRIO DA TABELA ===================

COMMENT ON TABLE ai_suggestions IS
'Sugestões de IA para extraction OU assessment.
- Extraction suggestions: extraction_run_id NOT NULL, field_id NOT NULL
- Assessment suggestions: assessment_run_id NOT NULL, assessment_item_id NOT NULL
Constraint garante que sugestão pertence a EXATAMENTE um tipo de run.';

-- =================== STEP 6: VERIFICAÇÃO FINAL ===================

DO $$
DECLARE
  v_extraction_count INTEGER;
  v_assessment_count INTEGER;
  v_invalid_count INTEGER;
BEGIN
  -- Contar sugestões de extraction
  SELECT COUNT(*) INTO v_extraction_count
  FROM ai_suggestions
  WHERE extraction_run_id IS NOT NULL;

  -- Contar sugestões de assessment (deve ser 0 por enquanto)
  SELECT COUNT(*) INTO v_assessment_count
  FROM ai_suggestions
  WHERE assessment_run_id IS NOT NULL;

  -- Contar sugestões inválidas (não deveria existir nenhuma)
  SELECT COUNT(*) INTO v_invalid_count
  FROM ai_suggestions
  WHERE (extraction_run_id IS NULL AND assessment_run_id IS NULL)
     OR (extraction_run_id IS NOT NULL AND assessment_run_id IS NOT NULL);

  RAISE NOTICE '=== VERIFICAÇÃO DE AI_SUGGESTIONS ===';
  RAISE NOTICE '  Sugestões de extraction: %', v_extraction_count;
  RAISE NOTICE '  Sugestões de assessment: %', v_assessment_count;
  RAISE NOTICE '  Sugestões inválidas (erro): %', v_invalid_count;
  RAISE NOTICE '';

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'ERRO: Existem % sugestões inválidas (ambas FKs ou nenhuma FK)', v_invalid_count;
  END IF;

  RAISE NOTICE '✅ Migration concluída com sucesso!';
  RAISE NOTICE '  - extraction_run_id: % sugestões', v_extraction_count;
  RAISE NOTICE '  - assessment_run_id: % sugestões (novas)', v_assessment_count;
  RAISE NOTICE '====================================';
END $$;

-- =================== FIM DA MIGRATION ===================
