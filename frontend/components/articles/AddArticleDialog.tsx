import {useState} from "react";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {supabase} from "@/integrations/supabase/client";
import {toast} from "sonner";
import {Upload} from "lucide-react";
import {t} from "@/lib/copy";
import {FILE_ROLES} from "@/lib/file-constants";
import {detectFileFormat, validateFile} from "@/lib/file-validation";

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
  
  // Estado para erros de validação
  const [validationErrors, setValidationErrors] = useState<{
    publication_year?: string;
    publication_month?: string;
  }>({});

    // Date field validation
  const validateDateField = (field: 'publication_year' | 'publication_month', value: string): string | undefined => {
      if (!value || value.trim() === '') {
        setValidationErrors(prev => ({ ...prev, [field]: undefined }));
        return undefined;
      }

      const num = parseInt(value.trim(), 10);
      if (isNaN(num)) {
          const error = t('articles', 'validNumber');
        setValidationErrors(prev => ({ ...prev, [field]: error }));
        return error;
      }

      let error: string | undefined;
      if (field === 'publication_month') {
        if (num < 1 || num > 12) {
            error = t('articles', 'monthBetween');
        }
      } else if (field === 'publication_year') {
        if (num < 1600 || num > 2500) {
            error = t('articles', 'yearRange');
        }
      }

      setValidationErrors(prev => ({ ...prev, [field]: error }));
      return error;
    };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) {
        toast.error(t('articles', 'titleRequiredToast'));
      return;
    }

    // Validar todos os campos antes de salvar
    const yearError = validateDateField('publication_year', formData.publication_year);
    const monthError = validateDateField('publication_month', formData.publication_month);

    if (yearError || monthError) {
        toast.error(t('articles', 'fixDateErrors'));
      return;
    }

    setLoading(true);
    try {
        // Helper to validate and convert numeric date values
      const parseDateValue = (value: string | undefined): number | null => {
        if (!value || value.trim() === '') return null;
        const num = parseInt(value.trim(), 10);
        if (isNaN(num)) return null;
        return num;
      };

      // Validar publication_month (deve estar entre 1-12)
      const parsedMonth = parseDateValue(formData.publication_month);
      const validMonth = parsedMonth !== null && parsedMonth >= 1 && parsedMonth <= 12 ? parsedMonth : null;

      // Validar publication_year (deve estar entre 1600-2500)
      const parsedYear = parseDateValue(formData.publication_year);
      const validYear = parsedYear !== null && parsedYear >= 1600 && parsedYear <= 2500 ? parsedYear : null;

      // Insert article
      const articleData = {
        project_id: projectId,
        title: formData.title.trim(),
        abstract: formData.abstract.trim() || null,
        authors: formData.authors.trim() ? formData.authors.split(",").map(a => a.trim()) : null,
        publication_year: validYear,
        publication_month: validMonth,
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
          // Validate file before upload
        const validation = validateFile(pdfFile);
        if (!validation.valid) {
            toast.error(validation.error || t('articles', 'invalidFile'));
          return;
        }

        const fileExt = pdfFile.name.split('.').pop();
        const fileName = `${projectId}/${article.id}/${Date.now()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from("articles")
          .upload(fileName, pdfFile);

        if (uploadError) {
          // Rollback: deletar artigo criado
          await supabase.from("articles").delete().eq("id", article.id);
            throw new Error(t('articles', 'errorUploadFile') + ': ' + uploadError.message);
        }

        // Detectar formato do arquivo automaticamente
        const detectedFormat = detectFileFormat(pdfFile);

        // Create article_files record
        const { error: insertError } = await supabase.from("article_files").insert([{
          project_id: projectId,
          article_id: article.id,
          file_type: detectedFormat,         // Formato detectado automaticamente
          file_role: FILE_ROLES.MAIN,         // Arquivo principal
          storage_key: fileName,
          original_filename: pdfFile.name,
          bytes: pdfFile.size,
        }]);

        if (insertError) {
          // Rollback: deletar arquivo do storage e artigo
          await supabase.storage.from("articles").remove([fileName]);
          await supabase.from("articles").delete().eq("id", article.id);
            throw new Error(t('articles', 'errorRegisterFile') + ': ' + insertError.message);
        }
      }

      toast.success("Artigo adicionado com sucesso!");
      onArticleAdded();
      onOpenChange(false);
      resetForm();
    } catch (error: any) {
      console.error("Error adding article:", error);
        toast.error(error.message || t('articles', 'errorAddArticle'));
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
            <DialogTitle>{t('articles', 'addArticle')}</DialogTitle>
          <DialogDescription>
              {t('articles', 'addArticleDesc')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Required Fields */}
          <div className="space-y-4">
            <div>
                <Label htmlFor="title">{t('articles', 'titleRequired')}</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder={t('articles', 'titlePlaceholder')}
                required
              />
            </div>

            <div>
                <Label htmlFor="abstract">{t('articles', 'abstract')}</Label>
              <Textarea
                id="abstract"
                value={formData.abstract}
                onChange={(e) => setFormData({ ...formData, abstract: e.target.value })}
                placeholder={t('articles', 'abstractPlaceholder')}
                rows={4}
              />
            </div>

            <div>
                <Label htmlFor="authors">{t('articles', 'authors')}</Label>
              <Input
                id="authors"
                value={formData.authors}
                onChange={(e) => setFormData({ ...formData, authors: e.target.value })}
                placeholder={t('articles', 'authorsPlaceholder')}
              />
            </div>
          </div>

          {/* Publication Details */}
          <div className="grid grid-cols-2 gap-4">
            <div>
                <Label htmlFor="publication_year">{t('articles', 'publicationYear')}</Label>
              <Input
                id="publication_year"
                type="number"
                value={formData.publication_year}
                onChange={(e) => {
                  setFormData({ ...formData, publication_year: e.target.value });
                  validateDateField('publication_year', e.target.value);
                }}
                onBlur={(e) => validateDateField('publication_year', e.target.value)}
                placeholder="2024"
                min="1600"
                max="2500"
                className={validationErrors.publication_year ? "border-destructive" : ""}
              />
              {validationErrors.publication_year && (
                <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                  {validationErrors.publication_year}
                </p>
              )}
            </div>
            <div>
                <Label htmlFor="publication_month">{t('articles', 'publicationMonth')}</Label>
              <Input
                id="publication_month"
                type="number"
                value={formData.publication_month}
                onChange={(e) => {
                  setFormData({ ...formData, publication_month: e.target.value });
                  validateDateField('publication_month', e.target.value);
                }}
                onBlur={(e) => validateDateField('publication_month', e.target.value)}
                placeholder="1-12"
                min="1"
                max="12"
                className={validationErrors.publication_month ? "border-destructive" : ""}
              />
              {validationErrors.publication_month && (
                <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                  {validationErrors.publication_month}
                </p>
              )}
            </div>
          </div>

          {/* Journal Details */}
          <div className="space-y-4">
            <div>
                <Label htmlFor="journal_title">{t('articles', 'journalTitle')}</Label>
              <Input
                id="journal_title"
                value={formData.journal_title}
                onChange={(e) => setFormData({ ...formData, journal_title: e.target.value })}
                placeholder={t('articles', 'journalPlaceholder')}
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
                  <Label htmlFor="issue">{t('articles', 'edition')}</Label>
                <Input
                  id="issue"
                  value={formData.issue}
                  onChange={(e) => setFormData({ ...formData, issue: e.target.value })}
                  placeholder="3"
                />
              </div>
              <div>
                  <Label htmlFor="pages">{t('articles', 'pages')}</Label>
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
                <Label htmlFor="keywords">{t('articles', 'keywords')}</Label>
              <Input
                id="keywords"
                value={formData.keywords}
                onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
                placeholder={t('articles', 'keywordsPlaceholder')}
              />
            </div>

            <div>
                <Label htmlFor="url_landing">{t('articles', 'articleUrl')}</Label>
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
              <Label htmlFor="pdf">{t('articles', 'uploadPdfOptional')}</Label>
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
                {t('common', 'cancel')}
            </Button>
            <Button type="submit" disabled={loading}>
                {loading ? t('articles', 'saving') : t('articles', 'addArticle')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}