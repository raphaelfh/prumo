/**
 * Componente de badge de Sugestões IA
 * Exibe contador de sugestões pendentes com acesso rápido
 */

import {Badge} from '@/components/ui/badge';
import {Tooltip, TooltipContent, TooltipTrigger,} from '@/components/ui/tooltip';
import {Brain} from 'lucide-react';
import {isSuggestionPending} from '@/lib/ai-extraction/suggestionUtils';
import type {AISuggestion} from '@/types/ai-extraction';

interface HeaderAIActionsProps {
  /** Sugestões de IA indexadas por `${instanceId}_${fieldId}` */
  suggestions: Record<string, AISuggestion>;
  /** Callback quando clica no badge */
  onClick?: () => void;
  /** Modo compacto (apenas ícone) */
  compact?: boolean;
}

export function HeaderAIActions({
  suggestions,
  onClick,
  compact = false,
}: HeaderAIActionsProps) {
  // Contar apenas sugestões pendentes
  const pendingSuggestions = Object.values(suggestions).filter(isSuggestionPending);
  const pendingCount = pendingSuggestions.length;

  // Não mostrar se não houver sugestões pendentes
  if (pendingCount === 0) {
    return null;
  }

  const badgeContent = (
    <Badge
      variant="outline"
      className={`
        relative gap-1.5 text-xs px-2.5 py-0.5 border-border/60 bg-transparent font-medium
        ${pendingCount > 0 
          ? 'text-primary border-primary/40 bg-primary/5 hover:bg-primary/10 cursor-pointer' 
          : 'text-muted-foreground'
        }
        transition-colors
      `}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
    >
      <Brain className="h-3 w-3" />
      {!compact && <span className="tabular-nums">{pendingCount}</span>}
      {compact && (
        <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-semibold tabular-nums">
          {pendingCount > 99 ? '99+' : pendingCount}
        </span>
      )}
    </Badge>
  );

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div>{badgeContent}</div>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={5} className="z-[100]">
          {pendingCount} {pendingCount === 1 ? 'sugestão de IA pendente' : 'sugestões de IA pendentes'}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {badgeContent}
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={5} className="z-[100]">
        {pendingCount} {pendingCount === 1 ? 'sugestão de IA pendente' : 'sugestões de IA pendentes'}
        {onClick && ' — Clique para ver'}
      </TooltipContent>
    </Tooltip>
  );
}

