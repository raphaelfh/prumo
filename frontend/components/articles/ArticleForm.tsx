/**
 * ArticleForm - Unified component for adding/editing articles
 * 
 * Sistema moderno com:
 * - Full screen instead of modal
 * - Step navigation with lateral submenus
 * - Component reuse for add/edit
 * - Interface responsiva e intuitiva
 */

import {useEffect, useState} from "react";
import {useNavigate} from "react-router-dom";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {Badge} from "@/components/ui/badge";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {cn} from "@/lib/utils";
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
import {supabase} from "@/integrations/supabase/client";
import {toast} from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Download,
  Eye,
  FileText,
  Hash,
  Loader2,
  Plus,
  Save,
  Tag,
  Trash2,
  Upload
} from "lucide-react";
import {useAuth} from "@/contexts/AuthContext";
import {ArticleFileUploadDialogNew} from './ArticleFileUploadDialogNew';
import {t} from '@/lib/copy';

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
  file_role: string;
  storage_key: string;
  original_filename: string | null;
  bytes: number | null;
}

interface ArticleFormProps {
  mode: 'add' | 'edit';
  projectId: string;
  articleId?: string;
  onComplete?: () => void;
}

type FormStep = 'basic' | 'publication' | 'identifiers' | 'additional' | 'files';

interface FormData {
  title: string;
  abstract: string;
  authors: string;
  publication_year: string;
  publication_month: string;
  publication_day: string;
  journal_title: string;
  journal_issn: string;
  journal_eissn: string;
  journal_publisher: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  pmid: string;
  pmcid: string;
  arxiv_id: string;
  pii: string;
  keywords: string;
  mesh_terms: string;
  url_landing: string;
  language: string;
  article_type: string;
  publication_status: string;
  study_design: string;
  conflicts_of_interest: string;
  data_availability: string;
  open_access: boolean;
  license: string;
}

const STEPS: { id: FormStep; label: string; icon: any; description: string }[] = [
  {
    id: 'basic',
      label: t('articles', 'basicInfo'),
    icon: FileText,
      description: t('articles', 'basicInfoDesc'),
  },
  {
    id: 'publication',
      label: t('articles', 'publication'),
    icon: BookOpen,
      description: t('articles', 'publicationDesc'),
  },
  {
    id: 'identifiers',
      label: t('articles', 'identifiersLabel'),
    icon: Hash,
      description: t('articles', 'identifiersDesc'),
  },
  {
    id: 'additional',
      label: t('articles', 'additionalInfo'),
    icon: Tag,
      description: t('articles', 'additionalInfoDesc'),
  },
  {
    id: 'files',
      label: t('articles', 'filesLabel'),
    icon: Upload,
      description: t('articles', 'filesDesc'),
  }
];

