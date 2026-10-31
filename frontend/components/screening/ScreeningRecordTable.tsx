/**
 * The record rows: a dense table from `sm` up, a `ListRowCard` per record
 * below it. Selection (the open record) tints the row; the cursor (keyboard
 * position) draws a ring only; checking is the checkbox alone. Also the bulk
 * bar that acts on the checked rows.
 */
import {toast} from 'sonner';

import {ListRowCard, ResponsiveList} from '@/components/shared/list';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {useEnrollArticles} from '@/hooks/screening/useScreeningConfig';
import {t} from '@/lib/copy';
import type {screening} from '@/lib/copy/screening';
import {screeningErrorMessage} from '@/lib/screening/errors';
import {recordsToCsv} from '@/lib/screening/records';
import {TABLE_CELL_CLASS} from '@/lib/table-constants';
import {cn} from '@/lib/utils';
import type {ScreeningRecordRow} from '@/services/screeningService';

import {RecordStatusChip} from './RecordStatusChip';

const DECISION_LABEL: Record<NonNullable<ScreeningRecordRow['my_decision']>, keyof typeof screening> = {
  include: 'decisionInclude',
  exclude: 'decisionExclude',
  maybe: 'decisionMaybe',
};

const HEAD_CLASS = cn(TABLE_CELL_CLASS, 'h-8 text-[11px] font-medium uppercase tracking-wider text-muted-foreground');
const CELL_CLASS = cn(TABLE_CELL_CLASS, 'py-1.5 text-[13px]');

interface ScreeningRecordTableProps {
  rows: ScreeningRecordRow[];
  isNarrow: boolean;
  showMine: boolean;
  showReason: boolean;
  activeArticleId: string | null;
  cursorArticleId: string | null;
  checkedIds: ReadonlySet<string>;
  onCheckedChange: (ids: ReadonlySet<string>) => void;
  onToggleRow: (row: ScreeningRecordRow, event: {shiftKey: boolean}) => void;
  onOpenRow: (row: ScreeningRecordRow) => void;
}

function RowCheckbox({row, checked, onToggleRow}: {
  row: ScreeningRecordRow;
  checked: boolean;
  onToggleRow: ScreeningRecordTableProps['onToggleRow'];
}) {
  return (
    <Checkbox
      checked={checked}
      onClick={(event) => {
        event.stopPropagation();
        onToggleRow(row, {shiftKey: event.shiftKey});
      }}
      aria-label={t('screening', 'selectRecord').replace('{{title}}', row.title)}
      className="h-3.5 w-3.5 rounded-sm"
    />
  );
}

