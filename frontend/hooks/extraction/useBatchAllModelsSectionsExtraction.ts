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

import { useState } from "react";
import { toast } from "sonner";
import {t} from "@/lib/copy";
import { getModelChildSections, type ModelChildSection } from "./helpers/getModelChildSections";
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

interface AllModelsSectionsParams {
  projectId: string;
  articleId: string;
  templateId: string;
  models: Array<{ instanceId: string; modelName: string }>;
  /** Active session run to extract into — reused so decisions aren't orphaned. */
  runId?: string;
  /**
   * Run-pinned section list (B-5b) — sections are entity-type-level, so one
   * list serves every model. When provided (non-empty) it replaces the live
   * per-model entity-type read so the dispatch loop matches the snapshot the
   * backend extracts from. Absent or EMPTY → chained fallback to the live
   * read (the worklist Full-AI path dispatches with no run view loaded).
   */
  sections?: ModelChildSection[];
}

/**
 * Tipo de retorno do hook
 */
export interface UseBatchAllModelsSectionsExtractionReturn {
  extractAllSectionsForAllModels: (params: AllModelsSectionsParams) => Promise<void>;
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
 *   onProgress: (p) => console.warn('Progress:', p),
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
  const extractAllSectionsForAllModels = async (params: AllModelsSectionsParams) => {
        console.warn('[useBatchAllModelsSectionsExtraction] Starting extraction of sections for all models', {
        totalModels: params.models.length,
      });
      setLoading(true);
      setError(null);
      setProgress(null);

      const doExtract = async () => {
        const { projectId, articleId, templateId, models, runId, sections: pinnedSections } = params;

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
        for (const [i, model] of models.entries()) {
            console.warn(`[useBatchAllModelsSectionsExtraction] Processing model ${i + 1}/${models.length}`, {
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

          // Each model is processed independently — errors skip the model
          // rather than aborting the whole batch. No try/catch here; instead
          // we catch per-model via .catch() on the inner await chain.
          const modelResult = await (async () => {
              // Extract sections from this model using chunking
              // 1. Resolve the section list: prefer the run-pinned list
              // (entity-type-level, shared by every model); a missing OR
              // empty list chains into the live read (never swap on empty).
            const sections =
              pinnedSections && pinnedSections.length > 0
                ? pinnedSections
                : await getModelChildSections(
                    model.instanceId,
                    templateId,
                  );

            if (sections.length === 0) {
                console.warn(`[useBatchAllModelsSectionsExtraction] No sections found for model ${model.modelName}`);
              return { totalSuggestionsCreated: 0, totalTokensUsed: 0, totalDurationMs: 0, skipped: true };
            }

              // 2. Process sections in chunks using helper
            const result = await processSectionsInChunks({
              sections,
              baseRequest: {
                projectId,
                articleId,
                templateId,
                parentInstanceId: model.instanceId,
                runId,
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

            return { ...result, skipped: false };
          })().catch((modelError: unknown) => {
              console.error(`[useBatchAllModelsSectionsExtraction] Error in model ${i + 1}:`, modelError);
            return null; // null signals failure
          });

          if (modelResult === null) {
            failedModels++;
          } else {
            totalSuggestionsCreated += modelResult.totalSuggestionsCreated;
            totalTokensUsed += modelResult.totalTokensUsed;
            totalDurationMs += modelResult.totalDurationMs;
            successfulModels++;
              console.warn(`[useBatchAllModelsSectionsExtraction] Model ${i + 1} completed`, {
              modelName: model.modelName,
              suggestionsCreated: modelResult.totalSuggestionsCreated,
              tokensUsed: modelResult.totalTokensUsed,
            });
          }
        }

          // Consolidate final results
          console.warn('[useBatchAllModelsSectionsExtraction] Extraction completed', {
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
      };

      return doExtract()
        .catch((err: unknown) => {
          console.error('[useBatchAllModelsSectionsExtraction] Caught error', {
            error: err instanceof Error ? err.message : String(err),
            name: err instanceof Error ? err.name : 'Unknown',
            stack: err instanceof Error ? err.stack : undefined,
          });

          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          toast.error(`${t('extraction', 'errors_sectionsExtraction')}: ${message}`, {
            duration: 8000,
          });
          setProgress(null);
          throw err;
        })
        .finally(() => setLoading(false));
  };

  return { extractAllSectionsForAllModels, loading, error, progress };
}

