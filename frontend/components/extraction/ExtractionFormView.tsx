/**
 * Extraction form view
 *
 * Renders sections in extraction mode (non-comparison).
 * Extracted from ExtractionFullScreen for modularity.
 */

import {memo} from 'react';
import {SectionAccordion} from './SectionAccordion';
import {ModelSelector} from './hierarchy/ModelSelector';
import {Separator} from '@/components/ui/separator';
import {useModelExtraction} from '@/hooks/extraction/useModelExtraction';
import {useBatchSectionExtractionChunked} from '@/hooks/extraction/useBatchSectionExtractionChunked';
import {useBatchAllModelsSectionsExtraction} from '@/hooks/extraction/useBatchAllModelsSectionsExtraction';
import {BatchExtractionProgress} from './BatchExtractionProgress';
import {BatchAllModelsSectionsProgress} from './BatchAllModelsSectionsProgress';
import type {ExtractionEntityType, ExtractionField, ExtractionInstance, ExtractionValue} from '@/types/extraction';
import type {OtherExtraction} from '@/hooks/extraction/colaboracao/useOtherExtractions';
import type {AISuggestion, AISuggestionHistoryItem} from '@/hooks/extraction/ai/useAISuggestions';

// Tipo auxiliar para entity types com fields
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
    templateId: string; // Required for section extraction
  modelsLoading: boolean;
    onExtractionComplete?: () => void; // Callback to refresh after extraction
}

function ExtractionFormViewComponent(props: ExtractionFormViewProps) {
    // Hook for model extraction
  const { extractModels, loading: extractingModels } = useModelExtraction({
    onSuccess: async (runId, modelsCreated) => {
        console.log('[ExtractionFormView] Models extracted:', {runId, modelsCreated});

        // Reload models and instances after extraction
      try {
        await props.onRefreshModels();
        await props.onRefreshInstances();

          // Select first model if no activeModelId
        if (props.models.length === 0 && modelsCreated > 0) {
          // Aguardar um pouco para garantir que os modelos foram carregados
          setTimeout(async () => {
            await props.onRefreshModels();
              // setActiveModelId will be called by parent via useModelManagement
          }, 500);
        }
      } catch (error) {
          console.error('[ExtractionFormView] Error reloading after model extraction:', error);
      }
    },
  });

  // Handler para extrair modelos
  const handleExtractModels = async () => {
    try {
      await extractModels({
        projectId: props.projectId,
        articleId: props.articleId,
        templateId: props.templateId,
      });
    } catch (error) {
        // Error already handled by hook with toast
        console.error('[ExtractionFormView] Error in model extraction:', error);
    }
  };

    // Hook for extracting all sections of the model with chunking
  const { extractAllSections, loading: extractingAllSections, progress: extractionProgress } = useBatchSectionExtractionChunked({
    onSuccess: async (result) => {
        console.log('[ExtractionFormView] All sections extracted:', result);

        // Reload instances and suggestions after extraction
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

    // Handler to extract all sections of the active model
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
      });
    } catch (error) {
        // Error already handled by hook with toast
        console.error('[ExtractionFormView] Error in extraction of all sections:', error);
    }
  };

    // Hook for extracting sections from all models
  const { extractAllSectionsForAllModels, loading: extractingAllSectionsForAllModels, progress: allModelsProgress } = useBatchAllModelsSectionsExtraction({
    onSuccess: async (result) => {
        console.log('[ExtractionFormView] Sections from all models extracted:', result);

        // Reload instances and suggestions after extraction
      try {
        await props.onRefreshInstances();
        if (props.onExtractionComplete) {
          await props.onExtractionComplete();
        }
      } catch (error) {
          console.error('[ExtractionFormView] Error reloading after extraction of sections from all models:', error);
      }
    },
  });

    // Handler to extract sections from all models
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
        models: props.models.map(m => ({
          instanceId: m.instanceId,
          modelName: m.modelName,
        })),
      });
    } catch (error) {
        // Error already handled by hook with toast
        console.error('[ExtractionFormView] Error in extraction of sections from all models:', error);
    }
  };

  return (
    <>
      {/* Study-level sections */}
      {props.studyLevelSections.map(entityType => {
        const typeInstances = props.instances.filter(
          i => i.entity_type_id === entityType.id
        );
        
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
      
      {/* Model sections */}
      {props.modelParentEntityType && (
        <>
          <div className="py-4">
            <Separator />
          </div>
          
          <ModelSelector
            models={props.models}
            activeModelId={props.activeModelId}
            onSelectModel={props.setActiveModelId}
            onAddModel={props.onAddModel}
            onRemoveModel={props.onRemoveModel}
            onExtractModels={handleExtractModels}
            extractingModels={extractingModels}
            loading={props.modelsLoading}
            onExtractAllSections={props.activeModelId ? handleExtractAllSections : undefined}
            extractingAllSections={extractingAllSections}
            onExtractAllSectionsForAllModels={handleExtractAllSectionsForAllModels}
            extractingAllSectionsForAllModels={extractingAllSectionsForAllModels}
          />

            {/* Batch extraction progress for one model */}
          {extractingAllSections && extractionProgress && (
            <div className="mt-4">
              <BatchExtractionProgress progress={extractionProgress} />
            </div>
          )}

            {/* Batch extraction progress for all models */}
          {extractingAllSectionsForAllModels && allModelsProgress && (
            <div className="mt-4">
              <BatchAllModelsSectionsProgress progress={allModelsProgress} />
            </div>
          )}
          
          {props.activeModelId && (
            <div className="space-y-4 mt-4">
              {props.modelChildSections.map(entityType => {
                const typeInstances = props.getInstancesForModel(
                  entityType.id,
                  props.activeModelId!
                );
                
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
                    parentInstanceId={props.activeModelId || undefined}
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
            </div>
          )}
        </>
      )}
    </>
  );
}

// Memoize component to avoid unnecessary re-renders
// Compares critical props that actually cause visual changes
export const ExtractionFormView = memo(ExtractionFormViewComponent, (prevProps, nextProps) => {
    // Custom comparison focused on props that actually matter
    // IMPORTANT: Include aiSuggestions to ensure re-render when suggestions are updated after extraction
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
    !aiSuggestionsChanged // Se aiSuggestions mudou, precisa re-renderizar
  );
});

ExtractionFormView.displayName = 'ExtractionFormView';
