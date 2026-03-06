/**
 * AI suggestion display component - Assessment
 *
 * Shows suggested value (level) + % + accept/reject buttons below the input.
 * Click on value or % opens justification/evidence modal (when available).
 * Layout responsivo: [Valor sugerido] [%] [✓] [✗]
 *
 * @component
 */

import type {AIAssessmentSuggestion} from '@/types/assessment';
import {AISuggestionActions} from '@/components/shared/ai-suggestions';
import {AISuggestionConfidence} from './shared/AISuggestionConfidence';
import {AISuggestionDetailsPopover} from './shared/AISuggestionDetailsPopover';
import {AISuggestionValue} from './shared/AISuggestionValue';
import {t} from '@/lib/copy';
import {isAssessmentSuggestionAccepted} from '@/lib/assessment-utils';

interface AISuggestionDisplayProps {
  suggestion: AIAssessmentSuggestion;
  itemId?: string;
  onAccept?: () => void;
  onReject?: () => void;
  loading?: boolean;
}

function hasSuggestionDetails(suggestion: AIAssessmentSuggestion): boolean {
  const hasReasoning = !!suggestion.reasoning?.trim();
  const hasEvidence = (suggestion.suggested_value.evidence_passages?.length ?? 0) > 0;
  return hasReasoning || hasEvidence;
}

const triggerAreaClass =
  'flex flex-1 min-w-0 items-center gap-2 rounded-md px-1 py-0.5 -mx-1 -my-0.5 cursor-pointer hover:bg-muted/50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function AISuggestionDisplay({
  suggestion,
  itemId: _itemId,
  onAccept,
  onReject,
  loading = false,
}: AISuggestionDisplayProps) {
  const isAccepted = isAssessmentSuggestionAccepted(suggestion);
  const isRejected = suggestion.status === 'rejected';
  const hasDetails = hasSuggestionDetails(suggestion);

  return (
    <div className="mt-2 animate-in fade-in slide-in-from-top-2 duration-200 w-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-2 w-full">
          {/* Value + %: clickable area to open details modal (when available) */}
        <div className="flex-1 min-w-0 w-full sm:w-auto flex items-center gap-2">
          {hasDetails ? (
            <AISuggestionDetailsPopover
              suggestion={suggestion}
              trigger={
                <div
                  className={triggerAreaClass}
                  role="button"
                  tabIndex={0}
                  title={t('assessment', 'aiEvidenceClickTitle')}
                  aria-label={t('assessment', 'aiEvidenceClickAria')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      (e.currentTarget as HTMLElement).click();
                    }
                  }}
                >
                  <AISuggestionValue suggestion={suggestion} maxLength={150} className="flex-1 min-w-0" />
                  <AISuggestionConfidence suggestion={suggestion} asTriggerChild />
                </div>
              }
            />
          ) : (
            <>
              <AISuggestionValue suggestion={suggestion} maxLength={150} />
              <AISuggestionConfidence suggestion={suggestion} showDetailsOnClick />
            </>
          )}
        </div>

          {/* Action buttons - always show */}
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end sm:justify-start pr-1">
          <div className="overflow-visible">
            <AISuggestionActions
              onAccept={onAccept}
              onReject={onReject}
              loading={loading}
              isAccepted={isAccepted}
              isRejected={isRejected}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
