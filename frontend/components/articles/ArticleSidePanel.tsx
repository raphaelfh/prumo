/**
 * The docked article panel in the Articles tab.
 *
 * Shows EITHER the article's document (PDF or the markdown reader — the
 * viewer owns that switch) OR its edit fields. Owns only the strip and the
 * switch; both bodies are the components the run screens and the old editor
 * sheet already use, unchanged.
 */
import {useId, useState} from 'react';
import {FileText, Loader2} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {ArticleForm} from '@/components/articles/ArticleForm';
import {ArticleFileUploadDialogNew} from '@/components/articles/ArticleFileUploadDialogNew';
import {RunPdfContent} from '@/components/runs/RunPdfContent';
import {useArticleDocuments} from '@/hooks/extraction/useArticleDocuments';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

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
  const [uploadOpen, setUploadOpen] = useState(false);
  const documentHintId = useId();

  const effectiveArticleId = articleId ?? createdId ?? undefined;
  const documentAvailable = Boolean(effectiveArticleId);
  const {files, filesLoading} = useArticleDocuments(effectiveArticleId ?? null);
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
          <ViewButton
            active={view === 'details'}
            onClick={() => onViewChange('details')}
            label={t('articles', 'panelViewDetails')}
          />
          <ViewButton
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
        ) : filesLoading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true"/>
            <p className="text-[12px] text-muted-foreground">
              {t('articles', 'panelDocumentLoading')}
            </p>
          </div>
        ) : files.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <FileText className="h-5 w-5 text-muted-foreground" aria-hidden="true"/>
            <p className="text-[13px] font-medium">{t('articles', 'panelNoDocumentTitle')}</p>
            <p className="text-[12px] text-muted-foreground">
              {t('articles', 'panelNoDocumentBody')}
            </p>
            <Button size="sm" variant="outline" className="text-[12px]" onClick={() => setUploadOpen(true)}>
              {t('articles', 'panelAddFile')}
            </Button>
          </div>
        ) : (
          <RunPdfContent articleId={effectiveArticleId as string} projectId={projectId}/>
        )}
      </div>

      {effectiveArticleId && (
        <ArticleFileUploadDialogNew
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          articleId={effectiveArticleId}
          projectId={projectId}
          onFileUploaded={() => setUploadOpen(false)}
        />
      )}
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  label,
  disabled,
  title,
  describedById,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  title?: string;
  describedById?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      aria-disabled={disabled}
      aria-describedby={describedById}
      className={cn(
        'h-6 rounded-sm px-2 text-[12px] transition-colors',
        active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {label}
    </button>
  );
}
