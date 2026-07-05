/**
 * Action buttons for AI suggestions (Accept/Reject) used in extraction flows.
 * Accept/reject are instant local state updates (no backend write from the
 * suggestion surface — autosave persists), so there is no loading state.
 */

import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {Check, X} from 'lucide-react';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

interface AISuggestionActionsProps {
  onAccept?: () => void;
  onReject?: () => void;
  className?: string;
  isAccepted?: boolean;
  isRejected?: boolean;
}

export function AISuggestionActions({
  onAccept,
  onReject,
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
              aria-label={isAccepted ? t('shared', 'suggestionAccepted') : t('shared', 'acceptSuggestion')}
              className={cn(
                "h-7 w-7 rounded-full",
                isAccepted && "ring-1 ring-success bg-success/10",
                "text-success hover:text-success hover:bg-success/10"
              )}
            >
              <Check className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
              <p>{isAccepted ? t('shared', 'suggestionAccepted') : t('shared', 'acceptSuggestion')}</p>
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
              aria-label={isRejected ? t('shared', 'suggestionRejected') : t('shared', 'rejectSuggestion')}
              className={cn(
                "h-7 w-7 rounded-full",
                isRejected && "ring-1 ring-destructive bg-destructive/10",
                "text-destructive hover:text-destructive hover:bg-destructive/10"
              )}
            >
              <X className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
              <p>{isRejected ? t('shared', 'suggestionRejected') : t('shared', 'rejectSuggestion')}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
