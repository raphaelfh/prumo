import type {CSSProperties} from "react";
import {forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import {Button} from "@/components/ui/button";
import {Badge} from "@/components/ui/badge";
import {Checkbox} from "@/components/ui/checkbox";
import {
    FileText,
    MoreHorizontal,
    Plus,
    Search,
    Trash2,
    Upload,
} from "lucide-react";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from "@/components/ui/alert-dialog";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import {supabase} from "@/integrations/supabase/client";
import {toast} from "sonner";
import {t} from "@/lib/copy";
import {TABLE_CELL_CLASS} from "@/lib/table-constants";
import {useListKeyboardShortcuts} from "@/hooks/useListKeyboardShortcuts";
import type {FilterFieldConfig, FilterValues} from "@/components/shared/list";
import {
    ActiveFilterChips,
    buildActiveFiltersList,
    DataTableWrapper,
    EmptyListState,
    FilterButtonWithPopover,
    ListCount,
    ListDisplaySortPopover,
    ListFilterPanel,
    ListRowCard,
    SortIconHeader,
    ListToolbarSearch,
    ResponsiveList,
    useResizableTableColumns,
} from "@/components/shared/list";
import {useIsNarrow} from '@/hooks/use-mobile';
import {ArticleFileUploadDialogNew} from "./ArticleFileUploadDialogNew";
import {ArticlesExportDialog} from "./ArticlesExportDialog";
import {ZoteroImportDialog} from "./ZoteroImportDialog";
import {useZoteroIntegration} from "@/hooks/useZoteroIntegration";
import type {Article} from "@/types/article";
import {ARTICLES_DATA_COLUMN_DEFS, articleListCellTitle, formatArticleListCell} from "@/lib/articlesListDisplay";

export type ArticlesListHandle = {
    openExportDialog: () => void;
};

interface ArticlesListProps {
  articles: Article[];
  onArticleClick: (articleId: string) => void;
  projectId: string;
  onArticlesChange?: () => void;
    /** When provided, Zotero dialog is controlled by parent (e.g. ProjectView) */
    onOpenZoteroDialog?: () => void;
    /** When provided, shows "Via RIS file" option alongside Zotero */
    onOpenRisDialog?: () => void;
    /** Notifies parent when export action should be enabled (filtered list or selection). */
    onExportAvailabilityChange?: (canExport: boolean) => void;
    /** When set, empty-state "Add first article" opens the panel instead of navigating. */
    onOpenAddArticle?: () => void;
}

type SortField =
    | 'title'
    | 'authors'
    | 'journal_title'
    | 'publication_year'
    | 'created_at'
    | 'has_main_file';
type SortDirection = 'asc' | 'desc';

const ARTICLES_FILTER_FIELDS: FilterFieldConfig[] = [
    {id: 'title', label: 'Title', type: 'text', placeholder: t('articles', 'listSearchTitlePlaceholder')},
    {id: 'authors', label: 'Authors', type: 'text', placeholder: t('articles', 'listSearchAuthorPlaceholder')},
    {id: 'journal_title', label: 'Journal', type: 'text', placeholder: t('articles', 'listSearchJournalPlaceholder')},
    {
        id: 'publication_year',
        label: 'Year',
        type: 'numericRange',
        minBound: 1990,
        maxBound: new Date().getFullYear(),
        step: 1
    },
    {
        id: 'keywords',
        label: 'Keywords',
        type: 'facetMultiSelect',
        placeholder: t('articles', 'listFilterKeywordsSearchPlaceholder'),
        facetNoDataMessage: t('articles', 'listFilterKeywordsNoData'),
        facetNoMatchesMessage: t('articles', 'listFilterKeywordsNoMatches'),
    },
    {
        id: 'has_main_file', label: 'PDF', type: 'categorical', options: [
            {value: 'yes', label: t('articles', 'listHasPdf')},
            {value: 'no', label: t('articles', 'listNoPdf')},
        ]
    },
    {
        id: 'ingestion_source', label: 'Source', type: 'categorical', options: [
            {value: 'ZOTERO', label: 'Zotero'},
            {value: 'MANUAL', label: 'Manual'},
            {value: 'RIS', label: 'RIS'},
        ]
    },
    {
        id: 'sync_state', label: 'Sync state', type: 'categorical', options: [
            {value: 'active', label: 'Active'},
            {value: 'removed_at_source', label: 'Removed at source'},
            {value: 'conflict', label: 'Conflict'},
        ]
    },
];

const INITIAL_ARTICLES_FILTER_VALUES: FilterValues = {
    title: '',
    authors: '',
    journal_title: '',
    publication_year: {},
    keywords: '',
    has_main_file: [],
    ingestion_source: [],
    sync_state: [],
};

const VISIBLE_COLUMNS_KEY = "articles-list-visible-columns-v3";
const COLUMN_WIDTHS_KEY = "articles-list-column-widths-v3";

/** Data column configuration for header (DRY). id = key in columnWidths. breakpoint = from which Tailwind breakpoint the column is visible (sm = always in table, md/lg = hidden until that breakpoint). */
const TABLE_COLUMNS: Array<{
    id: string;
    label: string;
    sortField?: SortField;
    filterKey?: string;
    visibleKey?: string;
    flexible?: boolean;
    /** When to show column in table: sm (default), md, lg */
    breakpoint?: 'sm' | 'md' | 'lg';
}> = [
    {id: 'title', label: 'Title', sortField: 'title', filterKey: 'title', flexible: true, breakpoint: 'sm'},
    {
        id: 'pdf',
        label: 'PDF',
        sortField: 'has_main_file',
        filterKey: 'has_main_file',
        visibleKey: 'pdf',
        breakpoint: 'sm'
    },
    {
        id: 'source',
        label: 'Source',
        visibleKey: 'source',
        breakpoint: 'sm'
    },
    {
        id: 'authors',
        label: 'Authors',
        sortField: 'authors',
        filterKey: 'authors',
        visibleKey: 'authors',
        breakpoint: 'md'
    },
    {
        id: 'journal',
        label: 'Journal',
        sortField: 'journal_title',
        filterKey: 'journal_title',
        visibleKey: 'journal',
        breakpoint: 'lg'
    },
    {
        id: 'year',
        label: 'Year',
        sortField: 'publication_year',
        filterKey: 'publication_year',
        visibleKey: 'year',
        breakpoint: 'md'
    },
    {id: 'keywords', label: 'Keywords', filterKey: 'keywords', visibleKey: 'keywords', breakpoint: 'lg'},
    {id: 'doi', label: 'DOI', visibleKey: 'doi', breakpoint: 'lg'},
    {id: 'abstract', label: 'Abstract', visibleKey: 'abstract', breakpoint: 'lg'},
    ...ARTICLES_DATA_COLUMN_DEFS.map((d) => ({
        id: d.id,
        label: d.label,
        visibleKey: d.id,
        breakpoint: 'lg' as const,
    })),
];

/** Default: only core bibliographic columns; extended metadata off unless user enables. */
function buildDefaultVisibleColumns(): Record<string, boolean> {
    const d: Record<string, boolean> = {
        title: true,
        pdf: true,
        source: false,
        authors: true,
        journal: true,
        year: true,
        keywords: true,
        doi: true,
        abstract: false,
    };
    for (const {id} of ARTICLES_DATA_COLUMN_DEFS) {
        d[id] = false;
    }
    return d;
}

const DEFAULT_VISIBLE_COLUMNS = buildDefaultVisibleColumns();

const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
    title: 320,
    pdf: 100,
    source: 120,
    authors: 140,
    journal: 160,
    year: 100,
    keywords: 160,
    doi: 200,
    abstract: 220,
};
for (const {id} of ARTICLES_DATA_COLUMN_DEFS) {
    if (DEFAULT_COLUMN_WIDTHS[id] == null) {
        DEFAULT_COLUMN_WIDTHS[id] = id.includes('payload') || id.includes('conflict') ? 160 : 120;
    }
}

