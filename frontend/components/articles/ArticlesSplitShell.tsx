/**
 * Articles tab: the table on the left, the article panel on the right.
 *
 * The layout, the Topbar toggle and its shortcuts live in
 * `ListDetailSplitShell`; this file owns the article panel, its dirty-discard
 * guard and the selection edge. Articles opts out of the shell's maximize and
 * Escape-closes behaviours.
 *
 * State split: the URL owns WHICH article and WHICH view (the props below);
 * this shell owns only whether the panel is expanded.
 *
 * `panelOpen` cannot be `useState(hasSelection)` (mount-only): "Add article"
 * reaches this shell via ProjectView -> URL mode=add, never through
 * `onArticleClick`, so a mount-time snapshot would leave the add form
 * unreachable once the shell is already on screen. Instead we track the
 * previous `hasSelection` in a ref and open only on its false->true edge —
 * that also means collapsing the panel while a selection stays active does
 * NOT get undone by an unrelated re-render.
 */
import {type ReactNode, useEffect, useRef, useState} from 'react';

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
import {
  ArticleSidePanel,
  type ArticleSidePanelView,
} from '@/components/articles/ArticleSidePanel';
import {ListDetailSplitShell} from '@/components/layout/ListDetailSplitShell';
import {t} from '@/lib/copy';

export interface ArticlesSplitShellListApi {
  /** Row click: opens the panel on that article. */
  onArticleClick: (id: string) => void;
}

export interface ArticlesSplitShellProps {
  list: (api: ArticlesSplitShellListApi) => ReactNode;
  projectId: string;
  mode: 'add' | 'edit' | null;
  articleId: string | null;
  view: ArticleSidePanelView;
  onViewChange: (view: ArticleSidePanelView) => void;
  onSelectArticle: (id: string) => void;
  onDismiss: () => void;
  onComplete: () => void;
}

export function ArticlesSplitShell({
  list,
  projectId,
  mode,
  articleId,
  view,
  onViewChange,
  onSelectArticle,
  onDismiss,
  onComplete,
}: ArticlesSplitShellProps) {
  const hasSelection = mode === 'add' || (mode === 'edit' && Boolean(articleId));
  // Open on mount when the URL already carries a selection (deep link, reload).
  const [panelOpen, setPanelOpen] = useState(hasSelection);
  const [dirty, setDirty] = useState(false);
  // Collapsing (the header toggle or its shortcut) and swapping the article
  // both wait on the same discard dialog, so one pending action models both:
  // which thing is waiting on the confirm.
  const [pendingAction, setPendingAction] = useState<
    {type: 'select'; id: string} | {type: 'collapse'} | null
  >(null);

  // Open the panel on a false->true transition of hasSelection (e.g. "Add
  // article" routing straight to mode=add), without re-opening a panel the
  // user just collapsed while the selection did not change. Ref read/write
  // stays inside the effect body — the React Compiler forbids ref access
  // during render.
  const prevHasSelectionRef = useRef(hasSelection);
  useEffect(() => {
    if (!prevHasSelectionRef.current && hasSelection) {
      setPanelOpen(true);
    }
    // A true->false transition means the selection was cleared out from
    // under the panel (e.g. Cancel clears the URL): ArticleSidePanel
    // unmounts without ever calling onDirtyChange(false), so `dirty` would
    // otherwise strand at whatever it last reported and make the header
    // toggle raise a discard dialog over an empty placeholder.
    if (prevHasSelectionRef.current && !hasSelection) {
      setDirty(false);
    }
    prevHasSelectionRef.current = hasSelection;
  }, [hasSelection]);

  const selectArticle = (id: string) => {
    setPanelOpen(true);
    setDirty(false);
    onSelectArticle(id);
  };

  const handleArticleClick = (id: string) => {
    // Only a genuine swap is guarded: re-clicking the open article is a no-op,
    // and nagging there would make the guard feel broken.
    if (dirty && id !== articleId) {
      setPendingAction({type: 'select', id});
      return;
    }
    selectArticle(id);
  };

  const collapsePanel = () => {
    setPanelOpen(false);
    // Nothing left to lose once the panel is gone: an un-cleared `dirty`
    // would nag about edits that no longer exist on the next row click.
    setDirty(false);
  };

  const requestCollapse = () => {
    if (dirty) {
      setPendingAction({type: 'collapse'});
      return;
    }
    collapsePanel();
  };

  const listApi: ArticlesSplitShellListApi = {
    onArticleClick: handleArticleClick,
  };

  const panelBody = hasSelection ? (
    <ArticleSidePanel
      projectId={projectId}
      mode={mode as 'add' | 'edit'}
      articleId={articleId ?? undefined}
      view={view}
      onViewChange={onViewChange}
      onDismiss={onDismiss}
      onComplete={onComplete}
      onDirtyChange={setDirty}
    />
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
      <p className="text-[13px] font-medium">{t('articles', 'panelPlaceholderTitle')}</p>
      <p className="text-[12px] text-muted-foreground">
        {t('articles', 'panelPlaceholderBody')}
      </p>
    </div>
  );

  const discardDialog = (
    <AlertDialog
      open={pendingAction !== null}
      onOpenChange={(open) => !open && setPendingAction(null)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('articles', 'panelDiscardTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('articles', 'panelDiscardBody')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('articles', 'panelDiscardCancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const action = pendingAction;
              setPendingAction(null);
              if (action?.type === 'select') selectArticle(action.id);
              else if (action?.type === 'collapse') collapsePanel();
            }}
          >
            {t('articles', 'panelDiscardConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <>
      <ListDetailSplitShell
        list={list(listApi)}
        panel={panelBody}
        panelOpen={panelOpen}
        // Opening is never guarded (nothing to lose); closing goes through the
        // discard confirm.
        onPanelOpenChange={(open) => (open ? setPanelOpen(true) : requestCollapse())}
        idPrefix="articles-shell"
        toggleLabel={t('articles', 'panelToggle')}
      />
      {discardDialog}
    </>
  );
}
