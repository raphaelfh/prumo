/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Valor sugerido truncado com tooltip
 * Componente compartilhado reutilizável
 */

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  formatSuggestionValue,
  formatFullSuggestionValue,
} from '@/lib/ai-extraction/suggestionUtils';
import type { AISuggestion } from '@/hooks/extraction/ai/useAISuggestions';

interface AISuggestionValueProps {
  suggestion: AISuggestion;
  maxLength?: number;
  className?: string;
}

export function AISuggestionValue({
  suggestion,
  maxLength = 150,
  className = "",
}: AISuggestionValueProps) {
  const displayValue = formatSuggestionValue(suggestion.value, maxLength);
  const fullValue = formatFullSuggestionValue(suggestion.value);
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

