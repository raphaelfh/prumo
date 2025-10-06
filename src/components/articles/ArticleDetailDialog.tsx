import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, ExternalLink, Download, Eye, Upload, Trash2 } from "lucide-react";
import { ArticleFileUploadDialog } from "./ArticleFileUploadDialog";
import { formatFileSize } from "@/lib/file-validation";
import { FILE_ROLE_LABELS } from "@/lib/file-constants";
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
}

interface ArticleFile {
  id: string;
  file_type: string;   // Formato: PDF, DOC, etc.
  file_role?: string;  // Função: MAIN, SUPPLEMENT, etc.
  storage_key: string;
  original_filename: string | null;
  bytes: number | null;
}

interface ArticleDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  articleId: string | null;
}

export function ArticleDetailDialog({ open, onOpenChange, articleId }: ArticleDetailDialogProps) {
  const [article, setArticle] = useState<Article | null>(null);
  const [files, setFiles] = useState<ArticleFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<ArticleFile | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (articleId && open) {
      loadArticle();
      loadFiles();
    }
  }, [articleId, open]);

  const loadArticle = async () => {
    if (!articleId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("articles")
        .select("*")
        .eq("id", articleId)
        .single();

      if (error) throw error;
      setArticle(data);
    } catch (error: any) {
      console.error("Error loading article:", error);
      toast.error("Erro ao carregar artigo");
    } finally {
      setLoading(false);
    }
  };

  const loadFiles = async () => {
    if (!articleId) return;

    try {
      const { data, error } = await supabase
        .from("article_files")
        .select("*")
        .eq("article_id", articleId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setFiles(data || []);
    } catch (error: any) {
      console.error("Error loading files:", error);
    }
  };

  const downloadFile = async (file: ArticleFile) => {
    try {
      const { data, error } = await supabase.storage
        .from("articles")
        .download(file.storage_key);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.original_filename || "document.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error("Error downloading file:", error);
      toast.error("Erro ao baixar arquivo");
    }
  };

  const viewPDF = async (file: ArticleFile) => {
    try {
      // First try to download the file and open it
      const { data: fileData, error: downloadError } = await supabase.storage
        .from("articles")
        .download(file.storage_key);

      if (downloadError) {
        console.error("Error downloading file:", downloadError);
        throw downloadError;
      }

      // Create blob URL and open in new tab
      const blob = new Blob([fileData], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      
      // Clean up after a delay to allow the browser to load it
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error: any) {
      console.error("Error viewing PDF:", error);
      toast.error("Erro ao visualizar PDF. Tente fazer o download.");
    }
  };

  const handleDeleteFile = async () => {
    if (!fileToDelete) return;

    setDeleting(true);
    try {
      // Deletar arquivo do storage
      const { error: storageError } = await supabase.storage
        .from("articles")
        .remove([fileToDelete.storage_key]);

      if (storageError) {
        console.warn("Erro ao deletar arquivo do storage:", storageError);
      }

      // Deletar registro do banco
      const { error: dbError } = await supabase
        .from("article_files")
        .delete()
        .eq("id", fileToDelete.id);

      if (dbError) throw dbError;

      toast.success("Arquivo removido com sucesso!");
      loadFiles(); // Recarregar lista de arquivos
    } catch (error: any) {
      console.error("Error deleting file:", error);
      toast.error("Erro ao remover arquivo");
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
      setFileToDelete(null);
    }
  };

  const getFileRoleLabel = (fileRole: string | undefined): string => {
    if (!fileRole) return 'Não especificado';
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
                <h3 className="text-sm font-semibold mb-2">Autores</h3>
                <p className="text-sm text-muted-foreground">
                  {article.authors.join(", ")}
                </p>
              </div>
            )}

            {/* Journal Info */}
            <div className="flex flex-wrap gap-4">
              {article.journal_title && (
                <div>
                  <h3 className="text-sm font-semibold mb-1">Revista</h3>
                  <p className="text-sm text-muted-foreground italic">
                    {article.journal_title}
                  </p>
                </div>
              )}

              {article.publication_year && (
                <div>
                  <h3 className="text-sm font-semibold mb-1">Ano</h3>
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
                  <h3 className="text-sm font-semibold mb-1">Edição</h3>
                  <p className="text-sm text-muted-foreground">{article.issue}</p>
                </div>
              )}

              {article.pages && (
                <div>
                  <h3 className="text-sm font-semibold mb-1">Páginas</h3>
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
                  Adicionar Arquivo
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
                          title="Baixar arquivo"
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
                          title="Remover arquivo"
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
                    Nenhum arquivo vinculado a este artigo
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setUploadDialogOpen(true)}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Adicionar Primeiro Arquivo
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
        <ArticleFileUploadDialog
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
            <AlertDialogTitle>Confirmar Remoção</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover o arquivo "{fileToDelete?.original_filename}"?
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteFile}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Removendo..." : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}