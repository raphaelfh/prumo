/**
 * View de Formulário de Extração
 * 
 * Renderiza seções no modo extração (não-comparação).
 * Extraído do ExtractionFullScreen para modularidade.
 */

import { SectionAccordion } from './SectionAccordion';
import { ModelSelector } from './hierarchy/ModelSelector';
import { Separator } from '@/components/ui/separator';
import type { ExtractionEntityType, ExtractionInstance } from '@/types/extraction';
import type { OtherExtraction } from '@/hooks/extraction/colaboracao/useOtherExtractions';
import type { AISuggestion } from '@/hooks/extraction/ai/useAISuggestions';

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
  models: Array<{ instanceId: string; modelName: string }>;
  activeModelId: string | null;
  setActiveModelId: (id: string) => void;
  onAddModel: () => void;
  onRemoveModel: (id: string) => void;
  getInstancesForModel: (entityTypeId: string, modelId: string) => ExtractionInstance[];
  handleAddInstance: (entityTypeId: string) => void;
  handleRemoveInstance: (instanceId: string) => void;
  projectId: string;
  articleId: string;
  modelsLoading: boolean;
}

export function ExtractionFormView(props: ExtractionFormViewProps) {
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
            otherExtractions={props.otherExtractions}
            aiSuggestions={props.aiSuggestions}
            onAcceptAI={props.acceptSuggestion}
            onRejectAI={props.rejectSuggestion}
            onAddInstance={() => props.handleAddInstance(entityType.id)}
            onRemoveInstance={props.handleRemoveInstance}
            viewMode="extract"
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
                    otherExtractions={props.otherExtractions}
                    aiSuggestions={props.aiSuggestions}
                    onAcceptAI={props.acceptSuggestion}
                    onRejectAI={props.rejectSuggestion}
                    viewMode="extract"
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
