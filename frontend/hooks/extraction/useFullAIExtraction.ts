/**
 * Full AI Extraction hook
 *
 * React hook to manage full AI extraction:
 * 1. Extracts models from the article (using AI)
 * 2. For each extracted model, extracts all sections automatically
 *
 * Focus: Full extraction orchestration (models + sections).
 * Reuses existing hooks to keep DRY.
 *
 * Features:
 * - Sequential extraction: models first, then sections
 * - Aggregated progress (current stage + section progress)
 * - Error handling (continues even if some models fail)
 * - Success callback for refresh
 */

import {useState} from "react";
import {toast} from "sonner";
import {t} from "@/lib/copy";
import {useModelExtraction} from "./useModelExtraction";
import type {AllModelsSectionsProgress} from "./useBatchAllModelsSectionsExtraction";
import {useBatchAllModelsSectionsExtraction} from "./useBatchAllModelsSectionsExtraction";
import type {TopLevelSectionsProgress} from "./useTopLevelSectionsExtraction";
import {useTopLevelSectionsExtraction} from "./useTopLevelSectionsExtraction";
import {queryEntityTypesWithFallback} from "./helpers/queryEntityTypes";
import {ENTITY_ROLE} from "@/lib/extraction/entityTypeRoles";
import {loadExtractedModels} from "@/services/extractionInstanceService";

/**
 * Full extraction progress
 */
export interface FullAIExtractionProgress {
  stage: 'extracting_models' | 'extracting_sections';
  modelsProgress?: AllModelsSectionsProgress;
  topLevelSectionsProgress?: TopLevelSectionsProgress;
}

/**
 * Tipo de retorno do hook
 */
export interface UseFullAIExtractionReturn {
  extractFullAI: (params: {
    projectId: string;
    articleId: string;
    templateId: string;
  }) => Promise<void>;
  loading: boolean;
  error: string | null;
  progress: FullAIExtractionProgress | null;
}

/**
 * Hook for full AI extraction
 *
 * Usage:
 * ```tsx
 * const { extractFullAI, loading, progress } = useFullAIExtraction({
 *   onSuccess: () => {
 *     // Refresh instances and models
 *   }
 * });
 *
 * await extractFullAI({
 *   projectId,
 *   articleId,
 *   templateId
 * });
 * ```
 *
 * @param options - Hook options
 * @returns Extraction function, loading state, error and progress
 */
