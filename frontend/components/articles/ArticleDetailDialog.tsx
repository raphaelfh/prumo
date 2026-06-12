import {useEffect, useState} from "react";
import {Dialog, DialogContent, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Badge} from "@/components/ui/badge";
import {Separator} from "@/components/ui/separator";
import {toast} from "sonner";
import {Download, ExternalLink, Eye, FileText, Trash2, Upload} from "lucide-react";
import {ArticleFileUploadDialogNew} from "./ArticleFileUploadDialogNew";
import {formatFileSize} from "@/lib/file-validation";
import {FILE_ROLE_LABELS} from "@/lib/file-constants";
import {t} from "@/lib/copy";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    fetchArticle,
    fetchArticleFiles,
    downloadFileBlob,
    deleteArticleFile,
    type ArticleFileRecord,
} from "@/services/articlesService";

interface Article {
  id: string;
  title: string;
  abstract: string | null;
  authors: string[] | null;
  publication_year: number | null;
  publication_month: number | null;
  journal_title: string | null;
  journal_issn: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  keywords: string[] | null;
  url_landing: string | null;
  project_id: string;
    ingestion_source: string | null;
    sync_state: string | null;
    source_lineage: string | null;
    last_synced_at: string | null;
    zotero_item_key: string | null;
    zotero_collection_key: string | null;
}

interface ArticleDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  articleId: string | null;
}

