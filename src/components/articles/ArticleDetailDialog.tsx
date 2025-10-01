import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, ExternalLink, Download, Eye } from "lucide-react";

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
}

interface ArticleFile {
  id: string;
  file_type: string;
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
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

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
            {files.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-semibold mb-3">Arquivos</h3>
                  <div className="space-y-2">
                    {files.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">
                              {file.original_filename || "document.pdf"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {file.bytes ? `${(file.bytes / 1024 / 1024).toFixed(2)} MB` : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => viewPDF(file)}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            Visualizar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => downloadFile(file)}
                          >
                            <Download className="mr-2 h-4 w-4" />
                            Baixar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

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
    </Dialog>
  );
}