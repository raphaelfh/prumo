/**
 * View de Formulário de Assessment (Avaliação de Qualidade)
 *
 * Renderiza domínios e items do instrumento de avaliação.
 * Componente isolado para modularidade (SRP - Single Responsibility Principle).
 *
 * Baseado em ExtractionFormView.tsx, mas simplificado para assessment (DRY + KISS)
 *
 * @component
 */

import { memo } from 'react';
import { DomainAccordion } from './DomainAccordion';
import type {
  AssessmentItem,
  AssessmentResponse,
  AIAssessmentSuggestion,
} from '@/types/assessment';
import type { DomainWithItems } from '@/hooks/assessment';

// =================== INTERFACES ===================

export interface AssessmentFormViewProps {
  domains: DomainWithItems[];
  responses: Record<string, AssessmentResponse>;
  onResponseChange: (itemId: string, response: AssessmentResponse) => void;
  aiSuggestions?: Record<string, AIAssessmentSuggestion>;
  onAcceptAI?: (itemId: string) => Promise<void>;
  onRejectAI?: (itemId: string) => Promise<void>;
  onTriggerAI?: (itemId: string) => Promise<void>;
  isActionLoading?: (itemId: string) => boolean;
  isTriggerLoading?: (itemId: string) => boolean;
  disabled?: boolean;
}

// =================== COMPONENT ===================

function AssessmentFormViewComponent(props: AssessmentFormViewProps) {
  const {
    domains,
    responses,
    onResponseChange,
    aiSuggestions,
    onAcceptAI,
    onRejectAI,
    onTriggerAI,
    isActionLoading,
    isTriggerLoading,
    disabled,
  } = props;

  if (domains.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">
          Nenhum domínio encontrado neste instrumento de avaliação
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {domains.map((domain) => (
        <DomainAccordion
          key={domain.name}
          domainName={domain.label}
          items={domain.items}
          responses={responses}
          onResponseChange={onResponseChange}
          aiSuggestions={aiSuggestions}
          onAcceptAI={onAcceptAI}
          onRejectAI={onRejectAI}
          onTriggerAI={onTriggerAI}
          isActionLoading={isActionLoading}
          isTriggerLoading={isTriggerLoading}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

/**
 * Exporta versão memoizada para evitar re-renders desnecessários
 * Performance crítica: componente renderiza múltiplos domínios e items
 */
export const AssessmentFormView = memo(AssessmentFormViewComponent, (prevProps, nextProps) => {
  // Re-renderizar se:
  // 1. Domínios mudaram (raro)
  // 2. Responses mudaram
  // 3. Sugestões de IA mudaram
  // 4. Loading states mudaram

  const domainsChanged = prevProps.domains.length !== nextProps.domains.length;
  const responsesChanged = JSON.stringify(prevProps.responses) !== JSON.stringify(nextProps.responses);
  const suggestionsChanged = JSON.stringify(prevProps.aiSuggestions) !== JSON.stringify(nextProps.aiSuggestions);
  const disabledChanged = prevProps.disabled !== nextProps.disabled;

  return !(domainsChanged || responsesChanged || suggestionsChanged || disabledChanged);
});
