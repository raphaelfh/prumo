/**
 * The Duplicates sub-view (spec §8.4): the pair list and the docked compare
 * panel on `ListDetailSplitShell`.
 *
 * URL (all replace): `?status=` is the status view (absent or unknown → Open);
 * `?article=` + `?kept=` the selected pair (`kept` absent → the first open pair
 * holding the article, `findSelectedPair`). A selection no pair matches once
 * the read lands is dropped silently.
 * Local: whether the panel is open, the list cursor while it is closed, and
 * the "Accept N exact" confirm.
 *
 * Every verdict is one `useDuplicateVerdicts` call; the controls and keys rest
 * while one is in flight. Merge and Not duplicates toast with an Undo
 * (`cleared` for the same ids) and move to the next pair in list order, as Skip
 * does without a request; a toast's Undo is a no-op while another verdict is
 * in flight. A refusal toasts its mapped copy; the hook refetches
 * the screening family on every settle. Keys: j/k move, Enter opens, Esc is the
 * shell's chain (panel → selection).
 */
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {useSearchParams} from 'react-router';
import {toast} from 'sonner';

import {ListDetailSplitShell} from '@/components/layout/ListDetailSplitShell';
import {ErrorState} from '@/components/patterns/ErrorState';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {Button} from '@/components/ui/button';
import {Skeleton} from '@/components/ui/skeleton';
import {useDuplicates, useDuplicateVerdicts} from '@/hooks/screening/useDuplicates';
import {useKeyboardShortcuts} from '@/hooks/useKeyboardShortcuts';
import {ApiError} from '@/integrations/api/client';
import {t} from '@/lib/copy';
import {duplicatesErrorMessage} from '@/lib/duplicates/errors';
import {
  findSelectedPair,
  pairKey,
  pairsInView,
  selectAcceptableExact,
  viewCounts,
  type DuplicateStatusView,
} from '@/lib/duplicates/pairs';
import type {DuplicatePair, DuplicateVerdictCreate} from '@/services/duplicatesService';

import {DuplicateComparePanel} from './DuplicateComparePanel';
import {DUPLICATE_STATUS_VIEWS, DuplicatePairList} from './DuplicatePairList';

const SKELETON_ROWS = 6;

function isStatusView(value: string | null): value is DuplicateStatusView {
  return value !== null && (DUPLICATE_STATUS_VIEWS as readonly string[]).includes(value);
}

const verdictFor = (pair: DuplicatePair, verdict: DuplicateVerdictCreate['verdict']): DuplicateVerdictCreate => ({
  article_id: pair.article_id,
  kept_article_id: pair.kept_article_id,
  verdict,
});

const cleared = (items: DuplicateVerdictCreate[]) => items.map((item) => ({...item, verdict: 'cleared' as const}));

function SkeletonRows() {
  return (
    <section aria-busy="true" aria-label={t('screening', 'loading')} className="flex flex-col gap-1">
      {Array.from({length: SKELETON_ROWS}, (_, index) => (
        <Skeleton key={index} data-slot="skeleton-row" className="h-9 w-full" />
      ))}
    </section>
  );
}

