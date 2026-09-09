/**
 * ArticleForm — add/edit article with settings-style cards, continuous scroll in the main column,
 * and a section nav that syncs with scroll (IntersectionObserver). Use variant "panel" inside a Sheet.
 */

import {useEffect, useRef, useState} from "react";
import {useNavigate} from "react-router";
import {cn} from "@/lib/utils";
import {TooltipProvider} from "@/components/ui/tooltip";
import {toast} from "sonner";
import {
  BookOpen,
  FileText,
  Hash,
  Tag,
  Upload
} from "lucide-react";
import {useAuth} from "@/contexts/AuthContext";
import {ArticleFileUploadDialogNew} from './ArticleFileUploadDialogNew';
import {type StagedArticleFile} from './ArticleFilesSection';
import {ArticleFormSteps, type ArticleFormStep, type FormStep} from './ArticleFormSteps';
import {ArticleFormActions, ArticleFormHeader, ArticleFormLoadingState} from './ArticleFormHeader';
import {isScrolledToBottom, resolveActiveStep} from '@/lib/articleFormScrollspy';
import {BasicInfoSection} from './sections/BasicInfoSection';
import {PublicationSection} from './sections/PublicationSection';
import {IdentifiersSection} from './sections/IdentifiersSection';
import {AdditionalInfoSection} from './sections/AdditionalInfoSection';
import {FilesSection} from './sections/FilesSection';
import {t} from '@/lib/copy';
import {triggerDownload} from '@/lib/download';
import {
    fetchArticle,
    fetchArticleFiles,
    insertArticle,
    updateArticle,
    uploadArticleFile,
    downloadFileBlob,
    deleteArticleFile,
    type ArticleFileRecord,
} from '@/services/articlesService';
import {generateStorageKey} from '@/lib/file-validation';
import {FILE_ROLES} from '@/lib/file-constants';
import {authorsFromRows, newAuthorRow, rowsFromAuthorsArray, type AuthorFormRow} from '@/lib/articleAuthors';
import {normalizeArticleKeywordsForSave} from '@/lib/articleKeywords';
import {
    ITEM_TYPE_CUSTOM_SELECT_VALUE,
    ITEM_TYPE_NONE_SELECT_VALUE,
    isKnownZoteroItemType,
} from '@/lib/zoteroItemTypes';

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

// Re-use the service type (same shape)
type ArticleFile = ArticleFileRecord;

interface ArticleFormProps {
  mode: 'add' | 'edit';
  projectId: string;
  articleId?: string;
  onComplete?: () => void;
    /** When "panel", uses height constraints for embedded layout and onDismiss instead of navigate(-1) for back/cancel. */
    variant?: 'page' | 'panel';
    /** Called for Back/Cancel in panel mode; optional in page mode (falls back to navigate(-1)). */
    onDismiss?: () => void;
    /** Reports whether the form holds unsaved edits, so a host panel can guard
     *  navigation away from it. Fires on every transition of the flag. */
    onDirtyChange?: (dirty: boolean) => void;
    /** Fired once when add mode's insert succeeds, with the new article's id.
     *  The form deliberately does NOT put this in the URL — that would remount
     *  the tree and destroy the staged File objects (see the note at the
     *  createdArticleId declaration) — so a host panel learns the id here. */
    onArticleCreated?: (articleId: string) => void;
}


