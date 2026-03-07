/**
 * Hook for extraction of all sections of a model
 *
 * React hook to manage AI extraction of all sections of a model in one go.
 *
 * FOCUS: Batch extraction with summarized memory (section-extraction pipeline with extractAllSections=true).
 * Lets the user extract all sections of a model sequentially in a single operation.
 *
 * FEATURES:
 * - Loading and error state
 * - Automatic toast notifications with aggregated results
 * - Callback to refresh suggestions after extraction
 * - Friendly error handling
 */

import {useCallback, useState} from "react";
import {toast} from "sonner";
import {t} from "@/lib/copy";
import {SectionExtractionService,} from "@/services/sectionExtractionService";
import type {BatchSectionExtractionRequest} from "@/types/ai-extraction";
import {AuthenticationError, getErrorCode, getErrorMessage, PDFNotFoundError,} from "@/lib/ai-extraction/errors";

/**
 * Hook return type
 */
export interface UseBatchSectionExtractionReturn {
  extractAllSections: (request: BatchSectionExtractionRequest) => Promise<void>;
  loading: boolean;
  error: string | null;
}

/**
 * Hook for extraction of all sections of a model
 *
 * USAGE:
 * ```tsx
 * const { extractAllSections, loading, error } = useBatchSectionExtraction({
 *   onSuccess: (result) => {
 *     // Refresh suggestions or navigate
 *   }
 * });
 *
 * await extractAllSections({
 *   projectId,
 *   articleId,
 *   templateId,
 *   parentInstanceId,
 *   extractAllSections: true
 * });
 * ```
 *
 * @param options - Hook options (success callback)
 * @returns Extraction function, loading and error state
 */
export function useBatchSectionExtraction(options?: {
  onSuccess?: (result: { totalSections: number; successfulSections: number; failedSections: number; totalSuggestionsCreated: number }) => void;
}): UseBatchSectionExtractionReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Extract all sections of a model
   *
   * @param request - Extraction parameters
   */
  const extractAllSections = useCallback(
    async (request: BatchSectionExtractionRequest) => {
        console.warn('[useBatchSectionExtraction] Starting extraction of all sections', request);
      setLoading(true);
      setError(null);

      try {
          // Call service to run extraction
          console.warn('[useBatchSectionExtraction] Calling service...');
        const result = await SectionExtractionService.extractAllSections(request);
          console.warn('[useBatchSectionExtraction] Service returned', {
          hasData: !!result.data,
          totalSections: result.data?.totalSections,
          successfulSections: result.data?.successfulSections,
          failedSections: result.data?.failedSections,
          totalSuggestionsCreated: result.data?.totalSuggestionsCreated,
        });

        if (!result.data) {
          throw new Error("No data returned from batch extraction");
        }

        const { totalSections, successfulSections, failedSections, totalSuggestionsCreated, totalTokensUsed, durationMs } = result.data;

          // Success toast with aggregated info
        if (failedSections === 0) {
          toast.success(
              t('extraction', 'batchSectionExtractionSuccess').replace('{{n}}', String(successfulSections)),
            {
                description: t('extraction', 'batchSectionExtractionSuccessDesc')
                    .replace('{{suggestions}}', String(totalSuggestionsCreated))
                    .replace('{{tokens}}', String(totalTokensUsed))
                    .replace('{{duration}}', (durationMs / 1000).toFixed(1)),
              duration: 8000,
            },
          );
        } else {
          toast.warning(
              t('extraction', 'batchSectionExtractionPartial')
                  .replace('{{success}}', String(successfulSections))
                  .replace('{{total}}', String(totalSections)),
            {
                description: t('extraction', 'batchSectionExtractionPartialDesc')
                    .replace('{{suggestions}}', String(totalSuggestionsCreated))
                    .replace('{{failed}}', String(failedSections)),
              duration: 10000,
            },
          );
        }

          // Call success callback if provided
        if (options?.onSuccess) {
          Promise.resolve(
            options.onSuccess({
              totalSections,
              successfulSections,
              failedSections,
              totalSuggestionsCreated,
            })
          ).catch(err => {
              console.error('[useBatchSectionExtraction] Error in onSuccess callback:', err);
          });
        }
      } catch (err: any) {
          console.error('[useBatchSectionExtraction] Error caught', {
          error: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : 'Unknown',
          stack: err instanceof Error ? err.stack : undefined,
        });

          // Handle error in a friendly way using custom error classes
        const message = getErrorMessage(err);
        const code = getErrorCode(err);
        setError(message);

          // Error toast with clear message based on error type
        const errorCode = code || '';
        if (err instanceof PDFNotFoundError || errorCode === 'PDF_NOT_FOUND') {
            toast.error(t('extraction', 'sectionExtractionErrorTitle'), {
            description: message,
          });
        } else if (err instanceof AuthenticationError || errorCode === 'AUTH_ERROR') {
            toast.error(t('extraction', 'sectionExtractionErrorAuth'), {
                description: t('extraction', 'sectionExtractionErrorAuthDesc'),
          });
        } else if (errorCode === 'TIMEOUT' || message.includes('timeout') || message.includes('cancelada')) {
            toast.error(t('extraction', 'sectionExtractionErrorTitle'), {
                description: t('extraction', 'sectionExtractionTimeoutDesc'),
            duration: 10000,
          });
        } else {
            toast.error(`${t('extraction', 'errors_allSectionsExtraction')}: ${message}`, {
            duration: 8000,
          });
        }

          // Re-throw to allow further handling by the component
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [options],
  );

  return { extractAllSections, loading, error };
}

