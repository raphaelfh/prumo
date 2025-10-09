/**
 * Badge de Sugestão de IA
 * 
 * Mostra ⚡ com porcentagem de confiança.
 * Tooltip com reasoning ao passar mouse.
 * 
 * @component
 */

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Sparkles } from 'lucide-react';
import type { AISuggestion } from '@/hooks/extraction/ai/useAISuggestions';

// =================== INTERFACES ===================

interface AISuggestionBadgeProps {
  suggestion: AISuggestion;
  showReasoningTooltip?: boolean;
}

// =================== COMPONENT ===================

export function AISuggestionBadge(props: AISuggestionBadgeProps) {
  const { suggestion, showReasoningTooltip = true } = props;

  const confidencePercent = Math.round(suggestion.confidence * 100);

  const badgeContent = (
    <Badge
      variant="outline"
      className="gap-1 cursor-pointer bg-purple-100 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700"
    >
      <Sparkles className="h-3 w-3 text-purple-600" />
      {confidencePercent}%
    </Badge>
  );

  if (!showReasoningTooltip || !suggestion.reasoning) {
    return badgeContent;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {badgeContent}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-sm">
        <div className="space-y-2">
          <p className="font-medium">💡 Sugestão da IA</p>
          <p className="text-sm">{suggestion.reasoning}</p>
          <p className="text-xs text-muted-foreground">
            Confiança: {confidencePercent}%
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

