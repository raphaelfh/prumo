/**
 * The duplicate pair list (spec §8.4): the status views with their counts, the
 * caller's toolbar actions, and one row per pair (removed title, the kept title
 * as a muted second line, the match chip, both sources, the year). A dense
 * table from `sm` up, a `ListRowCard` per pair below it. Selection (the open
 * pair) tints the row; the keyboard cursor draws a ring only.
 */
import type {ReactNode} from 'react';

import {ListRowCard, ResponsiveList} from '@/components/shared/list';
import {Badge} from '@/components/ui/badge';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {useIsNarrow} from '@/hooks/use-mobile';
import {t} from '@/lib/copy';
import type {duplicates} from '@/lib/copy/duplicates';
import {pairKey, sourceLabel, type DuplicateStatusView} from '@/lib/duplicates/pairs';
import {TABLE_CELL_CLASS} from '@/lib/table-constants';
import {cn} from '@/lib/utils';
import type {DuplicatePair} from '@/services/duplicatesService';

type CopyKey = keyof typeof duplicates;

export const DUPLICATE_STATUS_VIEWS: readonly DuplicateStatusView[] = ['open', 'exact', 'likely', 'possible', 'resolved'];

const VIEW_LABEL: Record<DuplicateStatusView, CopyKey> = {
  open: 'viewOpen',
  exact: 'viewExact',
  likely: 'viewLikely',
  possible: 'viewPossible',
  resolved: 'viewResolved',
};

const MATCH_LABEL: Record<NonNullable<DuplicatePair['match_label']>, CopyKey> = {
  pmid: 'matchPmid',
  doi_title: 'matchDoiTitle',
  title: 'matchTitle',
  doi_only: 'matchDoiOnly',
};

const HEAD_CLASS = cn(TABLE_CELL_CLASS, 'h-8 text-[11px] font-medium uppercase tracking-wider text-muted-foreground');
const CELL_CLASS = cn(TABLE_CELL_CLASS, 'py-1.5 text-[13px]');

const sources = (pair: DuplicatePair) =>
  `${sourceLabel(pair.removed.ingestion_source)} · ${sourceLabel(pair.kept.ingestion_source)}`;
const year = (pair: DuplicatePair) => pair.removed.publication_year ?? pair.kept.publication_year;

function MatchChip({pair}: {pair: DuplicatePair}) {
  if (!pair.match_label) return null;
  return (
    <Badge variant="outline" className="whitespace-nowrap px-1.5 py-0 text-[11px] font-normal">
      {t('duplicates', MATCH_LABEL[pair.match_label])}
    </Badge>
  );
}

/** Both titles in one button: its accessible name tells two pairs sharing a removed record apart. */
function PairTitle({pair, stretched}: {pair: DuplicatePair; stretched?: boolean}) {
  return (
    <span className="flex min-w-0 flex-col text-left">
      <span className={cn('truncate text-foreground', stretched && 'after:absolute after:inset-0')}>
        {pair.removed.title}
      </span>
      <span className="truncate text-[11px] text-muted-foreground">{pair.kept.title}</span>
    </span>
  );
}

interface DuplicatePairListProps {
  counts: Record<DuplicateStatusView, number>;
  view: DuplicateStatusView;
  onViewChange: (view: DuplicateStatusView) => void;
  pairs: DuplicatePair[];
  activeKey: string | null;
  cursorKey: string | null;
  onOpenPair: (pair: DuplicatePair) => void;
  toolbarActions: ReactNode;
}

export function DuplicatePairList({
  counts,
  view,
  onViewChange,
  pairs,
  activeKey,
  cursorKey,
  onOpenPair,
  toolbarActions,
}: DuplicatePairListProps) {
  const isNarrow = useIsNarrow();

  const tableContent = (
    <Table containerClassName="overflow-visible" className="w-full table-fixed">
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow className="h-8 border-b border-border/40 hover:bg-transparent">
          <TableHead className={HEAD_CLASS}>{t('duplicates', 'colTitle')}</TableHead>
          <TableHead className={cn(HEAD_CLASS, 'w-[180px]')}>{t('duplicates', 'colMatch')}</TableHead>
          <TableHead className={cn(HEAD_CLASS, 'hidden w-[140px] @xl:table-cell')}>
            {t('duplicates', 'colSources')}
          </TableHead>
          <TableHead className={cn(HEAD_CLASS, 'hidden w-[64px] @lg:table-cell')}>{t('duplicates', 'colYear')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pairs.map((pair) => {
          const k = pairKey(pair);
          const active = k === activeKey;
          return (
            <TableRow
              key={k}
              data-pair-row={k}
              data-state={active ? 'selected' : undefined}
              data-cursor={k === cursorKey || undefined}
              className={cn(
                'group relative border-b border-border/30 transition-colors duration-75 hover:bg-muted/40',
                active && 'bg-muted/60 font-medium',
                k === cursorKey && 'ring-1 ring-inset ring-ring/60',
              )}
            >
              <TableCell className={cn(CELL_CLASS, 'min-w-0')}>
                {/* Stretched over the row by its ::after: the whole row opens the pair. */}
                <button
                  type="button"
                  onClick={() => onOpenPair(pair)}
                  className="block w-full min-w-0 rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <PairTitle pair={pair} stretched />
                </button>
              </TableCell>
              <TableCell className={CELL_CLASS}>
                <MatchChip pair={pair} />
              </TableCell>
              <TableCell className={cn(CELL_CLASS, 'hidden truncate text-muted-foreground @xl:table-cell')}>
                {sources(pair)}
              </TableCell>
              <TableCell className={cn(CELL_CLASS, 'hidden tabular-nums text-muted-foreground @lg:table-cell')}>
                {year(pair)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  const cardContent = pairs.map((pair) => (
    <ListRowCard
      key={pairKey(pair)}
      className={cn(pairKey(pair) === activeKey && 'bg-muted/60')}
      title={pair.removed.title}
      subtitle={pair.kept.title}
      meta={
        <>
          <MatchChip pair={pair} />
          <span>{sources(pair)}</span>
          {year(pair) != null && <span className="tabular-nums">{year(pair)}</span>}
        </>
      }
      primaryAction={null}
      onClick={() => onOpenPair(pair)}
    />
  ));

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label={t('duplicates', 'tabDuplicates')}
          className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-md bg-muted/40 p-0.5"
        >
          {DUPLICATE_STATUS_VIEWS.map((candidate) => {
            const active = candidate === view;
            return (
              <button
                key={candidate}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onViewChange(candidate)}
                className={cn(
                  'h-7 shrink-0 whitespace-nowrap rounded px-3 text-[13px] font-medium transition-colors duration-75 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11',
                  active
                    ? 'bg-background text-foreground shadow-xs'
                    : counts[candidate] === 0
                      ? 'text-muted-foreground/60 hover:text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span>{t('duplicates', VIEW_LABEL[candidate])}</span>{' '}
                <span className="tabular-nums opacity-70">{counts[candidate]}</span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">{toolbarActions}</div>
      </div>

      {/* @container: columns drop on the list's own width (the docked panel halves it). */}
      <div className="@container flex min-h-0 flex-1 flex-col overflow-auto rounded-md border border-border/40">
        {pairs.length > 0 ? (
          <ResponsiveList isNarrow={isNarrow} tableContent={tableContent} cardContent={cardContent} />
        ) : (
          <p className="px-4 py-16 text-center text-[13px] text-muted-foreground">
            {t('duplicates', view === 'resolved' ? 'noResolvedPairs' : 'noOpenPairs')}
          </p>
        )}
      </div>
    </div>
  );
}
