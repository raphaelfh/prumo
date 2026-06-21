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
    <nav className="flex items-center gap-1.5" aria-label="Run stage">
      {isRevision && (
        <span className="mr-1 whitespace-nowrap rounded-md bg-ai/10 px-2 py-0.5 text-[11px] font-medium text-ai">
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
                className={cn(
                  'flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  node.state === 'current' && 'bg-info/10 font-medium text-foreground',
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
                <span className="hidden @[48rem]/headerbar:inline">{t('runs', STAGE_COPY_KEY[node.key])}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t('runs', STAGE_TOOLTIP_KEY[node.key])}</TooltipContent>
          </Tooltip>
        </div>
      ))}
    </nav>
  );
}
