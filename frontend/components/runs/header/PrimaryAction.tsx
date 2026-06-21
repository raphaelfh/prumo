import { useId } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import { useRunHeader } from './RunHeaderContext';

export function PrimaryAction() {
  const helperId = useId();
  const { transition, submitting, progress } = useRunHeader();
  if (!transition) return null;
  const gated = transition.gate.ok === false;
  const helper = gated
    ? t('runs', 'requiredOfTotal')
        .replace('{{done}}', String(progress.completed))
        .replace('{{total}}', String(progress.total))
    : null;
  const button = (
    <Button
      size="sm"
      onClick={() => void transition.onAdvance()}
      disabled={submitting}
      aria-disabled={gated || undefined}
      aria-describedby={gated ? helperId : undefined}
      className={cn('shrink-0 whitespace-nowrap font-medium hover:bg-primary-hover', gated && 'opacity-70')}
    >
      {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {transition.label}
    </Button>
  );
  return (
    <div className="flex items-center gap-2">
      {/* sr-only (not `hidden`) below 52rem so the node stays in the a11y tree
          and the button's aria-describedby keeps resolving; revealed visually
          where the row has room. */}
      {helper && <span id={helperId} className="sr-only text-[11px] text-muted-foreground @[52rem]/headerbar:not-sr-only @[52rem]/headerbar:whitespace-nowrap">{helper}</span>}
      {transition.tooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>{transition.tooltip}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
    </div>
  );
}
