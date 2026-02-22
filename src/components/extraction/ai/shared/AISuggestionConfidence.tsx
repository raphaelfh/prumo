/**
 * Porcentagem de confiança da sugestão de IA
 * Componente compartilhado reutilizável
 */

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AISuggestionDetailsPopover } from './AISuggestionDetailsPopover';
import { calculateConfidencePercent } from '@/lib/ai-extraction/suggestionUtils';
import type { AISuggestion } from '@/hooks/extraction/ai/useAISuggestions';

interface AISuggestionConfidenceProps {
  suggestion: AISuggestion;
  /** Se true, abre modal de detalhes ao clicar no % */
  showDetailsOnClick?: boolean;
  /** Se true, renderiza só o % (para o pai usar como parte do trigger do modal) */
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

  // Quando usado como parte do trigger (valor + % clicáveis), só renderiza o %
  if (asTriggerChild) {
    return (
      <span className={`${confidenceSpanClass} shrink-0 ${className}`}>
        {confidencePercent}%
      </span>
    );
  }

  // Se há detalhes e deve mostrar no clique, usar modal só no %
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

