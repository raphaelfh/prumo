/**
 * Migration: Adicionar coluna metadata à tabela ai_suggestions
 * 
 * MOTIVAÇÃO: Armazenar metadados adicionais da extração de IA de forma organizada.
 * A coluna metadata armazena informações como evidence (trechos do texto),
 * enquanto suggested_value fica focado apenas no valor extraído.
 * 
 * ESTRUTURA:
 * - metadata JSONB: Armazena metadados estruturados
 *   {
 *     evidence?: {
 *       text: string,
 *       page_number?: number
 *     },
 *     // Outros metadados futuros podem ser adicionados aqui
 *   }
 */

-- Adicionar coluna metadata como JSONB
ALTER TABLE public.ai_suggestions
ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Comentário explicativo
COMMENT ON COLUMN public.ai_suggestions.metadata IS 
  'Metadata adicional da extração de IA, incluindo evidence (trechos do texto) e outras informações estruturadas';

-- Criar índice GIN para consultas eficientes em metadata
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_metadata_gin 
ON public.ai_suggestions 
USING gin (metadata)
WHERE metadata != '{}'::jsonb;