export interface FormData {
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


const STEPS: ArticleFormStep[] = [
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
                                onDirtyChange,
                                onArticleCreated,
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
  const [stagedFiles, setStagedFiles] = useState<StagedArticleFile[]>([]);

  // Set once the add-mode row lands. Its ONLY job is to stop a retry from
  // inserting a second article; the form deliberately does NOT derive a mode
  // from it — `mode` is a prop owned by the URL, and rewriting the URL would
  // remount this tree and destroy the staged `File` objects.
  const [createdArticleId, setCreatedArticleId] = useState<string | null>(null);
  const [fileToDelete, setFileToDelete] = useState<ArticleFile | null>(null);
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

  /**
   * Dirty tracking. The fingerprint is the SAVED shape, not the widget state:
   * AuthorFormRow.id is a uuidv4 minted fresh by rowsFromAuthorsArray on every
   * load, so comparing rows directly would report dirty forever and make the
   * host panel's guard fire on every row click.
   */
  const dirtyFingerprint = JSON.stringify({
    formData,
    authors: authorsFromRows(authorRows),
    staged: stagedFiles.length,
  });
  const dirtyBaselineRef = useRef<string | null>(null);
  const lastReportedDirtyRef = useRef<boolean | null>(null);

  useEffect(() => {
    // Edit mode captures its baseline only once the fetched article has been
    // written into formData; add mode's baseline is the empty form at mount.
    if (dirtyBaselineRef.current === null) {
      if (mode === 'edit' && !article) return;
      dirtyBaselineRef.current = dirtyFingerprint;
    }
    const dirty = dirtyFingerprint !== dirtyBaselineRef.current;
    if (lastReportedDirtyRef.current !== dirty) {
      lastReportedDirtyRef.current = dirty;
      onDirtyChange?.(dirty);
    }
  }, [dirtyFingerprint, mode, article, onDirtyChange]);

  const effectiveArticleId = articleId ?? createdArticleId ?? undefined;

  const loadArticle = async () => {
    if (!articleId) return;

    setLoading(true);
    const result = await fetchArticle(articleId);
    setLoading(false);

    if (!result.ok) {
      toast.error(t('articles', 'errorLoadArticle'));
      return;
    }

    const data = result.data as any;
    setArticle(data as Article);

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
        keywords: (data.keywords ?? []).map((k: string) => k.trim()).filter(Boolean),
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
  };

  const loadFilesFor = async (targetId: string) => {
    const result = await fetchArticleFiles(targetId);
    if (result.ok) {
      setFiles(result.data);
    }
    // silent on error — files are best-effort
  };

  const loadFiles = async () => {
    if (!effectiveArticleId) return;
    await loadFilesFor(effectiveArticleId);
  };

    // Load article data (edit mode)
  useEffect(() => {
    if (mode === 'edit' && articleId) {
      // Microtask so the loaders' setState calls run in async callbacks.
      queueMicrotask(() => {
        void loadArticle();
        void loadFiles();
      });
    }
  }, [mode, articleId]);

    const scrollRef = useRef<HTMLDivElement>(null);

    const scrollToSection = (step: FormStep) => {
        document.getElementById(`article-section-${step}`)?.scrollIntoView({behavior: 'smooth', block: 'start'});
        setActiveSection(step); // explicit click wins immediately; see the bottom-of-scroll override below
    };

    useEffect(() => {
        if (loading) return;
        const root = scrollRef.current;
        if (!root) return;
        const els = STEPS.map((s) => document.getElementById(`article-section-${s.id}`)).filter(
            (n): n is HTMLElement => n !== null
        );
        if (els.length === 0) return;
        const lastStepId = STEPS[STEPS.length - 1].id; // "root" is reused below; no second listener on window
        const ratios = new Map<string, number>();
        const applyActiveStep = () => {
            const next = resolveActiveStep(ratios, lastStepId, isScrolledToBottom(root)); if (next) setActiveSection(next);
        };
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
                applyActiveStep();
            },
            {root, threshold: [0, 0.08, 0.2, 0.35, 0.5, 1], rootMargin: '-8% 0px -45% 0px'}
        );
        els.forEach((el) => io.observe(el));
        root.addEventListener('scroll', applyActiveStep, {passive: true});
        return () => {
            io.disconnect();
            root.removeEventListener('scroll', applyActiveStep);
        };
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

    // Helper to validate and convert numeric date values
    const parseDateValue = (value: string | undefined): number | null => {
      if (!value || value.trim() === '') return null;
      const num = parseInt(value.trim(), 10);
      if (isNaN(num)) return null;
      return num;
    };

    const parsedMonth = parseDateValue(formData.publication_month);
    const validMonth = parsedMonth !== null && parsedMonth >= 1 && parsedMonth <= 12 ? parsedMonth : null;

    const parsedDay = parseDateValue(formData.publication_day);
    const validDay = parsedDay !== null && parsedDay >= 1 && parsedDay <= 31 ? parsedDay : null;

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

    // Creating an article with staged files is two writes: the row, then N
    // uploads. `saving` stays true across BOTH — clearing it after phase one
    // would re-enable Create while the row already exists, and a second click
    // would insert a duplicate.
    const isCreating = mode === 'add' && createdArticleId === null;

    let savedArticleId: string;
    if (isCreating) {
      const created = await insertArticle(articleData);
      if (!created.ok) {
        setSaving(false);
        toast.error(`${t('articles', 'errorCreateArticle')}: ${created.error.message || t('articles', 'errorCreateArticle')}`);
        return; // staged files are untouched, so the user can fix and retry
      }
      savedArticleId = created.data.id;
      setCreatedArticleId(savedArticleId);
      onArticleCreated?.(savedArticleId);
    } else {
      const targetId = articleId ?? createdArticleId;
      if (!targetId) {
        setSaving(false);
        toast.error(t('articles', 'errorUpdateArticle') + ': articleId is required for edit mode');
        return;
      }
      const updated = await updateArticle(targetId, articleData);
      if (!updated.ok) {
        setSaving(false);
        toast.error(`${t('articles', 'errorUpdateArticle')}: ${updated.error.message || t('articles', 'errorUpdateArticle')}`);
        return;
      }
      savedArticleId = targetId;
    }

    // Phase two. Only files that have not landed yet are retried.
    const failedIds = await uploadStagedFiles(savedArticleId);

    setSaving(false);

    dirtyBaselineRef.current = JSON.stringify({formData, authors: authorsFromRows(authorRows), staged: failedIds.length});
    lastReportedDirtyRef.current = false; onDirtyChange?.(false);

    if (failedIds.length > 0) {
      // The row persisted, so the sheet MUST stay open: these `File` objects
      // exist nowhere else and dismissing would drop them silently.
      toast.warning(
        t('articles', 'stagedUploadPartial').replace('{{failed}}', String(failedIds.length)),
      );
      void loadFilesFor(savedArticleId);
      return;
    }

    toast.success(isCreating ? t('articles', 'articleCreatedSuccess') : t('articles', 'articleUpdatedSuccess'));

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
  };

