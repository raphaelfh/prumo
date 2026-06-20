import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import { useRunHeader } from './RunHeaderContext';

export function PrimaryAction() {
  const { transition, submitting, progress } = useRunHeader();
  if (!transition) return null;
  const gated = transition.gate.ok === false;
  const helper = gated
    ? t('extraction', 'runHeaderRequiredOfTotal')
        .replace('{{done}}', String(progress.completed))
        .replace('{{total}}', String(progress.total))
    : null;
  return (
    <div className="flex items-center gap-2">
      {helper && <span id="run-primary-helper" className="text-[11px] text-muted-foreground">{helper}</span>}
      <Button
        size="sm"
        onClick={() => void transition.onAdvance()}
        disabled={submitting}
        aria-disabled={gated || undefined}
        aria-describedby={gated ? 'run-primary-helper' : undefined}
        className={cn('shrink-0 font-medium hover:bg-primary-hover', gated && 'opacity-70')}
      >
        {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {transition.label}
      </Button>
    </div>
  );
}
