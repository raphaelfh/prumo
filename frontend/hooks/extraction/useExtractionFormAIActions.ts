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

import type {Model} from '@/components/extraction/hierarchy/ModelSelector';
import type {ModelChildSection} from './helpers/getModelChildSections';
import {useBatchAllModelsSectionsExtraction} from './useBatchAllModelsSectionsExtraction';
import {useBatchSectionExtractionChunked} from './useBatchSectionExtractionChunked';
import {useModelExtraction} from './useModelExtraction';

export interface UseExtractionFormAIActionsProps {
  projectId: string;
  articleId: string;
  templateId: string;
  /**
   * Active HITL session run. Threaded into every AI extraction so models +
   * sections land on the SESSION run rather than forking a parallel run that
   * would shadow the reviewer's saved decisions (the orphaning bug). Null/absent
   * only before the session resolves — the buttons are gated on it upstream.
   */
  runId?: string | null;
  /**
   * Run-pinned model child sections, derived from the run view (B-5b).
   * Threaded into both batch entry points so the dispatch loop matches the
   * snapshot the backend extracts from — live rows can carry a manager's
   * unpublished draft section (undispatchable) or miss a
   * published-but-since-deleted one. Absent/empty → the batch hooks keep
   * their live fallback (the worklist path has no run view loaded).
   */
  sections?: ModelChildSection[];
  activeModelId: string | null;
  models: Model[];
  onRefreshModels: () => Promise<void>;
  onRefreshInstances: () => Promise<void>;
  onExtractionComplete?: () => void;
}

export function useExtractionFormAIActions(props: UseExtractionFormAIActionsProps) {
  const {
    projectId,
    articleId,
    templateId,
    runId,
    sections,
    activeModelId,
    models,
    onRefreshModels,
    onRefreshInstances,
    onExtractionComplete,
  } = props;

  // Normalise null → undefined once: the request types carry `runId?: string`,
  // so every handler feeds the extraction on the session run (never a fork).
  const sessionRunId = runId ?? undefined;

  const {extractModels, loading: extractingModels} = useModelExtraction({
    onSuccess: async (_runId, _modelsCreated, createdModels) => {
      // Refresh so the new models appear immediately, then extract every
      // created model's sections — a bare model with empty fields is not
      // a finished extraction from the user's point of view. The batch
      // hook's own onSuccess re-refreshes and fires onExtractionComplete.
      onRefreshModels()
        .then(() => onRefreshInstances())
        .then(() => {
          if (createdModels.length === 0) return undefined;
          return extractAllSectionsForAllModels({
            projectId,
            articleId,
            templateId,
            models: createdModels,
            // Chained sections land on the SAME session run as the models —
            // omitting this would fork a shadow run (the orphaning bug).
            runId: sessionRunId,
            // Sections are entity-type-level, so the run-pinned list applies
            // to freshly created models too (B-5b).
            sections,
          });
        })
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
    extractModels({projectId, articleId, templateId, runId: sessionRunId}).catch(
      (error: unknown) => {
        console.error('[useExtractionFormAIActions] extractModels failed:', error);
      },
    );
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
      runId: sessionRunId,
      extractAllSections: true,
      sections,
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
      runId: sessionRunId,
      sections,
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
