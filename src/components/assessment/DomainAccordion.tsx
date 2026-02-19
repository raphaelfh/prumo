/**
 * Accordion de Domínio de Assessment
 *
 * Componente que renderiza um domínio do instrumento de avaliação com seus items.
 * Calcula progresso do domínio e exibe items de forma organizada.
 *
 * Atualizado para usar os novos hooks e tipos (DRY + KISS)
 * Baseado em SectionAccordion.tsx do módulo de extração
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
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRef, type MouseEvent } from 'react';
import MemoizedAssessmentItemInput from './AssessmentItemInput';
import type {
  AssessmentItem,
  AssessmentResponse,
  AIAssessmentSuggestion,
  AIAssessmentSuggestionHistoryItem,
} from '@/types/assessment';
import { calculateAssessmentProgress, getAssessmentSuggestionKey } from '@/lib/assessment-utils';

// =================== INTERFACES ===================

export interface DomainAccordionProps {
  domainName: string;
  items: AssessmentItem[];
  responses: Record<string, AssessmentResponse>;
  onResponseChange: (itemId: string, response: AssessmentResponse) => void;
  aiSuggestions?: Record<string, AIAssessmentSuggestion>;
  onAcceptAI?: (itemId: string) => Promise<void>;
  onRejectAI?: (itemId: string) => Promise<void>;
  onTriggerAI?: (itemId: string) => Promise<void>;
  isActionLoading?: (itemId: string) => boolean;
  isTriggerLoading?: (itemId: string) => boolean;
  getSuggestionsHistory?: (itemId: string, limit?: number) => Promise<AIAssessmentSuggestionHistoryItem[]>;
  disabled?: boolean;
}

// =================== COMPONENT ===================

export function DomainAccordion(props: DomainAccordionProps) {
  const {
    domainName,
    items,
    responses,
    onResponseChange,
    aiSuggestions,
    onAcceptAI,
    onRejectAI,
    onTriggerAI,
    isActionLoading,
    isTriggerLoading,
    getSuggestionsHistory,
    disabled,
  } = props;

  // Ref para o trigger do accordion
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleChevronClick = (e: MouseEvent) => {
    e.stopPropagation();
    triggerRef.current?.click();
  };

  // Calcular progresso deste domínio
  const progress = calculateAssessmentProgress(items, responses);
  const totalRequired = progress.totalRequired;
  const completedRequired = progress.completedRequired;
  const isComplete = progress.isComplete;
  const progressPercentage = progress.progressPercentage;

  // Determinar cor da borda esquerda baseada no status
  const borderColor = isComplete
    ? 'border-l-green-500'
    : completedRequired > 0
    ? 'border-l-blue-500'
    : 'border-l-slate-300';

  // Gerar ID único para o accordion
  const accordionId = `domain-${domainName.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={accordionId}
      className={cn('bg-white border-l-4 rounded-lg shadow-sm', borderColor)}
    >
      <AccordionItem value={accordionId} className="border-none group/accordion-item">
        <div className="px-6 py-4 hover:bg-slate-50/50">
          <div className="flex items-center gap-3">
            <AccordionPrimitive.Header className="flex flex-1">
              <AccordionPrimitive.Trigger
                ref={triggerRef}
                className={cn(
                  'flex flex-1 items-center justify-between py-4 font-medium transition-all hover:no-underline'
                )}
              >
                {/* Título à esquerda */}
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-base">{domainName}</h3>
                  <Badge variant="outline" className="text-xs">
                    {items.length} {items.length === 1 ? 'item' : 'items'}
                  </Badge>
                </div>

                {/* Progresso à direita */}
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="font-medium">
                    {completedRequired}/{totalRequired}
                  </span>
                  <span>{progressPercentage}%</span>
                </div>
              </AccordionPrimitive.Trigger>
            </AccordionPrimitive.Header>

            {/* Chevron manualmente posicionado */}
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
          <div className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">Nenhum item neste domínio</p>
              </div>
            ) : (
              items.map((item) => (
                <MemoizedAssessmentItemInput
                  key={item.id}
                  item={item}
                  value={responses[item.id] || null}
                  onChange={(response) => onResponseChange(item.id, response)}
                  aiSuggestion={aiSuggestions?.[getAssessmentSuggestionKey(item.id)]}
                  onAcceptAI={onAcceptAI ? () => onAcceptAI(item.id) : undefined}
                  onRejectAI={onRejectAI ? () => onRejectAI(item.id) : undefined}
                  onTriggerAI={onTriggerAI ? () => onTriggerAI(item.id) : undefined}
                  isActionLoading={isActionLoading ? isActionLoading(item.id) : false}
                  isTriggerLoading={isTriggerLoading ? isTriggerLoading(item.id) : false}
                  getSuggestionsHistory={getSuggestionsHistory}
                  disabled={disabled}
                />
              ))
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
