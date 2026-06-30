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
    // Whole cluster shows only on wide headers (≥64rem). Reviewers rank BELOW
    // the article title, so wherever the title is crushed for room, the reviewer
    // cluster must already be gone (otherwise "title < reviewer" — the inversion
    // the priority forbids). The title is pure flex-shrink and reclaims the
    // freed room. Avatars-only 64–72rem; full labels at 72rem+.
    <div className="hidden items-center gap-2 @[64rem]/headerbar:flex" data-testid="run-reviewers">
      {/* role=img + aria-label carries the count to assistive tech at EVERY
          width, so the visual label can use display:none below 72rem without
          losing it (and without the sr-only white-space:normal reset that
          re-wraps the label). */}
      <div
        className="flex shrink-0 -space-x-2"
        role="img"
        aria-label={t('runs', 'reviewersOfExpected')
          .replace('{{count}}', String(reviewers.count))
          .replace('{{required}}', String(reviewers.required))}
      >
        {Array.from({ length: shown }).map((_, i) => (
          <span key={i} className={cn('h-[18px] w-[18px] rounded-full border-2 border-background', AVATAR[i % AVATAR.length])} aria-hidden="true" />
        ))}
        {reviewers.count > shown && (
          <span className="flex h-[18px] items-center rounded-full border-2 border-background bg-muted px-1 text-[10px] text-muted-foreground">+{reviewers.count - shown}</span>
        )}
      </div>
      <span
        aria-hidden="true"
        className="hidden whitespace-nowrap text-[11px] text-muted-foreground @[72rem]/headerbar:inline"
        data-testid="run-reviewers-count"
      >
        {t('runs', 'reviewersOfExpected')
          .replace('{{count}}', String(reviewers.count))
          .replace('{{required}}', String(reviewers.required))}
      </span>
      {readyLabel && (
        <span
          className="hidden whitespace-nowrap rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground @[72rem]/headerbar:inline"
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
          aria-label={t('runs', 'reviewersDiffer').replace('{{count}}', String(reviewers.divergent))}
          className="flex cursor-pointer items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-[11px] text-foreground transition-colors hover:bg-warning/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <GitFork className="h-3 w-3 shrink-0 text-warning" strokeWidth={1.5} aria-hidden="true" />
          {/* Compact tier: icon + count only below 72rem; the full "N differ"
              shows above it. Both are aria-hidden — the button's aria-label is
              the canonical announced name (avoids the sr-only white-space reset). */}
          <span aria-hidden="true" className="hidden whitespace-nowrap @[72rem]/headerbar:inline">
            {t('runs', 'reviewersDiffer').replace('{{count}}', String(reviewers.divergent))}
          </span>
          <span aria-hidden="true" className="@[72rem]/headerbar:hidden">{reviewers.divergent}</span>
        </button>
      )}
    </div>
  );
}
