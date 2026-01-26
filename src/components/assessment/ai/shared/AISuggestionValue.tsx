/**
 * Valor sugerido (nível de assessment) com tooltip
 * Componente compartilhado reutilizável
 *
 * Adaptado de extraction/ai/shared/AISuggestionValue.tsx
 */

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatAssessmentLevel, type AIAssessmentSuggestion } from '@/types/assessment';

// =================== INTERFACES ===================

interface AISuggestionValueProps {
  suggestion: AIAssessmentSuggestion;
  maxLength?: number;
  className?: string;
}

// =================== HELPERS ===================

/**
 * Formata valor para exibição
 */
function formatSuggestionValue(level: string, maxLength: number): string {
  const formatted = formatAssessmentLevel(level);
  if (formatted.length > maxLength) {
    return formatted.substring(0, maxLength) + '...';
  }
  return formatted;
}

/**
 * Retorna valor completo formatado
 */
function formatFullSuggestionValue(level: string): string {
  return formatAssessmentLevel(level);
}

// =================== COMPONENT ===================

export function AISuggestionValue({
  suggestion,
  maxLength = 150,
  className = "",
}: AISuggestionValueProps) {
  const level = suggestion.suggested_value.level;
  const displayValue = formatSuggestionValue(level, maxLength);
  const fullValue = formatFullSuggestionValue(level);
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
