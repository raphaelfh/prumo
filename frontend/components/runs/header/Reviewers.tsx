import { GitFork } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import { useRunHeader } from './RunHeaderContext';

const AVATAR = ['bg-reviewer-1', 'bg-reviewer-2', 'bg-reviewer-3', 'bg-reviewer-4', 'bg-reviewer-5'];

export function Reviewers() {
  const { stage, reviewers, onJumpToDivergence } = useRunHeader();
  if (stage === 'proposal' || stage == null || reviewers.count === 0) return null;
  const shown = Math.min(reviewers.count, 3);
  return (
    <div className="flex items-center gap-2" data-testid="run-reviewers">
      <div className="flex -space-x-2" title={`${reviewers.count}/${reviewers.required}`}>
        {Array.from({ length: shown }).map((_, i) => (
          <span key={i} className={cn('h-[18px] w-[18px] rounded-full border-2 border-background', AVATAR[i % AVATAR.length])} aria-hidden="true" />
        ))}
        {reviewers.count > shown && (
          <span className="flex h-[18px] items-center rounded-full border-2 border-background bg-muted px-1 text-[10px] text-muted-foreground">+{reviewers.count - shown}</span>
        )}
      </div>
      {reviewers.divergent > 0 && (
        <button
          type="button"
          onClick={() => onJumpToDivergence?.()}
          className="flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-[11px] text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <GitFork className="h-3 w-3" aria-hidden="true" />
          {t('extraction', 'runHeaderReviewersDiffer').replace('{{count}}', String(reviewers.divergent))}
        </button>
      )}
    </div>
  );
}
