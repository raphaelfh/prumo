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
import MemoizedFieldInput from './FieldInput'; // Usar versão memoizada
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
  viewMode?: 'extract' | 'compare';
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

  // Calcular porcentagem de progresso
  const progressPercentage = totalRequired > 0 ? Math.round((completedRequired / totalRequired) * 100) : 0;

  // Determinar cor da borda esquerda baseada no status
  const borderColor = isComplete 
    ? "border-l-green-500" 
    : completedRequired > 0
    ? "border-l-blue-500"
    : "border-l-slate-300";

  return (
    <Accordion 
      type="single"
      collapsible
      defaultValue={entityType.id}
      className={cn("bg-white border-l-4", borderColor)}
    >
      <AccordionItem value={entityType.id} className="border-none">
        <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-slate-50/50">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-base">{entityType.label}</h3>
              {isMultiple && (
                <Badge variant="outline" className="text-xs">
                  Múltipla ({instances.length})
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="font-medium">{completedRequired}/{totalRequired}</span>
              <span>{progressPercentage}%</span>
            </div>
          </div>
        </AccordionTrigger>

        <AccordionContent className="px-8 pb-8">
          <div className="space-y-6">
            {instances.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4">Nenhuma instância criada para esta seção</p>
                {isMultiple && props.onAddInstance && (
                  <Button
                    variant="outline"
                    onClick={props.onAddInstance}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar {entityType.label}
                  </Button>
                )}
              </div>
            ) : isMultiple ? (
              // Seção múltipla: Mostrar cards de instâncias
              <>
                {instances.map((instance, index) => (
                  <div key={instance.id}>
                    <InstanceCard
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
                      viewMode={props.viewMode}
                    />
                  </div>
                ))}

                {props.onAddInstance && (
                  <div className="mt-2">
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={props.onAddInstance}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Adicionar {entityType.label}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              // Seção única: Mostrar campos diretamente
              <div className="divide-y divide-slate-100">
                {fields.map(field => {
                  const key = `${instances[0].id}_${field.id}`;
                  
                  return (
                    <MemoizedFieldInput
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
                      viewMode={props.viewMode}
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

