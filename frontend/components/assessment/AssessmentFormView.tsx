/**
 * Assessment form view (quality assessment)
 *
 * Renders domains and items of the assessment instrument.
 * Isolated component for modularity (SRP - Single Responsibility Principle).
 *
 * Based on ExtractionFormView.tsx but simplified for assessment (DRY + KISS)
 *
 * @component
 */

import {memo} from 'react';
import {t} from '@/lib/copy';
import {DomainAccordion} from './DomainAccordion';
import type {AIAssessmentSuggestion, AIAssessmentSuggestionHistoryItem, AssessmentResponse,} from '@/types/assessment';
import type {DomainWithItems} from '@/hooks/assessment';

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
  /** Primitive value for memo invalidation when AI trigger loading state changes */
  triggeringItemId?: string | null;
  getSuggestionsHistory?: (itemId: string, limit?: number) => Promise<AIAssessmentSuggestionHistoryItem[]>;
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
    getSuggestionsHistory,
    disabled,
  } = props;

  if (domains.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">
            {t('assessment', 'noDomainFound')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {domains.map((domain) => (
        <DomainAccordion
          key={domain.domain}
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
          getSuggestionsHistory={getSuggestionsHistory}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

/**
 * Exports memoized version to avoid unnecessary re-renders
 * Performance-critical: component renders multiple domains and items
 */
export const AssessmentFormView = memo(AssessmentFormViewComponent, (prevProps, nextProps) => {
  // Re-renderizar se:
    // 1. Domains changed (rare)
  // 2. Responses mudaram
    // 3. AI suggestions changed
  // 4. Loading states mudaram (triggeringItemId)

  const domainsChanged = prevProps.domains.length !== nextProps.domains.length;
  const responsesChanged = JSON.stringify(prevProps.responses) !== JSON.stringify(nextProps.responses);
  const suggestionsChanged = JSON.stringify(prevProps.aiSuggestions) !== JSON.stringify(nextProps.aiSuggestions);
  const disabledChanged = prevProps.disabled !== nextProps.disabled;
  const triggerLoadingChanged = prevProps.triggeringItemId !== nextProps.triggeringItemId;

  return !(domainsChanged || responsesChanged || suggestionsChanged || disabledChanged || triggerLoadingChanged);
});
