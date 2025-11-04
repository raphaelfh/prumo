/**
 * Componente Inline de Sugestão de IA
 * 
 * Mostra sugestão ao lado do campo de input de forma minimalista
 * Layout: [Badge] [Valor truncado] [✓] [✗]
 * 
 * @component
 */

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Sparkles, Check, X, Loader2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AISuggestion, AISuggestionHistoryItem } from '@/hooks/extraction/ai/useAISuggestions';
import { AISuggestionHistoryPopover } from './AISuggestionHistoryPopover';
import { AISuggestionEvidence } from './AISuggestionEvidence';
import {
  calculateConfidencePercent,
  formatSuggestionValue,
  formatFullSuggestionValue,
  isSuggestionAccepted,
} from '@/lib/ai-extraction/suggestionUtils';

// =================== INTERFACES ===================

interface AISuggestionInlineProps {
  instanceId: string;
  fieldId: string;
  suggestion: AISuggestion;
  onAccept?: () => void;
  onReject?: () => void;
  getHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  loading?: boolean;
}

// =================== COMPONENT ===================

export function AISuggestionInline(props: AISuggestionInlineProps) {
  const {
    instanceId,
    fieldId,
    suggestion,
    onAccept,
    onReject,
    getHistory,
    loading = false,
  } = props;

  const [detailsOpen, setDetailsOpen] = useState(false);

  const confidencePercent = calculateConfidencePercent(suggestion.confidence);
  const MAX_VALUE_LENGTH = 40;

  const displayValue = formatSuggestionValue(suggestion.value, MAX_VALUE_LENGTH);
  const fullValue = formatFullSuggestionValue(suggestion.value);

  // Determinar estilo do badge baseado no status
  const isAccepted = isSuggestionAccepted(suggestion);
  
  // Verificar se há reasoning ou evidence para mostrar
  const hasReasoning = suggestion.reasoning && suggestion.reasoning.trim().length > 0;
  const hasEvidence = suggestion.evidence && suggestion.evidence.text && suggestion.evidence.text.trim().length > 0;
  const hasDetails = hasReasoning || hasEvidence;
  
  const badgeContent = (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 transition-colors",
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
    <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200 flex-wrap sm:flex-nowrap">
      {/* Badge de Confiança (com histórico se disponível) */}
      {getHistory ? (
        <AISuggestionHistoryPopover
          instanceId={instanceId}
          fieldId={fieldId}
          currentSuggestionId={suggestion.id}
          getHistory={getHistory}
          onAccept={(histSuggestion) => {
            // Se aceitar do histórico, usar o callback normal
            if (onAccept) onAccept();
          }}
          onReject={(histSuggestion) => {
            if (onReject) onReject();
          }}
          trigger={badgeContent}
        />
      ) : (
        badgeContent
      )}

      {/* Valor Sugerido (com tooltip se truncado) */}
      {displayValue !== fullValue || fullValue.length > MAX_VALUE_LENGTH ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-sm text-muted-foreground px-2 py-1 rounded bg-muted/50 hover:bg-muted transition-colors cursor-help max-w-[200px] truncate">
              {displayValue}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-sm">{fullValue}</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="text-sm text-muted-foreground px-2 py-1 rounded bg-muted/50 max-w-[200px] truncate">
          {displayValue}
        </span>
      )}

      {/* Botão de Detalhes (reasoning/evidence) - só mostrar se houver detalhes */}
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

      {/* Botões Aceitar/Rejeitar - só mostrar se ainda estiver pendente */}
      {!isAccepted && (
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={onAccept}
                disabled={loading}
                className={cn(
                  "h-7 w-7",
                  "text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/20",
                  loading && "opacity-50 cursor-not-allowed"
                )}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Aceitar sugestão</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={onReject}
                disabled={loading}
                className={cn(
                  "h-7 w-7",
                  "text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20",
                  loading && "opacity-50 cursor-not-allowed"
                )}
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Rejeitar sugestão</p>
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

