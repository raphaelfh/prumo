/**
 * The status views as a segmented tablist (`SectionViewSwitcher`'s classes):
 * each tab reads "Label N"; a view at 0 stays, muted, unless it is one of
 * `HIDDEN_AT_ZERO`.
 */
import {t} from '@/lib/copy';
import {visibleStatusViews, type StatusView} from '@/lib/screening/records';
import {cn} from '@/lib/utils';

import {RECORD_STATUS_LABEL} from './RecordStatusChip';

interface ScreeningStatusViewsProps {
  counts: Record<StatusView, number>;
  status: StatusView;
  onStatusChange: (status: StatusView) => void;
}

function viewLabel(view: StatusView): string {
  return view === 'all' ? t('screening', 'statusAll') : t('screening', RECORD_STATUS_LABEL[view]);
}

export function ScreeningStatusViews({counts, status, onStatusChange}: ScreeningStatusViewsProps) {
  return (
    <div
      role="tablist"
      aria-label={t('screening', 'statusViewsLabel')}
      className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-md bg-muted/40 p-0.5"
    >
      {visibleStatusViews(counts).map((view) => {
        const active = view === status;
        const empty = counts[view] === 0;
        return (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onStatusChange(view)}
            className={cn(
              'h-7 shrink-0 whitespace-nowrap rounded px-3 text-[13px] font-medium transition-colors duration-75 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11',
              active
                ? 'bg-background text-foreground shadow-xs'
                : empty
                  ? 'text-muted-foreground/60 hover:text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span>{viewLabel(view)}</span> <span className="tabular-nums opacity-70">{counts[view]}</span>
          </button>
        );
      })}
    </div>
  );
}