export function ArticleDetailDialog({ open, onOpenChange, articleId }: ArticleDetailDialogProps) {
  const [article, setArticle] = useState<Article | null>(null);
  const [files, setFiles] = useState<ArticleFileRecord[]>([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<ArticleFileRecord | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadArticle = async () => {
    if (!articleId) return;
    const result = await fetchArticle(articleId);
    if (result.ok) {
      setArticle(result.data as unknown as Article);
    } else {
      toast.error(t('articles', 'errorLoadArticle'));
    }
  };

  const loadFiles = async () => {
    if (!articleId) return;
    const result = await fetchArticleFiles(articleId);
    if (result.ok) {
      setFiles(result.data);
    }
    // silent on error — files are best-effort
  };

  useEffect(() => {
    if (articleId && open) {
      // Microtask so the loaders' setState calls run in async callbacks.
      queueMicrotask(() => {
        void loadArticle();
        void loadFiles();
      });
    }
  }, [articleId, open]);

  const downloadFile = async (file: ArticleFileRecord) => {
    const result = await downloadFileBlob(file.storage_key);
    if (!result.ok) {
      toast.error(t('articles', 'errorDownloadFile'));
      return;
    }
    const url = URL.createObjectURL(result.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.original_filename || "document.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const viewPDF = async (file: ArticleFileRecord) => {
    const result = await downloadFileBlob(file.storage_key);
    if (!result.ok) {
      toast.error(t('articles', 'errorViewPdf'));
      return;
    }
    const blob = new Blob([result.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    // Clean up after a delay to allow the browser to load it
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const handleDeleteFile = async () => {
    if (!fileToDelete) return;

    setDeleting(true);
    const result = await deleteArticleFile(fileToDelete.id, fileToDelete.storage_key);
    setDeleting(false);
    setDeleteDialogOpen(false);
    setFileToDelete(null);

    if (!result.ok) {
      toast.error(t('articles', 'errorRemoveFile'));
      return;
    }

    toast.success(t('articles', 'fileRemovedSuccess'));
    void loadFiles(); // Reload file list
  };

  const getFileRoleLabel = (fileRole: string | null | undefined): string => {
      if (!fileRole) return t('articles', 'notSpecified');
    return FILE_ROLE_LABELS[fileRole as keyof typeof FILE_ROLE_LABELS] || fileRole;
  };

  if (!article) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl leading-tight pr-8">
            {article.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Metadata */}
          <div className="space-y-4">
            {/* Authors */}
            {article.authors && article.authors.length > 0 && (
              <div>
                  <h3 className="text-sm font-semibold mb-2">Authors</h3>
                <p className="text-sm text-muted-foreground">
                  {article.authors.join(", ")}
                </p>
              </div>
            )}

              <div className="flex items-center gap-2">
                  <Badge variant="outline">{article.ingestion_source ?? "MANUAL"}</Badge>
                  {article.sync_state && article.sync_state !== "active" && (
                      <Badge variant="secondary">{article.sync_state}</Badge>
                  )}
                  {article.zotero_item_key && (
                      <Badge variant="outline" className="font-mono text-[10px]">
                          {article.zotero_item_key}
                      </Badge>
                  )}
              </div>

            {/* Journal Info */}
            <div className="flex flex-wrap gap-4">
              {article.journal_title && (
                <div>
                    <h3 className="text-sm font-semibold mb-1">Journal</h3>
                  <p className="text-sm text-muted-foreground italic">
                    {article.journal_title}
                  </p>
                </div>
              )}

              {article.publication_year && (
                <div>
                    <h3 className="text-sm font-semibold mb-1">Year</h3>
                  <Badge variant="secondary">{article.publication_year}</Badge>
                </div>
              )}

              {article.volume && (
                <div>
                  <h3 className="text-sm font-semibold mb-1">Volume</h3>
                  <p className="text-sm text-muted-foreground">{article.volume}</p>
                </div>
              )}

              {article.issue && (
                <div>
                    <h3 className="text-sm font-semibold mb-1">{t('articles', 'edition')}</h3>
                  <p className="text-sm text-muted-foreground">{article.issue}</p>
                </div>
              )}

              {article.pages && (
                <div>
                    <h3 className="text-sm font-semibold mb-1">{t('articles', 'pages')}</h3>
                  <p className="text-sm text-muted-foreground">{article.pages}</p>
                </div>
              )}
            </div>

            <Separator />

            {/* Identifiers */}
            <div className="flex flex-wrap gap-4">
              {article.doi && (
                <div>
                  <h3 className="text-sm font-semibold mb-1">DOI</h3>
                  <Button
                    variant="link"
                    className="h-auto p-0 text-sm"
                    onClick={() => window.open(`https://doi.org/${article.doi}`, "_blank")}
                  >
                    {article.doi}
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </Button>
                </div>
              )}

              {article.pmid && (
                <div>
                  <h3 className="text-sm font-semibold mb-1">PMID</h3>
                  <p className="text-sm text-muted-foreground">{article.pmid}</p>
                </div>
              )}

              {article.pmcid && (
                <div>
                  <h3 className="text-sm font-semibold mb-1">PMCID</h3>
                  <p className="text-sm text-muted-foreground">{article.pmcid}</p>
                </div>
              )}

              {article.journal_issn && (
                <div>
                  <h3 className="text-sm font-semibold mb-1">ISSN</h3>
                  <p className="text-sm text-muted-foreground">{article.journal_issn}</p>
                </div>
              )}
            </div>

            {/* Abstract */}
            {article.abstract && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-semibold mb-2">Resumo</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {article.abstract}
                  </p>
                </div>
              </>
            )}

            {/* Keywords */}
            {article.keywords && article.keywords.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-semibold mb-2">Palavras-chave</h3>
                  <div className="flex flex-wrap gap-2">
                    {article.keywords.map((keyword, idx) => (
                      <Badge key={idx} variant="outline">
                        {keyword}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Files */}
            <Separator />
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">
                  Arquivos {files.length > 0 && `(${files.length})`}
                </h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setUploadDialogOpen(true)}
                >
                  <Upload className="mr-2 h-4 w-4" />
                    {t('articles', 'addFile')}
                </Button>
              </div>

              {files.length > 0 ? (
                <div className="space-y-2">
                  {files.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {file.original_filename || "document.pdf"}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline" className="text-xs">
                              {getFileRoleLabel(file.file_role)}
                            </Badge>
                            <span>•</span>
                            <span>{file.file_type}</span>
                            {file.bytes && (
                              <>
                                <span>•</span>
                                <span>{formatFileSize(file.bytes)}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => viewPDF(file)}
                          title="Visualizar arquivo"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => downloadFile(file)}
                          title={t('articles', 'downloadFile')}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setFileToDelete(file);
                            setDeleteDialogOpen(true);
                          }}
                          title={t('articles', 'removeFile')}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 border rounded-lg border-dashed">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground mb-4">
                      {t('articles', 'noFilesLinked')}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setUploadDialogOpen(true)}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                      {t('articles', 'addFirstFile')}
                  </Button>
                </div>
              )}
            </div>

            {/* URL */}
            {article.url_landing && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-semibold mb-2">Link</h3>
                  <Button
                    variant="link"
                    className="h-auto p-0 text-sm"
                    onClick={() => window.open(article.url_landing!, "_blank")}
                  >
                    {article.url_landing}
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>

      {/* Upload Dialog */}
      {articleId && article && (
        <ArticleFileUploadDialogNew
          open={uploadDialogOpen}
          onOpenChange={setUploadDialogOpen}
          articleId={articleId}
          projectId={article.project_id}
          onFileUploaded={loadFiles}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
              <AlertDialogTitle>{t('articles', 'confirmRemove')}</AlertDialogTitle>
            <AlertDialogDescription>
                {t('articles', 'confirmRemoveFile')} "{fileToDelete?.original_filename}"? {t('articles', 'confirmRemoveDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>{t('common', 'cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteFile}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
                {deleting ? t('articles', 'removing') : t('articles', 'remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
