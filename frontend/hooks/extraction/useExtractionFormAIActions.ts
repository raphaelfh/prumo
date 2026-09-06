/**
 * Groups the three AI-extraction hooks one entry group orchestrates:
 * identifying its entries, extracting every section under the active
 * entry, and doing that for every entry. The section component consumes
 * a single object instead of wiring three hooks + three handlers inline.
 *
 * Identification is `POST /extraction/sections` against THIS group —
 * identify → resolve → extract, the generalized pipeline B1 built. It was
 * `POST /extraction/models`, which took no entity type and could only ever
 * mean the one container 0016 allowed: on any other group it identified
 * the WRONG group's entries, and the hook is instantiated per group.
 *
 * Keeps refresh / completion side-effects (``onRefreshInstances``,
 * ``onExtractionComplete``) in one place so any new AI action just plugs
 * into the same callback chain.
 */

import type {Entry} from '@/components/extraction/entries/types';
import type {ModelChildSection} from './helpers/getModelChildSections';
import {useBatchAllModelsSectionsExtraction} from './useBatchAllModelsSectionsExtraction';
import {useBatchSectionExtractionChunked} from './useBatchSectionExtractionChunked';
import {useSectionExtraction} from './useSectionExtraction';

export interface UseExtractionFormAIActionsProps {
  projectId: string;
  articleId: string;
  templateId: string;
  /** The repeating section these actions belong to — what Identify targets. */
  entityTypeId: string;
  /** The entry this group hangs under, or null at article scope. Two models
   * may each own an `internal` validation, and each identifies into its own
   * parent's coordinate. */
  parentInstanceId: string | null;
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
  models: Entry[];
  onRefreshInstances: () => Promise<void>;
  onExtractionComplete?: () => void;
}

export function useExtractionFormAIActions(props: UseExtractionFormAIActionsProps) {
  const {
    projectId,
    articleId,
    templateId,
    entityTypeId,
    parentInstanceId,
    runId,
    sections,
    activeModelId,
    models,
    onRefreshInstances,
    onExtractionComplete,
  } = props;

  // Normalise null → undefined once: the request types carry `runId?: string`,
  // so every handler feeds the extraction on the session run (never a fork).
  const sessionRunId = runId ?? undefined;

  const {extractSection: identifyEntries, loading: identifying} = useSectionExtraction({
    onSuccess: async () => {
      // Refresh so the identified entries appear immediately. The model
      // path used to chain "extract every section for every model" here,
      // because its endpoint created BARE models with no fields. This one
      // extracts the group's own fields in the same call, so the entries
      // arrive named and identified; filling their child sections stays the
      // explicit action it is labelled as.
      onRefreshInstances()
        .then(() => onExtractionComplete?.())
        .catch((error: unknown) => {
          console.error('[useExtractionFormAIActions] refresh after identification failed:', error);
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

  const handleIdentifyEntries = async () => {
    identifyEntries({
      projectId,
      articleId,
      templateId,
      runId: sessionRunId,
      // The two halves the model endpoint could not carry: WHICH group, and
      // under which entry of its parent.
      entityTypeId,
      parentInstanceId: parentInstanceId ?? undefined,
    }).catch((error: unknown) => {
      console.error('[useExtractionFormAIActions] identifyEntries failed:', error);
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
      models: models.map(m => ({instanceId: m.instanceId, entryName: m.entryName})),
      runId: sessionRunId,
      sections,
    }).catch((error: unknown) => {
      console.error('[useExtractionFormAIActions] extractAllSectionsForAllModels failed:', error);
    });
  };

  return {
    handleIdentifyEntries,
    identifying,
    handleExtractAllSections,
    extractingAllSections,
    extractionProgress,
    handleExtractAllSectionsForAllModels,
    extractingAllSectionsForAllModels,
    allModelsProgress,
  };
}
