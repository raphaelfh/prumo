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
  /** Se true, abre modal de detalhes ao clicar no % */
  showDetailsOnClick?: boolean;
  /** Se true, renderiza só o % (para o pai usar como parte do trigger do modal) */
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

  // Quando usado como parte do trigger (valor + % clicáveis), só renderiza o %
  if (asTriggerChild) {
    return (
      <span className={`${confidenceSpanClass} shrink-0 ${className}`}>
        {confidencePercent}%
      </span>
    );
  }

  // Se há detalhes e deve mostrar no clique, usar popover só no %
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

  // Caso contrário, apenas tooltip
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`${confidenceSpanClass} cursor-help ${className}`}>
          {confidencePercent}%
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">Nível de confiança da sugestão da IA</p>
      </TooltipContent>
    </Tooltip>
  );
}
