/**
 * AI suggestion display component - Extraction
 *
 * Shows the suggested value + confidence + quick accept/reject below the input.
 * The rich review surface (version history, provenance, cited evidence + locate)
 * now lives behind the single review trigger in `FieldInput`
 * (`AISuggestionReviewPopover`), so this strip stays a lightweight inline glance.
 *
 * @component
 */

import type {AISuggestion} from '@/hooks/extraction/ai/useAISuggestions';
import {AISuggestionActions} from '@/components/shared/ai-suggestions';
import {AISuggestionConfidence} from './shared/AISuggestionConfidence';
import {AISuggestionValue} from './shared/AISuggestionValue';
import {isSuggestionAccepted} from '@/lib/ai-extraction/suggestionUtils';

interface AISuggestionDisplayProps {
  suggestion: AISuggestion;
  onAccept?: () => void;
  onReject?: () => void;
  loading?: boolean;
}

export function AISuggestionDisplay({
  suggestion,
  onAccept,
  onReject,
  loading = false,
}: AISuggestionDisplayProps) {
  const isAccepted = isSuggestionAccepted(suggestion);
  const isRejected = suggestion.status === 'rejected';

  return (
    <div className="mt-2 animate-in fade-in slide-in-from-top-2 duration-200 w-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-2 w-full">
          {/* Suggested value + confidence */}
        <div className="flex-1 min-w-0 w-full sm:w-auto flex items-center gap-2">
          <AISuggestionValue suggestion={suggestion} maxLength={150} className="flex-1 min-w-0" />
          <AISuggestionConfidence suggestion={suggestion} />
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
