/**
 * The document body of an article panel: files loading, a failed files read,
 * the empty state (with the attach dialog), or the caller's viewer once files
 * exist. Shared by the Articles side panel and the full-text screening panel.
 */
import {useState, type ReactNode} from 'react';
import {FileText, Loader2} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {ErrorState} from '@/components/patterns/ErrorState';
import {ArticleFileUploadDialogNew} from '@/components/articles/ArticleFileUploadDialogNew';
import {useArticleDocuments} from '@/hooks/extraction/useArticleDocuments';
import {t} from '@/lib/copy';
import type {ArticleFileListItem} from '@/services/articleFilesService';

export interface ArticleDocumentsBodyProps {
  projectId: string;
  articleId: string;
  /** False: the empty state carries no attach action. */
  canAttach: boolean;
  /** Only `MAIN` files count, matching the screening `has_pdf`. */
  mainOnly?: boolean;
  /** Rendered once files exist. */
  children: (files: ArticleFileListItem[]) => ReactNode;
}

export function ArticleDocumentsBody({
  projectId,
  articleId,
  canAttach,
  mainOnly = false,
  children,
}: ArticleDocumentsBodyProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const {files, filesLoading, filesError, refetchFiles} = useArticleDocuments(articleId);
  const counted = mainOnly ? files.filter((f) => f.fileRole === 'MAIN') : files;

  let body: ReactNode;
  if (filesLoading) {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true"/>
        <p className="text-[12px] text-muted-foreground">{t('articles', 'panelDocumentLoading')}</p>
      </div>
    );
  } else if (filesError) {
    // A failed read must not read as "no PDF".
    body = <ErrorState message={t('articles', 'panelDocumentLoadError')} onRetry={refetchFiles}/>;
  } else if (counted.length === 0) {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <FileText className="h-5 w-5 text-muted-foreground" aria-hidden="true"/>
        <p className="text-[13px] font-medium">{t('articles', 'panelNoDocumentTitle')}</p>
        <p className="text-[12px] text-muted-foreground">{t('articles', 'panelNoDocumentBody')}</p>
        {canAttach && (
          <Button size="sm" variant="outline" className="text-[12px]" onClick={() => setUploadOpen(true)}>
            {t('articles', 'panelAddFile')}
          </Button>
        )}
      </div>
    );
  } else {
    body = children(counted);
  }

  return (
    <>
      {body}
      {canAttach && (
        <ArticleFileUploadDialogNew
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          articleId={articleId}
          projectId={projectId}
          onFileUploaded={() => setUploadOpen(false)}
        />
      )}
    </>
  );
}
