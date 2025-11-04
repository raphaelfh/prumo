/**
 * View de Formulário de Extração
 * 
 * Renderiza seções no modo extração (não-comparação).
 * Extraído do ExtractionFullScreen para modularidade.
 */

import { SectionAccordion } from './SectionAccordion';
import { ModelSelector } from './hierarchy/ModelSelector';
import { Separator } from '@/components/ui/separator';
import { useModelExtraction } from '@/hooks/extraction/useModelExtraction';
import type { ExtractionEntityType, ExtractionInstance } from '@/types/extraction';
import type { OtherExtraction } from '@/hooks/extraction/colaboracao/useOtherExtractions';
import type { AISuggestion, AISuggestionHistoryItem } from '@/hooks/extraction/ai/useAISuggestions';

export interface ExtractionFormViewProps {
  studyLevelSections: ExtractionEntityType[];
  modelParentEntityType: ExtractionEntityType | undefined;
  modelChildSections: ExtractionEntityType[];
  instances: ExtractionInstance[];
  values: Record<string, any>;
  updateValue: (instanceId: string, fieldId: string, value: any) => void;
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
  templateId: string; // Nova: necessário para extração de seção
  modelsLoading: boolean;
  onExtractionComplete?: () => void; // Callback para refresh após extração
}

export function ExtractionFormView(props: ExtractionFormViewProps) {
  // Hook para extração de modelos
  const { extractModels, loading: extractingModels } = useModelExtraction({
    onSuccess: async (runId, modelsCreated) => {
      console.log('[ExtractionFormView] Modelos extraídos:', { runId, modelsCreated });
      
      // Recarregar modelos e instâncias após extração
      try {
        await props.onRefreshModels();
        await props.onRefreshInstances();
        
        // Selecionar primeiro modelo se não houver activeModelId
        if (props.models.length === 0 && modelsCreated > 0) {
          // Aguardar um pouco para garantir que os modelos foram carregados
          setTimeout(async () => {
            await props.onRefreshModels();
            // O setActiveModelId será chamado pelo componente pai através do useModelManagement
          }, 500);
        }
      } catch (error) {
        console.error('[ExtractionFormView] Erro ao recarregar após extração de modelos:', error);
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
      // Erro já tratado pelo hook com toast
      console.error('[ExtractionFormView] Erro na extração de modelos:', error);
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
          />
          
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
                    parentInstanceId={props.activeModelId}
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
