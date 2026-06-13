/**
 * Groups the three AI-extraction hooks the form orchestrates:
 * model identification, per-model batch section extraction, and
 * cross-model batch section extraction. The form component consumes
 * a single object instead of wiring three hooks + three handlers
 * inline.
 *
 * Keeps refresh / completion side-effects (``onRefreshModels``,
 * ``onRefreshInstances``, ``onExtractionComplete``) in one place so
 * any new AI action just plugs into the same callback chain.
 */

import {useBatchAllModelsSectionsExtraction} from './useBatchAllModelsSectionsExtraction';
import {useBatchSectionExtractionChunked} from './useBatchSectionExtractionChunked';
import {useModelExtraction} from './useModelExtraction';

export interface UseExtractionFormAIActionsProps {
  projectId: string;
  articleId: string;
  templateId: string;
  activeModelId: string | null;
  models: Array<{instanceId: string; modelName: string}>;
  onRefreshModels: () => Promise<void>;
  onRefreshInstances: () => Promise<void>;
  onExtractionComplete?: () => void;
}

export function useExtractionFormAIActions(props: UseExtractionFormAIActionsProps) {
  const {
    projectId,
    articleId,
    templateId,
    activeModelId,
    models,
    onRefreshModels,
    onRefreshInstances,
    onExtractionComplete,
  } = props;

  const {extractModels, loading: extractingModels} = useModelExtraction({
    onSuccess: async () => {
      onRefreshModels()
        .then(() => onRefreshInstances())
        .catch((error: unknown) => {
          console.error('[useExtractionFormAIActions] refresh after model extraction failed:', error);
        });
    },
  });

  const {
    extractAllSections,
    loading: extractingAllSections,
    progress: extractionProgress,
  } = useBatchSectionExtractionChunked({
    onSuccess: async () => {
      onRefreshInstances()
        .then(() => onExtractionComplete?.())
        .catch((error: unknown) => {
          console.error('[useExtractionFormAIActions] refresh after section extraction failed:', error);
        });
    },
  });

  const {
    extractAllSectionsForAllModels,
    loading: extractingAllSectionsForAllModels,
    progress: allModelsProgress,
  } = useBatchAllModelsSectionsExtraction({
    onSuccess: async () => {
      onRefreshInstances()
        .then(() => onExtractionComplete?.())
        .catch((error: unknown) => {
          console.error('[useExtractionFormAIActions] refresh after cross-model extraction failed:', error);
        });
    },
  });

  const handleExtractModels = async () => {
    extractModels({projectId, articleId, templateId}).catch((error: unknown) => {
      console.error('[useExtractionFormAIActions] extractModels failed:', error);
    });
  };

  const handleExtractAllSections = async () => {
    if (!activeModelId) {
      console.warn('[useExtractionFormAIActions] no active model; skipping');
      return;
    }
    extractAllSections({
      projectId,
      articleId,
      templateId,
      parentInstanceId: activeModelId,
      extractAllSections: true,
    }).catch((error: unknown) => {
      console.error('[useExtractionFormAIActions] extractAllSections failed:', error);
    });
  };

  const handleExtractAllSectionsForAllModels = async () => {
    if (models.length === 0) {
      console.warn('[useExtractionFormAIActions] no models; skipping');
      return;
    }
    extractAllSectionsForAllModels({
      projectId,
      articleId,
      templateId,
      models: models.map(m => ({instanceId: m.instanceId, modelName: m.modelName})),
    }).catch((error: unknown) => {
      console.error('[useExtractionFormAIActions] extractAllSectionsForAllModels failed:', error);
    });
  };

  return {
    handleExtractModels,
    extractingModels,
    handleExtractAllSections,
    extractingAllSections,
    extractionProgress,
    handleExtractAllSectionsForAllModels,
    extractingAllSectionsForAllModels,
    allModelsProgress,
  };
}