export function DuplicatesWorkspace({projectId}: {projectId: string}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const articleId = searchParams.get('article');
  const keptId = searchParams.get('kept');
  const statusParam = searchParams.get('status');
  const view: DuplicateStatusView = isStatusView(statusParam) ? statusParam : 'open';

  // Manager-only tab: the backend refuses anyone else, so the read is always on.
  const query = useDuplicates(projectId, true);
  const verdicts = useDuplicateVerdicts(projectId);
  const busy = verdicts.isPending;
  const data = query.data;
  // A toast's Undo outlives the render that made it: it reads the live flag.
  // A second mutate on the observer would drop the in-flight call's callbacks.
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const [panelOpen, setPanelOpen] = useState(() => articleId !== null);
  const [listCursor, setListCursor] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const visible = data ? pairsInView(data, view) : [];
  const selected = data ? findSelectedPair(data, articleId, keptId) : null;
  const selectedKey = selected ? pairKey(selected) : null;
  const acceptable = data ? selectAcceptableExact(data.open) : [];

  const updateParams = (mutate: (params: URLSearchParams) => void) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        mutate(next);
        return next;
      },
      {replace: true},
    );
  const clearSelection = (params: URLSearchParams) => {
    params.delete('article');
    params.delete('kept');
  };

  // A selection the loaded read does not hold (a stale link, a pair resolved
  // elsewhere) is dropped without a toast.
  const selectionMissing = data !== undefined && articleId !== null && selected === null;
  useEffect(() => {
    if (!selectionMissing) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('article');
        next.delete('kept');
        return next;
      },
      {replace: true},
    );
  }, [selectionMissing, setSearchParams]);

  const cursorKey = panelOpen ? selectedKey : listCursor;
  const selectPair = (pair: DuplicatePair) => {
    updateParams((params) => {
      params.set('article', pair.article_id);
      params.set('kept', pair.kept_article_id);
    });
    setListCursor(pairKey(pair));
  };
  const openPair = (pair: DuplicatePair) => {
    selectPair(pair);
    setPanelOpen(true);
  };

  const moveCursor = (step: 1 | -1) => {
    if (visible.length === 0) return;
    const index = visible.findIndex((pair) => pairKey(pair) === cursorKey);
    const target = index === -1 ? visible[0] : visible[Math.min(Math.max(index + step, 0), visible.length - 1)];
    if (panelOpen) selectPair(target);
    else setListCursor(pairKey(target));
  };

  /**
   * The pair after `from` in list order, wrapping, skipping pairs that hold
   * `removedId` (they leave the read on refetch); none left → the selection clears.
   */
  const advance = (from: DuplicatePair, removedId?: string) => {
    const at = visible.findIndex((pair) => pairKey(pair) === pairKey(from));
    const next = [...visible.slice(at + 1), ...visible.slice(0, Math.max(at, 0))].find(
      (pair) =>
        pairKey(pair) !== pairKey(from) && pair.article_id !== removedId && pair.kept_article_id !== removedId,
    );
    if (next) selectPair(next);
    else updateParams(clearSelection);
  };

  const post = (items: DuplicateVerdictCreate[], onSuccess?: (written: number) => void) =>
    verdicts.mutate(items, {
      onSuccess: (result) => onSuccess?.(result.written),
      onError: (error) => toast.error(duplicatesErrorMessage(error)),
    });
  const toastWithUndo = (message: string, items: DuplicateVerdictCreate[]) =>
    toast.success(message, {
      action: {
        label: t('duplicates', 'undo'),
        onClick: () => {
          if (!busyRef.current) post(cleared(items));
        },
      },
    });

  const merge = (pair: DuplicatePair, removedId: string, keptArticleId: string) => {
    const items: DuplicateVerdictCreate[] = [
      {article_id: removedId, kept_article_id: keptArticleId, verdict: 'duplicate'},
    ];
    post(items, () => {
      toastWithUndo(t('duplicates', 'merged'), items);
      advance(pair, removedId);
    });
  };
  const markDistinct = (pair: DuplicatePair) => {
    const items = [verdictFor(pair, 'distinct')];
    post(items, () => {
      toastWithUndo(t('duplicates', 'markedDistinct'), items);
      advance(pair);
    });
  };
  // The count is the server's: it skips a pair whose record is already removed.
  const acceptExact = () =>
    post(
      acceptable.map((pair) => verdictFor(pair, 'duplicate')),
      (written) => toast.success(t('duplicates', 'mergedMany').replace('{{n}}', String(written))),
    );

  useKeyboardShortcuts({
    enabled: data !== undefined && !busy,
    bindings: [
      {type: 'chord', key: 'j', handler: () => moveCursor(1)},
      {type: 'chord', key: 'k', handler: () => moveCursor(-1)},
      {
        type: 'chord',
        key: 'Enter',
        yieldToControls: true,
        handler: () => {
          const pair = visible.find((candidate) => pairKey(candidate) === cursorKey);
          if (pair) openPair(pair);
        },
      },
    ],
  });

  const acceptLabel = t('duplicates', 'acceptExact').replace('{{n}}', String(acceptable.length));
  // Bulk accept acts on open pairs only: not offered from the Resolved view.
  const toolbarActions = view !== 'resolved' && acceptable.length > 0 && (
    <>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmOpen(true)}>
        {acceptLabel}
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {acceptable.length === 1
                ? t('duplicates', 'acceptExactTitleOne')
                : t('duplicates', 'acceptExactTitle').replace('{{n}}', String(acceptable.length))}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('duplicates', 'acceptExactBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common', 'cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={acceptExact}>{acceptLabel}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  let list: ReactNode;
  if (query.isError) {
    const forbidden = query.error instanceof ApiError && query.error.status === 403;
    list = (
      <ErrorState
        title={t('duplicates', 'loadError')}
        message={duplicatesErrorMessage(query.error)}
        onRetry={forbidden ? undefined : () => void query.refetch()}
      />
    );
  } else if (!data) {
    list = <SkeletonRows />;
  } else {
    list = (
      <DuplicatePairList
        counts={viewCounts(data)}
        view={view}
        onViewChange={(next) => updateParams((params) => params.set('status', next))}
        pairs={visible}
        activeKey={selectedKey}
        cursorKey={cursorKey}
        onOpenPair={openPair}
        toolbarActions={toolbarActions}
      />
    );
  }

  return (
    <ListDetailSplitShell
      idPrefix="duplicates-shell"
      toggleLabel={t('duplicates', 'panelToggle')}
      list={list}
      panel={
        selected && (
          <div className="h-full min-h-0 overflow-auto p-3">
            <DuplicateComparePanel
              key={pairKey(selected)}
              pair={selected}
              busy={busy}
              onMerge={(removedId, keptArticleId) => merge(selected, removedId, keptArticleId)}
              onDistinct={() => markDistinct(selected)}
              onSkip={() => advance(selected)}
              onUndo={() => post([verdictFor(selected, 'cleared')])}
            />
          </div>
        )
      }
      panelOpen={panelOpen}
      onPanelOpenChange={setPanelOpen}
      escapeCloses
      hasSelection={articleId !== null}
      onClearSelection={() => updateParams(clearSelection)}
    />
  );
}
