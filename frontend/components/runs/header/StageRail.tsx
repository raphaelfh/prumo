import { Circle, CircleCheck, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useRunHeader } from './RunHeaderContext';
import { stageNodeStates, type StageNode, type StageKey } from './stage';

const STAGE_COPY_KEY: Record<StageKey, 'stageExtract' | 'stageConsensus' | 'stageFinalized'> = {
  extract: 'stageExtract',
  consensus: 'stageConsensus',
  finalized: 'stageFinalized',
};

const STAGE_TOOLTIP_KEY: Record<StageKey, 'stageExtractTooltip' | 'stageConsensusTooltip' | 'stageFinalizedTooltip'> = {
  extract: 'stageExtractTooltip',
  consensus: 'stageConsensusTooltip',
  finalized: 'stageFinalizedTooltip',
};

const STATE_COPY: Record<StageNode['state'], 'stageStateDone' | 'stageStateCurrent' | 'stageStateUpcoming' | 'stageStateCancelled'> = {
  done: 'stageStateDone',
  current: 'stageStateCurrent',
  future: 'stageStateUpcoming',
  cancelled: 'stageStateCancelled',
};

const DOT: Record<StageNode['state'], string> = {
  done: 'text-success',
  current: 'text-info',
  future: 'text-muted-foreground/50',
  cancelled: 'text-destructive',
};

export function StageRail() {
  const { stage, isRevision } = useRunHeader();
  const nodes = stageNodeStates(stage);
  return (
    // Folds as ONE unit below 40rem. Above it the rail competes proportionally
    // with the article title for the Left track; the title (larger basis) shrinks
    // first, and the rail clips at the track's overflow-hidden edge under heavy
    // pressure. Stage labels collapse to dots at narrower widths (see the node
    // label below) so any clip is of dots, not mid-word text.
    <nav className="hidden min-w-0 shrink items-center gap-1.5 @[40rem]/headerbar:flex" aria-label="Run stage">
      {isRevision && (
        <span className="mr-1 hidden @[58rem]/headerbar:inline-flex whitespace-nowrap rounded-md bg-ai/10 px-1.5 py-0.5 text-[11px] font-medium text-ai">
          {t('runs', 'revision')}
        </span>
      )}
      {nodes.map((node, i) => (
        <div
          key={node.key}
          className="flex items-center gap-1.5"
          data-state={node.state}
          {...(node.state === 'current' ? { 'data-testid': 'run-stage-current' } : {})}
        >
          {i > 0 && (
            <span
              className={cn('h-px w-3.5', nodes[i - 1].state === 'done' ? 'bg-success/40' : 'bg-border')}
              aria-hidden="true"
            />
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                aria-current={node.state === 'current' ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-1.5 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  node.state === 'current' && 'font-medium text-foreground',
                  node.state !== 'current' && 'text-muted-foreground',
                )}
              >
                {node.state === 'done' ? (
                  <CircleCheck className={cn('h-3.5 w-3.5', DOT.done)} aria-hidden="true" />
                ) : node.key === 'finalized' && node.state === 'future' ? (
                  <Lock className={cn('h-3.5 w-3.5', DOT[node.state])} aria-hidden="true" />
                ) : node.state === 'current' ? (
                  <span className={cn('h-[7px] w-[7px] rounded-full bg-info')} aria-hidden="true" />
                ) : (
                  <Circle className={cn('h-3.5 w-3.5', DOT[node.state])} aria-hidden="true" />
                )}
                <span className="sr-only @[58rem]/headerbar:not-sr-only">{t('runs', STAGE_COPY_KEY[node.key])}</span>
                {/* State (done/current/upcoming/locked/cancelled) is shown to
                    sighted users by the icon; this sr-only suffix gives the same
                    cue to assistive tech, completing each node's announced name. */}
                <span className="sr-only">
                  {', '}
                  {t('runs', node.key === 'finalized' && node.state === 'future' ? 'stageStateLocked' : STATE_COPY[node.state])}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t('runs', STAGE_TOOLTIP_KEY[node.key])}</TooltipContent>
          </Tooltip>
        </div>
      ))}
    </nav>
  );
}
