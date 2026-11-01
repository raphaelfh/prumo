/**
 * The docked article panel in the Articles tab.
 *
 * Shows EITHER the article's document (PDF or the markdown reader — the
 * viewer owns that switch) OR its edit fields. Owns only the strip and the
 * switch; both bodies are the components the run screens and the old editor
 * sheet already use, unchanged.
 */
import {useId, useState} from 'react';

import {ArticleForm} from '@/components/articles/ArticleForm';
import {ArticleDocumentsBody} from '@/components/articles/ArticleDocumentsBody';
import {ArticleViewButton} from '@/components/articles/ArticleViewButton';
import {RunPdfContent} from '@/components/runs/RunPdfContent';
import {t} from '@/lib/copy';

export type ArticleSidePanelView = 'details' | 'document';

export interface ArticleSidePanelProps {
  projectId: string;
  /** 'add' has no article yet; 'edit' always carries articleId. */
  mode: 'add' | 'edit';
  articleId?: string;
  view: ArticleSidePanelView;
  onViewChange: (view: ArticleSidePanelView) => void;
  onDismiss: () => void;
  onComplete: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function ArticleSidePanel({
  projectId,
  mode,
  articleId,
  view,
  onViewChange,
  onDismiss,
  onComplete,
  onDirtyChange,
}: ArticleSidePanelProps) {
  // Add mode does not put the new id in the URL (that would remount the form
  // and destroy its staged files), so the form hands it to us directly.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const documentHintId = useId();

  const effectiveArticleId = articleId ?? createdId ?? undefined;
  const documentAvailable = Boolean(effectiveArticleId);
  // The panel decides its own body defensively: `view` is host-driven and can
  // still say 'document' right after switching to add mode (articleId cleared,
  // view untouched) — falling back to 'details' here avoids stranding the user
  // on a dead "Add file" button gated behind an article id that doesn't exist yet.
  const effectiveView = documentAvailable ? view : 'details';

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="article-side-panel">
      {/* Show/hide is the Topbar toggle's job (ArticlesSplitShell, ⌘⇧B); the
          strip carries only the view switch. */}
      <div className="flex h-8 shrink-0 items-center border-b border-border/40 px-2">
        <div className="flex items-center gap-0.5" role="group">
          <ArticleViewButton
            active={view === 'details'}
            onClick={() => onViewChange('details')}
            label={t('articles', 'panelViewDetails')}
          />
          <ArticleViewButton
            active={effectiveView === 'document'}
            onClick={() => {
              if (!documentAvailable) return;
              onViewChange('document');
            }}
            label={t('articles', 'panelViewDocument')}
            disabled={!documentAvailable}
            title={documentAvailable ? undefined : t('articles', 'panelViewDocumentAfterSave')}
            describedById={documentAvailable ? undefined : documentHintId}
          />
          {!documentAvailable && (
            <span id={documentHintId} className="sr-only">
              {t('articles', 'panelViewDocumentAfterSave')}
            </span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {effectiveView === 'details' ? (
          <ArticleForm
            key={mode === 'add' ? 'add' : articleId}
            mode={mode}
            projectId={projectId}
            articleId={articleId}
            onDismiss={onDismiss}
            onComplete={onComplete}
            onDirtyChange={onDirtyChange}
            onArticleCreated={setCreatedId}
          />
        ) : (
          <ArticleDocumentsBody projectId={projectId} articleId={effectiveArticleId as string} canAttach>
            {() => <RunPdfContent articleId={effectiveArticleId as string} projectId={projectId}/>}
          </ArticleDocumentsBody>
        )}
      </div>
    </div>
  );
}
