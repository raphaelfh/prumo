-- =====================================================
-- MIGRATION: Adicionar campo llm_description para instruções de IA
-- =====================================================
-- Descrição: Adiciona coluna para instruções específicas de LLM
-- em cada campo de extração, permitindo prompts personalizados
-- para extração automática com IA
-- =====================================================

-- Adicionar coluna llm_description
ALTER TABLE extraction_fields
ADD COLUMN llm_description TEXT;

-- Comentário explicativo
COMMENT ON COLUMN extraction_fields.llm_description IS 
'Descrição específica para extração com IA (LLM). 
Instrução clara e detalhada sobre como extrair este campo dos artigos.

Exemplos:
- "Extraia o número total de participantes incluídos no estudo inicial, antes de qualquer exclusão por dados ausentes"
- "Procure na seção Methods ou Study Population os critérios de inclusão. Liste todos os critérios, um por linha"
- "Identifique o tipo de modelo preditivo usado (ex: regressão logística, random forest, etc)"

Esta instrução será usada como contexto adicional quando implementarmos extração automática com IA.';

-- Log de sucesso
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Coluna llm_description adicionada com sucesso';
  RAISE NOTICE 'Campos de extração agora suportam instruções personalizadas para IA';
  RAISE NOTICE '========================================';
END $$;

