import { Circle, CircleCheck, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import { useRunHeader } from './RunHeaderContext';
import { stageNodeStates, type StageNode, type StageKey } from './stage';

const STAGE_COPY_KEY: Record<StageKey, 'stageProposal' | 'stageReview' | 'stageConsensus' | 'stageFinalized'> = {
  proposal: 'stageProposal',
  review: 'stageReview',
  consensus: 'stageConsensus',
  finalized: 'stageFinalized',
};

const DOT: Record<StageNode['state'], string> = {
  done: 'text-success',
  current: 'text-info',
  future: 'text-muted-foreground/50',
  cancelled: 'text-destructive',
};

export function StageRail() {
  const { stage, isRevision, progress, transition } = useRunHeader();
  const nodes = stageNodeStates(stage);
  const gateRemaining = transition && transition.gate.ok === false ? transition.gate.remaining : null;
  return (
    <nav className="flex items-center gap-1.5" aria-label="Run stage">
      {isRevision && (
        <span className="mr-1 rounded-md bg-ai/10 px-2 py-0.5 text-[11px] font-medium text-ai">
          {t('runs', 'revision')}
        </span>
      )}
      {nodes.map((node, i) => (
        <div key={node.key} className="flex items-center gap-1.5" data-state={node.state}>
          {i > 0 && <span className={cn('h-px w-3.5', nodes[i - 1].state === 'done' ? 'bg-success/40' : 'bg-border')} aria-hidden="true" />}
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[13px]',
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
            {/* Label: hidden in very narrow containers (dots-only mode) */}
            <span className="relative hidden @[48rem]/headerbar:inline">
              {t('runs', STAGE_COPY_KEY[node.key])}
              {node.state === 'current' && progress.total > 0 && (
                <span
                  className="absolute -bottom-1 left-0 h-0.5 rounded bg-info"
                  style={{ width: `${Math.min(100, progress.pct)}%` }}
                  aria-hidden="true"
                />
              )}
            </span>
            {node.state === 'current' && gateRemaining != null && gateRemaining > 0 && (
              <span className="ml-1 hidden rounded bg-warning/15 px-1.5 text-[11px] text-warning @[48rem]/headerbar:inline">
                {t('runs', 'gateRemaining').replace('{{count}}', String(gateRemaining))}
              </span>
            )}
          </span>
        </div>
      ))}
    </nav>
  );
}
