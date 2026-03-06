/**
 * Inline AI Suggestion component - Assessment
 *
 * Shows suggestion next to the input field in a minimal way
 * Responsive layout: [%] [✓] [✗] [Truncated value]
 * When accepted, shows history popover (mirrors extraction)
 *
 * Adaptado de extraction/ai/AISuggestionInline.tsx
 *
 * @component
 */

import type {AIAssessmentSuggestion, AIAssessmentSuggestionHistoryItem} from '@/types/assessment';
import {AISuggestionHistoryPopover} from './AISuggestionHistoryPopover';
import {AISuggestionActions} from '@/components/shared/ai-suggestions';
import {AISuggestionConfidence} from './shared/AISuggestionConfidence';
import {AISuggestionValue} from './shared/AISuggestionValue';
import {isAssessmentSuggestionAccepted} from '@/lib/assessment-utils';

// =================== INTERFACES ===================

interface AISuggestionInlineProps {
    /** AI suggestion to display */
  suggestion: AIAssessmentSuggestion;
  /** Item ID for history lookup */
  itemId?: string;
    /** Callback when accepting suggestion */
  onAccept?: () => void;
    /** Callback when rejecting suggestion */
  onReject?: () => void;
  /** History fetcher (when provided, shows history popover on accepted suggestions) */
  getHistory?: (itemId: string, limit?: number) => Promise<AIAssessmentSuggestionHistoryItem[]>;
    /** Loading state */
  loading?: boolean;
}

// =================== COMPONENT ===================

export function AISuggestionInline({
  suggestion,
  itemId,
  onAccept,
  onReject,
  getHistory,
  loading = false,
}: AISuggestionInlineProps) {
  const isAccepted = isAssessmentSuggestionAccepted(suggestion);
  const isRejected = suggestion.status === 'rejected';

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200 flex-wrap">
        {/* Confidence % + action buttons - show when pending or rejected */}
      {!isAccepted && (
        <div className="flex items-center gap-2 shrink-0">
          <AISuggestionConfidence suggestion={suggestion} showDetailsOnClick />
          <AISuggestionActions
            onAccept={onAccept}
            onReject={onReject}
            loading={loading}
            isAccepted={isAccepted}
            isRejected={isRejected}
          />
        </div>
      )}

      {/* History popover when accepted and getHistory available */}
      {isAccepted && getHistory && itemId && (
        <AISuggestionHistoryPopover
          itemId={itemId}
          currentSuggestionId={suggestion.id}
          getHistory={getHistory}
          onAccept={onAccept}
          onReject={onReject}
          trigger={
            <span className="text-xs font-medium text-muted-foreground cursor-help px-1.5 py-0.5 rounded">
              IA aceita
            </span>
          }
        />
      )}

      {/* Simple badge when accepted but no history available */}
      {isAccepted && (!getHistory || !itemId) && (
        <span className="text-xs font-medium text-muted-foreground px-1.5 py-0.5 rounded">
          IA aceita
        </span>
      )}

      {/* Valor Sugerido */}
      <div className="flex-1 min-w-0 sm:max-w-[200px]">
        <AISuggestionValue suggestion={suggestion} maxLength={40} />
      </div>
    </div>
  );
}
