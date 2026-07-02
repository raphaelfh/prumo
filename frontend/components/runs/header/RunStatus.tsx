import { useState } from 'react';
import { ChevronDown, Circle, CircleCheck, GitFork, ListChecks, Lock, UserRound } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import { useRunHeader } from './RunHeaderContext';
import { chipState, stageNodeStates, type ChipState, type StageKey, type StageNode } from './stage';

const AVATAR = ['bg-reviewer-1', 'bg-reviewer-2', 'bg-reviewer-3', 'bg-reviewer-4', 'bg-reviewer-5'];

const DOT_BG: Record<ChipState, string> = {
  pending: 'bg-muted-foreground/50',
  extract: 'bg-info',
  consensus: 'bg-info',
  finalized: 'bg-success',
  cancelled: 'bg-destructive',
};

const CHIP_COPY: Record<ChipState, 'stagePending' | 'stageExtract' | 'stageConsensus' | 'stageFinalized' | 'stageCancelled'> = {
  pending: 'stagePending',
  extract: 'stageExtract',
  consensus: 'stageConsensus',
  finalized: 'stageFinalized',
  cancelled: 'stageCancelled',
};

/** Kind-aware stage label key — QA calls the extract stage "Assessment".
 *  StageKey ⊂ ChipState, so one lookup serves the chip AND the timeline. */
function labelKeyFor(key: StageKey | ChipState, kind: string) {
  return key === 'extract' && kind === 'qa' ? ('stageAssessment' as const) : CHIP_COPY[key as ChipState];
}

const STATE_COPY: Record<StageNode['state'], 'stageStateDone' | 'stageStateCurrent' | 'stageStateUpcoming' | 'stageStateCancelled'> = {
  done: 'stageStateDone',
  current: 'stageStateCurrent',
  future: 'stageStateUpcoming',
  cancelled: 'stageStateCancelled',
};

const ROLE_COPY = {
  manager: 'roleManager',
  reviewer: 'roleReviewer',
  consensus: 'roleConsensus',
  viewer: 'roleViewer',
} as const;

function AvatarStack({ count, shown, size }: { count: number; shown: number; size: 'bar' | 'popover' }) {
  const dot = size === 'bar' ? 'h-[18px] w-[18px] border-2 border-background' : 'h-3.5 w-3.5 border border-popover';
  const overlap = size === 'bar' ? '-space-x-2' : '-space-x-1.5';
  return (
    <span className={cn('flex shrink-0', overlap)} aria-hidden="true">
      {Array.from({ length: shown }).map((_, i) => (
        <span key={i} className={cn('rounded-full', dot, AVATAR[i % AVATAR.length])} />
      ))}
      {size === 'bar' && count > shown && (
        <span className="flex h-[18px] items-center rounded-full border-2 border-background bg-muted px-1 text-[10px] text-muted-foreground">+{count - shown}</span>
      )}
    </span>
  );
}

function NodeIcon({ node }: { node: StageNode }) {
  if (node.state === 'done') return <CircleCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" />;
  if (node.state === 'current') return <span className="mx-[3.5px] h-[7px] w-[7px] rounded-full bg-info" aria-hidden="true" />;
  if (node.key === 'finalized') return <Lock className="h-3.5 w-3.5 text-muted-foreground/50" aria-hidden="true" />;
  return <Circle className={cn('h-3.5 w-3.5', node.state === 'cancelled' ? 'text-destructive' : 'text-muted-foreground/50')} aria-hidden="true" />;
}

/**
 * RunHeader.RunStatus — the unified status cluster (spec 2026-07-02).
 *
 * One stage chip (never drops; folds to its dot <58rem) + anonymous reviewer
 * avatars (drop <64rem), both opening a single status popover: kind-aware
 * 3-node timeline with role-voiced explainers, field progress, reviewer
 * counts, arbitrator-only divergences, the caller's role with the blind
 * reveal, and the revision note. Replaces the former stage rail, reviewer
 * cluster and role chip leaves.
 *
 * Divergence UI keys off the arbitrator capability derived from the context
 * `role` — never off divergence data merely arriving empty (blind reviewers'
 * data is server-scrubbed, but the gate must not rely on that alone).
 *
 * Optionally controlled (`open`/`onOpenChange`) so the Cmd-K palette's
 * "View run status" action can drive it; uncontrolled by default.
 */
