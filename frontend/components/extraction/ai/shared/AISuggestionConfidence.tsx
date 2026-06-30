/**
 * AI suggestion confidence percentage.
 *
 * A pure %-display: the rationale + cited evidence that used to open from a
 * %-click now live in the unified review popover (opened from FieldInput's
 * single AI trigger), so this component no longer owns a details popover.
 */

import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {calculateConfidencePercent} from '@/lib/ai-extraction/suggestionUtils';
import {t} from '@/lib/copy';
import type {AISuggestion} from '@/hooks/extraction/ai/useAISuggestions';

interface AISuggestionConfidenceProps {
  suggestion: AISuggestion;
  className?: string;
}

const confidenceSpanClass =
  'text-xs font-medium text-muted-foreground px-1.5 py-0.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function AISuggestionConfidence({
  suggestion,
  className = '',
}: AISuggestionConfidenceProps) {
  const confidencePercent = calculateConfidencePercent(suggestion.confidence);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`${confidenceSpanClass} cursor-help ${className}`}>
          {confidencePercent}%
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">{t('extraction', 'aiConfidenceTooltip')}</p>
      </TooltipContent>
    </Tooltip>
  );
}
