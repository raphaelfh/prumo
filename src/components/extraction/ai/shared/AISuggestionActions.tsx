/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Botões de ação para sugestões de IA (Aceitar/Rejeitar)
 * Componente compartilhado reutilizável
 */

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Check, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AISuggestionActionsProps {
  onAccept?: () => void;
  onReject?: () => void;
  loading?: boolean;
  className?: string;
  isAccepted?: boolean;
  isRejected?: boolean;
}

export function AISuggestionActions({
  onAccept,
  onReject,
  loading = false,
  className,
  isAccepted = false,
  isRejected = false,
}: AISuggestionActionsProps) {
  return (
    <div className={cn("flex items-center gap-1 shrink-0 overflow-visible", className)}>
      {onAccept && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={onAccept}
              disabled={loading}
              className={cn(
                "h-7 w-7 rounded-full",
                isAccepted && "ring-1 ring-green-500 bg-green-50 dark:bg-green-950/20",
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
            <p>{isAccepted ? 'Sugestão aceita' : 'Aceitar sugestão'}</p>
          </TooltipContent>
        </Tooltip>
      )}

      {onReject && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={onReject}
              disabled={loading}
              className={cn(
                "h-7 w-7 rounded-full",
                isRejected && "ring-1 ring-red-500 bg-red-50 dark:bg-red-950/20",
                "text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20",
                loading && "opacity-50 cursor-not-allowed"
              )}
            >
              <X className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isRejected ? 'Sugestão rejeitada' : 'Rejeitar sugestão'}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

