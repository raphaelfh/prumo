/**
 * A record's screening status as a small tinted chip; an arbitrated outcome
 * carries a muted "Arbitrated" suffix.
 */
import {t} from '@/lib/copy';
import type {screening} from '@/lib/copy/screening';
import type {RecordStatus} from '@/lib/screening/records';
import {cn} from '@/lib/utils';

type ScreeningCopyKey = keyof typeof screening;

export const RECORD_STATUS_LABEL: Record<RecordStatus, ScreeningCopyKey> = {
  to_screen: 'statusToScreen',
  waiting: 'statusWaiting',
  in_review: 'statusInReview',
  conflict: 'statusConflict',
  included: 'statusIncluded',
  excluded: 'statusExcluded',
  maybe: 'statusMaybe',
  not_retrieved: 'statusNotRetrieved',
  not_enrolled: 'statusNotEnrolled',
};

const TONE: Record<RecordStatus, string> = {
  to_screen: 'bg-primary/10 text-primary',
  waiting: 'bg-muted text-foreground',
  in_review: 'bg-info/10 text-info',
  conflict: 'bg-warning/10 text-warning',
  included: 'bg-success/10 text-success',
  excluded: 'bg-destructive/10 text-destructive',
  maybe: 'bg-warning/10 text-warning',
  not_retrieved: 'bg-muted text-muted-foreground',
  not_enrolled: 'border border-dashed border-border text-muted-foreground',
};

export function RecordStatusChip({status, arbitrated = false}: {status: RecordStatus; arbitrated?: boolean}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[11px] font-medium leading-none',
        TONE[status],
      )}
    >
      <span className="truncate">{t('screening', RECORD_STATUS_LABEL[status])}</span>
      {arbitrated && (
        <>
          <span aria-hidden="true">·</span>
          <span className="font-normal opacity-80">{t('screening', 'statusArbitrated')}</span>
        </>
      )}
    </span>
  );
}
