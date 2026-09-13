/**
 * Action buttons for AI suggestions (Accept/Reject) used in extraction flows.
 * Accept/reject are instant local state updates (no backend write from the
 * suggestion surface — autosave persists), so there is no loading state.
 */

import {IconButton} from '@/components/patterns/IconButton';
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
        <IconButton
          label={isAccepted ? t('shared', 'suggestionAccepted') : t('shared', 'acceptSuggestion')}
          onClick={onAccept}
          className={cn(
            "rounded-full",
            isAccepted && "ring-1 ring-success bg-success/10",
            "text-success hover:text-success hover:bg-success/10"
          )}
          icon={<Check />}
        />
      )}

      {onReject && (
        <IconButton
          label={isRejected ? t('shared', 'suggestionRejected') : t('shared', 'rejectSuggestion')}
          onClick={onReject}
          className={cn(
            "rounded-full",
            isRejected && "ring-1 ring-destructive bg-destructive/10",
            "text-destructive hover:text-destructive hover:bg-destructive/10"
          )}
          icon={<X />}
        />
      )}
    </div>
  );
}
