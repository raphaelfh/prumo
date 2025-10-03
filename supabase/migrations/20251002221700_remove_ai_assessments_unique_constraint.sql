-- Remove UNIQUE constraint que impede múltiplas avaliações
-- Permite que o mesmo usuário faça múltiplas avaliações AI para o mesmo artigo/item
-- (útil para testar diferentes prompts, comparar resultados, etc.)

ALTER TABLE public.ai_assessments 
DROP CONSTRAINT IF EXISTS ai_assessments_article_id_assessment_item_id_user_id_key;

-- Adicionar índice composto para performance (sem UNIQUE)
-- Isso mantém queries rápidas mas permite duplicatas
CREATE INDEX IF NOT EXISTS idx_ai_assessments_article_item_user 
ON public.ai_assessments(article_id, assessment_item_id, user_id, created_at DESC);

COMMENT ON TABLE public.ai_assessments IS 'AI-generated assessment responses with evidence and justification. Multiple assessments per article/item/user are allowed for comparison and iteration.';

