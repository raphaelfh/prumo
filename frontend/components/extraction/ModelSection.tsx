/**
 * Per-model region of the extraction form.
 *
 * Owns everything that renders below the study-level accordions and is
 * scoped to the model container entity type: the visual separator, the
 * model selector, AI extraction progress indicators, the container's own
 * fields accordion (so manager-added fields on the parent are not lost),
 * and the children sections rendered against the active model instance.
 *
 * Lives in its own file so ``ExtractionFormView`` stays a thin
 * composition of "study-level accordions" + "model section", with no
 * inline conditionals or one-off comments about the historical render
 * bugs that this layout used to mask.
 */
import {Separator} from '@/components/ui/separator';
import {BatchAllModelsSectionsProgress} from './BatchAllModelsSectionsProgress';
import {BatchExtractionProgress} from './BatchExtractionProgress';
import {ModelSelector} from './hierarchy/ModelSelector';
import {SectionAccordion} from './SectionAccordion';
import type {
  ExtractionEntityTypeWithFields,
  ExtractionInstance,
  ExtractionValue,
} from '@/types/extraction';
import type {AISuggestion, AISuggestionHistoryItem} from '@/hooks/extraction/ai/useAISuggestions';
import type {OtherExtraction} from '@/hooks/extraction/colaboracao/useOtherExtractions';

interface BatchExtractionProgressData {
  current: number;
  total: number;
  sectionName: string;
}

interface AllModelsProgressData {
  currentModel: number;
  totalModels: number;
  currentSection: number;
  totalSections: number;
  modelName: string;
  sectionName: string;
}

export interface ModelSectionProps {
  /** The model container entity type (cardinality='many'). */
  modelContainer: ExtractionEntityTypeWithFields;
  /** Children of the model container, rendered inside the active model. */
  modelChildren: ExtractionEntityTypeWithFields[];
  /** Article-scoped instances loaded by the page. */
  instances: ExtractionInstance[];
  /** Currently active model instance id; null when nothing is selected. */
  activeModelId: string | null;
  setActiveModelId: (id: string) => void;

  /** Model picker data + create/remove handlers. */
  models: Array<{ instanceId: string; modelName: string }>;
  modelsLoading: boolean;
  onAddModel: () => void;
  onRemoveModel: (id: string) => void;

  /** Field values + change handler shared with study-level accordions. */
  values: Record<string, ExtractionValue>;
  updateValue: (instanceId: string, fieldId: string, value: ExtractionValue) => void;

  /** AI suggestion + collaborator metadata, also shared with study-level. */
  otherExtractions: OtherExtraction[];
  aiSuggestions: Record<string, AISuggestion>;
  acceptSuggestion: (instanceId: string, fieldId: string) => Promise<void>;
  rejectSuggestion: (instanceId: string, fieldId: string) => Promise<void>;
  getSuggestionsHistory?: (
    instanceId: string,
    fieldId: string,
  ) => Promise<AISuggestionHistoryItem[]>;
  isActionLoading?: (instanceId: string, fieldId: string) => 'accept' | 'reject' | null;

  /** Instance mutations (add/remove repeatable sub-instances). */
  getInstancesForModel: (entityTypeId: string, modelId: string) => ExtractionInstance[];
  handleAddInstance: (entityTypeId: string) => void;
  handleRemoveInstance: (instanceId: string) => void;

  /** Context required by section-level AI triggers. */
  projectId: string;
  articleId: string;
  templateId: string;
  /** Active HITL-session run id. Passed to SectionAccordion. */
  runId?: string | null;

  /** AI extraction wiring. */
  onExtractModels: () => Promise<void> | void;
  extractingModels: boolean;

  onExtractAllSections?: () => Promise<void> | void;
  extractingAllSections: boolean;
  extractionProgress: BatchExtractionProgressData | null;

  onExtractAllSectionsForAllModels: () => Promise<void> | void;
  extractingAllSectionsForAllModels: boolean;
  allModelsProgress: AllModelsProgressData | null;

  /** Bubbled up after any AI section extraction completes. */
  onExtractionComplete?: () => void;
}

