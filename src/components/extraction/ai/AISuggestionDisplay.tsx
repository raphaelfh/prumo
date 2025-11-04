/**
 * Componente de Exibição de Sugestão de IA
 * 
 * Mostra valor sugerido + botões aceitar/rejeitar abaixo do input
 * Layout: [Valor sugerido] [Botões Aceitar/Rejeitar]
 * 
 * @component
 */

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Check, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AISuggestion } from '@/hooks/extraction/ai/useAISuggestions';
import {
  formatSuggestionValue,
  formatFullSuggestionValue,
  isSuggestionAccepted,
} from '@/lib/ai-extraction/suggestionUtils';

// =================== INTERFACES ===================

interface AISuggestionDisplayProps {
  suggestion: AISuggestion;
  onAccept?: () => void;
  onReject?: () => void;
  loading?: boolean;
}

// =================== COMPONENT ===================

export function AISuggestionDisplay(props: AISuggestionDisplayProps) {
  const { suggestion, onAccept, onReject, loading = false } = props;

  const MAX_VALUE_LENGTH = 150;
  const displayValue = formatSuggestionValue(suggestion.value, MAX_VALUE_LENGTH);
  const fullValue = formatFullSuggestionValue(suggestion.value);

  // Determinar se está aceita
  const isAccepted = isSuggestionAccepted(suggestion);

  return (
    <div className="mt-2 animate-in fade-in slide-in-from-top-2 duration-200 w-full">
      {/* Linha: Valor sugerido + Botões aceitar/rejeitar */}
      <div className="flex items-center gap-2 w-full min-w-0">
        {/* Valor Sugerido */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {displayValue !== fullValue || fullValue.length > MAX_VALUE_LENGTH ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm text-muted-foreground px-2 py-1 rounded bg-muted/50 hover:bg-muted transition-colors cursor-help truncate block w-full overflow-hidden">
                  {displayValue}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <p className="text-sm">{fullValue}</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-sm text-muted-foreground px-2 py-1 rounded bg-muted/50 block w-full truncate overflow-hidden">
              {displayValue}
            </span>
          )}
        </div>

        {/* Botões de ação - apenas se pendente */}
        {!isAccepted && (
          <div className="flex items-center gap-1 shrink-0">
            {/* Botão Aceitar */}
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

            {/* Botão Rejeitar */}
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
    </div>
  );
}

