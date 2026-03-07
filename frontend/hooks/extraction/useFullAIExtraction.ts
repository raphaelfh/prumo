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

import {useCallback, useState} from "react";
import {toast} from "sonner";
import {t} from "@/lib/copy";
import {useModelExtraction} from "./useModelExtraction";
import type {AllModelsSectionsProgress} from "./useBatchAllModelsSectionsExtraction";
import {useBatchAllModelsSectionsExtraction} from "./useBatchAllModelsSectionsExtraction";
import type {TopLevelSectionsProgress} from "./useTopLevelSectionsExtraction";
import {useTopLevelSectionsExtraction} from "./useTopLevelSectionsExtraction";
import {supabase} from "@/integrations/supabase/client";
import {queryEntityTypesWithFallback} from "./helpers/queryEntityTypes";

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
   * Fetches extracted models from the article
   *
   * @param articleId - Article ID
   * @param modelParentEntityTypeId - Model entity type ID
   * @returns Array of found models
   */
  const fetchExtractedModels = useCallback(async (
    articleId: string,
    modelParentEntityTypeId: string
  ): Promise<Array<{ instanceId: string; modelName: string }>> => {
    const { data: instances, error: instancesError } = await supabase
      .from('extraction_instances')
      .select('id, label')
      .eq('article_id', articleId)
      .eq('entity_type_id', modelParentEntityTypeId)
      .order('sort_order', { ascending: true });

    if (instancesError) {
      throw new Error(`Failed to fetch models: ${instancesError.message}`);
    }

    return (instances || []).map(instance => ({
      instanceId: instance.id,
        modelName: instance.label || 'Unnamed model',
    }));
  }, []);

  /**
   * Fetches the model entity type ID (prediction_models)
   *
   * @param templateId - Template ID
   * @returns Model entity type ID
   */
  const fetchModelParentEntityTypeId = useCallback(async (
    templateId: string
  ): Promise<string> => {
    const results = await queryEntityTypesWithFallback<{ id: string }>({
      templateId,
      select: 'id',
      filters: (query) => query.eq('name', 'prediction_models'),
    });

    if (results.length === 0) {
      throw new Error('Model entity type (prediction_models) not found in template');
    }

    return results[0].id;
  }, []);

  /**
   * Extracts models and then sections for each model
   *
   * @param params - Extraction parameters
   */
  const extractFullAI = useCallback(
    async (params: {
      projectId: string;
      articleId: string;
      templateId: string;
    }) => {
        console.warn('[useFullAIExtraction] Starting full AI extraction', params);
      setLoading(true);
      setError(null);
      setProgress(null);

      try {
        const { projectId, articleId, templateId } = params;

          // PHASE 1: Extract models and top-level sections in parallel
          console.warn('[useFullAIExtraction] Phase 1: Extracting models and top-level sections in parallel...');
        setProgress({
          stage: 'extracting_models',
        });

          // Run both extractions in parallel
          const [_modelsResult, topLevelSectionsResult] = await Promise.all([
          extractModelsHook({
            projectId,
            articleId,
            templateId,
          }),
          extractTopLevelSections({
            projectId,
            articleId,
            templateId,
          }),
        ]);

          console.warn('[useFullAIExtraction] Models and top-level sections extracted successfully', {
          modelsExtracted: true,
          topLevelSectionsExtracted: topLevelSectionsResult.totalSections > 0,
        });

          // PHASE 2: Fetch extracted models
          console.warn('[useFullAIExtraction] Phase 2: Fetching extracted models...');
        const modelParentEntityTypeId = await fetchModelParentEntityTypeId(templateId);
        const models = await fetchExtractedModels(articleId, modelParentEntityTypeId);

        if (models.length === 0) {
            toast.warning(t('extraction', 'noModelsFoundTitle'), {
                description: t('extraction', 'noModelsExtractionComplete'),
          });
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

          // Final success toast
        const topLevelSectionsCount = topLevelSectionsResult?.totalSections || 0;
        const topLevelSectionsSuccess = topLevelSectionsResult?.successfulSections || 0;

          let description = t('extraction', 'fullAISuccessDescription').replace('{{n}}', String(models.length));
        if (topLevelSectionsCount > 0) {
            description += ' ' + t('extraction', 'fullAITopLevelSections').replace('{{n}}', String(topLevelSectionsSuccess));
        }
          toast.success(t('extraction', 'fullAICompleteSuccessTitle'), {
              description,
              duration: 8000,
          });

          // Call success callback if provided
        if (options?.onSuccess) {
          await options.onSuccess();
        }

          // Clear progress
        setProgress(null);
      } catch (err: any) {
          console.error('[useFullAIExtraction] Error caught', {
          error: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : 'Unknown',
          stack: err instanceof Error ? err.stack : undefined,
        });

          // Handle error in a user-friendly way
        const message = err instanceof Error ? err.message : String(err);
        setError(message);

          toast.error(`${t('extraction', 'fullAIErrorPrefix')}: ${message}`, {
          duration: 8000,
        });

          // Clear progress
        setProgress(null);

          // Re-throw to allow additional handling by the component
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [extractModelsHook, extractTopLevelSections, extractAllSectionsForAllModels, fetchModelParentEntityTypeId, fetchExtractedModels, options],
  );

  return { extractFullAI, loading, error, progress };
}

