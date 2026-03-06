/**
 * Inline AI suggestion component
 *
 * Shows suggestion next to the input field in a minimal way
 * Layout responsivo: [%] [✓] [✗] [Valor truncado]
 * 
 * @component
 */

import type {AISuggestion, AISuggestionHistoryItem} from '@/hooks/extraction/ai/useAISuggestions';
import {AISuggestionHistoryPopover} from './AISuggestionHistoryPopover';
import {AISuggestionActions} from '@/components/shared/ai-suggestions';
import {AISuggestionConfidence} from './shared/AISuggestionConfidence';
import {AISuggestionValue} from './shared/AISuggestionValue';
import {isSuggestionAccepted} from '@/lib/ai-extraction/suggestionUtils';

// =================== INTERFACES ===================

interface AISuggestionInlineProps {
  instanceId: string;
  fieldId: string;
  suggestion: AISuggestion;
  onAccept?: () => void;
  onReject?: () => void;
  getHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  loading?: boolean;
}

// =================== COMPONENT ===================

export function AISuggestionInline({
  instanceId,
  fieldId,
  suggestion,
  onAccept,
  onReject,
  getHistory,
  loading = false,
}: AISuggestionInlineProps) {
  const isAccepted = isSuggestionAccepted(suggestion);
  const isRejected = suggestion.status === 'rejected';

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200 flex-wrap">
        {/* Percentage + action buttons - show if pending or rejected (to show indicator) */}
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

        {/* Confidence badge when accepted (with history if available) */}
      {isAccepted && getHistory && (
        <AISuggestionHistoryPopover
          instanceId={instanceId}
          fieldId={fieldId}
          currentSuggestionId={suggestion.id}
          getHistory={getHistory}
          onAccept={() => onAccept?.()}
          onReject={() => onReject?.()}
          trigger={
            <span className="text-xs font-medium text-muted-foreground cursor-help px-1.5 py-0.5 rounded">
              IA aceita
            </span>
          }
        />
      )}

      {/* Valor Sugerido */}
      <div className="flex-1 min-w-0 sm:max-w-[200px]">
        <AISuggestionValue suggestion={suggestion} maxLength={40} />
      </div>
    </div>
  );
}

