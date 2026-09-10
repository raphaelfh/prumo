/**
 * Split layout for the Articles tab: the table on the left, the article panel
 * on the right.
 *
 * Deliberately NOT RunSplitShell: that shell's `assessment-shell*` panel ids
 * are the DOM test contract for the run screens' specs, and its in-shell PDF
 * toggle is wrong for a panel that usually shows fields. Both are built on the
 * same ResizablePanelGroup primitives; see the side-panel design spec §4.
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
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import {useIsBelowDesktop} from '@/hooks/use-mobile';
import {useKeyboardShortcuts} from '@/hooks/useKeyboardShortcuts';
import {
  ArticleSidePanel,
  type ArticleSidePanelView,
} from '@/components/articles/ArticleSidePanel';
import {PanelToggleButton} from '@/components/layout/PanelToggleButton';
import {useSetHeaderActions} from '@/contexts/HeaderActionsContext';
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
  const belowDesktop = useIsBelowDesktop();

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

  // Opening is never guarded (nothing to lose); closing goes through the
  // discard confirm.
  const togglePanel = () => (panelOpen ? requestCollapse() : setPanelOpen(true));

  // ⌘⇧B / Ctrl+Shift+B: ⌘B already toggles the app sidebar on the other
  // edge, so this panel takes the same letter plus Shift. The header toggle
  // below is the one control for it and shows the chord on hover. Off while
  // the discard dialog is asking: it is an alertdialog, which the hook's own
  // dialog guard does not match, and a press there would rewrite a pending
  // swap into a collapse.
  useKeyboardShortcuts({
    bindings: [{type: 'chord', key: 'b', mod: true, shift: true, handler: togglePanel}],
    enabled: pendingAction === null,
  });

  // The toggle is page-specific state that Topbar must not know about — it
  // fills Topbar's generic header-actions slot instead of being threaded in
  // as a Topbar prop. See HeaderActionsContext for the rationale.
  useSetHeaderActions(
    <PanelToggleButton
      side={belowDesktop ? 'bottom' : 'right'}
      pressed={panelOpen}
      onToggle={togglePanel}
      ariaLabel={t('articles', 'panelToggle')}
      shortcut={['mod', '⇧', 'B']}
    />,
  );

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
      {/*
       * Below lg the group flips to vertical (table on top, panel
       * underneath) instead of falling back to an overlay: docking the
       * panel is the point, and an overlay Sheet would defeat it by
       * covering the table it was supposed to keep visible.
       */}
      <ResizablePanelGroup orientation={belowDesktop ? 'vertical' : 'horizontal'} className="h-full">
        <ResizablePanel id="articles-shell-list" defaultSize={panelOpen ? '55%' : '100%'} minSize="35%">
          {/* The tab is full-bleed (no page gutter), so the list owns a minimal
              inset — without it the toolbar and the table card sat flush
              against the window edge and the split handle. */}
          <div className="flex h-full min-h-0 flex-col p-2">{list(listApi)}</div>
        </ResizablePanel>
        {panelOpen ? (
          <>
            <ResizableHandle withHandle/>
            <ResizablePanel
              id="articles-shell-panel"
              defaultSize="45%"
              minSize="30%"
              maxSize="65%"
            >
              {panelBody}
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
      {discardDialog}
    </>
  );
}