export function RunStatus({ open, onOpenChange }: { open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const { kind, stage, isRevision, role, isBlind, canReveal, onReveal, progress, reviewers, onJumpToDivergence } = useRunHeader();
  const [uncontrolled, setUncontrolled] = useState(false);
  const actualOpen = open ?? uncontrolled;
  const setOpen = (o: boolean) => {
    onOpenChange?.(o);
    if (open === undefined) setUncontrolled(o);
  };

  const cs = chipState(stage);
  const chipLabel = t('runs', labelKeyFor(cs, kind));
  const isArbiter = role === 'manager' || role === 'consensus';
  const nodes = stageNodeStates(stage);
  const showAvatars = reviewers.count > 0;
  const shown = Math.min(reviewers.count, 3);
  const showDivergent = isArbiter && reviewers.divergent > 0;
  const explainFor = (key: StageKey): string => {
    if (key === 'finalized') return t('runs', 'stageExplainFinalized');
    if (key === 'consensus') return t('runs', isArbiter ? 'stageExplainConsensusArbiter' : 'stageExplainConsensus');
    return t('runs', isArbiter ? 'stageExplainExtractArbiter' : 'stageExplainExtract');
  };
  const reviewersLabel = t('runs', 'reviewersOfExpected')
    .replace('{{count}}', String(reviewers.count))
    .replace('{{required}}', String(reviewers.required));

  return (
    <Popover open={actualOpen} onOpenChange={setOpen}>
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('runs', 'runStatusChipLabel').replace('{{stage}}', chipLabel)}
            data-testid="run-stage-current"
            data-stage={cs}
            className="h-7 shrink-0 gap-1.5 rounded-full border border-border/60 px-2.5 text-[13px] font-medium"
          >
            <span className={cn('h-[7px] w-[7px] rounded-full', DOT_BG[cs])} aria-hidden="true" />
            <span className="hidden @[58rem]/headerbar:inline">{chipLabel}</span>
            <ChevronDown className="hidden h-3 w-3 text-muted-foreground @[58rem]/headerbar:block" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        {showAvatars && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={`${reviewersLabel} — ${t('runs', 'runStatusLabel')}`}
                aria-haspopup="dialog"
                aria-expanded={actualOpen}
                data-testid="run-status-reviewers"
                className="relative hidden shrink-0 items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring @[64rem]/headerbar:flex"
              >
                <AvatarStack count={reviewers.count} shown={shown} size="bar" />
                {showDivergent && (
                  <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-warning" data-testid="run-status-divergent" aria-hidden="true" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>{reviewersLabel}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <PopoverContent align="start" className="w-72 p-0 text-[13px]" aria-label={t('runs', 'runStatusLabel')} data-testid="run-status-popover">
        <ol className="flex flex-col gap-2.5 border-b px-4 py-3">
          {nodes.map((node) => (
            <li key={node.key} className="flex items-start gap-2.5" data-state={node.state}>
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                <NodeIcon node={node} />
              </span>
              <span className="min-w-0">
                <span className={cn('font-medium', node.state === 'current' ? 'text-foreground' : 'text-muted-foreground')}>
                  {t('runs', labelKeyFor(node.key, kind))}
                </span>
                <span className="sr-only">
                  {', '}
                  {t('runs', node.key === 'finalized' && node.state === 'future' ? 'stageStateLocked' : STATE_COPY[node.state])}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{explainFor(node.key)}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="flex flex-col gap-2 px-4 py-3 text-muted-foreground">
          <div className="flex items-center gap-2">
            <ListChecks className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            {t('runs', 'statusRequiredFields')
              .replace('{{done}}', String(progress.completed))
              .replace('{{total}}', String(progress.total))}
          </div>
          {showAvatars && (
            <div className="flex items-center gap-2">
              <AvatarStack count={reviewers.count} shown={shown} size="popover" />
              <span>
                {reviewersLabel}
                {reviewers.ready != null && reviewers.readyTotal != null && (
                  <>
                    {' · '}
                    {t('runs', 'reviewersReadyHint')
                      .replace('{{ready}}', String(reviewers.ready))
                      .replace('{{total}}', String(reviewers.readyTotal))}
                  </>
                )}
              </span>
            </div>
          )}
          {showDivergent && (
            <div className="flex items-center gap-2">
              <GitFork className="h-3.5 w-3.5 shrink-0 text-warning" strokeWidth={1.5} aria-hidden="true" />
              {t('runs', 'reviewersDiffer').replace('{{count}}', String(reviewers.divergent))}
              {onJumpToDivergence && (
                <Button size="sm" variant="outline" className="ml-auto h-6 px-2 text-xs" onClick={() => { setOpen(false); onJumpToDivergence(); }}>
                  {t('runs', 'statusViewDivergence')}
                </Button>
              )}
            </div>
          )}
          {role && (
            <div className="flex items-center gap-2">
              <UserRound className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span>
                {t('runs', 'statusYouReviewAs').replace('{{role}}', t('common', ROLE_COPY[role]))}
                {(isBlind || canReveal) && (
                  <>
                    {' · '}
                    {t('runs', isBlind ? 'blindSuffix' : 'revealedSuffix')}
                  </>
                )}
              </span>
              {canReveal && onReveal && (
                <Button size="sm" variant="outline" className="ml-auto h-6 px-2 text-xs" onClick={() => { setOpen(false); onReveal(); }}>
                  {t('runs', 'reveal')}
                </Button>
              )}
            </div>
          )}
          {role && isBlind && (
            <div className="text-xs">{t('runs', 'blindExplainer')}</div>
          )}
          {isRevision && (
            <div className="text-xs">{t('runs', 'statusRevisionNote')}</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
