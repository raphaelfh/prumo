/**
 * Hook for single-item AI assessment
 *
 * React hook to manage AI assessment of a single assessment item.
 *
 * FOCUS: Granular per-item assessment (assessment pipeline).
 * Lets the user assess one instrument item at a time.
 *
 * FEATURES:
 * - Loading and error state
 * - Automatic toast notifications
 * - Callback to refresh suggestions after assessment
 * - Friendly error handling
 * - BYOK (Bring Your Own Key) support
 *
 * Based on useSectionExtraction.ts (DRY + KISS)
 *
 * @hook
 */

import {useCallback, useState} from 'react';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {type AIAssessmentRequest, type AIAssessmentResponse, AssessmentService,} from '@/services/assessmentService';
import {
    APIError,
    AuthenticationError,
    getErrorCode,
    getErrorMessage,
    PDFNotFoundError,
} from '@/lib/ai-extraction/errors';

/**
 * Hook return type
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
 * Hook for single-item assessment
 *
 * USAGE:
 * ```tsx
 * const { assessItem, loading, error } = useSingleAssessment({
 *   onSuccess: (suggestionId) => {
 *     // Refresh suggestions
 *   }
 * });
 *
 * await assessItem({
 *   projectId,
 *   articleId,
 *   instrumentId,
 *   assessmentItemId,
 *   pdfStorageKey,
 *   openaiApiKey, // Optional (BYOK)
 *   model: 'gpt-4o-mini',
 * });
 * ```
 *
 * @param options - Hook options (success callback)
 * @returns Assessment function, loading and error state
 */
export function useSingleAssessment(options?: {
  onSuccess?: (suggestionId: string) => void;
}): UseSingleAssessmentReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Assess a single assessment item with AI
   *
   * @param request - Assessment parameters
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
            throw new APIError(result.error?.message || t('assessment', 'errors_assessItem'));
        }

          // Success toast with useful info
        const tokensUsed = (result.data.metadata.tokensPrompt || 0) + (result.data.metadata.tokensCompletion || 0);
        const confidence = Math.round((result.data.confidenceScore || 0) * 100);

        toast.success(
            t('assessment', 'assessmentItemSuccess').replace('{{level}}', result.data.selectedLevel),
          {
              description: t('assessment', 'assessmentItemConfidence')
                  .replace('{{n}}', String(confidence))
                  .replace('{{tokens}}', String(tokensUsed)),
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
            toast.error(t('assessment', 'errors_assessment'), {
                description: t('assessment', 'assessmentPdfNotFoundDesc'),
            duration: 6000,
          });
        } else if (err instanceof AuthenticationError || code === 'AUTH_ERROR') {
            toast.error(t('assessment', 'errors_assessmentAuth'), {
                description: t('assessment', 'assessmentAuthDesc'),
          });
        } else if (message.toLowerCase().includes('api key') || message.toLowerCase().includes('openai')) {
            toast.error(t('assessment', 'errors_assessmentOpenAI'), {
                description: t('assessment', 'assessmentOpenAIDesc'),
            duration: 6000,
          });
        } else {
            toast.error(t('assessment', 'errors_assessment'), {
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
