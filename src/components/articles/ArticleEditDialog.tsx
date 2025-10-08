import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, ExternalLink, Download, Eye, Save, X } from "lucide-react";

interface Article {
  id: string;
  title: string;
  abstract: string | null;
  authors: string[] | null;
  publication_year: number | null;
  publication_month: number | null;
  publication_day: number | null;
  journal_title: string | null;
  journal_issn: string | null;
  journal_eissn: string | null;
  journal_publisher: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  keywords: string[] | null;
  url_landing: string | null;
  url_pdf: string | null;
  language: string | null;
  article_type: string | null;
  publication_status: string | null;
  open_access: boolean | null;
  license: string | null;
  arxiv_id: string | null;
  pii: string | null;
  mesh_terms: string[] | null;
  study_design: string | null;
  conflicts_of_interest: string | null;
  data_availability: string | null;
}

interface ArticleFile {
  id: string;
  file_type: string;
  storage_key: string;
  original_filename: string | null;
  bytes: number | null;
}

interface ArticleEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  articleId: string | null;
  onArticleUpdated?: () => void;
}

export function ArticleEditDialog({ open, onOpenChange, articleId, onArticleUpdated }: ArticleEditDialogProps) {
  const [article, setArticle] = useState<Article | null>(null);
  const [files, setFiles] = useState<ArticleFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  
  // Form fields
  const [formData, setFormData] = useState<Partial<Article>>({});
  const [keywordsInput, setKeywordsInput] = useState("");
  const [authorsInput, setAuthorsInput] = useState("");
  const [meshTermsInput, setMeshTermsInput] = useState("");

  useEffect(() => {
    if (articleId && open) {
      loadArticle();
      loadFiles();
    }
  }, [articleId, open]);

  useEffect(() => {
    if (article) {
      setFormData(article);
      setKeywordsInput(article.keywords?.join(", ") || "");
      setAuthorsInput(article.authors?.join(", ") || "");
      setMeshTermsInput(article.mesh_terms?.join(", ") || "");
    }
  }, [article]);

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

  const handleSave = async () => {
    if (!articleId) return;

    setSaving(true);
    try {
      // Process arrays
      const processedData = {
        ...formData,
        keywords: keywordsInput ? keywordsInput.split(",").map(k => k.trim()).filter(Boolean) : null,
        authors: authorsInput ? authorsInput.split(",").map(a => a.trim()).filter(Boolean) : null,
        mesh_terms: meshTermsInput ? meshTermsInput.split(",").map(m => m.trim()).filter(Boolean) : null,
      };

      const { error } = await supabase
        .from("articles")
        .update(processedData)
        .eq("id", articleId);

      if (error) throw error;

      toast.success("Artigo atualizado com sucesso!");
      setEditing(false);
      onArticleUpdated?.();
      loadArticle(); // Reload to get updated data
    } catch (error: any) {
      console.error("Error updating article:", error);
      toast.error("Erro ao atualizar artigo");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (article) {
      setFormData(article);
      setKeywordsInput(article.keywords?.join(", ") || "");
      setAuthorsInput(article.authors?.join(", ") || "");
      setMeshTermsInput(article.mesh_terms?.join(", ") || "");
    }
    setEditing(false);
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
      const { data: fileData, error: downloadError } = await supabase.storage
        .from("articles")
        .download(file.storage_key);

      if (downloadError) {
        console.error("Error downloading file:", downloadError);
        throw downloadError;
      }

      const blob = new Blob([fileData], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error: any) {
      console.error("Error viewing PDF:", error);
      toast.error("Erro ao visualizar PDF. Tente fazer o download.");
    }
  };

  if (!article) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl leading-tight pr-8">
              {editing ? "Editar Artigo" : article.title}
            </DialogTitle>
            <div className="flex gap-2">
              {editing ? (
                <>
                  <Button variant="outline" size="sm" onClick={handleCancel}>
                    <X className="mr-2 h-4 w-4" />
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saving}>
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? "Salvando..." : "Salvar"}
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => setEditing(true)}>
                  Editar
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Basic Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="title">Título *</Label>
              {editing ? (
                <Textarea
                  id="title"
                  value={formData.title || ""}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="min-h-[100px]"
                />
              ) : (
                <p className="text-sm text-muted-foreground">{article.title}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="abstract">Resumo</Label>
              {editing ? (
                <Textarea
                  id="abstract"
                  value={formData.abstract || ""}
                  onChange={(e) => setFormData({ ...formData, abstract: e.target.value })}
                  className="min-h-[100px]"
                />
              ) : (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {article.abstract || "Não informado"}
                </p>
              )}
            </div>
          </div>

          {/* Authors */}
          <div className="space-y-2">
            <Label htmlFor="authors">Autores</Label>
            {editing ? (
              <Input
                id="authors"
                value={authorsInput}
                onChange={(e) => setAuthorsInput(e.target.value)}
                placeholder="Separe os autores por vírgula"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {article.authors?.join(", ") || "Não informado"}
              </p>
            )}
          </div>

          {/* Publication Details */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="journal_title">Revista</Label>
              {editing ? (
                <Input
                  id="journal_title"
                  value={formData.journal_title || ""}
                  onChange={(e) => setFormData({ ...formData, journal_title: e.target.value })}
                />
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  {article.journal_title || "Não informado"}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="publication_year">Ano</Label>
              {editing ? (
                <Input
                  id="publication_year"
                  type="number"
                  value={formData.publication_year || ""}
                  onChange={(e) => setFormData({ ...formData, publication_year: e.target.value ? parseInt(e.target.value) : null })}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {article.publication_year || "Não informado"}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="volume">Volume</Label>
              {editing ? (
                <Input
                  id="volume"
                  value={formData.volume || ""}
                  onChange={(e) => setFormData({ ...formData, volume: e.target.value })}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {article.volume || "Não informado"}
                </p>
              )}
            </div>
          </div>

          {/* Identifiers */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="doi">DOI</Label>
              {editing ? (
                <Input
                  id="doi"
                  value={formData.doi || ""}
                  onChange={(e) => setFormData({ ...formData, doi: e.target.value })}
                />
              ) : (
                <div className="flex items-center gap-2">
                  {article.doi ? (
                    <Button
                      variant="link"
                      className="h-auto p-0 text-sm"
                      onClick={() => window.open(`https://doi.org/${article.doi}`, "_blank")}
                    >
                      {article.doi}
                      <ExternalLink className="ml-1 h-3 w-3" />
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">Não informado</p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="pmid">PMID</Label>
              {editing ? (
                <Input
                  id="pmid"
                  value={formData.pmid || ""}
                  onChange={(e) => setFormData({ ...formData, pmid: e.target.value })}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {article.pmid || "Não informado"}
                </p>
              )}
            </div>
          </div>

          {/* Keywords */}
          <div className="space-y-2">
            <Label htmlFor="keywords">Palavras-chave</Label>
            {editing ? (
              <Input
                id="keywords"
                value={keywordsInput}
                onChange={(e) => setKeywordsInput(e.target.value)}
                placeholder="Separe as palavras-chave por vírgula"
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                {article.keywords && article.keywords.length > 0 ? (
                  article.keywords.map((keyword, idx) => (
                    <Badge key={idx} variant="outline">
                      {keyword}
                    </Badge>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">Não informado</p>
                )}
              </div>
            )}
          </div>

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
      </DialogContent>
    </Dialog>
  );
}
