/**
 * AI suggestion confidence percentage
 * Reusable shared component
 */

import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {AISuggestionDetailsPopover} from './AISuggestionDetailsPopover';
import {calculateConfidencePercent} from '@/lib/ai-extraction/suggestionUtils';
import type {AISuggestion} from '@/hooks/extraction/ai/useAISuggestions';

interface AISuggestionConfidenceProps {
  suggestion: AISuggestion;
    /** If true, opens details modal when clicking the % */
  showDetailsOnClick?: boolean;
    /** If true, renders only the % (for parent to use as part of modal trigger) */
  asTriggerChild?: boolean;
  className?: string;
}

const confidenceSpanClass =
  'text-xs font-medium text-muted-foreground px-1.5 py-0.5 rounded transition-colors';

export function AISuggestionConfidence({
  suggestion,
  showDetailsOnClick = true,
  asTriggerChild = false,
  className = "",
}: AISuggestionConfidenceProps) {
  const confidencePercent = calculateConfidencePercent(suggestion.confidence);
  const hasReasoning = !!suggestion.reasoning?.trim();
  const hasEvidence = !!suggestion.evidence?.text?.trim();
  const hasDetails = hasReasoning || hasEvidence;

    // When used as part of trigger (value + % clickable), only render the %
  if (asTriggerChild) {
    return (
      <span className={`${confidenceSpanClass} shrink-0 ${className}`}>
        {confidencePercent}%
      </span>
    );
  }

    // If there are details and should show on click, use modal only on %
  if (hasDetails && showDetailsOnClick) {
    return (
      <AISuggestionDetailsPopover
        suggestion={suggestion}
        trigger={
          <span className={`${confidenceSpanClass} cursor-pointer hover:text-foreground ${className}`}>
            {confidencePercent}%
          </span>
        }
      />
    );
  }

    // Otherwise, tooltip only
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`${confidenceSpanClass} cursor-help ${className}`}>
          {confidencePercent}%
        </span>
      </TooltipTrigger>
      <TooltipContent>
          <p className="text-xs">AI suggestion confidence level</p>
      </TooltipContent>
    </Tooltip>
  );
}