  /**
   * Uploads every staged file against `targetId`, sequentially so a MAIN
   * conflict surfaces before the rest. Returns the ids that failed; those stay
   * staged and retryable, and the ones that succeeded are dropped from the list
   * so a retry never uploads them twice.
   */
  const uploadStagedFiles = async (targetId: string): Promise<string[]> => {
    if (stagedFiles.length === 0) return [];

    const failures = new Map<string, string>();
    for (const staged of stagedFiles) {
      const result = await uploadArticleFile({
        projectId,
        articleId: targetId,
        storageKey: generateStorageKey(projectId, targetId, staged.file.name),
        file: staged.file,
        role: staged.role,
      });
      if (!result.ok) {
        failures.set(staged.id, result.error.message || t('articles', 'errorUnknown'));
      }
    }

    setStagedFiles(prev =>
      prev
        .filter(f => failures.has(f.id))
        .map(f => ({...f, error: failures.get(f.id)})),
    );
    return [...failures.keys()];
  };

  const downloadFile = async (file: ArticleFile) => {
    const result = await downloadFileBlob(file.storage_key);
    if (!result.ok) {
      toast.error(t('articles', 'errorDownloadFile'));
      return;
    }
    triggerDownload(result.data, file.original_filename || "document.pdf");
  };

  const handleDeleteFile = async () => {
    if (!fileToDelete) return;

    setDeletingFile(true);
    const result = await deleteArticleFile(fileToDelete.id, fileToDelete.storage_key);
    setDeletingFile(false);

    if (!result.ok) {
      toast.error(t('articles', 'errorRemoveFile'));
      return;
    }

      toast.success(t('articles', 'fileRemovedSuccess'));
      void loadFiles(); // Reload file list
    setFileToDelete(null);
  };

  const openDeleteDialog = (file: ArticleFile) => {
    setFileToDelete(file);
  };

