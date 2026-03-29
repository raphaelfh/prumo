/**
 * ArticleForm — add/edit article with settings-style cards, continuous scroll in the main column,
 * and a section nav that syncs with scroll (IntersectionObserver). Use variant "panel" inside a Sheet.
 */

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {Badge} from "@/components/ui/badge";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Switch} from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
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
import {ArticleAuthorsField} from './ArticleAuthorsField';
import {ArticleKeywordsField} from './ArticleKeywordsField';
import {PageHeader} from '@/components/patterns/PageHeader';
import {SettingsCard, SettingsField, SettingsSection} from '@/components/settings';
import {t} from '@/lib/copy';
import {authorsFromRows, newAuthorRow, rowsFromAuthorsArray, type AuthorFormRow} from '@/lib/articleAuthors';
import {normalizeArticleKeywordsForSave} from '@/lib/articleKeywords';
import {
    ITEM_TYPE_CUSTOM_SELECT_VALUE,
    ITEM_TYPE_NONE_SELECT_VALUE,
    ZOTERO_ITEM_TYPES,
    isKnownZoteroItemType,
} from '@/lib/zoteroItemTypes';
import type {LucideIcon} from 'lucide-react';

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
    /** When "panel", uses height constraints for embedded layout and onDismiss instead of navigate(-1) for back/cancel. */
    variant?: 'page' | 'panel';
    /** Called for Back/Cancel in panel mode; optional in page mode (falls back to navigate(-1)). */
    onDismiss?: () => void;
}

type FormStep = 'basic' | 'publication' | 'identifiers' | 'additional' | 'files';

interface FormData {
  title: string;
  abstract: string;
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
    keywords: string[];
  mesh_terms: string;
  url_landing: string;
    url_pdf: string;
  language: string;
  article_type: string;
  publication_status: string;
  study_design: string;
  conflicts_of_interest: string;
  data_availability: string;
  open_access: boolean;
  license: string;
}

