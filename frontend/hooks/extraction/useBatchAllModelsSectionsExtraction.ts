/**
 * Hook for extracting sections from all existing models
 *
 * React hook to manage AI extraction of all sections from all existing models,
 * using chunking to avoid timeout.
 *
 * FOCUS: Iterate over existing models and extract sections from each using chunking.
 * Does not extract new models - only processes existing models.
 *
 * FEATURES:
 * - Iterates over existing models
 * - For each model, extracts all sections using chunking
 * - Aggregated progress (models + current model sections)
 * - Error handling (skips failed models)
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import {t} from "@/lib/copy";
import { getModelChildSections } from "./helpers/getModelChildSections";
import { processSectionsInChunks } from "./helpers/processSectionsInChunks";
import type { ExtractionProgress } from "./useBatchSectionExtractionChunked";

/**
 * Progress of extracting sections from all models
 */
export interface AllModelsSectionsProgress {
  currentModel: number;
  totalModels: number;
  currentModelName: string | null;
  sectionProgress: ExtractionProgress | null;
}

/**
 * Tipo de retorno do hook
 */
export interface UseBatchAllModelsSectionsExtractionReturn {
  extractAllSectionsForAllModels: (params: {
    projectId: string;
    articleId: string;
    templateId: string;
    models: Array<{ instanceId: string; modelName: string }>;
  }) => Promise<void>;
  loading: boolean;
  error: string | null;
  progress: AllModelsSectionsProgress | null;
}

/**
 * Hook for extracting sections from all existing models
 *
 * USAGE:
 * ```tsx
 * const { extractAllSectionsForAllModels, loading, progress } = useBatchAllModelsSectionsExtraction({
 *   onProgress: (p) => console.log('Progress:', p),
 *   onSuccess: (result) => {
 *     // Refresh suggestions
 *   }
 * });
 * 
 * await extractAllSectionsForAllModels({
 *   projectId,
 *   articleId,
 *   templateId,
 *   models: [{ instanceId: '...', modelName: 'CatBoost' }, ...]
 * });
 * ```
 *
 * @param options - Hook options
 * @returns Extract function, loading state, error and progress
 */