export const ArticlesList = forwardRef<ArticlesListHandle, ArticlesListProps>(function ArticlesList(
    {
        articles,
        onArticleClick,
        projectId,
        onArticlesChange,
        onOpenZoteroDialog,
        onOpenRisDialog,
        onExportAvailabilityChange,
        onOpenAddArticle,
    },
    ref,
) {
    const isNarrow = useIsNarrow();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [articleToDelete, setArticleToDelete] = useState<string | null>(null);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [articleToUpload, setArticleToUpload] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [zoteroImportOpen, setZoteroImportOpen] = useState(false);
    const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [articlesWithMainFile, setArticlesWithMainFile] = useState<Set<string>>(new Set());

    const useImportCallbacks = !!onOpenZoteroDialog;

    const navigate = useNavigate();
    const searchInputRef = useRef<HTMLInputElement>(null);
    // Hook to check if user has Zotero integration configured
  const { isConfigured: hasZoteroConfigured } = useZoteroIntegration();

    // Fetch articles that have MAIN PDF file
  useEffect(() => {
    const fetchMainFiles = async () => {
      if (articles.length === 0) {
        setArticlesWithMainFile(new Set());
        return;
      }

      const articleIds = articles.map(a => a.id);
      const { data, error } = await supabase
        .from("article_files")
        .select("article_id")
        .in("article_id", articleIds)
        .eq("file_role", "MAIN");

      if (!error && data) {
        const articlesWithFile = new Set(data.map(f => f.article_id));
        setArticlesWithMainFile(articlesWithFile);
      }
    };

    fetchMainFiles();
  }, [articles]);

    // State for sort and filters
  const [sortField, setSortField] = useState<SortField>('publication_year');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [filterValues, setFilterValues] = useState<FilterValues>(INITIAL_ARTICLES_FILTER_VALUES);
    const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);

    // Visible columns
    const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() => {
        if (typeof window === "undefined") return {...DEFAULT_VISIBLE_COLUMNS};
        try {
            const stored = localStorage.getItem(VISIBLE_COLUMNS_KEY);
            if (!stored) return {...DEFAULT_VISIBLE_COLUMNS};
            const parsed = JSON.parse(stored) as Record<string, boolean>;
            return {...DEFAULT_VISIBLE_COLUMNS, ...parsed};
        } catch (_) {
            return {...DEFAULT_VISIBLE_COLUMNS};
        }
  });

    // Resizable column widths (persisted in localStorage)
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
        if (typeof window === 'undefined') return DEFAULT_COLUMN_WIDTHS;
        try {
            const stored = localStorage.getItem(COLUMN_WIDTHS_KEY);
            if (stored) {
                const parsed = JSON.parse(stored) as Record<string, number>;
                const merged = {...DEFAULT_COLUMN_WIDTHS, ...parsed};
                // Avoid title column too narrow (overlap): saved value < 120 is ignored
                if (merged.title < 120) merged.title = DEFAULT_COLUMN_WIDTHS.title;
                return merged;
            }
        } catch (_) {
            // Ignore JSON parse or localStorage errors; use defaults
        }
        return {...DEFAULT_COLUMN_WIDTHS};
    });
    const renderedResizableColumns = useMemo(
        () =>
            TABLE_COLUMNS
                .filter((col) => col.visibleKey == null || visibleColumns[col.visibleKey] === true)
                .map((col) => col.id),
        [visibleColumns]
    );
    const {registerHeaderRef, startResize} = useResizableTableColumns({
        columnWidths,
        setColumnWidths,
        defaultColumnWidths: DEFAULT_COLUMN_WIDTHS,
        orderedColumns: renderedResizableColumns,
        storageKey: COLUMN_WIDTHS_KEY,
    });

    /** Single source of truth for column widths (header and body). */
    const getColumnStyle = (columnId: string): CSSProperties => {
        if (columnId === 'title') {
            const wTitle = columnWidths.title ?? DEFAULT_COLUMN_WIDTHS.title;
            return {width: wTitle, minWidth: wTitle};
        }
        const w = columnWidths[columnId] ?? DEFAULT_COLUMN_WIDTHS[columnId];
        return {width: w, minWidth: 80};
    };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

    // Clear single filter field (for chip clear)
    const clearFilterField = useCallback((fieldId: string) => {
        const field = ARTICLES_FILTER_FIELDS.find(f => f.id === fieldId);
        if (!field) return;
        setFilterValues(prev => ({
            ...prev,
            [fieldId]:
                field.type === 'categorical' || field.type === 'facetMultiSelect'
                    ? []
                    : field.type === 'numericRange'
                        ? {}
                        : '',
        }));
    }, []);

    const clearAllFilters = useCallback(() => {
        setSearchTerm('');
        setFilterValues(INITIAL_ARTICLES_FILTER_VALUES);
    }, []);

    // Faceted values for Filter suggestions (derived from articles)
    const facetedValues = useMemo(() => {
        const years = new Map<number, number>();
        const journals = new Map<string, number>();
        const authors = new Map<string, number>();
        const keywords = new Map<string, number>();
        articles.forEach(a => {
            if (a.publication_year != null) {
                years.set(a.publication_year, (years.get(a.publication_year) ?? 0) + 1);
            }
            if (a.journal_title?.trim()) {
                const j = a.journal_title.trim();
                journals.set(j, (journals.get(j) ?? 0) + 1);
            }
            a.authors?.forEach(auth => {
                if (auth?.trim()) {
                    const t = auth.trim();
                    authors.set(t, (authors.get(t) ?? 0) + 1);
                }
            });
            a.keywords?.forEach(kw => {
                if (kw?.trim()) {
                    const k = kw.trim();
                    keywords.set(k, (keywords.get(k) ?? 0) + 1);
                }
            });
        });
        return {
            years: Array.from(years.entries()).sort((a, b) => b[0] - a[0]).map(([year, count]) => ({
                value: String(year),
                count
            })),
            journals: Array.from(journals.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({
                value: name,
                count
            })),
            authors: Array.from(authors.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({
                value: name,
                count
            })),
            keywords: Array.from(keywords.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({
                value: name,
                count
            })),
    };
    }, [articles]);

    const ARTICLES_FILTER_LABELS: Record<string, string> = useMemo(() => ({
        title: 'Title',
        authors: 'Authors',
        journal_title: 'Journal',
        publication_year: 'Year',
        keywords: 'Keywords',
        has_main_file: 'PDF',
        ingestion_source: 'Source',
        sync_state: 'Sync state',
    }), []);

    const activeFiltersList = useMemo(
        () => buildActiveFiltersList(ARTICLES_FILTER_FIELDS, filterValues, ARTICLES_FILTER_LABELS),
        [filterValues, ARTICLES_FILTER_LABELS]
    );

    // Visible columns toggle
    const toggleColumn = (column: string) => {
    setVisibleColumns(prev => ({
      ...prev,
      [column]: !prev[column]
    }));
  };

    useEffect(() => {
        try {
            localStorage.setItem(VISIBLE_COLUMNS_KEY, JSON.stringify(visibleColumns));
        } catch (_) {
            // Ignore localStorage errors
        }
    }, [visibleColumns]);

  // Handle article selection
  const handleSelectArticle = (articleId: string, checked: boolean) => {
    const newSelected = new Set(selectedArticles);
    if (checked) {
      newSelected.add(articleId);
    } else {
      newSelected.delete(articleId);
    }
    setSelectedArticles(newSelected);
  };

  // Delete single article
  const handleDeleteArticle = async (articleId: string) => {
    setDeleting(true);
    try {
      // First, get all files for this article
      const { data: files, error: filesError } = await supabase
        .from("article_files")
        .select("storage_key")
        .eq("article_id", articleId);

      if (filesError) throw filesError;

      // Delete files from storage
      if (files && files.length > 0) {
        const filePaths = files.map(f => f.storage_key);
        const { error: storageError } = await supabase.storage
          .from("articles")
          .remove(filePaths);

        if (storageError) {
          console.warn("Error deleting files from storage:", storageError);
        }
      }

      // Delete article (cascade will handle related records)
      const { error: deleteError } = await supabase
        .from("articles")
        .delete()
        .eq("id", articleId);

      if (deleteError) throw deleteError;

        toast.success(t('articles', 'listArticleDeletedSuccess'));
      onArticlesChange?.();
    } catch (error: any) {
      console.error("Error deleting article:", error);
        toast.error(t('articles', 'listErrorDeletingArticle'));
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
      setArticleToDelete(null);
    }
  };

  // Delete multiple articles
  const handleBulkDelete = async () => {
    if (selectedArticles.size === 0) return;

    setDeleting(true);
    try {
      const articleIds = Array.from(selectedArticles);

      // Get all files for selected articles
      const { data: files, error: filesError } = await supabase
        .from("article_files")
        .select("storage_key")
        .in("article_id", articleIds);

      if (filesError) throw filesError;

      // Delete files from storage
      if (files && files.length > 0) {
        const filePaths = files.map(f => f.storage_key);
        const { error: storageError } = await supabase.storage
          .from("articles")
          .remove(filePaths);

        if (storageError) {
          console.warn("Error deleting files from storage:", storageError);
        }
      }

      // Delete articles
      const { error: deleteError } = await supabase
        .from("articles")
        .delete()
        .in("id", articleIds);

      if (deleteError) throw deleteError;

        toast.success(`${articleIds.length} article(s) deleted successfully!`);
      setSelectedArticles(new Set());
      onArticlesChange?.();
    } catch (error: any) {
      console.error("Error deleting articles:", error);
        toast.error(t('articles', 'listErrorDeletingArticles'));
    } finally {
      setDeleting(false);
      setBulkDeleteDialogOpen(false);
    }
  };

  const openDeleteDialog = (articleId: string) => {
    setArticleToDelete(articleId);
    setDeleteDialogOpen(true);
  };

  const openUploadDialog = (articleId: string) => {
    setArticleToUpload(articleId);
    setUploadDialogOpen(true);
  };

  // Filtrar e ordenar artigos com useMemo
  const filteredArticles = useMemo(() => {
    const filtered = articles.filter(article => {
      // Filtro global de busca
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const matchesSearch =
            (article.title ?? '').toLowerCase().includes(searchLower) ||
            (article.abstract ?? '').toLowerCase().includes(searchLower) ||
            article.authors?.some((a) => (a ?? '').toLowerCase().includes(searchLower)) ||
            (article.journal_title ?? '').toLowerCase().includes(searchLower) ||
            article.keywords?.some((k) => (k ?? '').toLowerCase().includes(searchLower)) ||
            article.mesh_terms?.some((m) => (m ?? '').toLowerCase().includes(searchLower)) ||
            (article.doi ?? '').toLowerCase().includes(searchLower) ||
            (article.pmid ?? '').toLowerCase().includes(searchLower) ||
            (article.pmcid ?? '').toLowerCase().includes(searchLower);
        
        if (!matchesSearch) return false;
      }

        // Panel filters (FilterValues)
        const titleFilter = filterValues.title as string | undefined;
        if (titleFilter?.trim() && !(article.title ?? '').toLowerCase().includes(titleFilter.toLowerCase())) {
        return false;
      }

        const authorsFilter = filterValues.authors as string | undefined;
        if (authorsFilter?.trim()) {
            const authorMatch = article.authors?.some(author =>
                author.toLowerCase().includes(authorsFilter.toLowerCase())
        );
        if (!authorMatch) return false;
      }

        const journalFilter = filterValues.journal_title as string | undefined;
        if (journalFilter?.trim()) {
            if (!article.journal_title || !article.journal_title.toLowerCase().includes(journalFilter.toLowerCase())) {
          return false;
        }
      }

        const yearRange = filterValues.publication_year as { min?: number; max?: number } | undefined;
        if (yearRange && (yearRange.min != null || yearRange.max != null)) {
            const y = article.publication_year ?? null;
            if (y == null) return false;
            if (yearRange.min != null && y < yearRange.min) return false;
            if (yearRange.max != null && y > yearRange.max) return false;
      }

        const keywordsFilter = filterValues.keywords as string[] | undefined;
        // OR: artigo passa se tiver qualquer keyword selecionada (string exata; facetas usam trim).
        if (keywordsFilter && keywordsFilter.length > 0) {
            const articleKw = new Set(
                (article.keywords ?? []).map((k) => (k ?? '').trim()).filter(Boolean)
            );
            const keywordMatch = keywordsFilter.some((k) => articleKw.has(k));
            if (!keywordMatch) return false;
        }

        const hasMainFileFilter = filterValues.has_main_file as string[] | undefined;
        if (hasMainFileFilter?.length) {
            const hasPdf = articlesWithMainFile.has(article.id);
            const wantYes = hasMainFileFilter.includes('yes');
            const wantNo = hasMainFileFilter.includes('no');
            if (wantYes && !wantNo && !hasPdf) return false;
            if (wantNo && !wantYes && hasPdf) return false;
        }

        const sourceFilter = filterValues.ingestion_source as string[] | undefined;
        if (sourceFilter?.length) {
            const sourceValue = (article.ingestion_source ?? "MANUAL").toUpperCase();
            if (!sourceFilter.includes(sourceValue)) return false;
        }

        const syncStateFilter = filterValues.sync_state as string[] | undefined;
        if (syncStateFilter?.length) {
            const syncStateValue = article.sync_state ?? "active";
            if (!syncStateFilter.includes(syncStateValue)) return false;
        }

      return true;
    });

      // Sort
    filtered.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortField) {
        case 'title':
          aValue = a.title.toLowerCase();
          bValue = b.title.toLowerCase();
          break;
        case 'authors':
          aValue = a.authors?.join(', ').toLowerCase() || '';
          bValue = b.authors?.join(', ').toLowerCase() || '';
          break;
        case 'journal_title':
          aValue = a.journal_title?.toLowerCase() || '';
          bValue = b.journal_title?.toLowerCase() || '';
          break;
        case 'publication_year':
          aValue = a.publication_year || 0;
          bValue = b.publication_year || 0;
          break;
        case 'has_main_file':
          aValue = articlesWithMainFile.has(a.id) ? 1 : 0;
          bValue = articlesWithMainFile.has(b.id) ? 1 : 0;
            break;
          case 'created_at':
              aValue = new Date(a.created_at).getTime();
              bValue = new Date(b.created_at).getTime();
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [articles, searchTerm, filterValues, sortField, sortDirection, articlesWithMainFile]);

    const filteredArticlesRef = useRef(filteredArticles);
    filteredArticlesRef.current = filteredArticles;
    const selectedArticlesRef = useRef(selectedArticles);
    selectedArticlesRef.current = selectedArticles;

    useEffect(() => {
        onExportAvailabilityChange?.(
            filteredArticles.length > 0 || selectedArticles.size > 0,
        );
    }, [filteredArticles, selectedArticles, onExportAvailabilityChange]);

    useImperativeHandle(
        ref,
        () => ({
            openExportDialog: () => {
                if (
                    filteredArticlesRef.current.length > 0 ||
                    selectedArticlesRef.current.size > 0
                ) {
                    setExportDialogOpen(true);
                }
            },
        }),
        [],
    );

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedArticles(new Set(filteredArticles.map(a => a.id)));
    } else {
      setSelectedArticles(new Set());
    }
  };

    const hasActiveListFilters = activeFiltersList.length > 0 || !!searchTerm.trim();
    /** CSS class for responsive column visibility (sm = always, md/lg = hidden until that breakpoint). */
    const colVisibilityClass = (breakpoint?: 'sm' | 'md' | 'lg') =>
        !breakpoint || breakpoint === 'sm' ? '' : breakpoint === 'md' ? 'hidden md:table-cell' : 'hidden lg:table-cell';
    useListKeyboardShortcuts({
        searchInputRef,
        setFilterPopoverOpen,
        filterPopoverOpen,
        deselectAll: () => setSelectedArticles(new Set()),
        selectedCount: selectedArticles.size,
        hasActiveFilters: hasActiveListFilters,
        selectAll: () => setSelectedArticles(new Set(filteredArticles.map(a => a.id))),
        selectFiltered: () => setSelectedArticles(new Set(filteredArticles.map(a => a.id))),
    });

    const showEmpty = filteredArticles.length === 0 && articles.length === 0;
    const emptyContent = showEmpty ? (
        <div
            className="flex flex-col items-center justify-center py-24 px-4 bg-muted/10 rounded-lg border border-dashed border-border/40">
            <FileText className="h-10 w-10 text-muted-foreground/30 mb-4" strokeWidth={1.2}/>
            <h3 className="text-base font-medium text-foreground mb-1.5 text-center">{t('articles', 'listNoArticlesYet')}</h3>
            <p className="text-[13px] text-muted-foreground text-center mb-8 max-w-xs mx-auto">
                {t('articles', 'listStartByImporting')}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
                <Button
                    onClick={() =>
                        onOpenAddArticle
                            ? onOpenAddArticle()
                            : navigate(`/projects/${projectId}/articles/add`)
                    }
                    className="h-10 px-6 text-[13px] font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors shadow-sm"
                >
                    <Plus className="mr-2 h-4 w-4"/>
                    {t('articles', 'listAddFirstArticle')}
                </Button>
                {useImportCallbacks ? (
                    <>
                        {onOpenRisDialog && (
                            <Button
                                variant="outline"
                                onClick={onOpenRisDialog}
                                className="h-10 px-6 text-[13px] font-medium rounded-lg border-border/50 hover:bg-muted/50 transition-colors"
                            >
                                <FileText className="mr-2 h-4 w-4"/>
                                {t('articles', 'listImportFromRis')}
                            </Button>
                        )}
                        <Button
                            variant="outline"
                            onClick={() =>
                                hasZoteroConfigured
                                    ? onOpenZoteroDialog?.()
                                    : navigate('/settings?tab=integrations')
                            }
                            className="h-10 px-6 text-[13px] font-medium rounded-lg border-border/50 hover:bg-muted/50 transition-colors"
                        >
                            <Upload className="mr-2 h-4 w-4"/>
                            {onOpenRisDialog ? t('articles', 'listFromZotero') : t('articles', 'listImportArticles')}
                        </Button>
                    </>
                ) : (
                    hasZoteroConfigured ? (
                        <Button
                            variant="outline"
                            onClick={() => setZoteroImportOpen(true)}
                            className="h-10 px-6 text-[13px] font-medium rounded-lg border-border/50 hover:bg-muted/50 transition-colors"
                        >
                            <Upload className="mr-2 h-4 w-4"/>
                            {t('articles', 'listImportArticles')}
                        </Button>
                    ) : (
                        <Button
                            variant="outline"
                            onClick={() => navigate("/settings?tab=integrations")}
                            className="h-10 px-6 text-[13px] font-medium rounded-lg border-border/50 hover:bg-muted/50 transition-colors"
                        >
                            <Upload className="mr-2 h-4 w-4"/>
                            {t('articles', 'listImportArticles')}
                        </Button>
                    )
                )}
            </div>
        </div>
    ) : null;

    const tableContent = (
            <DataTableWrapper className="overflow-hidden rounded-md border border-border/40">
            <Table className="table-fixed w-max min-w-full">
                      <TableHeader className="bg-transparent">
                          <TableRow className="hover:bg-transparent border-b border-border/40 h-8">
                              <TableHead className="w-[40px] min-w-[40px] px-2 py-1.5 text-left align-middle">
                                  <Checkbox
                                      checked={selectedArticles.size === filteredArticles.length && filteredArticles.length > 0}
                                      onCheckedChange={handleSelectAll}
                                      aria-label={t('articles', 'listSelectAll')}
                                      className="h-3.5 w-3.5 rounded-sm"
                                  />
                              </TableHead>
                              {TABLE_COLUMNS.filter(
                                  (col) =>
                                      col.visibleKey == null || visibleColumns[col.visibleKey] === true
                              ).map((col) => (
                                  <TableHead
                                      key={col.id}
                                      ref={(el) => registerHeaderRef(col.id, el)}
                                      className={`relative h-8 text-xs font-medium text-muted-foreground group/head ${TABLE_CELL_CLASS} ${colVisibilityClass(col.breakpoint)}`}
                                      style={getColumnStyle(col.id)}
                                  >
                                      {col.sortField != null ? (
                                          <SortIconHeader
                                              label={col.label}
                                              direction={sortField === col.sortField ? sortDirection : null}
                                              onSort={() => handleSort(col.sortField!)}
                                              containerClassName="flex items-center gap-1 pr-4 min-w-0"
                                              labelClassName="text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
                                              iconClassName={sortField === col.sortField ? 'h-3 w-3 text-foreground shrink-0' : 'h-3 w-3 text-muted-foreground opacity-50 shrink-0'}
                                          />
                                      ) : (
                                          <div className="pr-4 min-w-0">
                                              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                                                  {col.label}
                                              </span>
                                          </div>
                                      )}
                                      <div
                                          role="separator"
                                          aria-label={t('articles', 'listResizeColumn')}
                                          onMouseDown={(e) => {
                                              e.preventDefault();
                                              startResize(col.id, e.clientX);
                                          }}
                                          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/20 shrink-0"
                                      />
                                  </TableHead>
                              ))}
                              <TableHead className="w-[40px] min-w-[40px] px-2 py-1.5 text-right"/>
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                          {filteredArticles.map((article) => (
                              <TableRow
                                  key={article.id}
                                  className="border-b border-border/40 hover:bg-muted/50 transition-colors duration-75 group h-8"
                              >
                                  {/* Checkbox */}
                                  <TableCell className={TABLE_CELL_CLASS}>
                                      <Checkbox
                                          checked={selectedArticles.has(article.id)}
                                          onCheckedChange={(checked) => handleSelectArticle(article.id, checked as boolean)}
                                          onClick={(e) => e.stopPropagation()}
                                          aria-label={t('articles', 'listSelectArticle').replace('{{title}}', article.title ?? t('articles', 'listArticle'))}
                                          className="h-3.5 w-3.5 rounded-sm"
                                      />
                                  </TableCell>

                                  {/* Title */}
                                  <TableCell
                                      className={`${TABLE_CELL_CLASS} font-medium cursor-pointer ${colVisibilityClass('sm')}`}
                                      style={getColumnStyle('title')}
                                      onClick={() => onArticleClick(article.id)}
                                  >
                                      <div
                                          className="line-clamp-1 text-[13px] leading-tight text-foreground font-medium group-hover:text-primary transition-colors">
                                          {article.title ?? t('articles', 'listUntitled')}
                                      </div>
                                  </TableCell>

                                  {/* PDF */}
                                  {visibleColumns.pdf === true && (
                                      <TableCell className={`${TABLE_CELL_CLASS} ${colVisibilityClass('sm')}`}
                                                 style={getColumnStyle('pdf')}>
                                          <div className="flex items-center gap-1 min-w-0">
                                          {articlesWithMainFile.has(article.id) ? (
                                              <div
                                                  className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-success/10 text-success text-[10px] font-bold uppercase tracking-tight cursor-pointer hover:bg-success/20 transition-colors"
                                                  onClick={async (e) => {
                                                      e.stopPropagation();
                                                      try {
                                                          const {data: fileData, error} = await supabase
                                                              .from("article_files")
                                                              .select("storage_key, original_filename")
                                                              .eq("article_id", article.id)
                                                              .eq("file_role", "MAIN")
                                                              .single();

                                                          if (error || !fileData) {
                                                              toast.error(t('articles', 'listPdfNotFound'));
                                                              return;
                                                          }

                                                          const {
                                                              data: signedUrl,
                                                              error: urlError
                                                          } = await supabase.storage
                                                              .from("articles")
                                                              .createSignedUrl(fileData.storage_key, 3600);

                                                          if (urlError) {
                                                              toast.error(t('articles', 'listErrorAccessingPdf'));
                                                              return;
                                                          }

                                                          window.open(signedUrl.signedUrl, "_blank");
                                                      } catch (error) {
                                                          console.error("Error opening PDF:", error);
                                                          toast.error(t('articles', 'listErrorOpeningPdf'));
                                                      }
                                                  }}
                                              >
                                                  PDF
                                              </div>
                                          ) : (
                                              <Button
                                                  size="sm"
                                                  variant="ghost"
                                                  onClick={(e) => {
                                                      e.stopPropagation();
                                                      openUploadDialog(article.id);
                                                  }}
                                                  className="h-6 px-1.5 text-[11px] font-medium rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
                                              >
                                                  <Plus className="h-2.5 w-2.5 mr-0.5"/>
                                                  {t('articles', 'listAddPdf')}
                                              </Button>
                                          )}
                                          </div>
                                      </TableCell>
                                  )}

                                  {/* Source */}
                                  {visibleColumns.source === true && (
                                      <TableCell className={`${TABLE_CELL_CLASS} ${colVisibilityClass('md')}`}
                                                 style={getColumnStyle('source')}>
                                          <div className="flex items-center gap-1">
                                              <Badge variant="outline" className="h-4 px-1 text-[10px] uppercase">
                                                  {article.ingestion_source ?? "MANUAL"}
                                              </Badge>
                                              {article.sync_state && article.sync_state !== "active" && (
                                                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                                                      {article.sync_state}
                                                  </Badge>
                                              )}
                                          </div>
                                      </TableCell>
                                  )}

                                  {/* Authors */}
                                  {visibleColumns.authors === true && (
                                      <TableCell
                                          className={`${TABLE_CELL_CLASS} text-[13px] text-muted-foreground font-medium ${colVisibilityClass('md')}`}
                                          style={getColumnStyle('authors')}>
                                          <TooltipProvider>
                                              <Tooltip>
                                                  <TooltipTrigger asChild>
                                                      <div className="truncate max-w-[120px]">
                                                          {(() => {
                                                              const part = article.authors?.slice(0, 2).join(", ") ?? "";
                                                              const suffix = (article.authors?.length || 0) > 2 ? " et al." : "";
                                                              return (part + suffix).trim() || "\u2013";
                                                          })()}
                                                      </div>
                                                  </TooltipTrigger>
                                                  <TooltipContent>
                                                      <div className="max-w-xs p-1">
                                                          <p className="font-semibold text-xs mb-1">{t('articles', 'listAuthorsLabel')}</p>
                                                          <p className="text-[11px] leading-relaxed">{article.authors?.join(", ") ?? '\u2013'}</p>
                                                      </div>
                                                  </TooltipContent>
                                              </Tooltip>
                                          </TooltipProvider>
                                      </TableCell>
                                  )}

                                  {/* Journal */}
                                  {visibleColumns.journal === true && (
                                      <TableCell
                                          className={`${TABLE_CELL_CLASS} text-[13px] text-muted-foreground italic ${colVisibilityClass('lg')}`}
                                          style={getColumnStyle('journal')}>
                        <span
                            className="line-clamp-2 leading-tight"
                            title={article.journal_title ?? ''}
                        >
                          {article.journal_title || "\u2013"}
                        </span>
                                      </TableCell>
                                  )}

                                  {/* Year */}
                                  {visibleColumns.year === true && (
                                      <TableCell className={`${TABLE_CELL_CLASS} ${colVisibilityClass('md')}`}
                                                 style={getColumnStyle('year')}>
                                          {article.publication_year ? (
                                              <span
                                                  className="text-xs font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {article.publication_year}
                          </span>
                                          ) : (
                                              <span className="text-[12px] text-muted-foreground/50">–</span>
                                          )}
                                      </TableCell>
                                  )}

                                  {/* Keywords */}
                                  {visibleColumns.keywords === true && (
                                      <TableCell className={`${TABLE_CELL_CLASS} ${colVisibilityClass('lg')}`}
                                                 style={getColumnStyle('keywords')}>
                                          {article.keywords && article.keywords.length > 0 ? (
                                              <div className="flex flex-wrap gap-1">
                                                  {article.keywords.slice(0, 1).map((keyword, idx) => (
                                                      <Badge key={idx} variant="outline"
                                                             className="text-[10px] h-4.5 px-1 font-medium bg-transparent border-border/60">
                                                          {keyword ?? '\u2013'}
                                                      </Badge>
                                                  ))}
                                                  {article.keywords.length > 1 && (
                                                      <Badge variant="outline"
                                                             className="text-[10px] h-4.5 px-1 font-medium bg-transparent border-border/60">
                                                          +{article.keywords.length - 1}
                                                      </Badge>
                                                  )}
                                              </div>
                                          ) : (
                                              <span className="text-[12px] text-muted-foreground/50">–</span>
                                          )}
                                      </TableCell>
                                  )}

                                  {/* DOI */}
                                  {visibleColumns.doi === true && (
                                      <TableCell className={`${TABLE_CELL_CLASS} ${colVisibilityClass('lg')}`}
                                                 style={getColumnStyle('doi')}>
                                          {article.doi ? (
                                              <TooltipProvider>
                                                  <Tooltip>
                                                      <TooltipTrigger asChild>
                                                          <button
                                                              type="button"
                                                              className="max-w-full text-left text-[12px] font-medium text-primary underline-offset-2 hover:underline line-clamp-2"
                                                              onClick={(e) => {
                                                                  e.stopPropagation();
                                                                  const raw = article.doi!.trim();
                                                                  const path = raw
                                                                      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
                                                                      .replace(/^doi:\s*/i, '');
                                                                  window.open(`https://doi.org/${path}`, '_blank', 'noopener,noreferrer');
                                                              }}
                                                          >
                                                              {article.doi.trim()}
                                                          </button>
                                                      </TooltipTrigger>
                                                      <TooltipContent side="top" className="max-w-sm">
                                                          <p className="break-all text-xs">{article.doi}</p>
                                                          <p className="text-[11px] text-muted-foreground mt-1">{t('articles', 'listDoiOpenHint')}</p>
                                                      </TooltipContent>
                                                  </Tooltip>
                                              </TooltipProvider>
                                          ) : (
                                              <span className="text-[12px] text-muted-foreground/50">–</span>
                                          )}
                                      </TableCell>
                                  )}

                                  {/* Abstract */}
                                  {visibleColumns.abstract === true && (
                                      <TableCell className={`${TABLE_CELL_CLASS} ${colVisibilityClass('lg')}`}
                                                 style={getColumnStyle('abstract')}>
                                          <div
                                              className="text-[12px] text-muted-foreground/80 line-clamp-2 leading-tight">
                                              {article.abstract || "\u2013"}
                                          </div>
                                      </TableCell>
                                  )}

                                  {ARTICLES_DATA_COLUMN_DEFS.map(({id}) =>
                                      visibleColumns[id] === true ? (
                                          <TableCell
                                              key={id}
                                              className={`${TABLE_CELL_CLASS} hidden lg:table-cell`}
                                              style={getColumnStyle(id)}
                                          >
                                              <span
                                                  className="line-clamp-2 text-[12px] leading-tight text-muted-foreground"
                                                  title={articleListCellTitle(article, id) ?? formatArticleListCell(article, id)}
                                              >
                                                  {formatArticleListCell(article, id)}
                                              </span>
                                          </TableCell>
                                      ) : null
                                  )}

                                  {/* Actions */}
                                  <TableCell className={`${TABLE_CELL_CLASS} text-right`}>
                                      <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                              <Button
                                                  size="icon"
                                                  variant="ghost"
                                                  className="h-6 w-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity"
                                                  onClick={(e) => e.stopPropagation()}
                                              >
                                                  <MoreHorizontal className="h-3.5 w-3.5"/>
                                              </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end" className="w-44">
                                              <DropdownMenuItem
                                                  onClick={(e) => {
                                                      e.stopPropagation();
                                                      onArticleClick(article.id);
                                                  }}
                                                  className="text-xs"
                                              >
                                                  <FileText className="mr-2 h-3.5 w-3.5"/>
                                                  Ver Detalhes
                                              </DropdownMenuItem>
                                              <DropdownMenuItem
                                                  onClick={(e) => {
                                                      e.stopPropagation();
                                                      openUploadDialog(article.id);
                                                  }}
                                                  className="text-xs"
                                              >
                                                  <Upload className="mr-2 h-3.5 w-3.5"/>
                                                  Attach file
                                              </DropdownMenuItem>
                                              <DropdownMenuSeparator/>
                                              <DropdownMenuItem
                                                  onClick={(e) => {
                                                      e.stopPropagation();
                                                      openDeleteDialog(article.id);
                                                  }}
                                                  className="text-xs text-destructive focus:text-destructive"
                                              >
                                                  <Trash2 className="mr-2 h-3.5 w-3.5"/>
                                                  Delete
                                              </DropdownMenuItem>
                                          </DropdownMenuContent>
                                      </DropdownMenu>
                                  </TableCell>
                              </TableRow>
                          ))}
                      </TableBody>
                  </Table>
            </DataTableWrapper>
    );

    const cardContent = (
        <>
            {filteredArticles.map((article) => (
                <ListRowCard
                    key={article.id}
                    leading={
                        <Checkbox
                            checked={selectedArticles.has(article.id)}
                            onCheckedChange={(checked) => handleSelectArticle(article.id, checked as boolean)}
                            aria-label={t('articles', 'listSelectArticle').replace('{{title}}', article.title ?? t('articles', 'listArticle'))}
                            className="h-3.5 w-3.5 rounded-sm"
                        />
                    }
                    title={article.title ?? t('articles', 'listUntitled')}
                    subtitle={article.authors?.slice(0, 2).join(', ') || undefined}
                    meta={
                        <>
                            <span className="uppercase">{article.ingestion_source ?? "MANUAL"}</span>
                            {article.publication_year != null && <span>{article.publication_year}</span>}
                            {article.journal_title && <span className="italic">{article.journal_title}</span>}
                            {article.sync_state && article.sync_state !== "active" && <span>{article.sync_state}</span>}
                        </>
                    }
                    primaryAction={
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-8 gap-1"
                                        onClick={(e) => e.stopPropagation()}>
                                    <MoreHorizontal className="h-3.5 w-3.5"/>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem onClick={(e) => {
                                    e.stopPropagation();
                                    onArticleClick(article.id);
                                }} className="text-xs">
                                    <FileText className="mr-2 h-3.5 w-3.5"/> Ver Detalhes
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={(e) => {
                                    e.stopPropagation();
                                    openUploadDialog(article.id);
                                }} className="text-xs">
                                    <Upload className="mr-2 h-3.5 w-3.5"/> Attach file
                                </DropdownMenuItem>
                                <DropdownMenuSeparator/>
                                <DropdownMenuItem onClick={(e) => {
                                    e.stopPropagation();
                                    openDeleteDialog(article.id);
                                }} className="text-xs text-destructive focus:text-destructive">
                                    <Trash2 className="mr-2 h-3.5 w-3.5"/> Delete
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    }
                    onClick={() => onArticleClick(article.id)}
                />
            ))}
        </>
    );

    const bodyContent = showEmpty ? emptyContent : (
        <ResponsiveList isNarrow={isNarrow} tableContent={tableContent} cardContent={cardContent}/>
    );

    return (
        <>
            <div className="space-y-3">
                <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2 w-full">
                        <ListToolbarSearch
                            ref={searchInputRef}
                            placeholder="Search... (⌘F / Ctrl+F)"
                            value={searchTerm}
                            onChange={setSearchTerm}
                        />
                        <FilterButtonWithPopover
                            open={filterPopoverOpen}
                            onOpenChange={setFilterPopoverOpen}
                            activeCount={activeFiltersList.length + (searchTerm.trim() ? 1 : 0)}
                            tooltipLabel="Filter (F)"
                            ariaLabel="Filter (F)"
                        >
                            <ListFilterPanel
                                fields={ARTICLES_FILTER_FIELDS}
                                values={filterValues}
                                onChange={setFilterValues}
                                facetedValues={{
                                    authors: facetedValues.authors,
                                    journal_title: facetedValues.journals,
                                    publication_year: facetedValues.years,
                                    keywords: facetedValues.keywords,
                                }}
                            />
                        </FilterButtonWithPopover>
                        <ListDisplaySortPopover
                            sortOptions={[
                                {value: 'title', label: 'Title'},
                                {value: 'authors', label: 'Authors'},
                                {value: 'journal_title', label: 'Journal'},
                                {value: 'publication_year', label: 'Year'},
                                {value: 'has_main_file', label: 'PDF'},
                                {value: 'created_at', label: 'Created'},
                            ]}
                            sortField={sortField}
                            sortDirection={sortDirection}
                            onSortFieldChange={(v) => setSortField(v as SortField)}
                            onSortDirectionChange={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
                            orderLabel={t('articles', 'listOrdering')}
                            columns={[
                                {key: 'title', label: 'Title', disabled: true},
                                ...TABLE_COLUMNS.filter((c) => c.visibleKey != null).map((c) => ({
                                    key: c.visibleKey as string,
                                    label: c.label,
                                })),
                            ]}
                            visibleKeys={visibleColumns}
                            onToggleColumn={(key) => toggleColumn(String(key))}
                            displayPropertiesLabel={t('articles', 'listDisplayProperties')}
                            tooltipLabel={t('articles', 'listDisplayAndSort')}
                            ariaLabel={t('articles', 'listDisplayOptions')}
                        />
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-auto">
                        <ListCount
                            visible={filteredArticles.length}
                            total={articles.length}
                            label={articles.length === 1 ? t('articles', 'listArticle') : t('articles', 'listArticles')}
                        />
                        {selectedArticles.size > 0 && (
                            <div className="flex items-center gap-2 animate-in fade-in duration-200">
                          <span className="text-[11px] font-medium text-foreground">
                              {selectedArticles.size} {t('articles', 'listSelected')}
                          </span>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setBulkDeleteDialogOpen(true)}
                                    disabled={deleting}
                                    className="h-6 text-[11px] text-destructive hover:text-destructive hover:bg-destructive/10"
                                >
                                    <Trash2 className="mr-1 h-3 w-3"/>
                                    {t('articles', 'listDelete')}
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
                <ActiveFilterChips
                    filters={activeFiltersList}
                    onClearField={clearFilterField}
                    onClearAll={clearAllFilters}
                    clearAllLabel={t('articles', 'listClearAll')}
                    removeFilterAriaLabel={(label) => t('articles', 'listRemoveFilter').replace('{{label}}', label)}
                />
            </div>

            {bodyContent}

            {/* Empty state after filters */}
            {filteredArticles.length === 0 && articles.length > 0 && (
                <EmptyListState
                    icon={Search}
                    title={t('articles', 'listNoMatchSearch')}
                    description={t('articles', 'listAdjustSearchOrClearFilters')}
                    actionLabel={t('articles', 'listClearAllFiltersButton')}
                    onAction={clearAllFilters}
                />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
              <AlertDialogTitle>{t('articles', 'listConfirmDelete')}</AlertDialogTitle>
            <AlertDialogDescription>
                {t('articles', 'listConfirmDeleteDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
              <AlertDialogCancel>{t('articles', 'listCancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => articleToDelete && handleDeleteArticle(articleToDelete)}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
                {deleting ? t('articles', 'listDeleting') : t('articles', 'listDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

            <ArticlesExportDialog
                open={exportDialogOpen}
                onOpenChange={setExportDialogOpen}
                projectId={projectId}
                currentListIds={filteredArticles.map((a) => a.id)}
                selectedIds={Array.from(selectedArticles)}
                defaultArticleScope={selectedArticles.size > 0 ? "selected" : "current_list"}
            />

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
              <AlertDialogTitle>{t('articles', 'listConfirmBulkDelete')}</AlertDialogTitle>
            <AlertDialogDescription>
                {t('articles', 'listConfirmBulkDeleteDesc').replace('{{n}}', String(selectedArticles.size))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
              <AlertDialogCancel>{t('articles', 'listCancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
                {deleting ? t('articles', 'listDeleting') : t('articles', 'listDeleteCount').replace('{{n}}', String(selectedArticles.size))}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* File Upload Dialog */}
      {articleToUpload && (
        <ArticleFileUploadDialogNew
          open={uploadDialogOpen}
          onOpenChange={setUploadDialogOpen}
          articleId={articleToUpload as string}
          projectId={projectId}
          onFileUploaded={() => {
            onArticlesChange?.();
            setArticleToUpload(null);
          }}
        />
      )}

          {/* Zotero Import Dialog (only when not controlled by parent) */}
          {!useImportCallbacks && (
              <ZoteroImportDialog
                  open={zoteroImportOpen}
                  onOpenChange={setZoteroImportOpen}
                  projectId={projectId}
                  onImportComplete={() => {
                      onArticlesChange?.();
                  }}
              />
          )}
        </>
  );
});

ArticlesList.displayName = 'ArticlesList';