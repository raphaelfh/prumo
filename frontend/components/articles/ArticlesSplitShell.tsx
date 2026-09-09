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
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import {Sheet, SheetContent} from '@/components/ui/sheet';
import {useIsBelowDesktop} from '@/hooks/use-mobile';
import {
  ArticleSidePanel,
  type ArticleSidePanelView,
} from '@/components/articles/ArticleSidePanel';
import {t} from '@/lib/copy';

export interface ArticlesSplitShellListApi {
  /** Row click: opens the panel on that article. */
  onArticleClick: (id: string) => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
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
    prevHasSelectionRef.current = hasSelection;
  }, [hasSelection]);

  const handleArticleClick = (id: string) => {
    setPanelOpen(true);
    onSelectArticle(id);
  };

  const listApi: ArticlesSplitShellListApi = {
    onArticleClick: handleArticleClick,
    panelOpen,
    onTogglePanel: () => setPanelOpen((v) => !v),
  };

  const panelBody = hasSelection ? (
    <ArticleSidePanel
      projectId={projectId}
      mode={mode as 'add' | 'edit'}
      articleId={articleId ?? undefined}
      view={view}
      onViewChange={onViewChange}
      onCollapse={() => setPanelOpen(false)}
      onDismiss={onDismiss}
      onComplete={onComplete}
    />
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
      <p className="text-[13px] font-medium">{t('articles', 'panelPlaceholderTitle')}</p>
      <p className="text-[12px] text-muted-foreground">
        {t('articles', 'panelPlaceholderBody')}
      </p>
    </div>
  );

  if (belowDesktop) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {list(listApi)}
        <Sheet open={panelOpen} onOpenChange={(open) => !open && setPanelOpen(false)}>
          <SheetContent
            side="right"
            showCloseButton={false}
            className="flex h-full w-full max-w-full min-h-0 flex-col gap-0 border-l border-border/40 p-0 sm:max-w-none sm:w-[min(960px,96vw)]"
          >
            {panelBody}
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel id="articles-shell-list" defaultSize={panelOpen ? '55%' : '100%'} minSize="35%">
        <div className="flex h-full min-h-0 flex-col">{list(listApi)}</div>
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
  );
}
