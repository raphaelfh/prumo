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
  // Gated: the visible inline helper is gone (declutter, spec 2026-07-02) —
  // the count lives in the tooltip ("reason — N of M") and in the status
  // popover; the sr-only node keeps aria-describedby resolving.
  const tooltipText = gated
    ? `${transition.gate.reason} — ${helper}`
    : (transition.tooltip ?? null);
  return (
    <div className="flex items-center gap-2">
      {helper && <span id={helperId} className="sr-only">{helper}</span>}
      {tooltipText ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>{tooltipText}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
    </div>
  );
}
