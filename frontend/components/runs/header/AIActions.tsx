import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/lib/copy';

interface AIActionsProps {
  pendingCount: number;
  canExtract: boolean;
  extracting?: boolean;
  onExtract: () => void;
  onOpenSuggestions?: () => void;
}

/**
 * Single home for header AI: one Sparkles trigger (count badge when
 * suggestions are pending) opening a named-action menu. Renders nothing when
 * no action is available — on finalized runs both screens force
 * pendingCount=0 and canExtract=false, so the read-only screen tests hold.
 * The review item requires a REAL onOpenSuggestions handler.
 */
export function AIActions({ pendingCount, canExtract, extracting, onExtract, onOpenSuggestions }: AIActionsProps) {
  const hasReview = pendingCount > 0 && onOpenSuggestions != null;
  if (!canExtract && !hasReview) return null;
  const ariaLabel = hasReview
    ? t('runs', 'aiPendingSuggestions').replace('{{n}}', String(pendingCount))
    : t('runs', 'aiActionsLabel');
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              aria-label={ariaLabel}
              data-testid="run-ai-actions"
              className="relative h-7 w-7 shrink-0 p-0"
            >
              {extracting ? (
                <Loader2 className="h-4 w-4 animate-spin text-ai" aria-hidden="true" />
              ) : (
                <Sparkles className="h-4 w-4 text-ai" strokeWidth={1.5} aria-hidden="true" />
              )}
              {pendingCount > 0 && (
                <span aria-hidden="true" className="absolute -right-1 -top-1 rounded-full bg-ai/10 px-1 text-[10px] font-medium leading-4 text-ai">
                  {pendingCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{ariaLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        {canExtract && (
          <DropdownMenuItem disabled={extracting} onSelect={() => onExtract()}>
            <Sparkles className="mr-2 h-3.5 w-3.5 text-ai" strokeWidth={1.5} aria-hidden="true" />
            {extracting ? t('runs', 'extractingWithAI') : t('runs', 'extractWithAI')}
          </DropdownMenuItem>
        )}
        {hasReview && (
          <DropdownMenuItem onSelect={() => onOpenSuggestions()}>
            {t('runs', 'reviewPendingSuggestions').replace('{{n}}', String(pendingCount))}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
