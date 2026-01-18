/**
 * Accordion de Seção de Extração
 * 
 * Componente que renderiza uma seção (entity type) com seus campos.
 * Suporta cardinality 'one' (única instância) e 'many' (múltiplas instâncias).
 * 
 * @component
 */

import {
  Accordion,
  AccordionContent,
  AccordionItem,
} from '@/components/ui/accordion';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Plus, Sparkles, Loader2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRef } from 'react';
import MemoizedFieldInput from './FieldInput'; // Usar versão memoizada
import { InstanceCard } from './InstanceCard';
import { useSectionExtraction } from '@/hooks/extraction/useSectionExtraction';
import type { 
  ExtractionEntityType,
  ExtractionField,
  ExtractionInstance
} from '@/types/extraction';
import type { OtherExtraction } from '@/hooks/extraction/colaboracao/useOtherExtractions';
import type { AISuggestion, AISuggestionHistoryItem } from '@/hooks/extraction/ai/useAISuggestions';

// =================== INTERFACES ===================

interface SectionAccordionProps {
  entityType: ExtractionEntityType;
  instances: ExtractionInstance[];
  fields: ExtractionField[];
  values: Record<string, any>;
  onValueChange: (instanceId: string, fieldId: string, value: any) => void;
  projectId: string;
  articleId: string;
  templateId: string; // Nova: necessário para extração de seção
  parentInstanceId?: string; // Nova: ID da instância pai (para filtrar child entities por modelo)
  otherExtractions?: OtherExtraction[];
  aiSuggestions?: Record<string, AISuggestion>;
  onAcceptAI?: (instanceId: string, fieldId: string) => Promise<void>;
  onRejectAI?: (instanceId: string, fieldId: string) => Promise<void>;
  getSuggestionsHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  isActionLoading?: (instanceId: string, fieldId: string) => 'accept' | 'reject' | null;
  onAddInstance?: () => void;
  onRemoveInstance?: (instanceId: string) => void;
  viewMode?: 'extract' | 'compare';
  onExtractionComplete?: (runId?: string) => void | Promise<void>; // Callback para refresh de sugestões após extração
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
    articleId,
    templateId
  } = props;

  const isMultiple = entityType.cardinality === 'many';

  // Hook para extração de seção específica
  // Callback onSuccess notifica componente pai para refresh de sugestões
  // IMPORTANTE: onSuccess não deve bloquear - chamar sem await para não travar o loading
  const { extractSection, loading: extractionLoading } = useSectionExtraction({
    onSuccess: async (runId, suggestionsCreated) => {
      // Notificar componente pai que extração foi concluída
      // CRÍTICO: Não fazer await aqui - deixar executar em background
      // O loading deve ser resetado pelo hook independentemente deste callback
      if (props.onExtractionComplete) {
        try {
          const result = props.onExtractionComplete(runId);
          // Se retornar Promise, tratar erro sem bloquear
          if (result && typeof result === 'object' && 'catch' in result) {
            result.catch(err => {
              console.error('Erro no callback onExtractionComplete:', err);
              // Não bloquear o hook de resetar loading
            });
          }
        } catch (err) {
          console.error('Erro ao chamar callback onExtractionComplete:', err);
          // Não bloquear o hook de resetar loading
        }
      }
    },
  });

  /**
   * Handler para extração de seção
   * IMPORTANTE: Para cardinality="many", o backend agora cria instâncias automaticamente,
   * então permitimos extração mesmo sem instâncias pré-existentes.
   */
  const handleExtractSection = async () => {
    // Verificar se há instâncias existentes
    // EXCEÇÃO: Para cardinality="many", permitir extração (backend cria instâncias automaticamente)
    if (instances.length === 0 && !isMultiple) {
      // Toast já será mostrado pelo hook, mas podemos adicionar aqui também se necessário
      return;
    }

    try {
      await extractSection({
        projectId,
        articleId,
        templateId,
        entityTypeId: entityType.id,
        parentInstanceId: props.parentInstanceId, // Nova: passar parentInstanceId quando fornecido
      });
    } catch (error) {
      // Erro já tratado pelo hook com toast
      console.error('Section extraction failed:', error);
    }
  };

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

  // Ref para o trigger do accordion, para poder clicar no chevron e abrir/fechar
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Disparar o clique no trigger do accordion
    triggerRef.current?.click();
  };

  return (
    <Accordion 
      type="single"
      collapsible
      defaultValue={entityType.id}
      className={cn("bg-white border-l-4", borderColor)}
    >
      <AccordionItem value={entityType.id} className="border-none group/accordion-item">
        <div className="px-6 py-4 hover:bg-slate-50/50">
          <div className="flex items-center gap-3">
            <AccordionPrimitive.Header className="flex flex-1">
              <AccordionPrimitive.Trigger
                ref={triggerRef}
                className={cn(
                  "flex flex-1 items-center justify-between py-4 font-medium transition-all hover:no-underline"
                )}
              >
                {/* Título à esquerda */}
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-base">{entityType.label}</h3>
                  {isMultiple && (
                    <Badge variant="outline" className="text-xs">
                      Múltipla ({instances.length})
                    </Badge>
                  )}
                </div>
                {/* Progresso à direita */}
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="font-medium">{completedRequired}/{totalRequired}</span>
                  <span>{progressPercentage}%</span>
                </div>
              </AccordionPrimitive.Trigger>
            </AccordionPrimitive.Header>
            {/* Botão minimalista de extração de IA - fora do AccordionTrigger para evitar aninhamento de botões */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation(); // Prevenir toggle do accordion
                      handleExtractSection();
                    }}
                    disabled={extractionLoading || (instances.length === 0 && !isMultiple)}
                    title={
                      instances.length === 0 && !isMultiple
                        ? "Crie pelo menos uma instância desta seção antes de extrair"
                        : `Extrair dados de "${entityType.label}" com IA`
                    }
                  >
                    {extractionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-primary" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {instances.length === 0 && !isMultiple
                      ? "Crie pelo menos uma instância desta seção antes de extrair"
                      : extractionLoading
                      ? "Extraindo dados com IA..."
                      : `Extrair dados de "${entityType.label}" com IA`}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {/* Chevron manualmente posicionado no final, após o botão de IA - clicável para abrir/fechar accordion */}
            <button
              type="button"
              onClick={handleChevronClick}
              className="flex items-center justify-center h-8 w-8 shrink-0 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
              aria-label="Toggle accordion"
            >
              <ChevronDown className="h-4 w-4 transition-transform duration-200 group-data-[state=open]/accordion-item:rotate-180" />
            </button>
          </div>
        </div>

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
                      canRemove={true}
                      projectId={projectId}
                      articleId={articleId}
                      otherExtractions={props.otherExtractions}
                      aiSuggestions={props.aiSuggestions}
                      onAcceptAI={props.onAcceptAI}
                      onRejectAI={props.onRejectAI}
                      getSuggestionsHistory={props.getSuggestionsHistory}
                      isActionLoading={props.isActionLoading}
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
                      getSuggestionsHistory={props.getSuggestionsHistory}
                      isActionLoading={props.isActionLoading}
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

