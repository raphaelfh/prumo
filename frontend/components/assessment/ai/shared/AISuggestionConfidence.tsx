/**
 * AI suggestion confidence percentage (Assessment)
 * Shared reusable component
 *
 * Adapted from extraction/ai/shared/AISuggestionConfidence.tsx
 */

import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {AISuggestionDetailsPopover} from './AISuggestionDetailsPopover';
import type {AIAssessmentSuggestion} from '@/types/assessment';
import {calculateConfidencePercent} from '@/lib/assessment-utils';

// =================== INTERFACES ===================

interface AISuggestionConfidenceProps {
  suggestion: AIAssessmentSuggestion;
    /** If true, open details modal on % click */
  showDetailsOnClick?: boolean;
    /** If true, render only the % (for parent to use as part of modal trigger) */
  asTriggerChild?: boolean;
  className?: string;
}

const confidenceSpanClass =
  'text-xs font-medium text-muted-foreground px-1.5 py-0.5 rounded transition-colors';

// =================== COMPONENT ===================

export function AISuggestionConfidence({
  suggestion,
  showDetailsOnClick = true,
  asTriggerChild = false,
  className = "",
}: AISuggestionConfidenceProps) {
  const confidencePercent = calculateConfidencePercent(suggestion.confidence_score ?? 0);
  const hasReasoning = suggestion.reasoning && suggestion.reasoning.trim().length > 0;
  const hasEvidence = suggestion.suggested_value.evidence_passages?.length > 0;
  const hasDetails = hasReasoning || hasEvidence;

    // When used as part of trigger (value + % clickable), only render the %
  if (asTriggerChild) {
    return (
      <span className={`${confidenceSpanClass} shrink-0 ${className}`}>
        {confidencePercent}%
      </span>
    );
  }

    // If there are details and should show on click, use popover only on the %
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

    // Otherwise just tooltip
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
