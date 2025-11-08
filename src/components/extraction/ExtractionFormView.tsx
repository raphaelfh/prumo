/**
 * View de Formulário de Extração
 * 
 * Renderiza seções no modo extração (não-comparação).
 * Extraído do ExtractionFullScreen para modularidade.
 */

import { memo } from 'react';
import { SectionAccordion } from './SectionAccordion';
import { ModelSelector } from './hierarchy/ModelSelector';
import { Separator } from '@/components/ui/separator';
import { useModelExtraction } from '@/hooks/extraction/useModelExtraction';
import { useBatchSectionExtraction } from '@/hooks/extraction/useBatchSectionExtraction';
import type { ExtractionEntityType, ExtractionInstance, ExtractionValue, ExtractionField } from '@/types/extraction';

// Tipo auxiliar para entity types com fields
interface EntityTypeWithFields extends ExtractionEntityType {
  fields: ExtractionField[];
}
import type { OtherExtraction } from '@/hooks/extraction/colaboracao/useOtherExtractions';
import type { AISuggestion, AISuggestionHistoryItem } from '@/hooks/extraction/ai/useAISuggestions';

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
  templateId: string; // Nova: necessário para extração de seção
  modelsLoading: boolean;
  onExtractionComplete?: () => void; // Callback para refresh após extração
}

function ExtractionFormViewComponent(props: ExtractionFormViewProps) {
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

  // Hook para extração de todas as seções do modelo
  const { extractAllSections, loading: extractingAllSections } = useBatchSectionExtraction({
    onSuccess: async (result) => {
      console.log('[ExtractionFormView] Todas as seções extraídas:', result);
      
      // Recarregar instâncias e sugestões após extração
      try {
        await props.onRefreshInstances();
        if (props.onExtractionComplete) {
          await props.onExtractionComplete();
        }
      } catch (error) {
        console.error('[ExtractionFormView] Erro ao recarregar após extração de todas as seções:', error);
      }
    },
  });

  // Handler para extrair todas as seções do modelo ativo
  const handleExtractAllSections = async () => {
    if (!props.activeModelId) {
      console.warn('[ExtractionFormView] Nenhum modelo ativo para extrair todas as seções');
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
      // Erro já tratado pelo hook com toast
      console.error('[ExtractionFormView] Erro na extração de todas as seções:', error);
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

// Memoizar componente para evitar re-renders desnecessários
// Compara props críticas que realmente causam mudanças visuais
export const ExtractionFormView = memo(ExtractionFormViewComponent, (prevProps, nextProps) => {
  // Comparação customizada focada em props que realmente importam
  // IMPORTANTE: Incluir aiSuggestions para garantir re-render quando sugestões são atualizadas após extração
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