export function useFullAIExtraction(options?: {
  onSuccess?: () => Promise<void>;
}): UseFullAIExtractionReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<FullAIExtractionProgress | null>(null);

    // Hook for model extraction
  const { extractModels: extractModelsHook } = useModelExtraction();

    // Hook for top-level section extraction
  const { extractTopLevelSections } = useTopLevelSectionsExtraction({
    onProgress: (topLevelSectionsProgress) => {
      setProgress({
        stage: 'extracting_models',
        topLevelSectionsProgress,
      });
    },
  });

    // Hook for extracting sections from all models
  const { extractAllSectionsForAllModels } = useBatchAllModelsSectionsExtraction({
    onProgress: (modelsProgress) => {
      setProgress({
        stage: 'extracting_sections',
        modelsProgress,
      });
    },
  });

  /**
   * Fetches the model container entity type id by structural role.
   *
   * The template has at most one ``model_container`` (enforced by a
   * partial unique index), so this returns the single matching id or
   * throws — failing fast is correct here: every caller assumes a
   * template that owns prediction models.
   */
  const fetchModelParentEntityTypeId = async (
    templateId: string
  ): Promise<string> => {
    const results = await queryEntityTypesWithFallback<{ id: string }>({
      templateId,
      select: 'id',
      filters: (query) => query.eq('role', ENTITY_ROLE.MODEL_CONTAINER),
    });

    if (results.length === 0) {
      throw new Error('No model_container entity type in template');
    }

    return results[0].id;
  };

  /**
   * Extracts models and then sections for each model
   *
   * @param params - Extraction parameters
   */
  const extractFullAI = async (params: {
      projectId: string;
      articleId: string;
      templateId: string;
    }) => {
        console.warn('[useFullAIExtraction] Starting full AI extraction', params);
      setLoading(true);
      setError(null);
      setProgress(null);

      const doExtract = async () => {
        const { projectId, articleId, templateId } = params;

          // PHASE 1: Extract models and top-level sections in parallel
          console.warn('[useFullAIExtraction] Phase 1: Extracting models and top-level sections in parallel...');
        setProgress({
          stage: 'extracting_models',
        });

        // Run both extractions in parallel. allSettled (not all) so a
        // rejection in one branch does not orphan the other still-running
        // request. Each sub-hook surfaces its OWN error toast, so a Phase-1
        // failure is handled here and never reaches the catch below — that is
        // what removes the double error toast (#102).
        const [modelsSettled, topLevelSettled] = await Promise.allSettled([
          extractModelsHook({ projectId, articleId, templateId }),
          extractTopLevelSections({ projectId, articleId, templateId }),
        ]);

        const topLevelSectionsResult =
          topLevelSettled.status === 'fulfilled' ? topLevelSettled.value : null;

        if (modelsSettled.status === 'rejected') {
          // Model extraction gates phases 2-3 and already toasted its own
          // error. Refresh whatever the top-level phase produced, then stop —
          // no second toast.
          setError(
            modelsSettled.reason instanceof Error
              ? modelsSettled.reason.message
              : String(modelsSettled.reason),
          );
          if (options?.onSuccess) await options.onSuccess();
          setProgress(null);
          return;
        }

        // PHASE 2: Fetch extracted models
        const modelParentEntityTypeId = await fetchModelParentEntityTypeId(templateId);
        const modelsResult = await loadExtractedModels(articleId, modelParentEntityTypeId);

        if (!modelsResult.ok) {
          throw modelsResult.error;
        }
        const models = modelsResult.data;

        if (models.length === 0) {
          toast.warning(t('extraction', 'noModelsFoundTitle'), {
            description: t('extraction', 'noModelsExtractionComplete'),
          });
          // Top-level (study-level) proposals were still created in Phase 1 —
          // refresh so they appear instead of leaving the UI stale (#159).
          if (options?.onSuccess) await options.onSuccess();
          setProgress(null);
          return;
        }

          console.warn('[useFullAIExtraction] Found', models.length, 'model(s)', {
          modelNames: models.map(m => m.modelName),
        });

          // PHASE 3: Extract sections from all models
          console.warn('[useFullAIExtraction] Phase 3: Extracting sections from all models...');
        setProgress({
          stage: 'extracting_sections',
        });

        await extractAllSectionsForAllModels({
          projectId,
          articleId,
          templateId,
          models,
        });

          console.warn('[useFullAIExtraction] Full AI extraction completed successfully');

          // Final toast. If the study-level (top-level) branch rejected, the
          // models still succeeded but study-level sections were not saved —
          // the sub-hook already toasted the specific error, so surface a
          // partial-success WARNING here, never an unqualified success (#159).
        const topLevelSectionsCount = topLevelSectionsResult?.totalSections || 0;
        const topLevelSectionsSuccess = topLevelSectionsResult?.successfulSections || 0;

        if (topLevelSettled.status === 'rejected') {
          toast.warning(t('extraction', 'fullAIPartialTitle'), {
            description: t('extraction', 'fullAIPartialTopLevelFailed'),
            duration: 8000,
          });
        } else {
          let description = t('extraction', 'fullAISuccessDescription').replace('{{n}}', String(models.length));
          if (topLevelSectionsCount > 0) {
            description += ' ' + t('extraction', 'fullAITopLevelSections').replace('{{n}}', String(topLevelSectionsSuccess));
          }
          toast.success(t('extraction', 'fullAICompleteSuccessTitle'), {
            description,
            duration: 8000,
          });
        }

          // Call success callback if provided
        if (options?.onSuccess) {
          await options.onSuccess();
        }

          // Clear progress
        setProgress(null);
      };

      doExtract()
        .catch((err: unknown) => {
          console.error('[useFullAIExtraction] Error caught', {
            error: err instanceof Error ? err.message : String(err),
            name: err instanceof Error ? err.name : 'Unknown',
            stack: err instanceof Error ? err.stack : undefined,
          });

          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          toast.error(`${t('extraction', 'fullAIErrorPrefix')}: ${message}`, {duration: 8000});
          setProgress(null);
          throw err;
        })
        .finally(() => setLoading(false));
  };

  return { extractFullAI, loading, error, progress };
}
