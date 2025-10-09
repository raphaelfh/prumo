-- =====================================================
-- Migration: Adicionar tracking de AI suggestions
-- Data: 2025-10-08
-- Descrição: Adiciona ai_suggestion_id em extracted_values
--            para trackear qual sugestão originou o valor
-- =====================================================

-- Adicionar coluna para vincular valor extraído à sugestão de IA
ALTER TABLE extracted_values
ADD COLUMN IF NOT EXISTS ai_suggestion_id uuid REFERENCES ai_suggestions(id) ON DELETE SET NULL;

-- Índice para busca rápida
CREATE INDEX IF NOT EXISTS idx_extracted_values_ai_suggestion
ON extracted_values(ai_suggestion_id)
WHERE ai_suggestion_id IS NOT NULL;

-- Comentário explicativo
COMMENT ON COLUMN extracted_values.ai_suggestion_id IS
'ID da sugestão de IA que originou este valor extraído. Permite rastrear quais valores foram aceitos de sugestões de IA.';

-- Adicionar índices de performance para queries comuns
CREATE INDEX IF NOT EXISTS idx_extracted_values_article_reviewer
ON extracted_values(article_id, reviewer_id);

CREATE INDEX IF NOT EXISTS idx_extracted_values_instance_field
ON extracted_values(instance_id, field_id);

CREATE INDEX IF NOT EXISTS idx_ai_suggestions_instance_field_status
ON ai_suggestions(instance_id, field_id, status);

CREATE INDEX IF NOT EXISTS idx_ai_suggestions_status
ON ai_suggestions(status)
WHERE status = 'pending';

-- Índice para buscar extrações de outros membros
CREATE INDEX IF NOT EXISTS idx_extracted_values_article_source
ON extracted_values(article_id, source, reviewer_id);

COMMENT ON INDEX idx_extracted_values_ai_suggestion IS
'Índice para buscar valores que vieram de sugestões de IA';

COMMENT ON INDEX idx_ai_suggestions_status IS
'Índice parcial para buscar apenas sugestões pendentes de revisão';

