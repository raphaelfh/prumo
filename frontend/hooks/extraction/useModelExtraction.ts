/**
 * Hook for prediction model extraction
 *
 * React hook to manage automatic extraction of article prediction models.
 *
 * FOCUS: Automatic model extraction (model-extraction pipeline).
 * Allows user to extract models automatically from the article PDF.
 * 
 * FEATURES:
 * - Estado de loading e error
 * - Automatic toast notifications
 * - Callback to refresh after extraction (reload models and instances)
 * - User-friendly error handling
 */

import {useState} from "react";
import {toast} from "sonner";
import {t} from "@/lib/copy";
import {type ModelExtractionRequest, SectionExtractionService,} from "@/services/sectionExtractionService";
import {AuthenticationError, getErrorCode, getErrorMessage, PDFNotFoundError,} from "@/lib/ai-extraction/errors";

/**
 * Tipo de retorno do hook
 */
export interface UseModelExtractionReturn {
  extractModels: (request: ModelExtractionRequest) => Promise<void>;
  loading: boolean;
  error: string | null;
}

/**
 * Hook for prediction model extraction
 * 
 * USO:
 * ```tsx
 * const { extractModels, loading, error } = useModelExtraction({
 *   onSuccess: (runId, modelsCreated) => {
 *     // Refresh models and instances
 *   }
 * });
 * 
 * await extractModels({
 *   projectId,
 *   articleId,
 *   templateId
 * });
 * ```
 *
 * @param options - Hook options (success callback)
 * @returns Extract function, loading state and error
 */
export function useModelExtraction(options?: {
  onSuccess?: (runId: string, modelsCreated: number) => void;
}): UseModelExtractionReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Extracts prediction models from the article
   * @param request - Extraction parameters
   */
  const extractModels = async (request: ModelExtractionRequest) => {
        console.warn('[useModelExtraction] Starting model extraction', request);
      setLoading(true);
      setError(null);

      const doExtract = async () => {
          // Call service to run extraction
          console.warn('[useModelExtraction] Chamando service...');
        const result = await SectionExtractionService.extractModels(request);
          console.warn('[useModelExtraction] Service retornou', {
          hasData: !!result.data,
          modelsCreated: result.data?.modelsCreated?.length || 0,
        });

        if (!result.data) {
          throw new Error("No data returned from model extraction");
        }

        const modelsCreated = result.data.modelsCreated.length;

          // Check if there are models created
        if (modelsCreated === 0) {
            toast.warning(t('extraction', 'noModelsFoundTitle'), {
                description: t('extraction', 'noModelsExtractionComplete'),
            duration: 6000,
          });
        } else {
          toast.success(
              t('extraction', 'modelExtractionSuccessTitle').replace('{{n}}', String(modelsCreated)),
            {
                description: t('extraction', 'modelExtractionSuccessTokens').replace('{{n}}', String(result.data.metadata?.tokensTotal || 0)),
            },
          );
        }

        // IMPORTANT: Do not await - callback must not block loading reset
        if (options?.onSuccess) {
          Promise.resolve(
            options.onSuccess(result.data.runId, modelsCreated)
          ).catch(err => {
            console.error('[useModelExtraction] Erro no callback onSuccess:', err);
          });
        }
      };

      doExtract()
        .catch((err: unknown) => {
          console.error('[useModelExtraction] Erro capturado', {
            error: err instanceof Error ? err.message : String(err),
            name: err instanceof Error ? err.name : 'Unknown',
            stack: err instanceof Error ? err.stack : undefined,
          });

          const message = getErrorMessage(err);
          const code = getErrorCode(err);
          setError(message);

          const errorCode = code || '';
          if (err instanceof PDFNotFoundError || errorCode === 'PDF_NOT_FOUND') {
            toast.error(t('extraction', 'modelExtractionErrorTitle'), {description: message});
          } else if (err instanceof AuthenticationError || errorCode === 'AUTH_ERROR') {
            toast.error(t('extraction', 'modelExtractionAuthErrorTitle'), {
              description: t('extraction', 'sectionExtractionErrorAuthDesc'),
            });
          } else {
            toast.error(`${t('extraction', 'modelExtractionErrorTitle')}: ${message}`);
          }

          throw err;
        })
        .finally(() => setLoading(false));
  };

  return { extractModels, loading, error };
}