  const viewPDF = async (file: ArticleFile) => {
    const result = await downloadFileBlob(file.storage_key);
    if (!result.ok) {
      toast.error(t('articles', 'errorViewPdf'));
      return;
    }
    const blob = new Blob([result.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

    const itemTypeSelectValue = (() => {
        const v = formData.article_type.trim();
        if (!v) return ITEM_TYPE_NONE_SELECT_VALUE;
        if (isKnownZoteroItemType(v)) return v;
        return ITEM_TYPE_CUSTOM_SELECT_VALUE;
    })();

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
        return <ArticleFormLoadingState isPanel={isPanel}/>;
    }

    const formActions = (
        <ArticleFormActions
            mode={mode}
            saving={saving}
            disabled={saving || !isStepValid('basic')}
            onCancel={handleDismiss}
            onSave={handleSave}
        />
    );

    return (
      <TooltipProvider delayDuration={200}>
        <div
            className={cn(
                'flex flex-col bg-background min-h-0',
                isPanel ? 'h-full' : 'h-screen'
            )}
        >
            {isPanel ? (
                /* The hosting panel's strip already names the article and owns
                   the exit, so the panel variant keeps only the actions. */
                <div className="flex shrink-0 items-center justify-end gap-2 border-b border-border/40 px-3 py-1.5">
                    {formActions}
                </div>
            ) : (
                <ArticleFormHeader
                    mode={mode}
                    articleTitle={article?.title}
                    onDismiss={handleDismiss}
                    actions={formActions}
                />
            )}

            <div className={cn('flex flex-1 flex-col overflow-hidden min-h-0 lg:flex-row', isPanel && 'lg:flex-row-reverse')}>
                <ArticleFormSteps
                    steps={STEPS}
                    activeStep={activeSection}
                    onSelect={scrollToSection}
                    titleMissing={!isStepValid('basic')}
                    compact={isPanel}
                />

                <main
                    ref={scrollRef}
                    className="min-h-0 flex-1 overflow-y-auto bg-muted/25 dark:bg-muted/10"
                >
                    <div className="mx-auto w-full max-w-6xl 2xl:max-w-7xl space-y-8 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
                        <BasicInfoSection
                            formData={formData}
                            setFormData={setFormData}
                            saving={saving}
                            authorRows={authorRows}
                            onAuthorRowsChange={setAuthorRows}
                            itemTypeSelectValue={itemTypeSelectValue}
                            onItemTypeSelectChange={onItemTypeSelectChange}
                        />

                        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2 xl:items-start xl:gap-8">
                            <PublicationSection
                                formData={formData}
                                setFormData={setFormData}
                                validationErrors={validationErrors}
                                onDateFieldChange={handleDateFieldChange}
                                onValidateDateField={validateDateField}
                            />

                            <IdentifiersSection formData={formData} setFormData={setFormData}/>
                        </div>

                        <AdditionalInfoSection formData={formData} setFormData={setFormData} saving={saving}/>

                        <FilesSection
                            files={files}
                            stagedFiles={stagedFiles}
                            onRemoveStaged={(id) =>
                                setStagedFiles(prev => prev.filter(f => f.id !== id))
                            }
                            fileToDelete={fileToDelete}
                            deleting={deletingFile}
                            onView={viewPDF}
                            onDownload={downloadFile}
                            onRequestDelete={openDeleteDialog}
                            onCancelDelete={() => setFileToDelete(null)}
                            onConfirmDelete={handleDeleteFile}
                            onAddFiles={() => setShowFileUpload(true)}
                        />
                    </div>
                </main>
      </div>

        {/* File upload modal */}
      {showFileUpload && (
        <ArticleFileUploadDialogNew
          open={showFileUpload}
          onOpenChange={setShowFileUpload}
          articleId={effectiveArticleId}
          projectId={projectId}
          mainAlreadyStaged={stagedFiles.some(f => f.role === FILE_ROLES.MAIN)}
          onFileUploaded={() => {
            loadFiles();
            setShowFileUpload(false);
          }}
          onFilesStaged={(picked) =>
            setStagedFiles(prev => [
              ...prev,
              ...picked.map((p, i) => ({
                id: `staged-${prev.length + i}-${p.file.name}`,
                file: p.file,
                role: p.role,
              })),
            ])
          }
        />
      )}

    </div>
      </TooltipProvider>
  );
}
