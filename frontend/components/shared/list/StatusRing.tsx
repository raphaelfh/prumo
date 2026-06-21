import { CheckCircle2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';

const SIZE = 28;
const STROKE = 3;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

export interface StatusRingProps {
  /** Completion percentage 0–100. Clamped and rounded for display. */
  progress: number;
  className?: string;
}

export function StatusRing({ progress, className }: StatusRingProps) {
  const rounded = Math.max(0, Math.min(100, Math.round(progress)));
  const status = rounded >= 100 ? 'complete' : rounded > 0 ? 'in_progress' : 'not_started';
  const label =
    status === 'complete'
      ? t('extraction', 'listStatusComplete')
      : status === 'in_progress'
        ? t('extraction', 'statusInProgressPct').replace('{{n}}', String(rounded))
        : t('extraction', 'listStatusNotStarted');
  const dashOffset = CIRC * (1 - rounded / 100);
  const arcColor = status === 'complete' ? 'text-success' : 'text-warning';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={label}
            className={cn('relative inline-flex h-7 w-7 items-center justify-center', className)}
          >
            <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
              <circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                fill="none"
                strokeWidth={STROKE}
                stroke="currentColor"
                className="text-muted-foreground/20"
              />
              {status !== 'not_started' && (
                <circle
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  fill="none"
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  stroke="currentColor"
                  strokeDasharray={CIRC}
                  strokeDashoffset={dashOffset}
                  transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                  className={arcColor}
                />
              )}
            </svg>
            <span className="absolute inset-0 flex items-center justify-center">
              {status === 'complete' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              ) : status === 'in_progress' ? (
                <span className="text-[9px] font-semibold leading-none tabular-nums text-warning">
                  {rounded}
                </span>
              ) : null}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
