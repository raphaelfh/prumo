/**
 * Hook for extracting all sections of a model with chunking
 *
 * React hook to manage AI extraction of all sections of a model
 * using chunking (smaller groups) to avoid timeout.
 *
 * Focus: Frontend chunking to process sections in groups of 2-3,
 * avoiding 150s Supabase Edge Functions timeout.
 *
 * Features:
 * - Auto chunking (2-3 sections per chunk)
 * - PDF cache (process once, reuse text)
 * - Real-time progress
 * - Error handling (skip failed sections)
 */

import {useCallback, useState} from "react";
import {toast} from "sonner";
import {t} from "@/lib/copy";
import type {BatchSectionExtractionRequest} from "@/types/ai-extraction";
import {AuthenticationError, getErrorCode, getErrorMessage, PDFNotFoundError,} from "@/lib/ai-extraction/errors";
import {getModelChildSections} from "./helpers/getModelChildSections";
import {processSectionsInChunks} from "./helpers/processSectionsInChunks";

/**
 * Chunked extraction progress
 */
export interface ExtractionProgress {
  currentChunk: number;
  totalChunks: number;
  completedSections: number;
  totalSections: number;
  currentSectionName: string | null;
}

/**
 * Tipo de retorno do hook
 */
export interface UseBatchSectionExtractionChunkedReturn {
  extractAllSections: (request: Omit<BatchSectionExtractionRequest, 'sectionIds' | 'pdfText'>) => Promise<void>;
  loading: boolean;
  error: string | null;
  progress: ExtractionProgress | null;
}

/**
 * Hook for extracting all sections with chunking
 *
 * Usage:
 * ```tsx
 * const { extractAllSections, loading, progress } = useBatchSectionExtractionChunked({
 *   onProgress: (p) => console.warn('Progress:', p),
 *   onSuccess: (result) => {
 *     // Refresh suggestions
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
 * @param options - Hook options
 * @returns Extraction function, loading state, error and progress
 */
export function useBatchSectionExtractionChunked(options?: {
  onProgress?: (progress: ExtractionProgress) => void;
  onSuccess?: (result: { totalSections: number; successfulSections: number; failedSections: number; totalSuggestionsCreated: number }) => void;
    chunkSize?: number; // Default: 2
}): UseBatchSectionExtractionChunkedReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
    const [pdfTextCache, _setPdfTextCache] = useState<string | null>(null);

  const chunkSize = options?.chunkSize || 2;

  /**
   * Extracts all sections of a model using chunking
   *
   * @param request - Extraction params (sectionIds and pdfText are generated)
   */
  const extractAllSections = useCallback(
    async (request: Omit<BatchSectionExtractionRequest, 'sectionIds' | 'pdfText'>) => {
        console.warn('[useBatchSectionExtractionChunked] Starting extraction with chunking', request);
      setLoading(true);
      setError(null);
      setProgress(null);

      try {
          // 1. Fetch model section list
          console.warn('[useBatchSectionExtractionChunked] Fetching model sections...');
        const sections = await getModelChildSections(
          request.parentInstanceId,
          request.templateId,
        );

        if (sections.length === 0) {
            toast.warning(t('extraction', 'noSectionsForModel'));
          return;
        }

          console.warn('[useBatchSectionExtractionChunked] Sections found:', sections.length);

          // 2. Process sections in chunks using helper
        const result = await processSectionsInChunks({
          sections,
          baseRequest: request,
          chunkSize,
          pdfText: pdfTextCache || undefined,
          onProgress: (progress) => {
            setProgress(progress);
            options?.onProgress?.(progress);
          },
        });

          // 3. Consolidate final results
        const { totalSuggestionsCreated, successfulSections, failedSections, totalTokensUsed, totalDurationMs } = result;
        const totalSections = sections.length;

          console.warn('[useBatchSectionExtractionChunked] Extraction completed', {
          totalSections,
          successfulSections,
          failedSections,
          totalSuggestionsCreated,
          totalTokensUsed,
          totalDurationMs,
        });

          // Success toast with aggregated info
        const durationSecs = (totalDurationMs / 1000).toFixed(1);
        if (failedSections === 0) {
          toast.success(
              t('extraction', 'batchChunkedSuccessTitle').replace('{{n}}', String(successfulSections)),
            {
                description: t('extraction', 'batchChunkedSuccessDesc')
                    .replace('{{suggestions}}', String(totalSuggestionsCreated))
                    .replace('{{tokens}}', String(totalTokensUsed))
                    .replace('{{duration}}', durationSecs),
              duration: 8000,
            },
          );
        } else {
          toast.warning(
              t('extraction', 'batchChunkedPartialTitle').replace('{{success}}', String(successfulSections)).replace('{{total}}', String(totalSections)),
            {
                description: t('extraction', 'batchChunkedPartialDesc')
                    .replace('{{suggestions}}', String(totalSuggestionsCreated))
                    .replace('{{failed}}', String(failedSections))
                    .replace('{{tokens}}', String(totalTokensUsed)),
              duration: 10000,
            },
          );
        }

        // Chamar callback de sucesso se fornecido
        if (options?.onSuccess) {
          Promise.resolve(
            options.onSuccess({
              totalSections,
              successfulSections,
              failedSections,
              totalSuggestionsCreated,
            })
          ).catch(err => {
            console.error('[useBatchSectionExtractionChunked] Erro no callback onSuccess:', err);
          });
        }

        // Limpar progresso
        setProgress(null);
      } catch (err: any) {
        console.error('[useBatchSectionExtractionChunked] Erro capturado', {
          error: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : 'Unknown',
          stack: err instanceof Error ? err.stack : undefined,
        });

          // Handle error in a user-friendly way
        const message = getErrorMessage(err);
        const code = getErrorCode(err);
        setError(message);

        // Toast de erro
        const errorCode = code || '';
        if (err instanceof PDFNotFoundError || errorCode === 'PDF_NOT_FOUND') {
            toast.error(t('extraction', 'sectionExtractionErrorTitle'), {
            description: message,
          });
        } else if (err instanceof AuthenticationError || errorCode === 'AUTH_ERROR') {
            toast.error(t('extraction', 'sectionExtractionErrorAuth'), {
                description: t('extraction', 'sectionExtractionErrorAuthDesc'),
          });
        } else {
            toast.error(`${t('extraction', 'sectionExtractionErrorTitle')}: ${message}`, {
            duration: 8000,
          });
        }

        // Limpar progresso
        setProgress(null);

        // Re-throw para permitir tratamento adicional pelo componente
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [options, chunkSize, pdfTextCache],
  );

  return { extractAllSections, loading, error, progress };
}

