/**
 * Hook for specific section extraction
 *
 * React hook to manage AI extraction of a specific section (entity type).
 *
 * FOCUS: Granular per-section extraction (section-extraction pipeline).
 * Allows user to extract data from one template section at a time.
 *
 * FEATURES:
 * - Loading and error state
 * - Automatic toast notifications
 * - Callback to refresh suggestions after extraction
 * - User-friendly error handling
 */

import {useCallback, useState} from "react";
import {toast} from "sonner";
import {type SectionExtractionRequest, SectionExtractionService,} from "@/services/sectionExtractionService";
import {
    AuthenticationError,
    FieldNameMismatchError,
    getErrorCode,
    getErrorMessage,
    NoInstancesError,
    PDFNotFoundError,
} from "@/lib/ai-extraction/errors";
import {t} from "@/lib/copy";

/**
 * Tipo de retorno do hook
 */
export interface UseSectionExtractionReturn {
  extractSection: (request: SectionExtractionRequest) => Promise<void>;
  loading: boolean;
  error: string | null;
}

/**
 * Hook for specific section extraction
 *
 * USAGE:
 * ```tsx
 * const { extractSection, loading, error } = useSectionExtraction({
 *   onSuccess: (runId) => {
 *     // Refresh suggestions or navigate
 *   }
 * });
 * 
 * await extractSection({
 *   projectId,
 *   articleId,
 *   templateId,
 *   entityTypeId
 * });
 * ```
 *
 * @param options - Hook options (success callback)
 * @returns Extract function, loading state and error
 */
export function useSectionExtraction(options?: {
  onSuccess?: (runId: string, suggestionsCreated: number) => void;
}): UseSectionExtractionReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Extracts data from a specific section
   * @param request - Extraction parameters
   */
  const extractSection = useCallback(
    async (request: SectionExtractionRequest) => {
        console.log('[useSectionExtraction] Starting extraction', request);
      setLoading(true);
      setError(null);

      try {
          // Call service to run extraction
        console.log('[useSectionExtraction] Chamando service...');
        const result = await SectionExtractionService.extractSection(request);
        console.log('[useSectionExtraction] Service retornou', {
          hasData: !!result.data,
          suggestionsCreated: result.data?.suggestionsCreated,
        });

        if (!result.data) {
          throw new Error("No data returned from extraction");
        }

          // Check if suggestions were created
        if (result.data.suggestionsCreated === 0) {
            toast.warning(t('extraction', 'sectionExtractionNoSuggestionsTitle'), {
                description: t('extraction', 'sectionExtractionNoSuggestionsDesc'),
            duration: 6000,
          });
        } else {
        const tokensUsed = result.data.tokensTotal || result.data.metadata?.tokensTotal || 0;
        toast.success(
            t('extraction', 'sectionExtractionSuccessTitle').replace('{{n}}', String(result.data.suggestionsCreated)),
          {
              description: t('extraction', 'sectionExtractionTokensUsed').replace('{{n}}', String(tokensUsed)),
          },
        );
        }

        // Chamar callback de sucesso se fornecido
          // Useful to refresh suggestions after extraction
          // IMPORTANT: Do not await - callback must not block loading reset
        if (options?.onSuccess) {
          // Executar callback sem bloquear (pode ser async)
            // Loading will be reset in finally regardless of callback
          Promise.resolve(
            options.onSuccess(result.data.runId, result.data.suggestionsCreated)
          ).catch(err => {
            console.error('[useSectionExtraction] Erro no callback onSuccess:', err);
              // Do not block loading reset on callback error
          });
        }
      } catch (err: any) {
        console.error('[useSectionExtraction] Erro capturado', {
          error: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : 'Unknown',
          stack: err instanceof Error ? err.stack : undefined,
        });

          // Handle error in a user-friendly way using custom error classes
        const message = getErrorMessage(err);
        const code = getErrorCode(err);
        setError(message);

        // Toast de erro com mensagem clara baseada no tipo de erro
        const errorCode = code || '';
        if (err instanceof NoInstancesError || errorCode === 'NO_INSTANCES') {
            toast.error(t('extraction', 'sectionExtractionErrorTitle'), {
            description: message,
            duration: 6000,
          });
        } else if (err instanceof PDFNotFoundError || errorCode === 'PDF_NOT_FOUND') {
            toast.error(t('extraction', 'sectionExtractionErrorTitle'), {
            description: message,
          });
        } else if (err instanceof FieldNameMismatchError || errorCode === 'FIELD_NAME_MISMATCH') {
            toast.error(t('extraction', 'sectionExtractionErrorFieldMismatch'), {
            description: message,
            duration: 8000,
          });
        } else if (err instanceof AuthenticationError || errorCode === 'AUTH_ERROR') {
            toast.error(t('extraction', 'sectionExtractionErrorAuth'), {
                description: t('extraction', 'sectionExtractionErrorAuthDesc'),
          });
        } else {
          const errorMessage = message.toLowerCase();
          if (errorMessage.includes('field name') || errorMessage.includes('mismatch') || errorMessage.includes('no mapping')) {
              toast.error(t('extraction', 'sectionExtractionErrorFieldMismatch'), {
                  description: t('extraction', 'sectionExtractionErrorFieldMismatchDesc'),
              duration: 8000,
              });
          } else {
              toast.error(`${t('extraction', 'sectionExtractionErrorTitle')}: ${message}`);
          }
        }

        // Re-throw para permitir tratamento adicional pelo componente
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [options],
  );

  return { extractSection, loading, error };
}

