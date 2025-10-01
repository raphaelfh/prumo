import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload } from "lucide-react";

interface AddArticleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onArticleAdded: () => void;
}

export function AddArticleDialog({ open, onOpenChange, projectId, onArticleAdded }: AddArticleDialogProps) {
  const [loading, setLoading] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    abstract: "",
    authors: "",
    publication_year: "",
    publication_month: "",
    journal_title: "",
    journal_issn: "",
    volume: "",
    issue: "",
    pages: "",
    doi: "",
    pmid: "",
    pmcid: "",
    keywords: "",
    url_landing: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      toast.error("O título é obrigatório");
      return;
    }

    setLoading(true);
    try {
      // Insert article
      const articleData = {
        project_id: projectId,
        title: formData.title.trim(),
        abstract: formData.abstract.trim() || null,
        authors: formData.authors.trim() ? formData.authors.split(",").map(a => a.trim()) : null,
        publication_year: formData.publication_year ? parseInt(formData.publication_year) : null,
        publication_month: formData.publication_month ? parseInt(formData.publication_month) : null,
        journal_title: formData.journal_title.trim() || null,
        journal_issn: formData.journal_issn.trim() || null,
        volume: formData.volume.trim() || null,
        issue: formData.issue.trim() || null,
        pages: formData.pages.trim() || null,
        doi: formData.doi.trim() || null,
        pmid: formData.pmid.trim() || null,
        pmcid: formData.pmcid.trim() || null,
        keywords: formData.keywords.trim() ? formData.keywords.split(",").map(k => k.trim()) : null,
        url_landing: formData.url_landing.trim() || null,
        ingestion_source: "MANUAL",
      };

      const { data: article, error: articleError } = await supabase
        .from("articles")
        .insert([articleData])
        .select()
        .single();

      if (articleError) throw articleError;

      // Upload PDF if provided
      if (pdfFile && article) {
        const fileExt = pdfFile.name.split('.').pop();
        const fileName = `${projectId}/${article.id}/${Date.now()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from("articles")
          .upload(fileName, pdfFile);

        if (uploadError) throw uploadError;

        // Create article_files record
        await supabase.from("article_files").insert([{
          project_id: projectId,
          article_id: article.id,
          file_type: "PDF",
          storage_key: fileName,
          original_filename: pdfFile.name,
          bytes: pdfFile.size,
        }]);
      }

      toast.success("Artigo adicionado com sucesso!");
      onArticleAdded();
      onOpenChange(false);
      resetForm();
    } catch (error: any) {
      console.error("Error adding article:", error);
      toast.error(error.message || "Erro ao adicionar artigo");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      title: "",
      abstract: "",
      authors: "",
      publication_year: "",
      publication_month: "",
      journal_title: "",
      journal_issn: "",
      volume: "",
      issue: "",
      pages: "",
      doi: "",
      pmid: "",
      pmcid: "",
      keywords: "",
      url_landing: "",
    });
    setPdfFile(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar Artigo</DialogTitle>
          <DialogDescription>
            Preencha as informações bibliográficas do artigo
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Required Fields */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="title">Título *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Título do artigo"
                required
              />
            </div>

            <div>
              <Label htmlFor="abstract">Resumo</Label>
              <Textarea
                id="abstract"
                value={formData.abstract}
                onChange={(e) => setFormData({ ...formData, abstract: e.target.value })}
                placeholder="Resumo ou abstract do artigo"
                rows={4}
              />
            </div>

            <div>
              <Label htmlFor="authors">Autores (separados por vírgula)</Label>
              <Input
                id="authors"
                value={formData.authors}
                onChange={(e) => setFormData({ ...formData, authors: e.target.value })}
                placeholder="Silva A, Santos B, Oliveira C"
              />
            </div>
          </div>

          {/* Publication Details */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="publication_year">Ano de Publicação</Label>
              <Input
                id="publication_year"
                type="number"
                value={formData.publication_year}
                onChange={(e) => setFormData({ ...formData, publication_year: e.target.value })}
                placeholder="2024"
                min="1600"
                max="2500"
              />
            </div>
            <div>
              <Label htmlFor="publication_month">Mês de Publicação</Label>
              <Input
                id="publication_month"
                type="number"
                value={formData.publication_month}
                onChange={(e) => setFormData({ ...formData, publication_month: e.target.value })}
                placeholder="1-12"
                min="1"
                max="12"
              />
            </div>
          </div>

          {/* Journal Details */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="journal_title">Revista/Jornal</Label>
              <Input
                id="journal_title"
                value={formData.journal_title}
                onChange={(e) => setFormData({ ...formData, journal_title: e.target.value })}
                placeholder="Nome da revista científica"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="volume">Volume</Label>
                <Input
                  id="volume"
                  value={formData.volume}
                  onChange={(e) => setFormData({ ...formData, volume: e.target.value })}
                  placeholder="12"
                />
              </div>
              <div>
                <Label htmlFor="issue">Edição</Label>
                <Input
                  id="issue"
                  value={formData.issue}
                  onChange={(e) => setFormData({ ...formData, issue: e.target.value })}
                  placeholder="3"
                />
              </div>
              <div>
                <Label htmlFor="pages">Páginas</Label>
                <Input
                  id="pages"
                  value={formData.pages}
                  onChange={(e) => setFormData({ ...formData, pages: e.target.value })}
                  placeholder="123-145"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="journal_issn">ISSN</Label>
              <Input
                id="journal_issn"
                value={formData.journal_issn}
                onChange={(e) => setFormData({ ...formData, journal_issn: e.target.value })}
                placeholder="1234-5678"
              />
            </div>
          </div>

          {/* Identifiers */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="doi">DOI</Label>
              <Input
                id="doi"
                value={formData.doi}
                onChange={(e) => setFormData({ ...formData, doi: e.target.value })}
                placeholder="10.xxxx/xxxxx"
              />
            </div>
            <div>
              <Label htmlFor="pmid">PMID</Label>
              <Input
                id="pmid"
                value={formData.pmid}
                onChange={(e) => setFormData({ ...formData, pmid: e.target.value })}
                placeholder="PubMed ID"
              />
            </div>
            <div>
              <Label htmlFor="pmcid">PMCID</Label>
              <Input
                id="pmcid"
                value={formData.pmcid}
                onChange={(e) => setFormData({ ...formData, pmcid: e.target.value })}
                placeholder="PMC ID"
              />
            </div>
          </div>

          {/* Additional Fields */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="keywords">Palavras-chave (separadas por vírgula)</Label>
              <Input
                id="keywords"
                value={formData.keywords}
                onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
                placeholder="revisão sistemática, meta-análise, saúde"
              />
            </div>

            <div>
              <Label htmlFor="url_landing">URL do Artigo</Label>
              <Input
                id="url_landing"
                type="url"
                value={formData.url_landing}
                onChange={(e) => setFormData({ ...formData, url_landing: e.target.value })}
                placeholder="https://..."
              />
            </div>
          </div>

          {/* PDF Upload */}
          <div>
            <Label htmlFor="pdf">Upload PDF (opcional)</Label>
            <div className="mt-2">
              <Input
                id="pdf"
                type="file"
                accept="application/pdf"
                onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
              />
              {pdfFile && (
                <p className="mt-2 text-sm text-muted-foreground">
                  <Upload className="inline h-4 w-4 mr-1" />
                  {pdfFile.name} ({(pdfFile.size / 1024 / 1024).toFixed(2)} MB)
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Salvando..." : "Adicionar Artigo"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}