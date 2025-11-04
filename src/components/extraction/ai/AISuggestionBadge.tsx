/**
 * Componente de Badge de Sugestão de IA
 * 
 * Badge de confiança + botão Info sempre visíveis ao lado direito do input
 * Permite acesso ao histórico mesmo após aceitar/rejeitar
 * 
 * @component
 */

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Sparkles, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AISuggestion, AISuggestionHistoryItem } from '@/hooks/extraction/ai/useAISuggestions';
import { AISuggestionHistoryPopover } from './AISuggestionHistoryPopover';
import { AISuggestionEvidence } from './AISuggestionEvidence';
import {
  calculateConfidencePercent,
  isSuggestionAccepted,
} from '@/lib/ai-extraction/suggestionUtils';

// =================== INTERFACES ===================

interface AISuggestionBadgeProps {
  instanceId: string;
  fieldId: string;
  suggestion: AISuggestion;
  getHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
}

// =================== COMPONENT ===================

export function AISuggestionBadge(props: AISuggestionBadgeProps) {
  const { instanceId, fieldId, suggestion, getHistory } = props;
  const [detailsOpen, setDetailsOpen] = useState(false);

  const confidencePercent = calculateConfidencePercent(suggestion.confidence);
  const isAccepted = isSuggestionAccepted(suggestion);

  // Verificar se há reasoning ou evidence para mostrar
  const hasReasoning = suggestion.reasoning && suggestion.reasoning.trim().length > 0;
  const hasEvidence = suggestion.evidence && suggestion.evidence.text && suggestion.evidence.text.trim().length > 0;
  const hasDetails = hasReasoning || hasEvidence;

  const badgeContent = (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 transition-colors shrink-0",
        isAccepted
          ? "cursor-default bg-green-100 dark:bg-green-900/20 border-green-300 dark:border-green-700"
          : "cursor-pointer bg-purple-100 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700 hover:bg-purple-200 dark:hover:bg-purple-900/40"
      )}
    >
      <Sparkles className={cn(
        "h-3 w-3",
        isAccepted 
          ? "text-green-600 dark:text-green-400" 
          : "text-purple-600 dark:text-purple-400"
      )} />
      <span className="text-xs font-medium">
        {isAccepted ? 'IA aceita' : `${confidencePercent}%`}
      </span>
    </Badge>
  );

  return (
    <div className="flex items-center gap-1 shrink-0">
      {/* Badge de Confiança (com histórico se disponível) */}
      {getHistory ? (
        <AISuggestionHistoryPopover
          instanceId={instanceId}
          fieldId={fieldId}
          currentSuggestionId={suggestion.id}
          getHistory={getHistory}
          trigger={badgeContent}
        />
      ) : (
        badgeContent
      )}

      {/* Botão Info (se houver detalhes) */}
      {hasDetails && (
        <Popover open={detailsOpen} onOpenChange={setDetailsOpen}>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                "h-7 w-7",
                "text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/20"
              )}
            >
              <Info className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-96 p-0" align="start">
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b">
                <Sparkles className="h-4 w-4 text-purple-600" />
                <h4 className="font-semibold text-sm">Detalhes da Sugestão</h4>
              </div>

              {/* Reasoning */}
              {hasReasoning && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">
                    Justificativa
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                    {suggestion.reasoning}
                  </p>
                </div>
              )}

              {/* Evidence */}
              {hasEvidence && (
                <div className="space-y-2">
                  <AISuggestionEvidence
                    evidence={{
                      text: suggestion.evidence!.text,
                      pageNumber: suggestion.evidence!.pageNumber,
                    }}
                    className="mt-2"
                  />
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
