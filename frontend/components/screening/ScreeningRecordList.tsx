/**
 * The title/abstract record list (spec §4.2, §4.6 list level): status views,
 * the toolbar (search, filters, sort and display, the caller's actions), the
 * progress strip, the rows and the bulk bar. It owns the search / filter /
 * sort UI state; the workspace owns the status view, selection, check set and
 * the decided-this-session ids it passes as `keepArticleIds`.
 */
import {Search} from 'lucide-react';
import {useEffect, useRef, useState, type ReactNode} from 'react';

import {
  ActiveFilterChips,
  buildActiveFiltersList,
  EmptyListState,
  FilterButtonWithPopover,
  ListCount,
  ListDisplaySortPopover,
  ListFilterPanel,
  ListToolbarSearch,
  type FilterFieldConfig,
  type FilterValues,
} from '@/components/shared/list';
import {useIsNarrow} from '@/hooks/use-mobile';
import {useListKeyboardShortcuts} from '@/hooks/useListKeyboardShortcuts';
import {t} from '@/lib/copy';
import type {screening} from '@/lib/copy/screening';
import {
  filterRecords,
  myDecisionValuesFor,
  progress,
  sortRecords,
  statusCounts,
  type RecordSortField,
  type StatusView,
} from '@/lib/screening/records';
import type {ScreeningConfigRead, ScreeningRecordRow, ScreeningRecordsRead} from '@/services/screeningService';

import {RecordBulkBar, ScreeningRecordTable} from './ScreeningRecordTable';
import {ScreeningStatusViews} from './ScreeningStatusViews';

export interface ScreeningRecordListProps {
  projectId: string;
  read: ScreeningRecordsRead;
  config: ScreeningConfigRead;
  status: StatusView;
  onStatusChange: (status: StatusView) => void;
  activeArticleId: string | null;
  cursorArticleId: string | null;
  onOpenRow: (row: ScreeningRecordRow) => void;
  checkedIds: ReadonlySet<string>;
  onCheckedChange: (ids: ReadonlySet<string>) => void;
  onToggleRow: (row: ScreeningRecordRow, event: {shiftKey: boolean}) => void;
  toolbarActions: ReactNode;
  onVisibleRowsChange?: (rows: ScreeningRecordRow[]) => void;
  keepArticleIds: ReadonlySet<string>;
  onFiltersChange: () => void;
}

type CopyKey = keyof typeof screening;

const SOURCE_LABEL: Record<string, CopyKey> = {
  pubmed: 'prismaSourcePubmed',
  zotero: 'prismaSourceZotero',
  ris: 'prismaSourceRis',
  manual: 'prismaSourceManual',
  unknown: 'sourceUnknown',
};

const categorical = (id: string, label: CopyKey, options: {value: string; label: string}[]): FilterFieldConfig => ({
  id,
  label: t('screening', label),
  type: 'categorical',
  options,
});

const DECISION_VALUE_LABEL: Record<string, CopyKey> = {
  include: 'decisionInclude',
  exclude: 'decisionExclude',
  maybe: 'decisionMaybe',
  not_retrieved: 'decisionNotRetrieved',
  none: 'myDecisionNone',
};

function filterFields(read: ScreeningRecordsRead, canReview: boolean): FilterFieldConfig[] {
  const years = read.rows.flatMap((row) => (row.publication_year === null ? [] : [row.publication_year]));
  const currentYear = new Date().getFullYear();
  const sources = [...new Set(read.rows.map((row) => row.ingestion_source ?? 'unknown'))];
  const myDecision = categorical(
    'my_decision',
    'filterMyDecision',
    myDecisionValuesFor(read.phase).map((value) => ({value, label: t('screening', DECISION_VALUE_LABEL[value])})),
  );
  return [
    {id: 'title', label: t('screening', 'filterTitle'), type: 'text'},
    {id: 'authors', label: t('screening', 'filterAuthors'), type: 'text'},
    {id: 'journal', label: t('screening', 'filterJournal'), type: 'text'},
    {
      id: 'year',
      label: t('screening', 'filterYear'),
      type: 'numericRange',
      minBound: years.length > 0 ? Math.min(...years) : currentYear,
      maxBound: Math.max(currentYear, ...years),
    },
    ...(canReview ? [myDecision] : []),
    categorical(
      'exclusion_reason',
      'filterExclusionReason',
      read.exclusion_reasons.map((reason) => ({value: reason, label: reason})),
    ),
    categorical(
      'source',
      'filterSource',
      sources.map((source) => ({
        value: source,
        label: source in SOURCE_LABEL ? t('screening', SOURCE_LABEL[source]) : source,
      })),
    ),
    ...(read.phase === 'full_text'
      ? [
          categorical('pdf', 'filterPdf', [
            {value: 'attached', label: t('screening', 'pdfAttached')},
            {value: 'missing', label: t('screening', 'pdfMissing')},
          ]),
        ]
      : []),
  ];
}