export function ScreeningRecordTable({
  rows,
  isNarrow,
  showMine,
  showReason,
  activeArticleId,
  cursorArticleId,
  checkedIds,
  onCheckedChange,
  onToggleRow,
  onOpenRow,
}: ScreeningRecordTableProps) {
  const checkedVisible = rows.filter((row) => checkedIds.has(row.article_id)).length;
  const allChecked = rows.length > 0 && checkedVisible === rows.length;
  const toggleAll = () => {
    const next = new Set(checkedIds);
    for (const row of rows) {
      if (allChecked) next.delete(row.article_id);
      else next.add(row.article_id);
    }
    onCheckedChange(next);
  };

  const tableContent = (
    <Table containerClassName="overflow-visible" className="w-full table-fixed">
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow className="h-8 border-b border-border/40 hover:bg-transparent">
          <TableHead className={cn(HEAD_CLASS, 'w-[36px]')}>
            <Checkbox
              checked={allChecked ? true : checkedVisible > 0 ? 'indeterminate' : false}
              onCheckedChange={toggleAll}
              aria-label={t('screening', 'selectAllRecords')}
              className="h-3.5 w-3.5 rounded-sm"
            />
          </TableHead>
          <TableHead className={HEAD_CLASS}>{t('screening', 'columnTitle')}</TableHead>
          <TableHead className={cn(HEAD_CLASS, 'hidden w-[64px] md:table-cell')}>{t('screening', 'columnYear')}</TableHead>
          <TableHead className={cn(HEAD_CLASS, 'hidden w-[160px] lg:table-cell')}>
            {t('screening', 'columnJournal')}
          </TableHead>
          {showMine && <TableHead className={cn(HEAD_CLASS, 'w-[84px]')}>{t('screening', 'columnMine')}</TableHead>}
          <TableHead className={cn(HEAD_CLASS, 'w-[176px]')}>{t('screening', 'columnStatus')}</TableHead>
          {showReason && <TableHead className={cn(HEAD_CLASS, 'w-[160px]')}>{t('screening', 'columnReason')}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const active = row.article_id === activeArticleId;
          const reason = row.outcome_exclusion_reason ?? row.my_exclusion_reason;
          return (
            <TableRow
              key={row.article_id}
              data-state={active ? 'selected' : undefined}
              className={cn(
                'group relative h-9 border-b border-border/30 transition-colors duration-75 hover:bg-muted/40',
                active && 'bg-muted/60 font-medium',
                row.article_id === cursorArticleId && 'ring-1 ring-inset ring-ring/60',
              )}
            >
              <TableCell className={cn(CELL_CLASS, 'relative z-10')}>
                <RowCheckbox row={row} checked={checkedIds.has(row.article_id)} onToggleRow={onToggleRow} />
              </TableCell>
              <TableCell className={cn(CELL_CLASS, 'min-w-0')}>
                {/* Stretched over the row by its ::after: the whole row opens the record. */}
                <button
                  type="button"
                  onClick={() => onOpenRow(row)}
                  className="block w-full min-w-0 truncate rounded-sm text-left text-foreground after:absolute after:inset-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {row.title}
                </button>
              </TableCell>
              <TableCell className={cn(CELL_CLASS, 'hidden tabular-nums text-muted-foreground md:table-cell')}>
                {row.publication_year}
              </TableCell>
              <TableCell className={cn(CELL_CLASS, 'hidden truncate text-muted-foreground lg:table-cell')}>
                {row.journal_title}
              </TableCell>
              {showMine && (
                <TableCell className={cn(CELL_CLASS, 'text-muted-foreground')}>
                  {row.my_decision && t('screening', DECISION_LABEL[row.my_decision])}
                </TableCell>
              )}
              <TableCell className={CELL_CLASS}>
                <RecordStatusChip status={row.status} arbitrated={row.outcome_kind === 'arbitrated'} />
              </TableCell>
              {showReason && (
                <TableCell className={cn(CELL_CLASS, 'truncate text-muted-foreground')}>{reason}</TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  const cardContent = rows.map((row) => (
    <ListRowCard
      key={row.article_id}
      className={cn(row.article_id === activeArticleId && 'bg-muted/60')}
      leading={<RowCheckbox row={row} checked={checkedIds.has(row.article_id)} onToggleRow={onToggleRow} />}
      title={row.title}
      subtitle={row.first_author ?? undefined}
      meta={
        <>
          <RecordStatusChip status={row.status} arbitrated={row.outcome_kind === 'arbitrated'} />
          {row.publication_year != null && <span className="tabular-nums">{row.publication_year}</span>}
          {row.journal_title && <span className="truncate">{row.journal_title}</span>}
        </>
      }
      primaryAction={null}
      onClick={() => onOpenRow(row)}
    />
  ));

  return <ResponsiveList isNarrow={isNarrow} tableContent={tableContent} cardContent={cardContent} />;
}

function downloadCsv(rows: ScreeningRecordRow[]) {
  const url = URL.createObjectURL(new Blob([recordsToCsv(rows)], {type: 'text/csv;charset=utf-8'}));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'screening-records.csv';
  anchor.click();
  // Revoking synchronously can cancel the download in Safari and Firefox.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

interface RecordBulkBarProps {
  projectId: string;
  rows: ScreeningRecordRow[];
  checkedIds: ReadonlySet<string>;
  canManage: boolean;
  onCheckedChange: (ids: ReadonlySet<string>) => void;
}

/** "N selected" with Enroll selected (manager; not-enrolled rows only) and Export selected (CSV). */
export function RecordBulkBar({projectId, rows, checkedIds, canManage, onCheckedChange}: RecordBulkBarProps) {
  const enroll = useEnrollArticles(projectId);
  const checkedRows = rows.filter((row) => checkedIds.has(row.article_id));
  const enrollIds = checkedRows.filter((row) => row.status === 'not_enrolled').map((row) => row.article_id);
  const enrollSelected = () =>
    enroll.mutate(
      {article_ids: enrollIds},
      {
        onSuccess: (result) => {
          toast.success(t('screening', 'enrolledToast').replace('{{n}}', String(result.enrolled)));
          onCheckedChange(new Set());
        },
        onError: (error) => toast.error(screeningErrorMessage(error)),
      },
    );
  return (
    <>
      <span className="text-[11px] font-medium tabular-nums text-foreground">
        {t('screening', 'selectedCount').replace('{{n}}', String(checkedRows.length))}
      </span>
      {canManage && (
        <Button size="xs" variant="ghost" onClick={enrollSelected} disabled={enrollIds.length === 0 || enroll.isPending}>
          {t('screening', 'enrollSelected')}
        </Button>
      )}
      <Button size="xs" variant="ghost" onClick={() => downloadCsv(checkedRows)}>
        {t('screening', 'exportSelected')}
      </Button>
    </>
  );
}
