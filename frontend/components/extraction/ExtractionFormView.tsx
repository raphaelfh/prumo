/**
 * Extraction form view.
 *
 * Renders the form in two regions:
 * 1. ``studyLevelSections`` — top-level accordions, one instance per
 *    article (filled once regardless of the model selection).
 * 2. ``<ModelSection />`` — the model container's selector + container
 *    fields + per-model children, only when the template has a
 *    ``model_container`` (CHARMS does; PROBAST/QUADAS-2 don't).
 *
 * Owns AI extraction wiring (model identification + per-model batch +
 * cross-model batch) but delegates per-section rendering. After the
 * cleanup of migration ``0016_entity_role_column`` the legacy inline
 * conditional that compensated for the missing parent-fields render
 * has moved into ``ModelSection``.
 */

import {memo} from 'react';
import {ModelSection} from './ModelSection';
import {SectionAccordion} from './SectionAccordion';
import {useBatchAllModelsSectionsExtraction} from '@/hooks/extraction/useBatchAllModelsSectionsExtraction';
import {useBatchSectionExtractionChunked} from '@/hooks/extraction/useBatchSectionExtractionChunked';
import {useModelExtraction} from '@/hooks/extraction/useModelExtraction';
import type {
  ExtractionEntityType,
  ExtractionField,
  ExtractionInstance,
  ExtractionValue,
} from '@/types/extraction';
import type {AISuggestion, AISuggestionHistoryItem} from '@/hooks/extraction/ai/useAISuggestions';
import type {OtherExtraction} from '@/hooks/extraction/colaboracao/useOtherExtractions';

interface EntityTypeWithFields extends ExtractionEntityType {
  fields: ExtractionField[];
}

export interface ExtractionFormViewProps {
  studyLevelSections: EntityTypeWithFields[];
  modelParentEntityType: EntityTypeWithFields | undefined;
  modelChildSections: EntityTypeWithFields[];
  instances: ExtractionInstance[];
  values: Record<string, ExtractionValue>;
  updateValue: (instanceId: string, fieldId: string, value: ExtractionValue) => void;
  otherExtractions: OtherExtraction[];
  aiSuggestions: Record<string, AISuggestion>;
  acceptSuggestion: (instanceId: string, fieldId: string) => Promise<void>;
  rejectSuggestion: (instanceId: string, fieldId: string) => Promise<void>;
  getSuggestionsHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  isActionLoading?: (instanceId: string, fieldId: string) => 'accept' | 'reject' | null;
  models: Array<{ instanceId: string; modelName: string }>;
  activeModelId: string | null;
  setActiveModelId: (id: string) => void;
  onAddModel: () => void;
  onRemoveModel: (id: string) => void;
  onRefreshModels: () => Promise<void>;
  onRefreshInstances: () => Promise<void>;
  getInstancesForModel: (entityTypeId: string, modelId: string) => ExtractionInstance[];
  handleAddInstance: (entityTypeId: string) => void;
  handleRemoveInstance: (instanceId: string) => void;
  projectId: string;
  articleId: string;
  /** Required for section-scoped AI extraction. */
  templateId: string;
  /** Active HITL run. AI proposals must be written here when present. */
  runId?: string | null;
  modelsLoading: boolean;
  /** Callback to refresh values/suggestions after AI extraction. */
  onExtractionComplete?: () => void;
}

