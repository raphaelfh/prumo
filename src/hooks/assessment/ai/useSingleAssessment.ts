/**
 * Hook para Avaliação de Item Específico com IA
 *
 * Hook React para gerenciar avaliação de IA de um item de assessment específico.
 *
 * FOCO: Avaliação granular por item (assessment pipeline).
 * Permite ao usuário avaliar um item específico do instrumento por vez.
 *
 * FEATURES:
 * - Estado de loading e error
 * - Toast notifications automáticas
 * - Callback para refresh de sugestões após avaliação
 * - Tratamento de erros amigável
 * - Suporte para BYOK (Bring Your Own Key)
 *
 * Baseado em useSectionExtraction.ts (DRY + KISS)
 *
 * @hook
 */

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  AssessmentService,
  type AIAssessmentRequest,
  type AIAssessmentResponse,
} from '@/services/assessmentService';
import {
  getErrorMessage,
  getErrorCode,
  PDFNotFoundError,
  AuthenticationError,
  APIError,
} from '@/lib/ai-extraction/errors';

/**
 * Tipo de retorno do hook
 */
export interface UseSingleAssessmentReturn {
  assessItem: (request: Omit<AIAssessmentRequest, 'projectId' | 'articleId' | 'assessmentItemId' | 'instrumentId'> & {
    projectId: string;
    articleId: string;
    assessmentItemId: string;
    instrumentId: string;
  }) => Promise<void>;
  loading: boolean;
  error: string | null;
}

/**
 * Hook para avaliação de item específico
 *
 * USO:
* ```tsx
* const { assessItem, loading, error } = useSingleAssessment({
*   onSuccess: (suggestionId) => {
*     // Refresh sugestões
*   }
* });
 *
 * await assessItem({
 *   projectId,
 *   articleId,
 *   instrumentId,
 *   assessmentItemId,
 *   pdfStorageKey,
 *   openaiApiKey, // Opcional (BYOK)
 *   model: 'gpt-4o-mini',
 * });
 * ```
 *
 * @param options - Opções do hook (callback de sucesso)
 * @returns Função de avaliação, estado de loading e error
 */
export function useSingleAssessment(options?: {
  onSuccess?: (suggestionId: string) => void;
}): UseSingleAssessmentReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Avalia um item de assessment específico com IA
   *
   * @param request - Parâmetros da avaliação
   */
  const assessItem = useCallback(
    async (request: Omit<AIAssessmentRequest, 'projectId' | 'articleId' | 'assessmentItemId' | 'instrumentId'> & {
      projectId: string;
      articleId: string;
      assessmentItemId: string;
      instrumentId: string;
    }) => {
      setLoading(true);
      setError(null);

      try {
        const result: AIAssessmentResponse = await AssessmentService.assessSingleItem(request);

        if (!result.ok || !result.data) {
          throw new APIError(result.error?.message || 'Erro ao avaliar item');
        }

        // Toast de sucesso com informações úteis
        const tokensUsed = (result.data.metadata.tokensPrompt || 0) + (result.data.metadata.tokensCompletion || 0);
        const confidence = Math.round((result.data.confidenceScore || 0) * 100);

        toast.success(
          `Avaliação concluída! Sugestão criada: ${result.data.selectedLevel}`,
          {
            description: `Confiança: ${confidence}% • ${tokensUsed} tokens usados`,
            duration: 5000,
          }
        );

        if (options?.onSuccess) {
          try {
            await Promise.resolve(options.onSuccess(result.data.id));
          } catch (err) {
            console.error('❌ [useSingleAssessment] Erro no callback onSuccess:', err);
          }
        }
      } catch (err) {
        console.error('❌ [useSingleAssessment] Erro capturado', {
          error: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : 'Unknown',
        });

        // Tratar erro de forma amigável
        const message = getErrorMessage(err);
        const code = getErrorCode(err);
        setError(message);

        // Toast de erro com mensagem clara baseada no tipo de erro
        if (err instanceof PDFNotFoundError || code === 'PDF_NOT_FOUND') {
          toast.error('Erro na avaliação', {
            description: 'PDF não encontrado. Verifique se o artigo possui um arquivo PDF anexado.',
            duration: 6000,
          });
        } else if (err instanceof AuthenticationError || code === 'AUTH_ERROR') {
          toast.error('Erro de autenticação', {
            description: 'Por favor, faça login novamente.',
          });
        } else if (message.toLowerCase().includes('api key') || message.toLowerCase().includes('openai')) {
          toast.error('Erro na API da OpenAI', {
            description: 'Verifique sua chave de API da OpenAI ou utilize a chave fornecida pelo projeto.',
            duration: 6000,
          });
        } else {
          toast.error('Erro na avaliação', {
            description: message,
            duration: 5000,
          });
        }

        // Re-throw para permitir tratamento adicional pelo componente
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [options]
  );

  return { assessItem, loading, error };
}
