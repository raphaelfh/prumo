/**
 * Valor sugerido truncado com tooltip
 * Shared reusable component
 */

import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {formatFullSuggestionValue, formatSuggestionValue,} from '@/lib/ai-extraction/suggestionUtils';
import type {AISuggestion} from '@/hooks/extraction/ai/useAISuggestions';

interface AISuggestionValueProps {
  suggestion: AISuggestion;
  maxLength?: number;
  className?: string;
  /** Field type + allowed_values so a select/multiselect CODE renders as its
   *  human label ("Y" → "Yes"). Omit for non-select fields. */
  fieldType?: string | null;
  allowedValues?: unknown;
}

export function AISuggestionValue({
  suggestion,
  maxLength = 150,
  className = "",
  fieldType,
  allowedValues,
}: AISuggestionValueProps) {
  const fieldContext = {fieldType, allowedValues};
  const displayValue = formatSuggestionValue(suggestion.value, maxLength, fieldContext);
  const fullValue = formatFullSuggestionValue(suggestion.value, fieldContext);
  const isTruncated = displayValue !== fullValue || fullValue.length > maxLength;

  const valueElement = (
    <span className={`text-sm text-muted-foreground px-2 py-1 rounded bg-muted/50 block w-full truncate overflow-hidden ${className}`}>
      {displayValue}
    </span>
  );

  if (isTruncated) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`text-sm text-muted-foreground px-2 py-1 rounded bg-muted/50 hover:bg-muted transition-colors cursor-help truncate block w-full overflow-hidden ${className}`}>
            {displayValue}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-sm">{fullValue}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return valueElement;
}