function ExtractionFormViewComponent(props: ExtractionFormViewProps) {
  // === AI: identify candidate models from the article ===
  const {extractModels, loading: extractingModels} = useModelExtraction({
    onSuccess: async (runId, modelsCreated) => {
      console.warn('[ExtractionFormView] Models extracted:', {runId, modelsCreated});
      try {
        await props.onRefreshModels();
        await props.onRefreshInstances();
        if (props.models.length === 0 && modelsCreated > 0) {
          setTimeout(async () => {
            await props.onRefreshModels();
          }, 500);
        }
      } catch (error) {
        console.error('[ExtractionFormView] Error reloading after model extraction:', error);
      }
    },
  });

  const handleExtractModels = async () => {
    try {
      await extractModels({
        projectId: props.projectId,
        articleId: props.articleId,
        templateId: props.templateId,
        runId: props.runId ?? undefined,
        autoAdvanceToReview: props.runId ? false : undefined,
      });
    } catch (error) {
      console.error('[ExtractionFormView] Error in model extraction:', error);
    }
  };

  // === AI: extract every section of the active model ===
  const {
    extractAllSections,
    loading: extractingAllSections,
    progress: extractionProgress,
  } = useBatchSectionExtractionChunked({
    onSuccess: async (result) => {
      console.warn('[ExtractionFormView] All sections extracted:', result);
      try {
        await props.onRefreshInstances();
        if (props.onExtractionComplete) {
          await props.onExtractionComplete();
        }
      } catch (error) {
        console.error('[ExtractionFormView] Error reloading after all sections extraction:', error);
      }
    },
  });

  const handleExtractAllSections = async () => {
    if (!props.activeModelId) {
      console.warn('[ExtractionFormView] No active model to extract all sections');
      return;
    }
    try {
      await extractAllSections({
        projectId: props.projectId,
        articleId: props.articleId,
        templateId: props.templateId,
        parentInstanceId: props.activeModelId,
        extractAllSections: true,
        runId: props.runId ?? undefined,
        autoAdvanceToReview: props.runId ? false : undefined,
      });
    } catch (error) {
      console.error('[ExtractionFormView] Error in extraction of all sections:', error);
    }
  };

  // === AI: extract every section of every model ===
  const {
    extractAllSectionsForAllModels,
    loading: extractingAllSectionsForAllModels,
    progress: allModelsProgress,
  } = useBatchAllModelsSectionsExtraction({
    onSuccess: async (result) => {
      console.warn('[ExtractionFormView] Sections from all models extracted:', result);
      try {
        await props.onRefreshInstances();
        if (props.onExtractionComplete) {
          await props.onExtractionComplete();
        }
      } catch (error) {
        console.error(
          '[ExtractionFormView] Error reloading after extraction of sections from all models:',
          error,
        );
      }
    },
  });

  const handleExtractAllSectionsForAllModels = async () => {
    if (props.models.length === 0) {
      console.warn('[ExtractionFormView] No model available to extract sections');
      return;
    }
    try {
      await extractAllSectionsForAllModels({
        projectId: props.projectId,
        articleId: props.articleId,
        templateId: props.templateId,
        runId: props.runId,
        models: props.models.map(m => ({
          instanceId: m.instanceId,
          modelName: m.modelName,
        })),
      });
    } catch (error) {
      console.error('[ExtractionFormView] Error in extraction of sections from all models:', error);
    }
  };

  return (
    <>
      {props.studyLevelSections.map(entityType => {
        const typeInstances = props.instances.filter(i => i.entity_type_id === entityType.id);
        return (
          <SectionAccordion
            key={entityType.id}
            entityType={entityType}
            instances={typeInstances}
            fields={entityType.fields}
            values={props.values}
            onValueChange={props.updateValue}
            projectId={props.projectId}
            articleId={props.articleId}
            templateId={props.templateId}
            runId={props.runId}
            otherExtractions={props.otherExtractions}
            aiSuggestions={props.aiSuggestions}
            onAcceptAI={props.acceptSuggestion}
            onRejectAI={props.rejectSuggestion}
            getSuggestionsHistory={props.getSuggestionsHistory}
            isActionLoading={props.isActionLoading}
            onAddInstance={() => props.handleAddInstance(entityType.id)}
            onRemoveInstance={props.handleRemoveInstance}
            viewMode="extract"
            onExtractionComplete={props.onExtractionComplete}
          />
        );
      })}

      {props.modelParentEntityType && (
        <ModelSection
          modelContainer={props.modelParentEntityType}
          modelChildren={props.modelChildSections}
          instances={props.instances}
          activeModelId={props.activeModelId}
          setActiveModelId={props.setActiveModelId}
          models={props.models}
          modelsLoading={props.modelsLoading}
          onAddModel={props.onAddModel}
          onRemoveModel={props.onRemoveModel}
          values={props.values}
          updateValue={props.updateValue}
          otherExtractions={props.otherExtractions}
          aiSuggestions={props.aiSuggestions}
          acceptSuggestion={props.acceptSuggestion}
          rejectSuggestion={props.rejectSuggestion}
          getSuggestionsHistory={props.getSuggestionsHistory}
          isActionLoading={props.isActionLoading}
          getInstancesForModel={props.getInstancesForModel}
          handleAddInstance={props.handleAddInstance}
          handleRemoveInstance={props.handleRemoveInstance}
          projectId={props.projectId}
          articleId={props.articleId}
          templateId={props.templateId}
          runId={props.runId}
          onExtractModels={handleExtractModels}
          extractingModels={extractingModels}
          onExtractAllSections={handleExtractAllSections}
          extractingAllSections={extractingAllSections}
          extractionProgress={extractionProgress}
          onExtractAllSectionsForAllModels={handleExtractAllSectionsForAllModels}
          extractingAllSectionsForAllModels={extractingAllSectionsForAllModels}
          allModelsProgress={allModelsProgress}
          onExtractionComplete={props.onExtractionComplete}
        />
      )}
    </>
  );
}

// Memoize on the props that actually trigger a visual change. AI suggestion
// updates are checked by reference + length so the form re-renders when the
// suggestions hook publishes a new map after extraction.
export const ExtractionFormView = memo(ExtractionFormViewComponent, (prevProps, nextProps) => {
  const aiSuggestionsChanged =
    prevProps.aiSuggestions !== nextProps.aiSuggestions ||
    Object.keys(prevProps.aiSuggestions).length !== Object.keys(nextProps.aiSuggestions).length;

  return (
    prevProps.values === nextProps.values &&
    prevProps.instances === nextProps.instances &&
    prevProps.studyLevelSections === nextProps.studyLevelSections &&
    prevProps.modelChildSections === nextProps.modelChildSections &&
    prevProps.activeModelId === nextProps.activeModelId &&
    prevProps.runId === nextProps.runId &&
    prevProps.models.length === nextProps.models.length &&
    !aiSuggestionsChanged
  );
});

ExtractionFormView.displayName = 'ExtractionFormView';