export function ArticleForm({ mode, projectId, articleId, onComplete }: ArticleFormProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  // Estado principal
  const [currentStep, setCurrentStep] = useState<FormStep>('basic');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [article, setArticle] = useState<Article | null>(null);
  const [files, setFiles] = useState<ArticleFile[]>([]);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<ArticleFile | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingFile, setDeletingFile] = useState(false);

    // State for validation errors
  const [validationErrors, setValidationErrors] = useState<{
    publication_year?: string;
    publication_month?: string;
    publication_day?: string;
  }>({});

    // Form
  const [formData, setFormData] = useState<FormData>({
    title: '',
    abstract: '',
    authors: '',
    publication_year: '',
    publication_month: '',
    publication_day: '',
    journal_title: '',
    journal_issn: '',
    journal_eissn: '',
    journal_publisher: '',
    volume: '',
    issue: '',
    pages: '',
    doi: '',
    pmid: '',
    pmcid: '',
    arxiv_id: '',
    pii: '',
    keywords: '',
    mesh_terms: '',
    url_landing: '',
    language: '',
    article_type: '',
    publication_status: '',
    study_design: '',
    conflicts_of_interest: '',
    data_availability: '',
    open_access: false,
    license: ''
  });

    // Load article data (edit mode)
  useEffect(() => {
    if (mode === 'edit' && articleId) {
      loadArticle();
      loadFiles();
    }
  }, [mode, articleId]);

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

        // Populate form
      setFormData({
        title: data.title || '',
        abstract: data.abstract || '',
        authors: data.authors?.join(', ') || '',
        publication_year: data.publication_year?.toString() || '',
        publication_month: data.publication_month?.toString() || '',
        publication_day: data.publication_day?.toString() || '',
        journal_title: data.journal_title || '',
        journal_issn: data.journal_issn || '',
        journal_eissn: data.journal_eissn || '',
        journal_publisher: data.journal_publisher || '',
        volume: data.volume || '',
        issue: data.issue || '',
        pages: data.pages || '',
        doi: data.doi || '',
        pmid: data.pmid || '',
        pmcid: data.pmcid || '',
        arxiv_id: data.arxiv_id || '',
        pii: data.pii || '',
        keywords: data.keywords?.join(', ') || '',
        mesh_terms: data.mesh_terms?.join(', ') || '',
        url_landing: data.url_landing || '',
        language: data.language || '',
        article_type: data.article_type || '',
        publication_status: data.publication_status || '',
        study_design: data.study_design || '',
        conflicts_of_interest: data.conflicts_of_interest || '',
        data_availability: data.data_availability || '',
        open_access: data.open_access || false,
        license: data.license || ''
      });
    } catch (error: any) {
      console.error("Error loading article:", error);
        toast.error(t('articles', 'errorLoadArticle'));
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

    // Date field validation
  const validateDateField = (field: 'publication_year' | 'publication_month' | 'publication_day', value: string): string | undefined => {
    if (!value || value.trim() === '') {
        // Empty field is valid (optional)
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
    } else if (field === 'publication_day') {
      if (num < 1 || num > 31) {
          error = t('articles', 'dayBetween');
      }
    } else if (field === 'publication_year') {
      if (num < 1600 || num > 2500) {
          error = t('articles', 'yearRange');
      }
    }

    setValidationErrors(prev => ({ ...prev, [field]: error }));
    return error;
  };

    // Handler for date field changes with validation
  const handleDateFieldChange = (field: 'publication_year' | 'publication_month' | 'publication_day', value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    validateDateField(field, value);
  };

  const handleSave = async () => {
    if (!formData.title.trim()) {
        toast.error(t('articles', 'titleRequiredToast'));
      setCurrentStep('basic');
      return;
    }

      // Validate all date fields before save
    const yearError = validateDateField('publication_year', formData.publication_year);
    const monthError = validateDateField('publication_month', formData.publication_month);
    const dayError = validateDateField('publication_day', formData.publication_day);

    if (yearError || monthError || dayError) {
        toast.error(t('articles', 'fixDateErrors'));
      setCurrentStep('publication');
      return;
    }

    setSaving(true);
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

      // Validar publication_day (deve estar entre 1-31)
      const parsedDay = parseDateValue(formData.publication_day);
      const validDay = parsedDay !== null && parsedDay >= 1 && parsedDay <= 31 ? parsedDay : null;

      // Validar publication_year (deve estar entre 1600-2500)
      const parsedYear = parseDateValue(formData.publication_year);
      const validYear = parsedYear !== null && parsedYear >= 1600 && parsedYear <= 2500 ? parsedYear : null;

      const articleData = {
        project_id: projectId,
        title: formData.title.trim(),
        abstract: formData.abstract.trim() || null,
        authors: formData.authors.trim() ? formData.authors.split(",").map(a => a.trim()) : null,
        publication_year: validYear,
        publication_month: validMonth,
        publication_day: validDay,
        journal_title: formData.journal_title.trim() || null,
        journal_issn: formData.journal_issn.trim() || null,
        journal_eissn: formData.journal_eissn.trim() || null,
        journal_publisher: formData.journal_publisher.trim() || null,
        volume: formData.volume.trim() || null,
        issue: formData.issue.trim() || null,
        pages: formData.pages.trim() || null,
        doi: formData.doi.trim() || null,
        pmid: formData.pmid.trim() || null,
        pmcid: formData.pmcid.trim() || null,
        arxiv_id: formData.arxiv_id.trim() || null,
        pii: formData.pii.trim() || null,
        keywords: formData.keywords.trim() ? formData.keywords.split(",").map(k => k.trim()) : null,
        mesh_terms: formData.mesh_terms.trim() ? formData.mesh_terms.split(",").map(m => m.trim()) : null,
        url_landing: formData.url_landing.trim() || null,
        language: formData.language.trim() || null,
        article_type: formData.article_type.trim() || null,
        publication_status: formData.publication_status.trim() || null,
        study_design: formData.study_design.trim() || null,
        conflicts_of_interest: formData.conflicts_of_interest.trim() || null,
        data_availability: formData.data_availability.trim() || null,
        open_access: formData.open_access,
        license: formData.license.trim() || null,
        ingestion_source: mode === 'add' ? "MANUAL" : undefined,
      };

      let result;
      if (mode === 'add') {
        const { data, error } = await supabase
          .from("articles")
          .insert([articleData])
          .select()
          .single();
        
        if (error) throw error;
        result = data;
      } else {
        const { data, error } = await supabase
          .from("articles")
          .update(articleData)
          .eq("id", articleId)
          .select()
          .single();
        
        if (error) throw error;
        result = data;
      }

        toast.success(mode === 'add' ? t('articles', 'articleCreatedSuccess') : t('articles', 'articleUpdatedSuccess'));
      
      if (mode === 'add') {
          // Navigate back to project article list
        navigate(`/projects/${projectId}?tab=articles`);
      } else {
        onComplete?.();
      }
    } catch (error: any) {
      console.error("Error saving article:", error);
        const errorMessage = error?.message || error?.details || (mode === 'add' ? t('articles', 'errorCreateArticle') : t('articles', 'errorUpdateArticle'));
        toast.error(`${mode === 'add' ? t('articles', 'errorCreateArticle') : t('articles', 'errorUpdateArticle')}: ${errorMessage}`);
    } finally {
      setSaving(false);
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
        toast.error(t('articles', 'errorDownloadFile'));
    }
  };

  const handleDeleteFile = async () => {
    if (!fileToDelete) return;

    setDeletingFile(true);
    try {
        // Delete file from storage
      const { error: storageError } = await supabase.storage
        .from("articles")
        .remove([fileToDelete.storage_key]);

      if (storageError) {
          console.warn('Error deleting file from storage:', storageError);
      }

        // Delete record from DB
      const { error: dbError } = await supabase
        .from("article_files")
        .delete()
        .eq("id", fileToDelete.id);

      if (dbError) throw dbError;

        toast.success(t('articles', 'fileRemovedSuccess'));
        loadFiles(); // Reload file list
      setDeleteDialogOpen(false);
      setFileToDelete(null);
    } catch (error: any) {
      console.error("Error deleting file:", error);
        toast.error(t('articles', 'errorRemoveFile'));
    } finally {
      setDeletingFile(false);
    }
  };

  const openDeleteDialog = (file: ArticleFile) => {
    setFileToDelete(file);
    setDeleteDialogOpen(true);
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
        toast.error(t('articles', 'errorViewPdf'));
    }
  };

  const isStepValid = (step: FormStep): boolean => {
    switch (step) {
      case 'basic':
        return !!formData.title.trim();
      case 'publication':
        return true; // Opcional
      case 'identifiers':
        return true; // Opcional
      case 'additional':
        return true; // Opcional
      case 'files':
        return true; // Opcional
      default:
        return true;
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 'basic':
        return (
          <Card>
            <CardHeader>
                <CardTitle>{t('articles', 'basicInfo')}</CardTitle>
              <CardDescription>
                  {t('articles', 'titleAbstractAuthors')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                  <Label htmlFor="title">{t('articles', 'titleRequired')}</Label>
                <Textarea
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder={t('articles', 'titlePlaceholder')}
                  className="min-h-[100px]"
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
                  rows={6}
                />
              </div>

              <div>
                  <Label htmlFor="authors">{t('articles', 'authors')}</Label>
                <Input
                  id="authors"
                  value={formData.authors}
                  onChange={(e) => setFormData({ ...formData, authors: e.target.value })}
                  placeholder={t('articles', 'authorsPlaceholderComma')}
                />
              </div>
            </CardContent>
          </Card>
        );

      case 'publication':
        return (
          <Card>
            <CardHeader>
                <CardTitle>{t('articles', 'publicationDetails')}</CardTitle>
              <CardDescription>
                  {t('articles', 'publicationDetailsDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                  <Label htmlFor="journal_title">{t('articles', 'journalTitle')}</Label>
                <Input
                  id="journal_title"
                  value={formData.journal_title}
                  onChange={(e) => setFormData({ ...formData, journal_title: e.target.value })}
                  placeholder={t('articles', 'journalPlaceholder')}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                    <Label htmlFor="publication_year">{t('articles', 'publicationYear')}</Label>
                  <Input
                    id="publication_year"
                    type="number"
                    value={formData.publication_year}
                    onChange={(e) => handleDateFieldChange('publication_year', e.target.value)}
                    onBlur={(e) => validateDateField('publication_year', e.target.value)}
                    placeholder="2024"
                    min="1600"
                    max="2500"
                    className={validationErrors.publication_year ? "border-destructive" : ""}
                  />
                  {validationErrors.publication_year && (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
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
                    onChange={(e) => handleDateFieldChange('publication_month', e.target.value)}
                    onBlur={(e) => validateDateField('publication_month', e.target.value)}
                    placeholder="1-12"
                    min="1"
                    max="12"
                    className={validationErrors.publication_month ? "border-destructive" : ""}
                  />
                  {validationErrors.publication_month && (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {validationErrors.publication_month}
                    </p>
                  )}
                </div>
              </div>
              
              <div>
                  <Label htmlFor="publication_day">{t('articles', 'publicationDay')}</Label>
                <Input
                  id="publication_day"
                  type="number"
                  value={formData.publication_day}
                  onChange={(e) => handleDateFieldChange('publication_day', e.target.value)}
                  onBlur={(e) => validateDateField('publication_day', e.target.value)}
                  placeholder="1-31"
                  min="1"
                  max="31"
                  className={validationErrors.publication_day ? "border-destructive" : ""}
                />
                {validationErrors.publication_day && (
                  <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {validationErrors.publication_day}
                  </p>
                )}
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
            </CardContent>
          </Card>
        );

      case 'identifiers':
        return (
          <Card>
            <CardHeader>
                <CardTitle>{t('articles', 'identifiersLabel')}</CardTitle>
              <CardDescription>
                  {t('articles', 'identifiersDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label htmlFor="doi">DOI</Label>
                <Input
                  id="doi"
                  value={formData.doi}
                  onChange={(e) => setFormData({ ...formData, doi: e.target.value })}
                  placeholder="10.xxxx/xxxxx"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="arxiv_id">arXiv ID</Label>
                  <Input
                    id="arxiv_id"
                    value={formData.arxiv_id}
                    onChange={(e) => setFormData({ ...formData, arxiv_id: e.target.value })}
                    placeholder="arXiv:1234.5678"
                  />
                </div>
                <div>
                  <Label htmlFor="pii">PII</Label>
                  <Input
                    id="pii"
                    value={formData.pii}
                    onChange={(e) => setFormData({ ...formData, pii: e.target.value })}
                    placeholder="Publisher Item Identifier"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        );

      case 'additional':
        return (
          <Card>
            <CardHeader>
                <CardTitle>{t('articles', 'additionalInfo')}</CardTitle>
              <CardDescription>
                  {t('articles', 'keywordsAndMetadata')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                  <Label htmlFor="keywords">{t('articles', 'keywordsLabel')}</Label>
                <Input
                  id="keywords"
                  value={formData.keywords}
                  onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
                  placeholder={t('articles', 'keywordsPlaceholder')}
                />
              </div>

              <div>
                <Label htmlFor="mesh_terms">Termos MeSH</Label>
                <Input
                  id="mesh_terms"
                  value={formData.mesh_terms}
                  onChange={(e) => setFormData({ ...formData, mesh_terms: e.target.value })}
                  placeholder={t('articles', 'meshPlaceholder')}
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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="language">Idioma</Label>
                  <Input
                    id="language"
                    value={formData.language}
                    onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                    placeholder={t('articles', 'languagePlaceholder')}
                  />
                </div>
                <div>
                  <Label htmlFor="article_type">Tipo de Artigo</Label>
                  <Input
                    id="article_type"
                    value={formData.article_type}
                    onChange={(e) => setFormData({ ...formData, article_type: e.target.value })}
                    placeholder={t('articles', 'typePlaceholder')}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        );

      case 'files':
        return (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                    <CardTitle>{t('articles', 'articleFiles')}</CardTitle>
                  <CardDescription>
                      {t('articles', 'articleFilesDesc')}
                  </CardDescription>
                </div>
                <Button
                  onClick={() => setShowFileUpload(true)}
                  disabled={mode === 'add'}
                >
                  <Plus className="mr-2 h-4 w-4" />
                    {t('articles', 'addFiles')}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {mode === 'add' ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                      Save the article first to add files.
                  </AlertDescription>
                </Alert>
              ) : files.length > 0 ? (
                <div className="space-y-3">
                  {files.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">
                            {file.original_filename || "document.pdf"}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">
                              {file.file_role}
                            </Badge>
                            {file.bytes && (
                              <span className="text-xs text-muted-foreground">
                                {(file.bytes / 1024 / 1024).toFixed(2)} MB
                              </span>
                            )}
                          </div>
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
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openDeleteDialog(file)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                            {t('articles', 'delete')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Upload className="mx-auto h-12 w-12 mb-4 opacity-50" />
                    <p>{t('articles', 'noFilesAddedYet')}</p>
                    <p className="text-sm">{t('articles', 'addFilesHint')}</p>
                </div>
              )}
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3 text-muted-foreground"/>
            <p className="text-[13px] text-muted-foreground">{t('articles', 'loadingArticle')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border/40 bg-background/80 backdrop-blur-md">
          <div className="flex h-12 items-center gap-4 px-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            aria-label="Voltar"
          >
            <ArrowLeft className="h-4 w-4 mr-2"/>
            Voltar
          </Button>

              <div className="h-4 w-px bg-border/40"/>

              <h1 className="text-[13px] font-medium tracking-tight flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0"/>
                  {mode === 'add' ? t('articles', 'addArticle') : t('articles', 'editArticle')}
            {article && (
                <>
                  <span className="text-muted-foreground font-normal">·</span>
                  <span
                      className="text-muted-foreground font-normal text-[13px] truncate max-w-xs">{article.title}</span>
                </>
            )}
          </h1>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-[12px]"
              onClick={() => navigate(-1)}
            >
                {t('common', 'cancel')}
            </Button>
            <Button
                size="sm"
                className="h-8 px-3 text-[12px] font-medium"
              onClick={handleSave}
              disabled={saving || !isStepValid('basic')}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin"/>
                    {t('articles', 'saving')}
                </>
              ) : (
                <>
                  <Save className="mr-1.5 h-3.5 w-3.5"/>
                    {mode === 'add' ? t('articles', 'createArticle') : t('common', 'save')}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
          {/* Navigation sidebar */}
        <div className="w-60 border-r bg-muted/30 flex-shrink-0 py-4 px-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-2">
              Form
          </p>
            <nav role="tablist" aria-label={t('articles', 'formStepsAria')} className="space-y-0.5">
            {STEPS.map((step) => {
              const Icon = step.icon;
              const isActive = step.id === currentStep;

              return (
                  <button
                      key={step.id}
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setCurrentStep(step.id)}
                      className={cn(
                          'w-full flex items-start gap-3 px-3 py-2.5 rounded-md text-left transition-colors',
                          isActive ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                      )}
                  >
                    <Icon
                        className={cn('h-4 w-4 mt-0.5 flex-shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')}/>
                    <div className="min-w-0">
                      <p className={cn('text-sm', isActive ? 'font-medium' : 'font-normal')}>{step.label}</p>
                      <p className="text-xs text-muted-foreground leading-snug mt-0.5 truncate">{step.description}</p>
                    </div>
                    {isActive && step.id === 'basic' && !isStepValid('basic') && (
                        <AlertCircle className="h-3.5 w-3.5 text-warning mt-0.5 ml-auto flex-shrink-0"/>
                    )}
                  </button>
              );
            })}
          </nav>
        </div>

          {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-8">
            <div className="max-w-2xl">
              {renderStepContent()}
            </div>
          </div>
        </div>
      </div>

        {/* File upload modal */}
      {showFileUpload && articleId && (
        <ArticleFileUploadDialogNew
          open={showFileUpload}
          onOpenChange={setShowFileUpload}
          articleId={articleId}
          projectId={projectId}
          onFileUploaded={() => {
            loadFiles();
            setShowFileUpload(false);
          }}
        />
      )}

        {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
              <AlertDialogTitle>{t('articles', 'confirmRemove')}</AlertDialogTitle>
            <AlertDialogDescription>
                {t('articles', 'confirmRemoveFile')} &quot;{fileToDelete?.original_filename}&quot;? {t('articles', 'confirmRemoveDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
              <AlertDialogCancel disabled={deletingFile}>{t('common', 'cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteFile}
              disabled={deletingFile}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
                {deletingFile ? t('articles', 'removing') : t('articles', 'remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