const STEPS: { id: FormStep; label: string; icon: LucideIcon; description: string }[] = [
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

export function ArticleForm({
                                mode,
                                projectId,
                                articleId,
                                onComplete,
                                variant = 'page',
                                onDismiss,
                            }: ArticleFormProps) {
  const navigate = useNavigate();
    const {user: _user} = useAuth();
    const isPanel = variant === 'panel';

    const handleDismiss = () => {
        if (isPanel && onDismiss) {
            onDismiss();
            return;
        }
        navigate(-1);
    };

    const [activeSection, setActiveSection] = useState<FormStep>('basic');
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
    const [authorRows, setAuthorRows] = useState<AuthorFormRow[]>(() => [newAuthorRow()]);
  const [formData, setFormData] = useState<FormData>({
    title: '',
    abstract: '',
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
      keywords: [],
    mesh_terms: '',
    url_landing: '',
      url_pdf: '',
    language: '',
      article_type: 'journalArticle',
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
        setAuthorRows(rowsFromAuthorsArray(data.authors));
      setFormData({
        title: data.title || '',
        abstract: data.abstract || '',
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
          keywords: (data.keywords ?? []).map((k) => k.trim()).filter(Boolean),
        mesh_terms: data.mesh_terms?.join(', ') || '',
        url_landing: data.url_landing || '',
          url_pdf: data.url_pdf || '',
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

    const scrollRef = useRef<HTMLDivElement>(null);

    const scrollToSection = useCallback((step: FormStep) => {
        document.getElementById(`article-section-${step}`)?.scrollIntoView({behavior: 'smooth', block: 'start'});
    }, []);

    useEffect(() => {
        if (loading) return;
        const root = scrollRef.current;
        if (!root) return;
        const els = STEPS.map((s) => document.getElementById(`article-section-${s.id}`)).filter(
            (n): n is HTMLElement => n !== null
        );
        if (els.length === 0) return;
        const ratios = new Map<string, number>();
        const io = new IntersectionObserver(
            (entries) => {
                for (const en of entries) {
                    const id = en.target.id.replace('article-section-', '');
                    if (en.isIntersecting) {
                        ratios.set(id, en.intersectionRatio);
                    } else {
                        ratios.delete(id);
                    }
                }
                let best: FormStep | null = null;
                let bestR = 0;
                for (const [id, r] of ratios) {
                    if (r > bestR) {
                        bestR = r;
                        best = id as FormStep;
                    }
                }
                if (best) {
                    setActiveSection(best);
                }
            },
            {root, threshold: [0, 0.08, 0.2, 0.35, 0.5, 1], rootMargin: '-8% 0px -45% 0px'}
        );
        els.forEach((el) => io.observe(el));
        return () => io.disconnect();
    }, [loading, mode, articleId]);

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
        scrollToSection('basic');
      return;
    }

      // Validate all date fields before save
    const yearError = validateDateField('publication_year', formData.publication_year);
    const monthError = validateDateField('publication_month', formData.publication_month);
    const dayError = validateDateField('publication_day', formData.publication_day);

    if (yearError || monthError || dayError) {
        toast.error(t('articles', 'fixDateErrors'));
        scrollToSection('publication');
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
          authors: authorsFromRows(authorRows),
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
          keywords: normalizeArticleKeywordsForSave(formData.keywords),
        mesh_terms: formData.mesh_terms.trim() ? formData.mesh_terms.split(",").map(m => m.trim()) : null,
        url_landing: formData.url_landing.trim() || null,
          url_pdf: formData.url_pdf.trim() || null,
        language: formData.language.trim() || null,
        article_type: formData.article_type.trim() || null,
        publication_status: formData.publication_status.trim() || null,
        study_design: formData.study_design.trim() || null,
        conflicts_of_interest: formData.conflicts_of_interest.trim() || null,
        data_availability: formData.data_availability.trim() || null,
        open_access: formData.open_access,
        license: formData.license.trim() || null,
        ingestion_source: mode === 'add' ? "MANUAL" : undefined,
          source_lineage: mode === 'add' ? "manual" : undefined,
          sync_state: mode === 'add' ? "active" : undefined,
      };

        let _result;
      if (mode === 'add') {
        const { data, error } = await supabase
          .from("articles")
          .insert([articleData])
          .select()
          .single();
        
        if (error) throw error;
          _result = data;
      } else {
        const { data, error } = await supabase
          .from("articles")
          .update(articleData)
          .eq("id", articleId)
          .select()
          .single();
        
        if (error) throw error;
          _result = data;
      }

        toast.success(mode === 'add' ? t('articles', 'articleCreatedSuccess') : t('articles', 'articleUpdatedSuccess'));

      if (mode === 'add') {
          if (isPanel) {
              onComplete?.();
              onDismiss?.();
          } else {
              navigate(`/projects/${projectId}?tab=articles`);
          }
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

    const itemTypeSelectValue = useMemo(() => {
        const v = formData.article_type.trim();
        if (!v) return ITEM_TYPE_NONE_SELECT_VALUE;
        if (isKnownZoteroItemType(v)) return v;
        return ITEM_TYPE_CUSTOM_SELECT_VALUE;
    }, [formData.article_type]);

    const onItemTypeSelectChange = (value: string) => {
        if (value === ITEM_TYPE_NONE_SELECT_VALUE) {
            setFormData((prev) => ({...prev, article_type: ''}));
            return;
        }
        if (value === ITEM_TYPE_CUSTOM_SELECT_VALUE) {
            setFormData((prev) => ({...prev, article_type: ''}));
            return;
        }
        setFormData((prev) => ({...prev, article_type: value}));
    };

  const isStepValid = (step: FormStep): boolean => {
    switch (step) {
      case 'basic':
        return !!formData.title.trim();
      case 'publication':
          return true;
      case 'identifiers':
          return true;
      case 'additional':
          return true;
      case 'files':
          return true;
      default:
        return true;
    }
  };

    if (loading) {
        return (
            <div
                className={cn(
                    'flex items-center justify-center',
                    isPanel ? 'h-full min-h-[240px]' : 'h-screen'
                )}
            >
                <div className="text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3 text-muted-foreground"/>
                    <p className="text-[13px] text-muted-foreground">{t('articles', 'loadingArticle')}</p>
                </div>
            </div>
        );
    }

    return (
        <div
            className={cn(
                'flex flex-col bg-background min-h-0',
                isPanel ? 'h-full' : 'h-screen'
            )}
        >
            <PageHeader
                leading={
                    <Button variant="ghost" size="sm" onClick={handleDismiss} aria-label={t('common', 'back')}>
                        <ArrowLeft className="h-4 w-4 mr-2"/>
                        {t('common', 'back')}
                    </Button>
                }
                title={mode === 'add' ? t('articles', 'addArticle') : t('articles', 'editArticle')}
                description={
                    mode === 'edit' && article ? article.title : t('articles', 'addArticleDesc')
                }
                actions={
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="h-8 px-3 text-[12px]" onClick={handleDismiss}>
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
                }
            />

            <div className="flex flex-1 flex-col overflow-hidden min-h-0 lg:flex-row">
                <aside
                    className="w-full flex-shrink-0 border-b border-border/40 bg-[#fafafa] dark:bg-[#0c0c0c] lg:w-56 lg:border-b-0 lg:border-r overflow-x-auto lg:overflow-y-auto">
                    <nav
                        role="navigation"
                        aria-label={t('articles', 'formStepsAria')}
                        className="flex flex-row gap-0.5 px-2 py-3 lg:flex-col lg:px-2 lg:py-4"
                    >
                        {STEPS.map((step) => {
                            const Icon = step.icon;
                            const isActive = step.id === activeSection;
                            return (
                                <button
                                    key={step.id}
                                    type="button"
                                    aria-current={isActive ? 'location' : undefined}
                                    onClick={() => scrollToSection(step.id)}
                                    className={cn(
                                        'flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium transition-colors duration-75',
                                        'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:ring-offset-1',
                                        'lg:w-full lg:shrink',
                                        isActive
                                            ? 'bg-muted text-foreground border-l-2 border-l-primary pl-1.5'
                                            : 'text-muted-foreground border-l-2 border-l-transparent pl-1.5'
                                    )}
                                >
                                    <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.5}/>
                                    <span className="whitespace-nowrap lg:whitespace-normal">{step.label}</span>
                                    {isActive && step.id === 'basic' && !isStepValid('basic') && (
                                        <AlertCircle className="ml-auto h-3.5 w-3.5 shrink-0 text-warning"/>
                                    )}
                                </button>
                            );
                        })}
                    </nav>
                </aside>

                <main
                    ref={scrollRef}
                    className="min-h-0 flex-1 overflow-y-auto bg-muted/25 dark:bg-muted/10"
                >
                    <div className="mx-auto w-full max-w-6xl 2xl:max-w-7xl space-y-8 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
                        <section id="article-section-basic" className="scroll-mt-4 space-y-6">
                            <SettingsSection title={t('articles', 'basicInfo')}
                                             description={t('articles', 'basicInfoDesc')}>
                                <SettingsCard
                                    title={t('articles', 'articleContentCardTitle')}
                                    description={t('articles', 'titleAbstractAuthors')}
                                >
                                    <SettingsField label={t('articles', 'itemTypeLabel')} htmlFor="article_item_type">
                                        <Select value={itemTypeSelectValue} onValueChange={onItemTypeSelectChange}
                                                disabled={saving}>
                                            <SelectTrigger id="article_item_type"
                                                           className="h-9 w-full min-w-0 text-[13px]">
                                                <SelectValue placeholder={t('articles', 'itemTypePlaceholder')}/>
                                            </SelectTrigger>
                                            <SelectContent className="max-h-[min(70vh,360px)]">
                                                <SelectItem value={ITEM_TYPE_NONE_SELECT_VALUE} className="text-[13px]">
                                                    {t('articles', 'itemTypeNone')}
                                                </SelectItem>
                                                {ZOTERO_ITEM_TYPES.map((opt) => (
                                                    <SelectItem key={opt.value} value={opt.value}
                                                                className="text-[13px]">
                                                        {opt.label}
                                                    </SelectItem>
                                                ))}
                                                <SelectItem value={ITEM_TYPE_CUSTOM_SELECT_VALUE}
                                                            className="text-[13px]">
                                                    {t('articles', 'itemTypeCustom')}
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                        {itemTypeSelectValue === ITEM_TYPE_CUSTOM_SELECT_VALUE && (
                                            <div className="space-y-2 pt-1">
                                                <p className="text-[12px] text-muted-foreground/70">{t('articles', 'itemTypeCustomHint')}</p>
                                                <Input
                                                    id="article_type_custom"
                                                    value={formData.article_type}
                                                    onChange={(e) => setFormData({
                                                        ...formData,
                                                        article_type: e.target.value
                                                    })}
                                                    className="h-9 w-full min-w-0 text-[13px]"
                                                    placeholder={t('articles', 'itemTypeCustomPlaceholder')}
                                                    disabled={saving}
                                                />
                                            </div>
                                        )}
                                    </SettingsField>
                                    <SettingsField label={t('articles', 'titleRequired')} htmlFor="title" required>
                                        <Textarea
                                            id="title"
                                            value={formData.title}
                                            onChange={(e) => setFormData({...formData, title: e.target.value})}
                                            placeholder={t('articles', 'titlePlaceholder')}
                                            className="min-h-[88px] resize-y text-[13px] leading-snug w-full min-w-0"
                                            required
                                        />
                                    </SettingsField>
                                    <SettingsField label={t('articles', 'abstract')} htmlFor="abstract"
                                                   hint={t('articles', 'abstractPlaceholder')}>
                                        <Textarea
                                            id="abstract"
                                            value={formData.abstract}
                                            onChange={(e) => setFormData({...formData, abstract: e.target.value})}
                                            placeholder={t('articles', 'abstractPlaceholder')}
                                            rows={5}
                                            className="w-full min-w-0 text-[13px] leading-snug"
                                        />
                                    </SettingsField>
                                </SettingsCard>
                                <SettingsCard title={t('articles', 'authors')}
                                              description={t('articles', 'authorsPlaceholderComma')}>
                                    <ArticleAuthorsField rows={authorRows} onChange={setAuthorRows} disabled={saving}/>
                                </SettingsCard>
                            </SettingsSection>
                        </section>

                        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2 xl:items-start xl:gap-8">
                            <section id="article-section-publication" className="scroll-mt-4 min-w-0 space-y-6">
                                <SettingsSection title={t('articles', 'publication')}
                                                 description={t('articles', 'publicationDesc')}>
                                    <SettingsCard
                                        title={t('articles', 'publicationDetails')}
                                        description={t('articles', 'publicationDetailsDesc')}
                                    >
                                        <SettingsField label={t('articles', 'journalTitle')} htmlFor="journal_title"
                                                       hint={t('articles', 'journalPlaceholder')}>
                                            <Input
                                                id="journal_title"
                                                value={formData.journal_title}
                                                onChange={(e) => setFormData({
                                                    ...formData,
                                                    journal_title: e.target.value
                                                })}
                                                placeholder={t('articles', 'journalPlaceholder')}
                                                className="h-9 w-full min-w-0 text-[13px]"
                                            />
                                        </SettingsField>
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                            <SettingsField label={t('articles', 'publicationYear')}
                                                           htmlFor="publication_year">
                                                <Input
                                                    id="publication_year"
                                                    type="number"
                                                    value={formData.publication_year}
                                                    onChange={(e) => handleDateFieldChange('publication_year', e.target.value)}
                                                    onBlur={(e) => validateDateField('publication_year', e.target.value)}
                                                    placeholder="2024"
                                                    min={1600}
                                                    max={2500}
                                                    className={cn('h-9 text-[13px]', validationErrors.publication_year && 'border-destructive')}
                                                />
                                                {validationErrors.publication_year && (
                                                    <p className="text-[12px] text-destructive flex items-center gap-1 pt-1">
                                                        <AlertCircle className="h-3 w-3 shrink-0"/>
                                                        {validationErrors.publication_year}
                                                    </p>
                                                )}
                                            </SettingsField>
                                            <SettingsField label={t('articles', 'publicationMonth')}
                                                           htmlFor="publication_month">
                                                <Input
                                                    id="publication_month"
                                                    type="number"
                                                    value={formData.publication_month}
                                                    onChange={(e) => handleDateFieldChange('publication_month', e.target.value)}
                                                    onBlur={(e) => validateDateField('publication_month', e.target.value)}
                                                    placeholder="1-12"
                                                    min={1}
                                                    max={12}
                                                    className={cn('h-9 text-[13px]', validationErrors.publication_month && 'border-destructive')}
                                                />
                                                {validationErrors.publication_month && (
                                                    <p className="text-[12px] text-destructive flex items-center gap-1 pt-1">
                                                        <AlertCircle className="h-3 w-3 shrink-0"/>
                                                        {validationErrors.publication_month}
                                                    </p>
                                                )}
                                            </SettingsField>
                                        </div>
                                        <SettingsField label={t('articles', 'publicationDay')}
                                                       htmlFor="publication_day">
                                            <Input
                                                id="publication_day"
                                                type="number"
                                                value={formData.publication_day}
                                                onChange={(e) => handleDateFieldChange('publication_day', e.target.value)}
                                                onBlur={(e) => validateDateField('publication_day', e.target.value)}
                                                placeholder="1-31"
                                                min={1}
                                                max={31}
                                                className={cn('h-9 max-w-xs text-[13px]', validationErrors.publication_day && 'border-destructive')}
                                            />
                                            {validationErrors.publication_day && (
                                                <p className="text-[12px] text-destructive flex items-center gap-1 pt-1">
                                                    <AlertCircle className="h-3 w-3 shrink-0"/>
                                                    {validationErrors.publication_day}
                                                </p>
                                            )}
                                        </SettingsField>
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                            <SettingsField label={t('articles', 'volume')} htmlFor="volume">
                                                <Input
                                                    id="volume"
                                                    value={formData.volume}
                                                    onChange={(e) => setFormData({...formData, volume: e.target.value})}
                                                    placeholder={t('articles', 'volumePlaceholder')}
                                                    className="h-9 text-[13px]"
                                                />
                                            </SettingsField>
                                            <SettingsField label={t('articles', 'edition')} htmlFor="issue">
                                                <Input
                                                    id="issue"
                                                    value={formData.issue}
                                                    onChange={(e) => setFormData({...formData, issue: e.target.value})}
                                                    placeholder="3"
                                                    className="h-9 text-[13px]"
                                                />
                                            </SettingsField>
                                            <SettingsField label={t('articles', 'pages')} htmlFor="pages">
                                                <Input
                                                    id="pages"
                                                    value={formData.pages}
                                                    onChange={(e) => setFormData({...formData, pages: e.target.value})}
                                                    placeholder={t('articles', 'pagesPlaceholder')}
                                                    className="h-9 text-[13px]"
                                                />
                                            </SettingsField>
                                        </div>
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                            <SettingsField label={t('articles', 'issnLabel')} htmlFor="journal_issn">
                                                <Input
                                                    id="journal_issn"
                                                    value={formData.journal_issn}
                                                    onChange={(e) => setFormData({
                                                        ...formData,
                                                        journal_issn: e.target.value
                                                    })}
                                                    placeholder="1234-5678"
                                                    className="h-9 text-[13px]"
                                                />
                                            </SettingsField>
                                            <SettingsField label={t('articles', 'formJournalEissn')}
                                                           htmlFor="journal_eissn">
                                                <Input
                                                    id="journal_eissn"
                                                    value={formData.journal_eissn}
                                                    onChange={(e) => setFormData({
                                                        ...formData,
                                                        journal_eissn: e.target.value
                                                    })}
                                                    placeholder="1234-5678"
                                                    className="h-9 text-[13px]"
                                                />
                                            </SettingsField>
                                        </div>
                                        <SettingsField label={t('articles', 'formJournalPublisher')}
                                                       htmlFor="journal_publisher">
                                            <Input
                                                id="journal_publisher"
                                                value={formData.journal_publisher}
                                                onChange={(e) => setFormData({
                                                    ...formData,
                                                    journal_publisher: e.target.value
                                                })}
                                                className="h-9 w-full min-w-0 text-[13px]"
                                            />
                                        </SettingsField>
                                    </SettingsCard>
                                </SettingsSection>
                            </section>

                            <section id="article-section-identifiers" className="scroll-mt-4 min-w-0 space-y-6">
                                <SettingsSection title={t('articles', 'identifiersLabel')}
                                                 description={t('articles', 'identifiersDesc')}>
                                    <SettingsCard title={t('articles', 'identifiersLabel')}>
                                        <SettingsField label={t('articles', 'doi')} htmlFor="doi">
                                            <Input
                                                id="doi"
                                                value={formData.doi}
                                                onChange={(e) => setFormData({...formData, doi: e.target.value})}
                                                placeholder="10.xxxx/xxxxx"
                                                className="h-9 w-full min-w-0 text-[13px]"
                                            />
                                        </SettingsField>
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                            <SettingsField label={t('articles', 'pmid')} htmlFor="pmid">
                                                <Input
                                                    id="pmid"
                                                    value={formData.pmid}
                                                    onChange={(e) => setFormData({...formData, pmid: e.target.value})}
                                                    placeholder="PubMed ID"
                                                    className="h-9 text-[13px]"
                                                />
                                            </SettingsField>
                                            <SettingsField label={t('articles', 'pmcidLabel')} htmlFor="pmcid">
                                                <Input
                                                    id="pmcid"
                                                    value={formData.pmcid}
                                                    onChange={(e) => setFormData({...formData, pmcid: e.target.value})}
                                                    placeholder="PMC ID"
                                                    className="h-9 text-[13px]"
                                                />
                                            </SettingsField>
                                        </div>
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                            <SettingsField label={t('articles', 'arxivIdLabel')} htmlFor="arxiv_id">
                                                <Input
                                                    id="arxiv_id"
                                                    value={formData.arxiv_id}
                                                    onChange={(e) => setFormData({
                                                        ...formData,
                                                        arxiv_id: e.target.value
                                                    })}
                                                    placeholder="arXiv:1234.5678"
                                                    className="h-9 text-[13px]"
                                                />
                                            </SettingsField>
                                            <SettingsField label={t('articles', 'piiLabel')} htmlFor="pii">
                                                <Input id="pii" value={formData.pii}
                                                       onChange={(e) => setFormData({...formData, pii: e.target.value})}
                                                       className="h-9 text-[13px]"/>
                                            </SettingsField>
                                        </div>
                                    </SettingsCard>
                                </SettingsSection>
                            </section>
                        </div>

                        <section id="article-section-additional" className="scroll-mt-4 space-y-6">
                            <SettingsSection title={t('articles', 'additionalInfo')}
                                             description={t('articles', 'additionalInfoDesc')}>
                                <SettingsCard title={t('articles', 'keywordsAndMetadata')}>
                                    <SettingsField
                                        label={t('articles', 'keywordsLabel')}
                                        htmlFor="article_keywords_draft"
                                        hint={t('articles', 'keywordsFieldHint')}
                                    >
                                        <ArticleKeywordsField
                                            value={formData.keywords}
                                            onChange={(keywords) => setFormData((prev) => ({...prev, keywords}))}
                                            disabled={saving}
                                            draftInputId="article_keywords_draft"
                                        />
                                    </SettingsField>
                                    <SettingsField label={t('articles', 'meshTermsLabel')} htmlFor="mesh_terms"
                                                   hint={t('articles', 'meshPlaceholder')}>
                                        <Input
                                            id="mesh_terms"
                                            value={formData.mesh_terms}
                                            onChange={(e) => setFormData({...formData, mesh_terms: e.target.value})}
                                            placeholder={t('articles', 'meshPlaceholder')}
                                            className="h-9 w-full min-w-0 text-[13px]"
                                        />
                                    </SettingsField>
                                    <SettingsField label={t('articles', 'articleUrl')} htmlFor="url_landing">
                                        <Input
                                            id="url_landing"
                                            type="url"
                                            value={formData.url_landing}
                                            onChange={(e) => setFormData({...formData, url_landing: e.target.value})}
                                            placeholder="https://…"
                                            className="h-9 w-full min-w-0 text-[13px]"
                                        />
                                    </SettingsField>
                                    <SettingsField label={t('articles', 'formPdfUrl')} htmlFor="url_pdf">
                                        <Input
                                            id="url_pdf"
                                            type="url"
                                            value={formData.url_pdf}
                                            onChange={(e) => setFormData({...formData, url_pdf: e.target.value})}
                                            placeholder="https://…"
                                            className="h-9 w-full min-w-0 text-[13px]"
                                        />
                                    </SettingsField>
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                        <SettingsField label={t('articles', 'languageLabel')} htmlFor="language"
                                                       hint={t('articles', 'languagePlaceholder')}>
                                            <Input
                                                id="language"
                                                value={formData.language}
                                                onChange={(e) => setFormData({...formData, language: e.target.value})}
                                                placeholder={t('articles', 'languagePlaceholder')}
                                                className="h-9 text-[13px]"
                                            />
                                        </SettingsField>
                                        <SettingsField label={t('articles', 'formPublicationStatus')}
                                                       htmlFor="publication_status">
                                            <Input
                                                id="publication_status"
                                                value={formData.publication_status}
                                                onChange={(e) => setFormData({
                                                    ...formData,
                                                    publication_status: e.target.value
                                                })}
                                                className="h-9 text-[13px]"
                                            />
                                        </SettingsField>
                                    </div>
                                    <div
                                        className="flex items-center justify-between gap-4 rounded-md border border-border/40 px-3 py-2">
                                        <Label htmlFor="open_access" className="cursor-pointer text-[13px] font-normal">
                                            {t('articles', 'formOpenAccess')}
                                        </Label>
                                        <Switch id="open_access" checked={formData.open_access}
                                                onCheckedChange={(c) => setFormData({...formData, open_access: c})}/>
                                    </div>
                                    <SettingsField label={t('articles', 'licenseLabel')} htmlFor="license">
                                        <Input
                                            id="license"
                                            value={formData.license}
                                            onChange={(e) => setFormData({...formData, license: e.target.value})}
                                            className="h-9 w-full min-w-0 text-[13px]"
                                        />
                                    </SettingsField>
                                    <SettingsField label={t('articles', 'studyDesignLabel')} htmlFor="study_design">
                                        <Input
                                            id="study_design"
                                            value={formData.study_design}
                                            onChange={(e) => setFormData({...formData, study_design: e.target.value})}
                                            className="h-9 w-full min-w-0 text-[13px]"
                                        />
                                    </SettingsField>
                                    <SettingsField label={t('articles', 'conflictsOfInterestLabel')}
                                                   htmlFor="conflicts_of_interest">
                                        <Textarea
                                            id="conflicts_of_interest"
                                            value={formData.conflicts_of_interest}
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                conflicts_of_interest: e.target.value
                                            })}
                                            rows={2}
                                            className="w-full min-w-0 text-[13px] leading-snug"
                                        />
                                    </SettingsField>
                                    <SettingsField label={t('articles', 'dataAvailabilityLabel')}
                                                   htmlFor="data_availability">
                                        <Textarea
                                            id="data_availability"
                                            value={formData.data_availability}
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                data_availability: e.target.value
                                            })}
                                            rows={2}
                                            className="w-full min-w-0 text-[13px] leading-snug"
                                        />
                                    </SettingsField>
                                </SettingsCard>
                            </SettingsSection>
                        </section>

                        <section id="article-section-files" className="scroll-mt-4 space-y-6">
                            <SettingsSection title={t('articles', 'filesLabel')}
                                             description={t('articles', 'filesDesc')}>
                                <Card className="rounded-md border-border/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                                    <CardHeader
                                        className="flex flex-row items-start justify-between gap-3 space-y-0 p-4 pb-2">
                                        <div className="min-w-0 space-y-1.5">
                                            <CardTitle
                                                className="text-[13px] font-medium leading-none">{t('articles', 'articleFiles')}</CardTitle>
                                            <CardDescription className="text-[12px] text-muted-foreground/70">
                                                {t('articles', 'articleFilesDesc')}
                                            </CardDescription>
                                        </div>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-8 shrink-0 text-[12px]"
                                            onClick={() => setShowFileUpload(true)}
                                            disabled={mode === 'add'}
                                        >
                                            <Plus className="mr-1.5 h-3.5 w-3.5"/>
                                            {t('articles', 'addFiles')}
                                        </Button>
                                    </CardHeader>
                                    <CardContent className="p-4 pt-2">
                                        {mode === 'add' ? (
                                            <Alert className="border-border/50 py-2">
                                                <AlertCircle className="h-3.5 w-3.5"/>
                                                <AlertDescription
                                                    className="text-[13px]">{t('articles', 'formSaveFirstFiles')}</AlertDescription>
                                            </Alert>
                                        ) : files.length > 0 ? (
                                            <div className="space-y-2">
                                                {files.map((file) => (
                                                    <div
                                                        key={file.id}
                                                        className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2 py-2"
                                                    >
                                                        <div className="flex min-w-0 items-center gap-2">
                                                            <FileText
                                                                className="h-4 w-4 shrink-0 text-muted-foreground"/>
                                                            <div className="min-w-0">
                                                                <p className="truncate text-[13px] font-medium">{file.original_filename || 'document.pdf'}</p>
                                                                <div
                                                                    className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                                                    <Badge variant="outline"
                                                                           className="h-5 px-1.5 text-[10px] font-normal">
                                                                        {file.file_role}
                                                                    </Badge>
                                                                    {file.bytes != null && (
                                                                        <span
                                                                            className="text-[11px] text-muted-foreground">
                                        {(file.bytes / 1024 / 1024).toFixed(2)} MB
                                      </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="flex shrink-0 gap-1">
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="ghost"
                                                                className="h-7 px-2 text-[11px]"
                                                                onClick={() => viewPDF(file)}
                                                            >
                                                                <Eye className="mr-1 h-3 w-3"/>
                                                                {t('articles', 'formViewPdf')}
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="ghost"
                                                                className="h-7 px-2 text-[11px]"
                                                                onClick={() => downloadFile(file)}
                                                            >
                                                                <Download className="mr-1 h-3 w-3"/>
                                                                {t('articles', 'formDownloadPdf')}
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="ghost"
                                                                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                                                onClick={() => openDeleteDialog(file)}
                                                                aria-label={t('articles', 'removeFile')}
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5"/>
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="py-8 text-center text-[13px] text-muted-foreground">
                                                <Upload className="mx-auto mb-3 h-9 w-9 opacity-40"/>
                                                <p>{t('articles', 'noFilesAddedYet')}</p>
                                                <p className="mt-1 text-[11px]">{t('articles', 'addFilesHint')}</p>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </SettingsSection>
                        </section>
                    </div>
                </main>
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

