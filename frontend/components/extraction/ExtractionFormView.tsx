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
import {useExtractionFormAIActions} from '@/hooks/extraction/useExtractionFormAIActions';
import type {
  ExtractionEntityTypeWithFields,
  ExtractionInstance,
  ExtractionValue,
} from '@/types/extraction';
import type {AISuggestion, AISuggestionHistoryItem} from '@/hooks/extraction/ai/useAISuggestions';
import type {OtherExtraction} from '@/hooks/extraction/colaboracao/useOtherExtractions';

export interface ExtractionFormViewProps {
  studyLevelSections: ExtractionEntityTypeWithFields[];
  modelParentEntityType: ExtractionEntityTypeWithFields | undefined;
  modelChildSections: ExtractionEntityTypeWithFields[];
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
  modelsLoading: boolean;
  /** Callback to refresh values/suggestions after AI extraction. */
  onExtractionComplete?: () => void;
}

function ExtractionFormViewComponent(props: ExtractionFormViewProps) {
  const ai = useExtractionFormAIActions({
    projectId: props.projectId,
    articleId: props.articleId,
    templateId: props.templateId,
    activeModelId: props.activeModelId,
    models: props.models,
    onRefreshModels: props.onRefreshModels,
    onRefreshInstances: props.onRefreshInstances,
    onExtractionComplete: props.onExtractionComplete,
  });

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
          onExtractModels={ai.handleExtractModels}
          extractingModels={ai.extractingModels}
          onExtractAllSections={ai.handleExtractAllSections}
          extractingAllSections={ai.extractingAllSections}
          extractionProgress={ai.extractionProgress}
          onExtractAllSectionsForAllModels={ai.handleExtractAllSectionsForAllModels}
          extractingAllSectionsForAllModels={ai.extractingAllSectionsForAllModels}
          allModelsProgress={ai.allModelsProgress}
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
    prevProps.models.length === nextProps.models.length &&
    !aiSuggestionsChanged
  );
});

ExtractionFormView.displayName = 'ExtractionFormView';
