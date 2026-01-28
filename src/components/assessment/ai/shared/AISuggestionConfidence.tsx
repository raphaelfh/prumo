/**
 * Porcentagem de confiança da sugestão de IA (Assessment)
 * Componente compartilhado reutilizável
 *
 * Adaptado de extraction/ai/shared/AISuggestionConfidence.tsx
 */

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AISuggestionDetailsPopover } from './AISuggestionDetailsPopover';
import type { AIAssessmentSuggestion } from '@/types/assessment';
import { calculateConfidencePercent } from '@/lib/assessment-utils';

// =================== INTERFACES ===================

interface AISuggestionConfidenceProps {
  suggestion: AIAssessmentSuggestion;
  showDetailsOnClick?: boolean;
  className?: string;
}

// =================== COMPONENT ===================

export function AISuggestionConfidence({
  suggestion,
  showDetailsOnClick = true,
  className = "",
}: AISuggestionConfidenceProps) {
  const confidencePercent = calculateConfidencePercent(suggestion.confidence_score ?? 0);
  const hasReasoning = suggestion.reasoning && suggestion.reasoning.trim().length > 0;
  const hasEvidence = suggestion.suggested_value.evidence_passages?.length > 0;
  const hasDetails = hasReasoning || hasEvidence;

  // Se há detalhes e deve mostrar no clique, usar popover
  if (hasDetails && showDetailsOnClick) {
    return (
      <AISuggestionDetailsPopover
        suggestion={suggestion}
        trigger={
          <span className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground px-1.5 py-0.5 rounded transition-colors">
            {confidencePercent}%
          </span>
        }
      />
    );
  }

  // Caso contrário, apenas tooltip
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`text-xs font-medium text-muted-foreground cursor-help px-1.5 py-0.5 rounded ${className}`}>
          {confidencePercent}%
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">Nível de confiança da sugestão da IA</p>
      </TooltipContent>
    </Tooltip>
  );
}
