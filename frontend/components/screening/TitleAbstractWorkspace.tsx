/**
 * The Title/abstract sub-view (spec §4, §4.1, §4.2, §4.6): the record list and
 * the docked record panel on `ListDetailSplitShell`.
 *
 * URL: `?article=` is the selection and `?status=` the status view (absent →
 * the role default, fixed once the first read lands); both are written with
 * replace. A legacy `?assignment=` is stripped on mount and opens nothing.
 * Local: whether the panel is open, maximized (controlled for the shell), the
 * checked rows, the list cursor while the panel is closed, and the article ids
 * decided this session, which stay in the current view until the view, search
 * or a filter changes (never persisted, so a reload clears them).
 *
 * Keyboard (§4.5): j/k and ↓/↑ move the cursor through the visible order (the
 * selection follows while the panel is open), Enter opens the cursor row, `x`
 * checks it; ⇧-click checks a range. A decision on a To screen row advances to
 * the next To screen row in queue order, announces it and prefetches the two
 * after it (wrapping like the advance); a ruling or a solo re-decide stays on
 * its record (§4.4 advances after a To screen decision only).
 */
import {FileText} from 'lucide-react';
import {useQueryClient} from '@tanstack/react-query';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {useSearchParams} from 'react-router';
import {toast} from 'sonner';

import {ListDetailSplitShell} from '@/components/layout/ListDetailSplitShell';
import {ErrorState} from '@/components/patterns/ErrorState';
import {EmptyListState} from '@/components/shared/list';
import {Skeleton} from '@/components/ui/skeleton';
import {assignmentQueryOptions} from '@/hooks/screening/useScreeningAssignment';
import {useScreeningRecords} from '@/hooks/screening/useScreeningRecords';
import {useKeyboardShortcuts} from '@/hooks/useKeyboardShortcuts';
import {t} from '@/lib/copy';
import {screeningErrorMessage} from '@/lib/screening/errors';
import {
  defaultStatusView,
  isReadOnly,
  nextToScreen,
  progress,
  sortRecords,
  statusCounts,
  statusViewsFor,
  type StatusView,
} from '@/lib/screening/records';
import type {ScreeningConfigRead, ScreeningRecordRow} from '@/services/screeningService';

import {ScreeningRecordList} from './ScreeningRecordList';
import {ScreeningRecordPanel} from './ScreeningRecordPanel';
import {EnrollAllButton, PubMedImportButton, StartScreeningButton} from './ScreeningToolbarActions';

const SKELETON_ROWS = 6;
const PREFETCH_AHEAD = 2;

/**
 * The To screen rows after `from` in queue order, wrapping to the queue's start
 * as `nextToScreen` does; skips the row just decided (its cached status is
 * pre-decision) and `from` itself.
 */
function queueAfter(rows: ScreeningRecordRow[], from: ScreeningRecordRow, decidedId: string): ScreeningRecordRow[] {
  const queue = sortRecords(
    rows.filter((row) => row.status === 'to_screen' && row.article_id !== decidedId),
    'queue',
    'asc',
  );
  const at = queue.findIndex((row) => row.article_id === from.article_id);
  return [...queue.slice(at + 1), ...queue.slice(0, Math.max(at, 0))];
}

function isStatusView(value: string | null): value is StatusView {
  return value !== null && (statusViewsFor('title_abstract') as readonly string[]).includes(value);
}

/** The toolbar row alone, above a list-level state that has no list. */
function ToolbarOnly({actions, children}: {actions: ReactNode; children: ReactNode}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      {children}
    </div>
  );
}

function SkeletonRows() {
  return (
    <section aria-busy="true" aria-label={t('screening', 'loading')} className="flex flex-col gap-1">
      {Array.from({length: SKELETON_ROWS}, (_, index) => (
        <Skeleton key={index} data-slot="skeleton-row" className="h-9 w-full" />
      ))}
    </section>
  );
}