export function ModelSection(props: ModelSectionProps): JSX.Element {
  const {
    modelContainer,
    modelChildren,
    instances,
    activeModelId,
    setActiveModelId,
    models,
    modelsLoading,
    onAddModel,
    onRemoveModel,
    values,
    updateValue,
    otherExtractions,
    aiSuggestions,
    acceptSuggestion,
    rejectSuggestion,
    getSuggestionsHistory,
    isActionLoading,
    getInstancesForModel,
    handleAddInstance,
    handleRemoveInstance,
    projectId,
    articleId,
    templateId,
    runId,
    onExtractModels,
    extractingModels,
    onExtractAllSections,
    extractingAllSections,
    extractionProgress,
    onExtractAllSectionsForAllModels,
    extractingAllSectionsForAllModels,
    allModelsProgress,
    onExtractionComplete,
  } = props;

  const activeModelInstance = activeModelId
    ? instances.filter(i => i.id === activeModelId)
    : [];

  return (
    <>
      <div className="py-4">
        <Separator />
      </div>

      <ModelSelector
        models={models}
        activeModelId={activeModelId}
        onSelectModel={setActiveModelId}
        onAddModel={onAddModel}
        onRemoveModel={onRemoveModel}
        onExtractModels={onExtractModels}
        extractingModels={extractingModels}
        loading={modelsLoading}
        onExtractAllSections={activeModelId ? onExtractAllSections : undefined}
        extractingAllSections={extractingAllSections}
        onExtractAllSectionsForAllModels={onExtractAllSectionsForAllModels}
        extractingAllSectionsForAllModels={extractingAllSectionsForAllModels}
      />

      {extractingAllSections && extractionProgress && (
        <div className="mt-4">
          <BatchExtractionProgress progress={extractionProgress} />
        </div>
      )}

      {extractingAllSectionsForAllModels && allModelsProgress && (
        <div className="mt-4">
          <BatchAllModelsSectionsProgress progress={allModelsProgress} />
        </div>
      )}

      {activeModelId && (
        <div className="space-y-4 mt-4">
          {/*
            The model container is itself an entity type with fields
            (CHARMS ships ``model_name`` + ``modelling_method``; managers
            can add more in the Configuration tab). We render an accordion
            for it when it carries any fields so they bind to the active
            model instance — children are rendered immediately below.
          */}
          {modelContainer.fields.length > 0 && (
            <SectionAccordion
              key={modelContainer.id}
              entityType={modelContainer}
              instances={activeModelInstance}
              fields={modelContainer.fields}
              values={values}
              onValueChange={updateValue}
              projectId={projectId}
              articleId={articleId}
              templateId={templateId}
              runId={runId}
              otherExtractions={otherExtractions}
              aiSuggestions={aiSuggestions}
              onAcceptAI={acceptSuggestion}
              onRejectAI={rejectSuggestion}
              getSuggestionsHistory={getSuggestionsHistory}
              isActionLoading={isActionLoading}
              onAddInstance={() => handleAddInstance(modelContainer.id)}
              onRemoveInstance={handleRemoveInstance}
              viewMode="extract"
              onExtractionComplete={onExtractionComplete}
            />
          )}

          {modelChildren.map(entityType => (
            <SectionAccordion
              key={entityType.id}
              entityType={entityType}
              instances={getInstancesForModel(entityType.id, activeModelId)}
              fields={entityType.fields}
              values={values}
              onValueChange={updateValue}
              projectId={projectId}
              articleId={articleId}
              templateId={templateId}
              runId={runId}
              parentInstanceId={activeModelId}
              otherExtractions={otherExtractions}
              aiSuggestions={aiSuggestions}
              onAcceptAI={acceptSuggestion}
              onRejectAI={rejectSuggestion}
              getSuggestionsHistory={getSuggestionsHistory}
              isActionLoading={isActionLoading}
              onAddInstance={() => handleAddInstance(entityType.id)}
              onRemoveInstance={handleRemoveInstance}
              viewMode="extract"
              onExtractionComplete={onExtractionComplete}
            />
          ))}
        </div>
      )}
    </>
  );
}
