/**
 * The PRISMA tab: identification and title/abstract screening numbers, read
 * as the server counts them. Blind review: the payload carries outcomes only,
 * so nothing here can tell a record awaiting a peer from one in conflict, and
 * nothing is derived client-side to try. The flow diagram is a later version.
 */
import {useId} from 'react';

import {ErrorState} from '@/components/patterns/ErrorState';
import {LoadingState, Notice} from '@/components/screening/ScreeningParts';
import {usePrismaCounts} from '@/hooks/screening/usePrismaCounts';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';
import {screeningErrorMessage} from '@/lib/screening/errors';
import type {PrismaCountsRead} from '@/services/screeningService';

type SourceKey = 'prismaSourcePubmed' | 'prismaSourceZotero' | 'prismaSourceRis' | 'prismaSourceManual';

const SOURCE_LABEL = new Map<string, SourceKey>([
  ['pubmed', 'prismaSourcePubmed'],
  ['zotero', 'prismaSourceZotero'],
  ['ris', 'prismaSourceRis'],
  ['manual', 'prismaSourceManual'],
]);

/** A known source by name; any other source as the server sent it. */
function sourceLabel(source: string): string {
  const key = SOURCE_LABEL.get(source);
  return key ? t('screening', key) : source;
}

interface Line {
  /** Unique within its section: a reason or a raw source may repeat a label. */
  id: string;
  label: string;
  count: number;
  /** A breakdown of the line above it. */
  nested?: boolean;
}

function CountsSection({title, lines}: {title: string; lines: Line[]}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-xs font-medium text-muted-foreground">
        {title}
      </h3>
      <table className="w-full text-[13px]">
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="h-9 border-b border-border/30 last:border-b-0">
              <th
                scope="row"
                className={cn(
                  'py-1.5 text-left font-normal',
                  line.nested ? 'pl-4 text-muted-foreground' : 'text-foreground',
                )}
              >
                {line.label}
              </th>
              <td className="py-1.5 text-right font-medium tabular-nums text-foreground">{line.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function identificationLines(counts: PrismaCountsRead): Line[] {
  return [
    ...counts.identified.map(({source, count}) => ({id: `source:${source}`, label: sourceLabel(source), count, nested: true})),
    {id: 'total', label: t('screening', 'prismaIdentifiedTotal'), count: counts.identified_total},
    {id: 'duplicates', label: t('screening', 'prismaDuplicates'), count: counts.duplicates_removed},
    {id: 'not-retrieved', label: t('screening', 'prismaNotRetrieved'), count: counts.not_retrieved},
    {id: 'not-enrolled', label: t('screening', 'prismaNotEnrolled'), count: counts.imported_not_enrolled},
  ];
}

function screeningLines(counts: PrismaCountsRead): Line[] {
  // Zero breakdown lines add nothing to "Records excluded"; they stay hidden.
  const breakdown: Line[] = [
    ...counts.excluded_by_reason.map(({reason, count}) => ({id: `reason:${reason}`, label: reason, count, nested: true})),
    {id: 'reasons-differ', label: t('screening', 'prismaReasonsDiffer'), count: counts.excluded_reasons_differ, nested: true},
    {id: 'no-reason', label: t('screening', 'prismaNoReason'), count: counts.excluded_without_reason, nested: true},
  ].filter((line) => line.count > 0);
  return [
    {id: 'screened', label: t('screening', 'prismaScreened'), count: counts.screened},
    {id: 'excluded', label: t('screening', 'prismaExcluded'), count: counts.excluded},
    ...breakdown,
    {id: 'sought', label: t('screening', 'prismaSought'), count: counts.sought_for_retrieval},
  ];
}

export function PrismaCountsPanel({projectId}: {projectId: string}) {
  const query = usePrismaCounts(projectId);

  if (query.isPending) return <LoadingState />;
  if (query.isError) {
    return (
      <ErrorState
        title={t('screening', 'loadErrorTitle')}
        message={screeningErrorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const counts = query.data;
  if (counts.screened === 0) {
    return (
      <Notice title={t('screening', 'prismaEmptyTitle')} body={t('screening', 'prismaEmptyBody')}>
        {counts.imported_not_enrolled > 0 && (
          <p className="text-[13px] text-muted-foreground">
            <span>{t('screening', 'prismaNotEnrolled')}</span>{' '}
            <span className="font-medium tabular-nums text-foreground">{counts.imported_not_enrolled}</span>
          </p>
        )}
      </Notice>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-6">
      <h2 className="text-sm font-medium text-foreground">{t('screening', 'prismaTitle')}</h2>
      <CountsSection title={t('screening', 'prismaIdentification')} lines={identificationLines(counts)} />
      <CountsSection title={t('screening', 'prismaScreening')} lines={screeningLines(counts)} />
    </div>
  );
}