export function useBatchAllModelsSectionsExtraction(options?: {
  onProgress?: (progress: AllModelsSectionsProgress) => void;
  onSuccess?: (result: { totalModels: number; successfulModels: number; failedModels: number; totalSuggestionsCreated: number }) => void;
}): UseBatchAllModelsSectionsExtractionReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<AllModelsSectionsProgress | null>(null);

    const chunkSize = 2; // Chunk size for sections

  /**
   * Extracts all sections from all existing models
   * @param params - Extraction params (projectId, articleId, templateId, models)
   */
  const extractAllSectionsForAllModels = useCallback(
    async (params: {
      projectId: string;
      articleId: string;
      templateId: string;
      models: Array<{ instanceId: string; modelName: string }>;
    }) => {
        console.log('[useBatchAllModelsSectionsExtraction] Starting extraction of sections for all models', {
        totalModels: params.models.length,
      });
      setLoading(true);
      setError(null);
      setProgress(null);

      try {
        const { projectId, articleId, templateId, models } = params;

        if (models.length === 0) {
            toast.warning(t('extraction', 'noModelsFoundTitle'), {
                description: t('extraction', 'noModelsToExtractSections'),
          });
          return;
        }

        let totalSuggestionsCreated = 0;
        let successfulModels = 0;
        let failedModels = 0;
        let totalTokensUsed = 0;
        let totalDurationMs = 0;

        // Processar cada modelo sequencialmente
        for (let i = 0; i < models.length; i++) {
          const model = models[i];

            console.log(`[useBatchAllModelsSectionsExtraction] Processing model ${i + 1}/${models.length}`, {
            modelName: model.modelName,
            instanceId: model.instanceId,
          });

            // Update progress: current model
          const currentProgress: AllModelsSectionsProgress = {
            currentModel: i + 1,
            totalModels: models.length,
            currentModelName: model.modelName,
            sectionProgress: null,
          };
          setProgress(currentProgress);
          if (options?.onProgress) {
            options.onProgress(currentProgress);
          }

          try {
              // Extract sections from this model using chunking
              // 1. Fetch model sections list
            const sections = await getModelChildSections(
              model.instanceId,
              templateId,
            );

            if (sections.length === 0) {
                console.log(`[useBatchAllModelsSectionsExtraction] No sections found for model ${model.modelName}`);
                successfulModels++; // Consider success even with no sections
              continue;
            }

              // 2. Process sections in chunks using helper
            const modelResult = await processSectionsInChunks({
              sections,
              baseRequest: {
                projectId,
                articleId,
                templateId,
                parentInstanceId: model.instanceId,
                extractAllSections: true,
              },
              chunkSize,
              onProgress: (sectionProgress) => {
                const updatedProgress: AllModelsSectionsProgress = {
                  currentModel: i + 1,
                  totalModels: models.length,
                  currentModelName: model.modelName,
                  sectionProgress,
                };
                setProgress(updatedProgress);
                options?.onProgress?.(updatedProgress);
              },
            });

            totalSuggestionsCreated += modelResult.totalSuggestionsCreated;
            totalTokensUsed += modelResult.totalTokensUsed;
            totalDurationMs += modelResult.totalDurationMs;

              // If we got here, extraction succeeded
            successfulModels++;
              console.log(`[useBatchAllModelsSectionsExtraction] Model ${i + 1} completed`, {
              modelName: model.modelName,
              suggestionsCreated: modelResult.totalSuggestionsCreated,
              tokensUsed: modelResult.totalTokensUsed,
            });
          } catch (modelError: any) {
              console.error(`[useBatchAllModelsSectionsExtraction] Error in model ${i + 1}:`, modelError);

              // Skip failed model (do not propagate error)
            failedModels++;

              // Continue with next model

          }
        }

          // Consolidate final results
          console.log('[useBatchAllModelsSectionsExtraction] Extraction completed', {
          totalModels: models.length,
          successfulModels,
          failedModels,
          totalTokensUsed,
          totalDurationMs,
        });

          // Success toast with aggregated info
        const durationSecs = (totalDurationMs / 1000).toFixed(1);
        if (failedModels === 0) {
          toast.success(
              t('extraction', 'batchAllModelsSuccessTitle').replace('{{n}}', String(successfulModels)),
            {
                description: t('extraction', 'batchAllModelsSuccessDesc')
                    .replace('{{suggestions}}', String(totalSuggestionsCreated))
                    .replace('{{tokens}}', String(totalTokensUsed))
                    .replace('{{duration}}', durationSecs),
              duration: 8000,
            },
          );
        } else {
          toast.warning(
              t('extraction', 'batchAllModelsPartialTitle').replace('{{success}}', String(successfulModels)).replace('{{total}}', String(models.length)),
            {
                description: t('extraction', 'batchAllModelsPartialDesc')
                    .replace('{{suggestions}}', String(totalSuggestionsCreated))
                    .replace('{{failed}}', String(failedModels))
                    .replace('{{tokens}}', String(totalTokensUsed)),
              duration: 10000,
            },
          );
        }

          // Call success callback if provided
        if (options?.onSuccess) {
          Promise.resolve(
            options.onSuccess({
              totalModels: models.length,
              successfulModels,
              failedModels,
              totalSuggestionsCreated,
            })
          ).catch(err => {
              console.error('[useBatchAllModelsSectionsExtraction] Error in onSuccess callback:', err);
          });
        }

          // Clear progress
        setProgress(null);
      } catch (err: any) {
          console.error('[useBatchAllModelsSectionsExtraction] Caught error', {
          error: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : 'Unknown',
          stack: err instanceof Error ? err.stack : undefined,
        });

          // Handle error in a user-friendly way
        const message = err instanceof Error ? err.message : String(err);
        setError(message);

          toast.error(`${t('extraction', 'errors_sectionsExtraction')}: ${message}`, {
          duration: 8000,
        });

          // Clear progress
        setProgress(null);

        // Re-throw para permitir tratamento adicional pelo componente
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [options],
  );

  return { extractAllSectionsForAllModels, loading, error, progress };
}

