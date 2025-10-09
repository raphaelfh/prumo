/**
 * Accordion de Seção de Extração
 * 
 * Componente que renderiza uma seção (entity type) com seus campos.
 * Suporta cardinality 'one' (única instância) e 'many' (múltiplas instâncias).
 * 
 * @component
 */

import { useState } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FieldInput } from './FieldInput';
import { InstanceCard } from './InstanceCard';
import type { 
  ExtractionEntityType,
  ExtractionField,
  ExtractionInstance
} from '@/types/extraction';
import type { OtherExtraction } from '@/hooks/extraction/colaboracao/useOtherExtractions';
import type { AISuggestion } from '@/hooks/extraction/ai/useAISuggestions';

// =================== INTERFACES ===================

interface SectionAccordionProps {
  entityType: ExtractionEntityType;
  instances: ExtractionInstance[];
  fields: ExtractionField[];
  values: Record<string, any>;
  onValueChange: (instanceId: string, fieldId: string, value: any) => void;
  projectId: string;
  articleId: string;
  otherExtractions?: OtherExtraction[];
  aiSuggestions?: Record<string, AISuggestion>;
  onAcceptAI?: (instanceId: string, fieldId: string) => Promise<void>;
  onRejectAI?: (instanceId: string, fieldId: string) => Promise<void>;
  onAddInstance?: () => void;
  onRemoveInstance?: (instanceId: string) => void;
}

// =================== COMPONENT ===================

export function SectionAccordion(props: SectionAccordionProps) {
  const {
    entityType,
    instances,
    fields,
    values,
    onValueChange,
    projectId,
    articleId
  } = props;

  const isMultiple = entityType.cardinality === 'many';

  // Calcular progresso desta seção
  const requiredFields = fields.filter(f => f.is_required);
  const totalRequired = requiredFields.length * (isMultiple ? instances.length : 1);
  
  const completedRequired = requiredFields.reduce((count, field) => {
    if (isMultiple) {
      // Para seções múltiplas, contar por instância
      return count + instances.filter(instance => {
        const key = `${instance.id}_${field.id}`;
        const value = values[key];
        return value !== null && value !== undefined && value !== '';
      }).length;
    } else {
      // Para seção única
      const instance = instances[0];
      if (!instance) return count;
      const key = `${instance.id}_${field.id}`;
      const value = values[key];
      return count + (value !== null && value !== undefined && value !== '' ? 1 : 0);
    }
  }, 0);

  const isComplete = totalRequired > 0 && completedRequired === totalRequired;

  return (
    <Accordion 
      type="single" 
      collapsible 
      className="border rounded-lg"
    >
      <AccordionItem value={entityType.id} className="border-none">
        <AccordionTrigger className="px-4 hover:no-underline hover:bg-muted/50">
          <div className="flex items-center justify-between w-full pr-2">
            <div className="flex items-center gap-3">
              {/* Badge de progresso */}
              <div className={cn(
                "flex items-center justify-center w-10 h-10 rounded-full text-sm font-medium transition-colors",
                isComplete 
                  ? "bg-green-500 text-white" 
                  : completedRequired > 0
                  ? "bg-blue-500 text-white"
                  : "bg-muted text-muted-foreground"
              )}>
                {completedRequired}/{totalRequired}
              </div>

              {/* Título e descrição */}
              <div className="text-left">
                <h3 className="font-semibold text-base">{entityType.label}</h3>
                {entityType.description && (
                  <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">
                    {entityType.description}
                  </p>
                )}
              </div>

              {/* Badges */}
              <div className="flex items-center gap-2">
                {entityType.is_required && (
                  <Badge variant="destructive" className="text-xs">
                    Obrigatório
                  </Badge>
                )}
                {isMultiple && (
                  <Badge variant="outline" className="text-xs">
                    Múltipla ({instances.length})
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </AccordionTrigger>

        <AccordionContent className="px-4 pb-4">
          <div className="space-y-4 pt-4">
            {instances.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>Nenhuma instância criada para esta seção</p>
              </div>
            ) : isMultiple ? (
              // Seção múltipla: Mostrar cards de instâncias
              <>
                {instances.map((instance, index) => (
                  <InstanceCard
                    key={instance.id}
                    instance={instance}
                    index={index + 1}
                    fields={fields}
                    values={values}
                    onValueChange={(fieldId, value) =>
                      onValueChange(instance.id, fieldId, value)
                    }
                    onRemove={() => props.onRemoveInstance?.(instance.id)}
                    canRemove={instances.length > 1}
                    projectId={projectId}
                    articleId={articleId}
                    otherExtractions={props.otherExtractions}
                    aiSuggestions={props.aiSuggestions}
                    onAcceptAI={(fieldId) => props.onAcceptAI?.(instance.id, fieldId)}
                    onRejectAI={(fieldId) => props.onRejectAI?.(instance.id, fieldId)}
                  />
                ))}

                {props.onAddInstance && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={props.onAddInstance}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar {entityType.label}
                  </Button>
                )}
              </>
            ) : (
              // Seção única: Mostrar campos diretamente
              <div className="grid gap-4">
                {fields.map(field => {
                  const key = `${instances[0].id}_${field.id}`;
                  
                  return (
                    <FieldInput
                      key={field.id}
                      field={field}
                      instanceId={instances[0].id}
                      value={values[key]}
                      onChange={(value) =>
                        onValueChange(instances[0].id, field.id, value)
                      }
                      projectId={projectId}
                      articleId={articleId}
                      otherExtractions={props.otherExtractions}
                      aiSuggestion={props.aiSuggestions?.[key]}
                      onAcceptAI={() => props.onAcceptAI?.(instances[0].id, field.id)}
                      onRejectAI={() => props.onRejectAI?.(instances[0].id, field.id)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

