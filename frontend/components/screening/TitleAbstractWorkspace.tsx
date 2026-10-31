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
 */
import {FileText} from 'lucide-react';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {useSearchParams} from 'react-router';
import {toast} from 'sonner';

import {ListDetailSplitShell} from '@/components/layout/ListDetailSplitShell';
import {ErrorState} from '@/components/patterns/ErrorState';
import {EmptyListState} from '@/components/shared/list';
import {Skeleton} from '@/components/ui/skeleton';
import {useScreeningRecords} from '@/hooks/screening/useScreeningRecords';
import {t} from '@/lib/copy';
import {screeningErrorMessage} from '@/lib/screening/errors';
import {
  defaultStatusView,
  isReadOnly,
  nextToScreen,
  progress,
  statusCounts,
  STATUS_VIEWS,
  type StatusView,
} from '@/lib/screening/records';
import type {ScreeningConfigRead, ScreeningRecordRow} from '@/services/screeningService';

import {ScreeningRecordList} from './ScreeningRecordList';
import {ScreeningRecordPanel} from './ScreeningRecordPanel';
import {EnrollAllButton, PubMedImportButton, StartScreeningButton} from './ScreeningToolbarActions';

const SKELETON_ROWS = 6;

function isStatusView(value: string | null): value is StatusView {
  return value !== null && (STATUS_VIEWS as readonly string[]).includes(value);
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
  const selectionMissing =
    rows !== undefined && articleId !== null && !rows.some((row) => row.article_id === articleId);
  useEffect(() => {
    if (selectionMissing) onNotInPhase();
  }, [selectionMissing, onNotInPhase]);

  useEffect(() => {
    if (hasLegacyAssignment) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('assignment');
          return next;
        },
        {replace: true},
      );
    }
  }, [hasLegacyAssignment, setSearchParams]);

  const openRow = (row: ScreeningRecordRow) => {
    updateParams((params) => params.set('article', row.article_id));
    setListCursor(row.article_id);
    setPanelOpen(true);
  };
  const changePanelOpen = (open: boolean) => {
    setPanelOpen(open);
    if (!open) setMaximized(false);
  };
  const changeStatus = (next: StatusView) => {
    updateParams((params) => params.set('status', next));
    setKeepArticleIds(new Set());
  };
  const toggleRow = (row: ScreeningRecordRow) => {
    const next = new Set(checkedIds);
    if (next.has(row.article_id)) next.delete(row.article_id);
    else next.add(row.article_id);
    setCheckedIds(next);
  };
  const onDecided = (row: ScreeningRecordRow) =>
    setKeepArticleIds((prev) => new Set(prev).add(row.article_id));

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
            cursorArticleId={panelOpen ? articleId : listCursor}
            onOpenRow={openRow}
            checkedIds={checkedIds}
            onCheckedChange={setCheckedIds}
            onToggleRow={toggleRow}
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
        <ScreeningRecordPanel
          projectId={projectId}
          row={selectedRow}
          config={config}
          onDecided={onDecided}
          onNotInPhase={onNotInPhase}
        />
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
