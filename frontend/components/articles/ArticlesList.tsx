import {useEffect, useMemo, useRef, useState} from "react";
import type {CSSProperties} from "react";
import {useNavigate} from "react-router-dom";
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {Badge} from "@/components/ui/badge";
import {Checkbox} from "@/components/ui/checkbox";
import {
  ChevronDown,
    ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  FileText,
  Filter,
    LayoutGrid,
  MoreHorizontal,
  Plus,
  Search,
    SlidersHorizontal,
  Trash2,
    Upload,
    X
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
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import {supabase} from "@/integrations/supabase/client";
import {toast} from "sonner";
import {t} from "@/lib/copy";
import {ArticleFileUploadDialogNew} from "./ArticleFileUploadDialogNew";
import {ZoteroImportDialog} from "./ZoteroImportDialog";
import {useZoteroIntegration} from "@/hooks/useZoteroIntegration";

interface Article {
  id: string;
  title: string;
  abstract: string | null;
  publication_year: number | null;
  journal_title: string | null;
  authors: string[] | null;
  doi: string | null;
  pmid: string | null;
  keywords: string[] | null;
}

interface ArticlesListProps {
  articles: Article[];
  onArticleClick: (articleId: string) => void;
  projectId: string;
  onArticlesChange?: () => void;
    /** When provided, Zotero dialog is controlled by parent (e.g. ProjectView) */
    onOpenZoteroDialog?: () => void;
    /** When provided, shows "Via RIS file" option alongside Zotero */
    onOpenRisDialog?: () => void;
}

type SortField = 'title' | 'authors' | 'journal_title' | 'publication_year' | 'created_at' | 'has_main_file';
type SortDirection = 'asc' | 'desc';

interface ColumnFilter {
  title: string;
  authors: string;
  journal_title: string;
  publication_year: string;
  keywords: string;
    /** 'yes' = has PDF, 'no' = no PDF, '' = any */
    has_main_file: '' | 'yes' | 'no';
}

interface VisibleColumns {
  title: boolean;
  pdf: boolean;
  authors: boolean;
  journal: boolean;
  year: boolean;
  keywords: boolean;
  doi: boolean;
  abstract: boolean;
}

/** Minimum padding in cells (Linear / frontend-ux) — compact. */
const TABLE_CELL_CLASS = 'px-2 py-1';

/** Data column configuration for header (DRY). id = key in columnWidths. */
const TABLE_COLUMNS: Array<{
    id: string;
    label: string;
    sortField?: SortField;
    filterKey?: keyof ColumnFilter;
    visibleKey?: keyof VisibleColumns;
    flexible?: boolean;
}> = [
    {id: 'title', label: 'Title', sortField: 'title', filterKey: 'title', flexible: true},
    {id: 'pdf', label: 'PDF', sortField: 'has_main_file', filterKey: 'has_main_file', visibleKey: 'pdf'},
    {id: 'authors', label: 'Authors', sortField: 'authors', filterKey: 'authors', visibleKey: 'authors'},
    {id: 'journal', label: 'Journal', sortField: 'journal_title', filterKey: 'journal_title', visibleKey: 'journal'},
    {id: 'year', label: 'Year', sortField: 'publication_year', filterKey: 'publication_year', visibleKey: 'year'},
    {id: 'keywords', label: 'Keywords', filterKey: 'keywords', visibleKey: 'keywords'},
    {id: 'doi', label: 'DOI', visibleKey: 'doi'},
    {id: 'abstract', label: 'Abstract', visibleKey: 'abstract'},
];

export function ArticlesList({
                                 articles,
                                 onArticleClick,
                                 projectId,
                                 onArticlesChange,
                                 onOpenZoteroDialog,
                                 onOpenRisDialog,
                             }: ArticlesListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [articleToDelete, setArticleToDelete] = useState<string | null>(null);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [articleToUpload, setArticleToUpload] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [zoteroImportOpen, setZoteroImportOpen] = useState(false);
  const [articlesWithMainFile, setArticlesWithMainFile] = useState<Set<string>>(new Set());

    const useImportCallbacks = !!onOpenZoteroDialog;

    const navigate = useNavigate();
    const searchInputRef = useRef<HTMLInputElement>(null);
    // Hook to check if user has Zotero integration configured
  const { isConfigured: hasZoteroConfigured } = useZoteroIntegration();

    // Shortcut ⌘K / Ctrl+K to focus search; F to open filter (when not in input/textarea)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                searchInputRef.current?.focus();
                return;
            }
            if (e.key === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) {
                const target = e.target as HTMLElement;
                const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
                if (!inInput) {
                    e.preventDefault();
                    setFilterPopoverOpen(prev => !prev);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

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
  const [columnFilters, setColumnFilters] = useState<ColumnFilter>({
    title: '',
    authors: '',
    journal_title: '',
    publication_year: '',
      keywords: '',
      has_main_file: ''
  });
    const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
    const [filterCategoryOpen, setFilterCategoryOpen] = useState<keyof ColumnFilter | null>(null);
    /** Which column has the filter popover in header open (one at a time) */
    const [openColumnFilter, setOpenColumnFilter] = useState<keyof ColumnFilter | null>(null);
    const [displayPopoverOpen, setDisplayPopoverOpen] = useState(false);

    // Visible columns
  const [visibleColumns, setVisibleColumns] = useState<VisibleColumns>({
    title: true,
    pdf: true,
    authors: true,
    journal: true,
    year: true,
    keywords: true,
    doi: false,
    abstract: false
  });

    // Resizable column widths (persisted in localStorage)
    const COLUMN_WIDTHS_KEY = 'articles-list-column-widths';
    const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
        title: 320,
        pdf: 100,
        authors: 140,
        journal: 160,
        year: 100,
        keywords: 160,
        doi: 130,
        abstract: 280,
    };
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
        }
        return {...DEFAULT_COLUMN_WIDTHS};
    });
    const [resizingColumn, setResizingColumn] = useState<string | null>(null);
    const [resizeStartX, setResizeStartX] = useState(0);
    const [resizeStartWidth, setResizeStartWidth] = useState(0);
    const columnWidthsRef = useRef(columnWidths);
    columnWidthsRef.current = columnWidths;
    /** Refs updated each mousemove so delta is always relative to last frame; avoids splitter jumping to opposite side on drag (reflow/scroll). */
    const lastXRef = useRef(0);
    const lastWidthRef = useRef(0);

    useEffect(() => {
        if (resizingColumn === null) return;
        const minW = 80;
        const maxW = 600;
        lastXRef.current = resizeStartX;
        lastWidthRef.current = resizeStartWidth;
        const onMove = (e: MouseEvent) => {
            const delta = e.clientX - lastXRef.current;
            const newWidth = Math.min(maxW, Math.max(minW, lastWidthRef.current + delta));
            lastXRef.current = e.clientX;
            lastWidthRef.current = newWidth;
            setColumnWidths(prev => ({...prev, [resizingColumn]: newWidth}));
        };
        const onUp = () => {
            try {
                localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(columnWidthsRef.current));
            } catch (_) {
            }
            setResizingColumn(null);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [resizingColumn, resizeStartX, resizeStartWidth]);

    useEffect(() => {
        if (resizingColumn) {
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        } else {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
        return () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [resizingColumn]);

    const startResize = (columnId: string, clientX: number) => {
        const initialWidth = columnWidths[columnId] ?? DEFAULT_COLUMN_WIDTHS[columnId];
        setResizingColumn(columnId);
        setResizeStartX(clientX);
        setResizeStartWidth(initialWidth);
    };

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

    // Update column filter
  const updateColumnFilter = (column: keyof ColumnFilter, value: string) => {
    setColumnFilters(prev => ({
      ...prev,
        [column]: column === 'has_main_file' ? (value as '' | 'yes' | 'no') : value
    }));
  };

    // Clear all column filters
    const clearAllColumnFilters = () => {
        setColumnFilters({
            title: '',
            authors: '',
            journal_title: '',
            publication_year: '',
            keywords: '',
            has_main_file: ''
        });
    };

    const hasColumnFilter = (col: keyof ColumnFilter): boolean =>
        col === 'has_main_file' ? !!columnFilters.has_main_file : columnFilters[col].trim() !== '';

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

    // List of active filters to show in chip bar (derived from columnFilters)
    const activeFiltersList = useMemo(() => {
        const labels: Record<keyof ColumnFilter, string> = {
            title: 'Title',
            authors: 'Authors',
            journal_title: 'Journal',
            publication_year: 'Year',
            keywords: 'Keywords',
            has_main_file: 'PDF'
    };
        const list: { column: keyof ColumnFilter; label: string; value: string }[] = [];
        (Object.keys(columnFilters) as (keyof ColumnFilter)[]).forEach(col => {
            if (col === 'has_main_file') {
                if (columnFilters.has_main_file === 'yes') list.push({
                    column: 'has_main_file',
                    label: labels.has_main_file,
                    value: 'Has PDF'
                });
                else if (columnFilters.has_main_file === 'no') list.push({
                    column: 'has_main_file',
                    label: labels.has_main_file,
                    value: 'No PDF'
                });
            } else if (columnFilters[col].trim() !== '') {
                list.push({column: col, label: labels[col], value: columnFilters[col].trim()});
            }
        });
        return list;
    }, [columnFilters]);

    /** Filter panel content for a column (reused in global Filter and header popover) */
    const renderColumnFilterPanelContent = (col: keyof ColumnFilter) => {
        if (col === 'title') {
            return (
                <div className="space-y-2">
                    <label
                        className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Title</label>
                    <Input
                        placeholder={t('articles', 'listSearchTitlePlaceholder')}
                        value={columnFilters.title}
                        onChange={(e) => updateColumnFilter('title', e.target.value)}
                        className="h-8 text-[13px]"
                    />
                    <p className="text-[11px] text-muted-foreground">{t('articles', 'listMatchesTextInTitle')}</p>
                </div>
            );
        }
        if (col === 'authors') {
            return (
                <div className="space-y-2">
                    <label
                        className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Authors</label>
                    <Input
                        placeholder={t('articles', 'listSearchAuthorPlaceholder')}
                        value={columnFilters.authors}
                        onChange={(e) => updateColumnFilter('authors', e.target.value)}
                        className="h-8 text-[13px]"
                    />
                    {facetedValues.authors.length > 0 && (
                        <div className="space-y-1 pt-1">
                            <p className="text-[11px] text-muted-foreground">{t('articles', 'listSuggestions')}</p>
                            <div className="flex flex-wrap gap-1">
                                {facetedValues.authors.slice(0, 12).map(({value, count}) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => updateColumnFilter('authors', value)}
                                        className="rounded-md border border-border/40 bg-muted/30 px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                                    >
                                        {value} ({count})
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            );
        }
        if (col === 'journal_title') {
            return (
                <div className="space-y-2">
                    <label
                        className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Journal</label>
                    <Input
                        placeholder={t('articles', 'listSearchJournalPlaceholder')}
                        value={columnFilters.journal_title}
                        onChange={(e) => updateColumnFilter('journal_title', e.target.value)}
                        className="h-8 text-[13px]"
                    />
                    {facetedValues.journals.length > 0 && (
                        <div className="space-y-1 pt-1">
                            <p className="text-[11px] text-muted-foreground">{t('articles', 'listSuggestions')}</p>
                            <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">
                                {facetedValues.journals.slice(0, 15).map(({value, count}) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => updateColumnFilter('journal_title', value)}
                                        className="rounded-md border border-border/40 bg-muted/30 px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted/60 hover:text-foreground truncate max-w-full"
                                    >
                                        {value} ({count})
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            );
        }
        if (col === 'publication_year') {
            const bounds = getYearFilterBounds(columnFilters.publication_year);
            const yearOptions = (() => {
                const fromData = facetedValues.years.length > 0
                    ? facetedValues.years.map(({value}) => value)
                    : [];
                const currentYear = new Date().getFullYear();
                const defaultYears = Array.from({length: currentYear - 1990 + 2}, (_, i) => String(1990 + i));
                const combined = Array.from(new Set([...fromData, ...defaultYears])).sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
                return combined;
            })();
            return (
                <div className="space-y-3">
                    <label
                        className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Year</label>
                    <div className="space-y-2">
                        <p className="text-[11px] text-muted-foreground">{t('articles', 'listYearFilterHint')}</p>
                        <div className="flex gap-2 items-center flex-wrap">
                            <div className="space-y-1">
                                <span
                                    className="text-[11px] text-muted-foreground">{t('articles', 'listFromYear')}</span>
                                <Select
                                    value={bounds.from || '_none'}
                                    onValueChange={(from) => {
                                        if (from === '_none') updateColumnFilter('publication_year', bounds.to ? `max:${bounds.to}` : '');
                                        else updateColumnFilter('publication_year', bounds.to ? `${from}-${bounds.to}` : `min:${from}`);
                                    }}
                                >
                                    <SelectTrigger className="h-8 text-[13px] w-[100px]">
                                        <SelectValue placeholder={t('articles', 'listAny')}/>
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="_none">{t('articles', 'listAny')}</SelectItem>
                                        {yearOptions.map((y) => (
                                            <SelectItem key={y} value={y}>{y}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <span className="text-[11px] text-muted-foreground pt-5">to</span>
                            <div className="space-y-1">
                                <span className="text-[11px] text-muted-foreground">{t('articles', 'listToYear')}</span>
                                <Select
                                    value={bounds.to || '_none'}
                                    onValueChange={(to) => {
                                        if (to === '_none') updateColumnFilter('publication_year', bounds.from ? `min:${bounds.from}` : '');
                                        else updateColumnFilter('publication_year', bounds.from ? `${bounds.from}-${to}` : `max:${to}`);
                                    }}
                                >
                                    <SelectTrigger className="h-8 text-[13px] w-[100px]">
                                        <SelectValue placeholder={t('articles', 'listAny')}/>
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="_none">{t('articles', 'listAny')}</SelectItem>
                                        {yearOptions.map((y) => (
                                            <SelectItem key={y} value={y}>{y}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                    {facetedValues.years.length > 0 && (
                        <>
                            <div className="space-y-1 pt-1 border-t border-border/40">
                                <p className="text-[11px] text-muted-foreground">{t('articles', 'listQuick')}</p>
                                <div className="flex flex-wrap gap-1">
                                    {(() => {
                                        const minYear = facetedValues.years[facetedValues.years.length - 1].value;
                                        const maxYear = facetedValues.years[0].value;
                                        return (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => updateColumnFilter('publication_year', `max:${parseInt(minYear, 10) - 1}`)}
                                                    className={`rounded-md border px-2 py-1 text-[12px] transition-colors ${columnFilters.publication_year === `max:${parseInt(minYear, 10) - 1}` ? 'border-primary bg-primary/10 text-primary' : 'border-border/40 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
                                                >
                                                    {t('articles', 'listBeforeYear').replace('{{year}}', minYear)}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => updateColumnFilter('publication_year', `min:${parseInt(maxYear, 10) + 1}`)}
                                                    className={`rounded-md border px-2 py-1 text-[12px] transition-colors ${columnFilters.publication_year === `min:${parseInt(maxYear, 10) + 1}` ? 'border-primary bg-primary/10 text-primary' : 'border-border/40 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
                                                >
                                                    {t('articles', 'listAfterYear').replace('{{year}}', maxYear)}
                                                </button>
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>
                            <div className="space-y-1 pt-1">
                                <p className="text-[11px] text-muted-foreground">{t('articles', 'listSingleYear')}</p>
                                <div className="flex flex-wrap gap-1">
                                    {facetedValues.years.slice(0, 10).map(({value, count}) => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() => updateColumnFilter('publication_year', `${value}-${value}`)}
                                            className="rounded-md border border-border/40 bg-muted/30 px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                                        >
                                            {value} ({count})
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            );
        }
        if (col === 'keywords') {
            return (
                <div className="space-y-2">
                    <label
                        className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Keywords</label>
                    <Input
                        placeholder={t('articles', 'listSearchKeywordPlaceholder')}
                        value={columnFilters.keywords}
                        onChange={(e) => updateColumnFilter('keywords', e.target.value)}
                        className="h-8 text-[13px]"
                    />
                    {facetedValues.keywords.length > 0 && (
                        <div className="space-y-1 pt-1">
                            <p className="text-[11px] text-muted-foreground">{t('articles', 'listSuggestions')}</p>
                            <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">
                                {facetedValues.keywords.slice(0, 15).map(({value, count}) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => updateColumnFilter('keywords', value)}
                                        className="rounded-md border border-border/40 bg-muted/30 px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                                    >
                                        {value} ({count})
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            );
        }
        if (col === 'has_main_file') {
            return (
                <div className="space-y-2">
                    <label
                        className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">PDF</label>
                    <div className="flex gap-2">
                        <Button
                            variant={columnFilters.has_main_file === 'yes' ? 'secondary' : 'ghost'}
                            size="sm"
                            className="text-[12px]"
                            onClick={() => updateColumnFilter('has_main_file', columnFilters.has_main_file === 'yes' ? '' : 'yes')}
                        >
                            {t('articles', 'listHasPdf')}
                        </Button>
                        <Button
                            variant={columnFilters.has_main_file === 'no' ? 'secondary' : 'ghost'}
                            size="sm"
                            className="text-[12px]"
                            onClick={() => updateColumnFilter('has_main_file', columnFilters.has_main_file === 'no' ? '' : 'no')}
                        >
                            {t('articles', 'listNoPdf')}
                        </Button>
          </div>
                </div>
            );
        }
        return null;
  };

    // Visible columns toggle
  const toggleColumn = (column: keyof VisibleColumns) => {
    setVisibleColumns(prev => ({
      ...prev,
      [column]: !prev[column]
    }));
  };

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

    // Helper: interpreta filtro de ano (exato, faixa, before, after, min, max) e retorna se o ano do artigo passa
    const publicationYearMatchesFilter = (year: number | null, filterValue: string): boolean => {
        if (!filterValue.trim()) return true;
        if (year == null) return false;
        const v = filterValue.trim();
        const beforeMatch = v.match(/^before:(\d{4})$/i);
        if (beforeMatch) return year < parseInt(beforeMatch[1], 10);
        const afterMatch = v.match(/^after:(\d{4})$/i);
        if (afterMatch) return year > parseInt(afterMatch[1], 10);
        const minOnlyMatch = v.match(/^min:(\d{4})$/i);
        if (minOnlyMatch) return year >= parseInt(minOnlyMatch[1], 10);
        const maxOnlyMatch = v.match(/^max:(\d{4})$/i);
        if (maxOnlyMatch) return year <= parseInt(maxOnlyMatch[1], 10);
        const rangeMatch = v.match(/^(\d{4})-(\d{4})$/);
        if (rangeMatch) {
            const min = parseInt(rangeMatch[1], 10);
            const max = parseInt(rangeMatch[2], 10);
            return year >= min && year <= max;
        }
        const exact = v.match(/^\d{4}$/);
        if (exact) return year === parseInt(v, 10);
        return year.toString().includes(v);
    };

    /** Parse do filtro de ano para exibir nos dropdowns Min/Max (retorna { from, to } em string ou '') */
    const getYearFilterBounds = (filterValue: string): { from: string; to: string } => {
        const v = filterValue.trim();
        if (!v) return {from: '', to: ''};
        const rangeMatch = v.match(/^(\d{4})-(\d{4})$/);
        if (rangeMatch) return {from: rangeMatch[1], to: rangeMatch[2]};
        const minMatch = v.match(/^min:(\d{4})$/i);
        if (minMatch) return {from: minMatch[1], to: ''};
        const maxMatch = v.match(/^max:(\d{4})$/i);
        if (maxMatch) return {from: '', to: maxMatch[1]};
        const beforeMatch = v.match(/^before:(\d{4})$/i);
        if (beforeMatch) return {from: '', to: String(parseInt(beforeMatch[1], 10) - 1)};
        const afterMatch = v.match(/^after:(\d{4})$/i);
        if (afterMatch) return {from: String(parseInt(afterMatch[1], 10) + 1), to: ''};
        const exactMatch = v.match(/^\d{4}$/);
        if (exactMatch) return {from: v, to: v};
        return {from: '', to: ''};
    };

  // Filtrar e ordenar artigos com useMemo
  const filteredArticles = useMemo(() => {
    const filtered = articles.filter(article => {
      // Filtro global de busca
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const matchesSearch =
            (article.title ?? '').toLowerCase().includes(searchLower) ||
          article.abstract?.toLowerCase().includes(searchLower) ||
            article.authors?.some(a => (a ?? '').toLowerCase().includes(searchLower)) ||
          article.journal_title?.toLowerCase().includes(searchLower) ||
            article.keywords?.some(k => (k ?? '').toLowerCase().includes(searchLower));
        
        if (!matchesSearch) return false;
      }

      // Filtros por coluna
        if (columnFilters.title && !(article.title ?? '').toLowerCase().includes(columnFilters.title.toLowerCase())) {
        return false;
      }

        if (columnFilters.authors) {
            const authorMatch = article.authors?.some(author =>
          author.toLowerCase().includes(columnFilters.authors.toLowerCase())
        );
        if (!authorMatch) return false;
      }

        if (columnFilters.journal_title) {
            if (!article.journal_title || !article.journal_title.toLowerCase().includes(columnFilters.journal_title.toLowerCase())) {
          return false;
        }
      }

        if (columnFilters.publication_year) {
            if (!publicationYearMatchesFilter(article.publication_year ?? null, columnFilters.publication_year)) {
          return false;
        }
      }

        if (columnFilters.keywords) {
            const keywordMatch = article.keywords?.some(keyword =>
          keyword.toLowerCase().includes(columnFilters.keywords.toLowerCase())
        );
        if (!keywordMatch) return false;
      }

        if (columnFilters.has_main_file === 'yes' && !articlesWithMainFile.has(article.id)) return false;
        if (columnFilters.has_main_file === 'no' && articlesWithMainFile.has(article.id)) return false;

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
        default:
          return 0;
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [articles, searchTerm, columnFilters, sortField, sortDirection, articlesWithMainFile]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedArticles(new Set(filteredArticles.map(a => a.id)));
    } else {
      setSelectedArticles(new Set());
    }
  };

  return (
      <div className="space-y-3">
          {/* Single toolbar: search + Filter + Display + count/selection (Linear) */}
          <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 w-full">
                  {/* Busca */}
                  <div className="flex-1 min-w-[200px] group">
                      <div className="relative">
                          <Search
                              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground transition-colors group-focus-within:text-foreground"/>
                          <Input
                              ref={searchInputRef}
                              placeholder="Search... (⌘K)"
                              value={searchTerm}
                              onChange={(e) => setSearchTerm(e.target.value)}
                              className="pl-8 h-8 bg-muted/40 border-transparent focus:bg-background focus:ring-0 focus:border-border/60 focus:shadow-sm transition-all text-sm rounded-md"
                          />
                      </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                      <Popover open={filterPopoverOpen} onOpenChange={setFilterPopoverOpen} modal={false}>
                          <Tooltip>
                              <TooltipTrigger asChild>
                                  <PopoverTrigger asChild>
                                      <Button
                                          variant="ghost"
                                          size="sm"
                                          className={`h-8 w-8 p-0 rounded-md hover:bg-muted/50 transition-colors relative ${activeFiltersList.length > 0 ? 'text-primary' : 'text-muted-foreground'}`}
                                          aria-label="Filter"
                                      >
                                          <Filter className="h-4 w-4"/>
                                          {activeFiltersList.length > 0 && (
                                              <span
                                                  className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary/15 px-0.5 text-[10px] font-semibold text-primary">
                          {activeFiltersList.length}
                        </span>
                                          )}
                                      </Button>
                                  </PopoverTrigger>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">Filter (F)</TooltipContent>
                          </Tooltip>
                          <PopoverContent
                              className="w-[420px] p-0 border-border/50 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
                              align="end"
                              sideOffset={6}
                              onOpenAutoFocus={(e) => e.preventDefault()}
                          >
                              <div className="flex">
                                  <div className="w-44 border-r border-border/40 py-1">
                                      <div className="px-3 py-2">
                                          <p className="text-[13px] font-medium text-muted-foreground">{t('articles', 'listAddFilter')}</p>
                                      </div>
                                      {(['title', 'authors', 'journal_title', 'publication_year', 'keywords', 'has_main_file'] as const).map(col => {
                                          const labels: Record<keyof ColumnFilter, string> = {
                                              title: 'Title',
                                              authors: 'Authors',
                                              journal_title: 'Journal',
                                              publication_year: 'Year',
                                              keywords: 'Keywords',
                                              has_main_file: 'PDF'
                                          };
                                          const hasActive = col === 'has_main_file'
                                              ? !!columnFilters.has_main_file
                                              : columnFilters[col].trim() !== '';
                                          return (
                                              <button
                                                  key={col}
                                                  type="button"
                                                  onClick={() => setFilterCategoryOpen(filterCategoryOpen === col ? null : col)}
                                                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted/50 ${filterCategoryOpen === col ? 'bg-muted/60' : ''} ${hasActive ? 'text-primary font-medium' : 'text-foreground'}`}
                                              >
                                                  {labels[col]}
                                                  <ChevronRight
                                                      className={`h-3.5 w-3.5 shrink-0 ${filterCategoryOpen === col ? 'rotate-90' : ''}`}/>
                                              </button>
                                          );
                                      })}
                                  </div>
                                  <div className="flex-1 min-w-0 py-2 px-3 max-h-[320px] overflow-y-auto">
                                      {filterCategoryOpen === null && (
                                          <p className="text-[13px] text-muted-foreground">{t('articles', 'listSelectFilterAbove')}</p>
                                      )}
                                      {filterCategoryOpen && renderColumnFilterPanelContent(filterCategoryOpen)}
                                  </div>
                              </div>
                          </PopoverContent>
                      </Popover>

                      <Popover open={displayPopoverOpen} onOpenChange={setDisplayPopoverOpen}>
                          <Tooltip>
                              <TooltipTrigger asChild>
                                  <PopoverTrigger asChild>
                                      <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 w-8 p-0 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground"
                                          aria-label={t('articles', 'listDisplayOptions')}
                                      >
                                          <SlidersHorizontal className="h-4 w-4"/>
                                      </Button>
                                  </PopoverTrigger>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">{t('articles', 'listDisplayAndSort')}</TooltipContent>
                          </Tooltip>
                          <PopoverContent className="w-72 p-0" align="end">
                              <div className="p-3 space-y-4">
                                  <div className="space-y-2">
                                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                                          <ChevronsUpDown className="h-3.5 w-3.5"/>
                                          {t('articles', 'listOrdering')}
                                      </p>
                                      <div className="flex gap-2 items-center">
                                          <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
                                              <SelectTrigger className="h-8 text-[13px] flex-1">
                                                  <SelectValue/>
                                              </SelectTrigger>
                                              <SelectContent>
                                                  <SelectItem value="title">Title</SelectItem>
                                                  <SelectItem value="authors">Authors</SelectItem>
                                                  <SelectItem value="journal_title">Journal</SelectItem>
                                                  <SelectItem value="publication_year">Year</SelectItem>
                                                  <SelectItem value="has_main_file">PDF</SelectItem>
                                              </SelectContent>
                                          </Select>
                                          <Button
                                              variant="outline"
                                              size="sm"
                                              className="h-8 w-8 p-0 shrink-0"
                                              onClick={() => setSortDirection(d => d === 'asc' ? 'desc' : 'asc')}
                                          >
                                              {sortDirection === 'asc' ? <ChevronUp className="h-3.5 w-3.5"/> :
                                                  <ChevronDown className="h-3.5 w-3.5"/>}
                                          </Button>
                                      </div>
                                  </div>
                                  <div className="space-y-2">
                                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                                          <LayoutGrid className="h-3.5 w-3.5"/>
                                          {t('articles', 'listDisplayProperties')}
                                      </p>
                                      <div className="flex flex-wrap gap-1.5">
                                          {[
                                              {key: 'title' as const, label: 'Title'},
                                              {key: 'pdf' as const, label: 'PDF'},
                                              {key: 'authors' as const, label: 'Authors'},
                                              {key: 'journal' as const, label: 'Journal'},
                                              {key: 'year' as const, label: 'Year'},
                                              {key: 'keywords' as const, label: 'Keywords'},
                                              {key: 'doi' as const, label: 'DOI'},
                                              {key: 'abstract' as const, label: 'Abstract'},
                                          ].map(({key, label}) => (
                                              <button
                                                  key={key}
                                                  type="button"
                                                  disabled={key === 'title'}
                                                  onClick={() => key !== 'title' && toggleColumn(key)}
                                                  className={`rounded-md border px-2 py-1 text-[12px] transition-colors disabled:opacity-60 disabled:cursor-default ${
                                                      visibleColumns[key]
                                                          ? 'border-primary/50 bg-primary/10 text-foreground'
                                                          : 'border-border/40 bg-muted/30 text-muted-foreground hover:bg-muted/50'
                                                  }`}
                                              >
                                                  {label}
                                              </button>
                                          ))}
                                      </div>
                                  </div>
                              </div>
                          </PopoverContent>
                      </Popover>
                  </div>

                  {/* Count + selection actions (same line, right) */}
                  <div className="flex items-center gap-2 shrink-0 ml-auto">
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                          {filteredArticles.length} {t('articles', 'listOfArticles')} {articles.length} {articles.length === 1 ? t('articles', 'listArticle') : t('articles', 'listArticles')}
                      </span>
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

              {/* Chips de filtros ativos — compactos */}
              {activeFiltersList.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 px-0.5 py-1">
                      {activeFiltersList.map(({column, label, value}) => (
                          <span
                              key={column}
                              className="inline-flex items-center gap-0.5 rounded border border-border/40 bg-muted/50 text-[11px] text-muted-foreground pl-1.5 pr-0.5 py-0.5 max-w-[180px]"
                          >
                              <span className="truncate" title={`${label}: ${value}`}>
                                  {label}: &quot;{value.length > 18 ? `${value.slice(0, 18)}…` : value}&quot;
                              </span>
                              <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-4 w-4 p-0 shrink-0 hover:bg-muted rounded"
                                  onClick={() => updateColumnFilter(column, '')}
                                  aria-label={t('articles', 'listRemoveFilter').replace('{{label}}', label)}
                              >
                                  <X className="h-2.5 w-2.5"/>
                              </Button>
                          </span>
                      ))}
                      <Button
                          variant="ghost"
                          size="sm"
                          className="text-[11px] text-muted-foreground hover:text-foreground h-6 px-1.5"
                          onClick={clearAllColumnFilters}
                      >
                          {t('articles', 'listClearAll')}
                      </Button>
                  </div>
              )}
          </div>

      {/* Articles Table */}
      {filteredArticles.length === 0 && articles.length === 0 ? (
          <div
              className="flex flex-col items-center justify-center py-24 px-4 bg-muted/10 rounded-lg border border-dashed border-border/40">
              <FileText className="h-10 w-10 text-muted-foreground/30 mb-4" strokeWidth={1.2}/>
              <h3 className="text-base font-medium text-foreground mb-1.5 text-center">{t('articles', 'listNoArticlesYet')}</h3>
              <p className="text-[13px] text-muted-foreground text-center mb-8 max-w-xs mx-auto">
                  {t('articles', 'listStartByImporting')}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                  <Button
                      onClick={() => navigate(`/projects/${projectId}/articles/add`)}
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
      ) : (
          <div className="rounded-md overflow-hidden w-full border-b border-border/40">
              <div className="overflow-x-auto scrollbar-horizontal w-full min-w-0">
                  <Table className="table-fixed w-full">
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
                              {TABLE_COLUMNS.filter(col => col.visibleKey === undefined || visibleColumns[col.visibleKey]).map((col) => (
                                  <TableHead
                                      key={col.id}
                                      className={`relative h-8 text-xs font-medium text-muted-foreground group/head ${TABLE_CELL_CLASS}`}
                                      style={getColumnStyle(col.id)}
                                  >
                                      <div className="flex items-center gap-1 pr-4 min-w-0">
                                          {col.sortField != null ? (
                                              <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  onClick={() => handleSort(col.sortField!)}
                                                  className="h-auto p-0 min-w-0 text-[11px] font-medium text-muted-foreground uppercase tracking-wider hover:bg-transparent hover:text-foreground transition-colors"
                                              >
                                                  {col.label}
                                              </Button>
                                          ) : (
                                              <span
                                                  className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{col.label}</span>
                                          )}
                                          {col.sortField != null && sortField === col.sortField && (sortDirection === 'asc' ?
                                              <ChevronUp className="h-3 w-3 text-foreground shrink-0"/> :
                                              <ChevronDown className="h-3 w-3 text-foreground shrink-0"/>)}
                                          {col.filterKey != null && (
                                              <Popover open={openColumnFilter === col.filterKey}
                                                       onOpenChange={(open) => setOpenColumnFilter(open ? col.filterKey! : null)}
                                                       modal={false}>
                                                  <PopoverTrigger asChild>
                                                      <Button
                                                          variant="ghost"
                                                          size="sm"
                                                          className={`h-5 w-5 p-0 shrink-0 opacity-0 group-hover/head:opacity-100 transition-opacity ${hasColumnFilter(col.filterKey!) ? 'opacity-100 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                                                          aria-label={t('articles', 'listFilterBy').replace('{{label}}', col.label)}
                                                      >
                                                          <Filter className="h-3 w-3"/>
                                                      </Button>
                                                  </PopoverTrigger>
                                                  <PopoverContent
                                                      className="w-[320px] max-h-[320px] overflow-y-auto p-3 border-border/50 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
                                                      align="start" sideOffset={6}
                                                      onOpenAutoFocus={(e) => e.preventDefault()}>
                                                      {renderColumnFilterPanelContent(col.filterKey!)}
                                                  </PopoverContent>
                                              </Popover>
                                          )}
                                      </div>
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
                                      className={`${TABLE_CELL_CLASS} font-medium cursor-pointer`}
                                      style={getColumnStyle('title')}
                                      onClick={() => onArticleClick(article.id)}
                                  >
                                      <div
                                          className="line-clamp-1 text-[13px] leading-tight text-foreground font-medium group-hover:text-primary transition-colors">
                                          {article.title ?? t('articles', 'listUntitled')}
                                      </div>
                                  </TableCell>

                                  {/* PDF */}
                                  {visibleColumns.pdf && (
                                      <TableCell className={TABLE_CELL_CLASS} style={getColumnStyle('pdf')}>
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

                                  {/* Authors */}
                                  {visibleColumns.authors && (
                                      <TableCell
                                          className={`${TABLE_CELL_CLASS} text-[13px] text-muted-foreground font-medium`}
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
                                  {visibleColumns.journal && (
                                      <TableCell
                                          className={`${TABLE_CELL_CLASS} text-[13px] text-muted-foreground italic`}
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
                                  {visibleColumns.year && (
                                      <TableCell className={TABLE_CELL_CLASS} style={getColumnStyle('year')}>
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
                                  {visibleColumns.keywords && (
                                      <TableCell className={TABLE_CELL_CLASS} style={getColumnStyle('keywords')}>
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
                                  {visibleColumns.doi && (
                                      <TableCell className={TABLE_CELL_CLASS} style={getColumnStyle('doi')}>
                                          {article.doi ? (
                                              <Button
                                                  size="sm"
                                                  variant="ghost"
                                                  onClick={(e) => {
                                                      e.stopPropagation();
                                                      window.open(`https://doi.org/${article.doi}`, "_blank");
                                                  }}
                                                  className="h-6 px-1 text-[11px] font-medium text-primary hover:bg-primary/5"
                                              >
                                                  Link DOI
                                              </Button>
                                          ) : (
                                              <span className="text-[12px] text-muted-foreground/50">–</span>
                                          )}
                                      </TableCell>
                                  )}

                                  {/* Abstract */}
                                  {visibleColumns.abstract && (
                                      <TableCell className={TABLE_CELL_CLASS} style={getColumnStyle('abstract')}>
                                          <div
                                              className="text-[12px] text-muted-foreground/80 line-clamp-2 leading-tight">
                                              {article.abstract || "\u2013"}
                                          </div>
                                      </TableCell>
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
              </div>
          </div>
      )
      }

          {/* Empty state after filters */}
      {filteredArticles.length === 0 && articles.length > 0 && (
          <div className="text-center py-16 border rounded-lg bg-muted/10 border-dashed">
              <Search className="h-8 w-8 mx-auto mb-3 text-muted-foreground/30" strokeWidth={1.2}/>
              <p className="text-sm font-semibold">{t('articles', 'listNoMatchSearch')}</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">{t('articles', 'listAdjustSearchOrClearFilters')}</p>
          <Button
              variant="ghost"
            size="sm"
            onClick={() => {
              setSearchTerm('');
                setColumnFilters({
                    title: '',
                    authors: '',
                    journal_title: '',
                    publication_year: '',
                    keywords: '',
                    has_main_file: ''
              });
            }}
              className="mt-6 text-xs font-semibold underline underline-offset-4 hover:bg-transparent"
          >
              {t('articles', 'listClearAllFiltersButton')}
          </Button>
        </div>
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
    </div>
  );
}