export function ScreeningRecordList({
  projectId,
  read,
  config,
  status,
  onStatusChange,
  activeArticleId,
  cursorArticleId,
  onOpenRow,
  checkedIds,
  onCheckedChange,
  onToggleRow,
  toolbarActions,
  onVisibleRowsChange,
  keepArticleIds,
  onFiltersChange,
}: ScreeningRecordListProps) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterValues>({});
  const [sortField, setSortField] = useState<RecordSortField>('queue');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [showReason, setShowReason] = useState(false);
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // State, not a ref: the row window reads the scroller during render.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const isNarrow = useIsNarrow();

  const canReview = config.can_review;
  const fields = filterFields(read, canReview);
  const chips = buildActiveFiltersList(fields, filters);
  const hasActiveFilters = chips.length > 0 || search.trim() !== '';
  const counts = statusCounts(read.rows);
  const visible = sortRecords(
    filterRecords(read.rows, {search, filters, status, keep: keepArticleIds}),
    sortField,
    sortDirection,
  );

  useEffect(() => {
    onVisibleRowsChange?.(visible);
  }, [onVisibleRowsChange, visible]);

  const changeSearch = (value: string) => {
    setSearch(value);
    onFiltersChange();
  };
  const changeFilters = (values: FilterValues) => {
    setFilters(values);
    onFiltersChange();
  };
  const clearFilters = () => {
    setSearch('');
    setFilters({});
    onFiltersChange();
  };
  const clearField = (column: string) => {
    const next = {...filters};
    delete next[column];
    changeFilters(next);
  };

  // ⌘A selects what the user can see (spec §4.4): status view + search + filters.
  const selectVisible = () => onCheckedChange(new Set(visible.map((row) => row.article_id)));

  useListKeyboardShortcuts({
    searchInputRef,
    setFilterPopoverOpen,
    filterPopoverOpen,
    hasActiveFilters,
    selectAll: selectVisible,
    selectFiltered: selectVisible,
  });

  const {decided, enrolled, myLeft} = progress(read.rows);
  const decidedText = t('screening', 'progressDecided')
    .replace('{{x}}', String(decided))
    .replace('{{n}}', String(enrolled));
  const progressText = canReview
    ? `${decidedText} · ${t('screening', 'progressYouLeft').replace('{{m}}', String(myLeft))}`
    : decidedText;

  const sortOptions: {value: RecordSortField; label: string}[] = [
    {value: 'queue', label: t('screening', 'sortQueue')},
    {value: 'title', label: t('screening', 'sortTitle')},
    {value: 'year', label: t('screening', 'sortYear')},
    {value: 'status', label: t('screening', 'sortStatus')},
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 flex-col gap-2">
        <ScreeningStatusViews phase={read.phase} counts={counts} status={status} onStatusChange={onStatusChange} />
        <div className="flex w-full flex-wrap items-center gap-2">
          <ListToolbarSearch
            ref={searchInputRef}
            placeholder={t('screening', 'listSearchPlaceholder')}
            value={search}
            onChange={changeSearch}
          />
          <FilterButtonWithPopover
            open={filterPopoverOpen}
            onOpenChange={setFilterPopoverOpen}
            activeCount={chips.length}
            label={t('screening', 'listFilterLabel')}
          >
            <ListFilterPanel fields={fields} values={filters} onChange={changeFilters} />
          </FilterButtonWithPopover>
          <ListDisplaySortPopover
            sortOptions={sortOptions}
            sortField={sortField}
            sortDirection={sortDirection}
            onSortFieldChange={(value) => setSortField(value as RecordSortField)}
            onSortDirectionChange={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
            orderLabel={t('screening', 'sortOrderLabel')}
            columns={[{key: 'reason', label: t('screening', 'columnReason')}]}
            visibleKeys={{reason: showReason}}
            onToggleColumn={() => setShowReason((shown) => !shown)}
            displayPropertiesLabel={t('screening', 'displayProperties')}
            tooltipLabel={t('screening', 'sortLabel')}
            ariaLabel={t('screening', 'sortLabel')}
          />
          {toolbarActions}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {checkedIds.size === 0 ? (
              <ListCount visible={visible.length} total={counts.all} label={t('screening', 'listRecordsLabel')} />
            ) : (
              <RecordBulkBar
                projectId={projectId}
                rows={read.rows}
                checkedIds={checkedIds}
                canManage={config.can_manage}
                onCheckedChange={onCheckedChange}
              />
            )}
          </div>
        </div>
        <ActiveFilterChips
          filters={chips}
          onClearField={clearField}
          onClearAll={clearFilters}
          clearAllLabel={t('screening', 'clearFilters')}
          removeFilterAriaLabel={(label) => t('screening', 'removeFilterAria').replace('{{label}}', label)}
        />
        <p className="flex h-7 items-center truncate text-[11px] tabular-nums text-muted-foreground">{progressText}</p>
      </div>

      {/* @container: the table drops columns on its own width (the docked panel halves it), not the viewport's. */}
      <div
        ref={setScroller}
        className="@container flex min-h-0 flex-1 flex-col overflow-auto rounded-md border border-border/40"
      >
        {visible.length > 0 ? (
          <ScreeningRecordTable
            rows={visible}
            scroller={scroller}
            isNarrow={isNarrow}
            showMine={canReview}
            showReason={showReason}
            activeArticleId={activeArticleId}
            cursorArticleId={cursorArticleId}
            checkedIds={checkedIds}
            onCheckedChange={onCheckedChange}
            onToggleRow={onToggleRow}
            onOpenRow={onOpenRow}
          />
        ) : hasActiveFilters ? (
          <EmptyListState
            icon={Search}
            title={t('screening', 'noRecordsMatch')}
            actionLabel={t('screening', 'clearFilters')}
            onAction={clearFilters}
            className="flex flex-col items-center justify-center px-4 py-16"
          />
        ) : (
          <p className="px-4 py-16 text-center text-[13px] text-muted-foreground">{t('screening', 'emptyView')}</p>
        )}
      </div>
    </div>
  );
}