export function TitleAbstractWorkspace({projectId, config}: {projectId: string; config: ScreeningConfigRead}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const articleId = searchParams.get('article');
  const statusParam = searchParams.get('status');
  const hasLegacyAssignment = searchParams.has('assignment');

  const records = useScreeningRecords(projectId, 'title_abstract', config.reviewer_count !== null);
  const rows = records.data?.rows;

  const [panelOpen, setPanelOpen] = useState(() => articleId !== null);
  const [maximized, setMaximized] = useState(false);
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [listCursor, setListCursor] = useState<string | null>(null);
  const [keepArticleIds, setKeepArticleIds] = useState<ReadonlySet<string>>(() => new Set());
  const [rangeAnchorId, setRangeAnchorId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const queryClient = useQueryClient();

  // The list reports what it shows (view + search + filters + sort); only the
  // key and click handlers read it.
  const visibleRowsRef = useRef<ScreeningRecordRow[]>([]);
  const [onVisibleRowsChange] = useState(() => (visible: ScreeningRecordRow[]) => {
    visibleRowsRef.current = visible;
  });

  // The role default needs the counts, so it is fixed when the first read
  // lands: a later count change (the last conflict ruled) must not switch the
  // view under the user. Nothing enrolled → All, where the Not enrolled rows are.
  const [defaultView, setDefaultView] = useState<StatusView | null>(null);
  if (defaultView === null && rows) {
    setDefaultView(config.enrolled === 0 ? 'all' : defaultStatusView(config, statusCounts(rows)));
  }
  const status: StatusView = isStatusView(statusParam) ? statusParam : (defaultView ?? 'all');

  const updateParams = (mutate: (params: URLSearchParams) => void) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        mutate(next);
        return next;
      },
      {replace: true},
    );

  // One stable "not in this phase" handler: AssignmentView fires it from an
  // effect keyed on its identity, so a new function per render would toast
  // again on every re-render while the read stays gone.
  const notInPhaseRef = useRef<() => void>(() => {});
  useEffect(() => {
    notInPhaseRef.current = () => {
      updateParams((params) => params.delete('article'));
      toast(t('screening', 'notInPhase'));
    };
  });
  const [onNotInPhase] = useState(() => () => notInPhaseRef.current());

  // A client miss (initial or after a refetch): no request is made for it.
  // One updater for both URL repairs: react-router's functional
  // `setSearchParams` reads the last render's params, so a second navigate in
  // the same commit would restore what the first one removed.
  const selectionMissing =
    rows !== undefined && articleId !== null && !rows.some((row) => row.article_id === articleId);
  useEffect(() => {
    if (!hasLegacyAssignment && !selectionMissing) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('assignment');
        if (selectionMissing) next.delete('article');
        return next;
      },
      {replace: true},
    );
    if (selectionMissing) toast(t('screening', 'notInPhase'));
  }, [hasLegacyAssignment, selectionMissing, setSearchParams]);

  const cursorArticleId = panelOpen ? articleId : listCursor;
  const selectRow = (row: ScreeningRecordRow) => {
    updateParams((params) => params.set('article', row.article_id));
    setListCursor(row.article_id);
  };
  const openRow = (row: ScreeningRecordRow) => {
    selectRow(row);
    setPanelOpen(true);
  };
  const cursorRow = () => rows?.find((row) => row.article_id === cursorArticleId) ?? null;

  const moveCursor = (step: 1 | -1) => {
    const visible = visibleRowsRef.current;
    if (visible.length === 0) return;
    const index = visible.findIndex((row) => row.article_id === cursorArticleId);
    const target = index === -1 ? visible[0] : visible[Math.min(Math.max(index + step, 0), visible.length - 1)];
    if (panelOpen) selectRow(target);
    else setListCursor(target.article_id);
    // Focus follows to the cursor row once it mounts (useRecordWindow).
  };
  const changePanelOpen = (open: boolean) => {
    setPanelOpen(open);
    if (!open) setMaximized(false);
  };
  const changeStatus = (next: StatusView) => {
    updateParams((params) => params.set('status', next));
    setKeepArticleIds(new Set());
  };
  /** A plain toggle flips one row; ⇧ checks every visible row from the last toggled one to this one. */
  const toggleRow = (row: ScreeningRecordRow, {shiftKey}: {shiftKey: boolean}) => {
    const visible = visibleRowsRef.current;
    const from = shiftKey ? visible.findIndex((candidate) => candidate.article_id === rangeAnchorId) : -1;
    const to = visible.findIndex((candidate) => candidate.article_id === row.article_id);
    const next = new Set(checkedIds);
    if (from !== -1 && to !== -1) {
      for (const inRange of visible.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(inRange.article_id);
    } else if (next.has(row.article_id)) next.delete(row.article_id);
    else next.add(row.article_id);
    setCheckedIds(next);
    setRangeAnchorId(row.article_id);
  };

  const onDecided = (decided: ScreeningRecordRow) => {
    setKeepArticleIds((prev) => new Set(prev).add(decided.article_id));
    // `decided` is the row as it was before the decision: a solo re-decide
    // (anything but To screen) stays on the record, whose chip refetches.
    if (decided.status !== 'to_screen') return;
    const next = rows ? nextToScreen(rows, decided.article_id) : null;
    if (!rows || !next) return;
    selectRow(next);
    setAnnouncement(t('screening', 'nextRecordAnnouncement').replace('{{title}}', next.title));
    for (const ahead of queueAfter(rows, next, decided.article_id).slice(0, PREFETCH_AHEAD)) {
      if (ahead.assignment_id) void queryClient.prefetchQuery(assignmentQueryOptions(ahead.assignment_id));
    }
  };

  useKeyboardShortcuts({
    enabled: rows !== undefined,
    bindings: [
      {type: 'chord', key: 'j', handler: () => moveCursor(1)},
      {type: 'chord', key: 'ArrowDown', handler: () => moveCursor(1)},
      {type: 'chord', key: 'k', handler: () => moveCursor(-1)},
      {type: 'chord', key: 'ArrowUp', handler: () => moveCursor(-1)},
      {
        type: 'chord',
        key: 'Enter',
        yieldToControls: true,
        handler: () => {
          const row = cursorRow();
          if (row) openRow(row);
        },
      },
      {
        type: 'chord',
        key: 'x',
        handler: () => {
          const row = cursorRow();
          if (row) toggleRow(row, {shiftKey: false});
        },
      },
    ],
  });

  const start = () => {
    const next = rows ? nextToScreen(rows, null) : null;
    if (!next) return;
    openRow(next);
    setMaximized(true);
  };

  const readOnly = isReadOnly(config);
  const myLeft = rows ? progress(rows).myLeft : 0;
  const toolbarActions = (
    <>
      {!readOnly && (
        <PubMedImportButton projectId={projectId} canManage={config.can_manage} className="shrink-0" />
      )}
      {config.can_manage && config.enrolled > 0 && config.not_enrolled > 0 && (
        <EnrollAllButton
          projectId={projectId}
          className="shrink-0"
          label={t('screening', 'enrollNew').replace('{{n}}', String(config.not_enrolled))}
        />
      )}
      {!readOnly && myLeft > 0 && <StartScreeningButton onStart={start} />}
    </>
  );

  let list: ReactNode;
  if (records.isError) {
    list = (
      <ToolbarOnly actions={toolbarActions}>
        <ErrorState
          title={t('screening', 'loadErrorTitle')}
          message={screeningErrorMessage(records.error)}
          onRetry={() => void records.refetch()}
        />
      </ToolbarOnly>
    );
  } else if (!records.data) {
    list = (
      <ToolbarOnly actions={toolbarActions}>
        <SkeletonRows />
      </ToolbarOnly>
    );
  } else if (records.data.rows.length === 0) {
    list = (
      <ToolbarOnly actions={toolbarActions}>
        <EmptyListState
          icon={FileText}
          title={t('screening', 'noArticlesTitle')}
          description={t('screening', 'noArticlesBody')}
          className="flex flex-col items-center justify-center px-4 py-16"
        />
      </ToolbarOnly>
    );
  } else {
    list = (
      <div className="flex h-full min-h-0 flex-col gap-2">
        {config.enrolled === 0 && (
          <div className="flex shrink-0 items-center gap-3 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-[13px]">
            {config.can_manage ? (
              <EnrollAllButton projectId={projectId} label={t('screening', 'enrollAll')} />
            ) : (
              <p className="text-muted-foreground">{t('screening', 'enrollManagerOnly')}</p>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1">
          <ScreeningRecordList
            projectId={projectId}
            read={records.data}
            config={config}
            status={status}
            onStatusChange={changeStatus}
            activeArticleId={articleId}
            cursorArticleId={cursorArticleId}
            onOpenRow={openRow}
            checkedIds={checkedIds}
            onCheckedChange={setCheckedIds}
            onToggleRow={toggleRow}
            onVisibleRowsChange={onVisibleRowsChange}
            toolbarActions={toolbarActions}
            keepArticleIds={keepArticleIds}
            onFiltersChange={() => setKeepArticleIds(new Set())}
          />
        </div>
      </div>
    );
  }

  const selectedRow = rows?.find((row) => row.article_id === articleId) ?? null;

  return (
    <ListDetailSplitShell
      idPrefix="screening-shell"
      toggleLabel={t('screening', 'panelToggle')}
      list={list}
      panel={
        <div className="relative h-full min-h-0">
          <p role="status" data-testid="next-record-announcement" className="sr-only">
            {announcement}
          </p>
          <ScreeningRecordPanel
            projectId={projectId}
            row={selectedRow}
            config={config}
            onDecided={onDecided}
            onNotInPhase={onNotInPhase}
          />
        </div>
      }
      panelOpen={panelOpen}
      onPanelOpenChange={changePanelOpen}
      maximizable
      maximized={maximized}
      onMaximizedChange={setMaximized}
      escapeCloses
      hasSelection={articleId !== null}
      onClearSelection={() => updateParams((params) => params.delete('article'))}
      checkedCount={checkedIds.size}
      onClearChecked={() => setCheckedIds(new Set())}
    />
  );
}
