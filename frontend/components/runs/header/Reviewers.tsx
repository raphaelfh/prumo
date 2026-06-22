import { GitFork } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import { useRunHeader } from './RunHeaderContext';

const AVATAR = ['bg-reviewer-1', 'bg-reviewer-2', 'bg-reviewer-3', 'bg-reviewer-4', 'bg-reviewer-5'];

export function Reviewers() {
  const { stage, reviewers, onJumpToDivergence } = useRunHeader();
  if (stage == null || reviewers.count === 0) return null;
  const shown = Math.min(reviewers.count, 3);
  const readyLabel =
    reviewers.ready != null && reviewers.readyTotal != null
      ? t('runs', 'reviewersReadyHint')
          .replace('{{ready}}', String(reviewers.ready))
          .replace('{{total}}', String(reviewers.readyTotal))
      : null;
  return (
    <div className="flex items-center gap-2" data-testid="run-reviewers">
      <div className="flex shrink-0 -space-x-2" title={`${reviewers.count}/${reviewers.required}`}>
        {Array.from({ length: shown }).map((_, i) => (
          <span key={i} className={cn('h-[18px] w-[18px] rounded-full border-2 border-background', AVATAR[i % AVATAR.length])} aria-hidden="true" />
        ))}
        {reviewers.count > shown && (
          <span className="flex h-[18px] items-center rounded-full border-2 border-background bg-muted px-1 text-[10px] text-muted-foreground">+{reviewers.count - shown}</span>
        )}
      </div>
      {readyLabel && (
        <span
          className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
          data-testid="run-reviewers-ready"
          title={readyLabel}
        >
          {readyLabel}
        </span>
      )}
      {reviewers.divergent > 0 && (
        <button
          type="button"
          onClick={() => onJumpToDivergence?.()}
          className="flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-[11px] text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <GitFork className="h-3 w-3" aria-hidden="true" />
          {/* Compact tier: icon + count only; the "differ" word folds to
              sr-only so the chip survives phone widths without clipping. */}
          <span className="sr-only @[34rem]/headerbar:not-sr-only">
            {t('runs', 'reviewersDiffer').replace('{{count}}', String(reviewers.divergent))}
          </span>
          <span className="@[34rem]/headerbar:hidden" aria-hidden="true">{reviewers.divergent}</span>
        </button>
      )}
    </div>
  );
}
