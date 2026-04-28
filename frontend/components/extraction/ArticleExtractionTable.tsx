/**
 * Table for article data extraction
 *
 * Displays articles in table format with:
 * - Global text search and centralized filter panel (status, year, title, authors)
 * - Column sorting
 * - Minimal progress display
 * - Contextual actions
 */

import type {CSSProperties} from 'react';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {supabase} from '@/integrations/supabase/client';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Progress} from '@/components/ui/progress';
import {
    AlertCircle,
    Calendar,
    Circle,
    CheckCircle,
    CheckCircle2,
    Database,
    Edit,
    FileText,
    Loader2,
    MoreHorizontal,
    PlayCircle,
    Search,
    Sparkles,
    User,
    X
} from 'lucide-react';
import {toast} from 'sonner';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow,} from "@/components/ui/table";
import {Skeleton} from "@/components/ui/skeleton";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Checkbox} from "@/components/ui/checkbox";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import {useArticleSelection} from "@/hooks/extraction/useArticleSelection";
import {useFullAIExtraction} from "@/hooks/extraction/useFullAIExtraction";
import {useListKeyboardShortcuts} from "@/hooks/useListKeyboardShortcuts";
import {t} from '@/lib/copy';
import {TABLE_CELL_CLASS} from '@/lib/table-constants';
import type {FilterFieldConfig, FilterValues} from '@/components/shared/list';
import {
    ActiveFilterChips,
    buildActiveFiltersList,
    EmptyListState,
    FilterButtonWithPopover,
    isFilterValueEmpty,
    ListCount,
    ListDisplaySortPopover,
    ListFilterPanel,
    ListRowCard,
    SortIconHeader,
    ListToolbarSearch,
    ResponsiveList,
    useResizableTableColumns,
} from '@/components/shared/list';
import {DataTableWrapper} from '@/components/shared/list/DataTableWrapper';
import {useIsNarrow} from '@/hooks/use-mobile';

interface Article {
  id: string;
  title: string;
  authors: string[] | null;
  publication_year: number | null;
  created_at: string;
}

interface ExtractionInstance {
  id: string;
  article_id: string | null;
  template_id: string;
  entity_type_id: string;
  label: string;
  created_at: string;
}

interface ExtractionValueDisplay {
  id: string;
  instance_id: string;
  field_id: string;
  value: any;
  reviewer_id: string | null;
  created_at: string;
}

interface ArticleWithExtraction extends Article {
  instances: ExtractionInstance[];
  extractedValues: ExtractionValueDisplay[];
  isLoading: boolean;
}

interface ArticleExtractionTableProps {
  projectId: string;
  templateId: string;
}

type SortField = 'title' | 'publication_year' | 'extraction_progress' | 'status' | 'created_at';
type SortDirection = 'asc' | 'desc';

const EXTRACTION_FILTER_FIELDS: FilterFieldConfig[] = [
    {
        id: 'status', label: t('extraction', 'tableColumnStatus'), type: 'categorical', options: [
            {value: 'not_started', label: t('extraction', 'listStatusNotStarted')},
            {value: 'in_progress', label: t('extraction', 'listStatusInProgress')},
            {value: 'complete', label: t('extraction', 'listStatusComplete')},
        ]
    },
    {
        id: 'publication_year',
        label: t('extraction', 'tableColumnYear'),
        type: 'numericRange',
        minBound: 1990,
        maxBound: new Date().getFullYear(),
        step: 1
    },
    {
        id: 'title',
        label: t('extraction', 'tableColumnTitle'),
        type: 'text',
        placeholder: t('extraction', 'tableSearchTitle')
    },
    {
        id: 'authors',
        label: t('extraction', 'tableColumnAuthors'),
        type: 'text',
        placeholder: t('extraction', 'tableSearchAuthor')
    },
];

const INITIAL_EXTRACTION_FILTER_VALUES: FilterValues = {
    status: [],
    publication_year: {},
    title: '',
    authors: '',
};

const EXTRACTION_COLUMN_WIDTHS_KEY = 'extraction-list-column-widths-v1';
const EXTRACTION_DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
    title: 320,
    authors: 150,
    year: 100,
    progress: 170,
    status: 96,
    actions: 96,
};
const RESIZABLE_COLUMN_ORDER = ['title', 'authors', 'year', 'progress', 'status', 'actions'] as const;
export function ArticleExtractionTable({ projectId, templateId }: ArticleExtractionTableProps) {
  const navigate = useNavigate();
  const location = useLocation();
    const isNarrow = useIsNarrow();
    const searchInputRef = useRef<HTMLInputElement>(null);
  const [articles, setArticles] = useState<ArticleWithExtraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

    // Filter and sort state
  const [globalFilter, setGlobalFilter] = useState('');
    const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
    const [filterValues, setFilterValues] = useState<FilterValues>(INITIAL_EXTRACTION_FILTER_VALUES);
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
        if (typeof window === 'undefined') return {...EXTRACTION_DEFAULT_COLUMN_WIDTHS};
        try {
            const stored = localStorage.getItem(EXTRACTION_COLUMN_WIDTHS_KEY);
            if (!stored) return {...EXTRACTION_DEFAULT_COLUMN_WIDTHS};
            const parsed = JSON.parse(stored) as Record<string, number>;
            return {...EXTRACTION_DEFAULT_COLUMN_WIDTHS, ...parsed};
        } catch (_) {
            return {...EXTRACTION_DEFAULT_COLUMN_WIDTHS};
        }
    });
    const {registerHeaderRef, startResize} = useResizableTableColumns({
        columnWidths,
        setColumnWidths,
        defaultColumnWidths: EXTRACTION_DEFAULT_COLUMN_WIDTHS,
        orderedColumns: [...RESIZABLE_COLUMN_ORDER],
        storageKey: EXTRACTION_COLUMN_WIDTHS_KEY,
    });

    // Ref to track last visited route (avoid unnecessary refresh)
  const lastPathRef = useRef<string>('');
  const loadArticlesRef = useRef<() => Promise<void>>();

    // Hook for batch AI extraction
  const { extractFullAI, loading: isExtracting } = useFullAIExtraction({
    onSuccess: async () => {
        // Reload articles after extraction
      await loadArticles();
        toast.success(t('extraction', 'tableExtractionSuccess'));
    },
  });

    // Declare loadCurrentUser before any use to avoid TDZ
  const loadCurrentUser = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
      }
    } catch (error: any) {
        console.error('Error loading user:', error);
    }
  }, []);

    // Declare loadArticles before any use to avoid TDZ
  const loadArticles = useCallback(async () => {
    if (!projectId || !templateId || !currentUserId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
        // 1. Fetch project articles
      const { data: articlesData, error: articlesError } = await supabase
        .from('articles')
        .select('id, title, authors, publication_year, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (articlesError) {
          console.error('Error fetching articles:', articlesError);
        throw articlesError;
      }

      if (!articlesData || articlesData.length === 0) {
        setArticles([]);
        return;
      }

        // 2. Fetch extraction instances for template
      const { data: instancesData, error: instancesError } = await supabase
        .from('extraction_instances')
        .select('*')
        .eq('project_id', projectId)
        .eq('template_id', templateId);

      if (instancesError) {
          console.error('Error fetching instances:', instancesError);
        throw instancesError;
      }

        // 3. Fetch the user's current ReviewerDecisions via reviewer_states
        //    for instances in this template. Map each into the legacy
        //    ExtractionValueDisplay shape so the row-level rendering stays the same.
      const instanceIds = (instancesData || []).map((i) => i.id);
      let valuesData: any[] = [];
      if (instanceIds.length > 0) {
        const { data: statesData, error: statesError } = await supabase
          .from('extraction_reviewer_states')
          .select(
            `instance_id, current_decision_id,
             reviewer_decision:current_decision_id(field_id, value, decision, created_at)`,
          )
          .in('instance_id', instanceIds)
          .eq('reviewer_id', currentUserId);
        if (statesError) {
          console.error('Error fetching reviewer states:', statesError);
          throw statesError;
        }
        valuesData = (statesData || [])
          .map((s: any) => {
            if (!s.current_decision_id) return null;
            const dec = Array.isArray(s.reviewer_decision)
              ? s.reviewer_decision[0]
              : s.reviewer_decision;
            if (!dec || dec.decision === 'reject') return null;
            return {
              id: s.current_decision_id,
              instance_id: s.instance_id,
              field_id: dec.field_id,
              value: dec.value,
              source: 'human',
              reviewer_id: currentUserId,
              created_at: dec.created_at,
              updated_at: dec.created_at,
            };
          })
          .filter((v: any) => v !== null);
      }

        // 4. Combine articles with their extractions
      const articlesWithExtraction: ArticleWithExtraction[] = articlesData.map(article => {
        const articleInstances = instancesData?.filter(i => i.article_id === article.id) || [];
        const articleValues = valuesData.filter((v) =>
          articleInstances.some((instance) => instance.id === v.instance_id),
        );

        return {
          ...article,
          instances: articleInstances as ExtractionInstance[],
          extractedValues: articleValues as ExtractionValueDisplay[],
          isLoading: false,
        };
      });

      setArticles(articlesWithExtraction);
    } catch (err: any) {
        console.error('Error loading articles:', err);
      setError(err.message);
        toast.error(`${t('extraction', 'tableErrorLoadArticles')}: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [projectId, templateId, currentUserId]);

    // Update loadArticles ref when it changes (must be before any use)
  useEffect(() => {
    loadArticlesRef.current = loadArticles;
  }, [loadArticles]);

    // Load current user ID
  useEffect(() => {
    loadCurrentUser();
  }, [loadCurrentUser]);

    // Load project articles
  useEffect(() => {
    if (projectId && templateId && currentUserId) {
        // Use loadArticles directly to avoid timing issues with ref
      loadArticles();
    }
  }, [projectId, templateId, currentUserId, loadArticles]);

    // Auto-refresh when returning to page (after finishing extraction)
    // Ensures data is updated after changes made on other pages
  useEffect(() => {
    const currentPath = location.pathname;

      // Only reload if:
      // 1. We're on project route (but not extraction fullscreen)
      // 2. Route changed (not first render)
      // 3. We came back from extraction fullscreen (had articleId before, don't now)
    const isProjectExtractionRoute = currentPath.includes('/projects/') &&
        !currentPath.match(/\/extraction\/[^/]+$/); // Not on specific extraction route
      const cameFromExtractionFullscreen = lastPathRef.current.match(/\/extraction\/[^/]+$/); // Came from specific extraction route
    
    if (
      projectId && 
      templateId && 
      currentUserId && 
      isProjectExtractionRoute &&
      currentPath !== lastPathRef.current &&
      cameFromExtractionFullscreen &&
      loadArticlesRef.current
    ) {
      lastPathRef.current = currentPath;

        // Short delay to ensure navigation completed
      const timer = setTimeout(() => {
        if (loadArticlesRef.current) {
          loadArticlesRef.current();
        }
      }, 300);
      
      return () => clearTimeout(timer);
    } else if (currentPath !== lastPathRef.current) {
        // Update ref even if not reloading
      lastPathRef.current = currentPath;
    }
  }, [location.pathname, projectId, templateId, currentUserId]); // Reload when route changes

    // Compute extraction progress
  const calculateExtractionProgress = (article: ArticleWithExtraction) => {
    if (article.instances.length === 0) return 0;

      // Check if all instances have status 'completed'
    const allCompleted = article.instances.every(instance => instance.status === 'completed');
    if (allCompleted && article.instances.length > 0) {
      return 100;
    }

      // Count instances with at least one extracted value
    const instancesWithValues = article.instances.filter(instance =>
      article.extractedValues.some(value => value.instance_id === instance.id)
    ).length;

    return Math.round((instancesWithValues / article.instances.length) * 100);
  };

    // Filter and sort articles
  const filteredAndSortedArticles = useMemo(() => {
    const filtered = articles.filter(article => {
        // Global filter
      if (globalFilter) {
        const searchText = globalFilter.toLowerCase();
        const matchesTitle = article.title.toLowerCase().includes(searchText);
          const matchesAuthors = article.authors?.some(author =>
          author.toLowerCase().includes(searchText)
        ) || false;
        const matchesYear = article.publication_year?.toString().includes(searchText) || false;

        if (!matchesTitle && !matchesAuthors && !matchesYear) {
          return false;
        }
      }

        // Panel filters (FilterValues)
        const titleFilter = filterValues.title as string | undefined;
        if (titleFilter?.trim() && !article.title.toLowerCase().includes(titleFilter.toLowerCase())) {
            return false;
        }

        const authorsFilter = filterValues.authors as string | undefined;
        if (authorsFilter?.trim() && article.authors) {
            const match = article.authors.some(author =>
                author.toLowerCase().includes(authorsFilter.toLowerCase())
            );
            if (!match) return false;
      }

        const statusFilter = filterValues.status as string[] | undefined;
        if (statusFilter?.length) {
        const progress = calculateExtractionProgress(article);
        const roundedProgress = Math.max(0, Math.min(100, Math.round(progress)));
        const isComplete = progress >= 100;
        const isInProgress = roundedProgress > 0 && roundedProgress < 100;
            const articleStatus = isComplete ? 'complete' : isInProgress ? 'in_progress' : 'not_started';
            if (!statusFilter.includes(articleStatus)) return false;
      }

        const yearRange = filterValues.publication_year as { min?: number; max?: number } | undefined;
        if (yearRange && (yearRange.min != null || yearRange.max != null) && article.publication_year != null) {
            const y = article.publication_year;
            if (yearRange.min != null && y < yearRange.min) return false;
            if (yearRange.max != null && y > yearRange.max) return false;
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
        case 'publication_year':
          aValue = a.publication_year || 0;
          bValue = b.publication_year || 0;
          break;
        case 'extraction_progress':
          aValue = calculateExtractionProgress(a);
          bValue = calculateExtractionProgress(b);
          break;
        case 'status': {
            // Sort by status: not started (0), in progress (1), complete (2)
          const aProgress = calculateExtractionProgress(a);
          const bProgress = calculateExtractionProgress(b);
          const aHasInstances = a.instances.length > 0;
          const bHasInstances = b.instances.length > 0;
          
          aValue = !aHasInstances ? 0 : (aProgress >= 100 ? 2 : 1);
          bValue = !bHasInstances ? 0 : (bProgress >= 100 ? 2 : 1);
          break;
        }
        case 'created_at':
          aValue = new Date(a.created_at).getTime();
          bValue = new Date(b.created_at).getTime();
          break;
        default:
          return 0;
      }

        // Sort logic
      if (sortDirection === 'asc') {
        if (aValue < bValue) return -1;
        if (aValue > bValue) return 1;
        return 0;
      } else {
        if (aValue > bValue) return -1;
        if (aValue < bValue) return 1;
        return 0;
      }
    });

    return filtered;
  }, [articles, globalFilter, filterValues, sortField, sortDirection]);

    // Article selection
  const allArticleIds = useMemo(() => articles.map(a => a.id), [articles]);
  const visibleArticleIds = useMemo(() => filteredAndSortedArticles.map(a => a.id), [filteredAndSortedArticles]);
  
  const {
    selectedIds,
    isAllSelected,
    isIndeterminate,
    selectedCount,
    toggleArticle,
    selectAll,
    selectFiltered,
    deselectAll,
    isSelected,
    hasActiveFilters,
  } = useArticleSelection({
    allArticleIds,
    visibleArticleIds,
  });

    // Batch AI extraction handler
  const handleBatchAIExtraction = useCallback(async () => {
    if (selectedIds.size === 0) {
        toast.error(t('extraction', 'tableSelectAtLeastOne'));
      return;
    }

    const selectedArticles = filteredAndSortedArticles.filter(a => selectedIds.has(a.id));

      toast.info(t('extraction', 'tableBatchAIStarting').replace('{{count}}', String(selectedArticles.length)), {
          description: t('extraction', 'extractionMayTakeMinutes'),
    });

    try {
        // Process articles sequentially to avoid overload
      for (let i = 0; i < selectedArticles.length; i++) {
        const article = selectedArticles[i];
          toast.info(t('extraction', 'processingArticle').replace('{{current}}', String(i + 1)).replace('{{total}}', String(selectedArticles.length)).replace('{{title}}', article.title || ''));
        
        await extractFullAI({
          projectId,
          articleId: article.id,
          templateId,
        });
      }

        // Clear selection after success
      deselectAll();
    } catch (error: any) {
        console.error('Error in batch AI extraction:', error);
        toast.error(t('extraction', 'tableErrorProcessAI'), {
            description: error.message || t('extraction', 'tableErrorUnknown'),
      });
    }
  }, [selectedIds, filteredAndSortedArticles, projectId, templateId, extractFullAI, deselectAll]);

    // Header checkbox component with indeterminate support
  const HeaderCheckbox = React.memo(({ 
    checked, 
    indeterminate, 
    onCheckedChange, 
    ...props 
  }: { 
    checked: boolean; 
    indeterminate: boolean; 
    onCheckedChange: (checked: boolean) => void;
    'aria-label'?: string;
  }) => {
    const checkboxRef = useRef<React.ElementRef<typeof Checkbox>>(null);

    useEffect(() => {
      if (checkboxRef.current) {
          // Access underlying Radix UI DOM element
        const element = checkboxRef.current as unknown as { 
          querySelector?: (selector: string) => HTMLElement | null;
        };
        const buttonElement = element?.querySelector?.('button') as HTMLButtonElement | null;
        if (buttonElement) {
          buttonElement.indeterminate = indeterminate;
        }
      }
    }, [indeterminate]);

    return (
      <Checkbox
        ref={checkboxRef}
        checked={indeterminate ? false : checked}
        onCheckedChange={onCheckedChange}
        className={indeterminate ? 'data-[state=checked]:bg-primary/50' : ''}
        {...props}
      />
    );
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
        setSortDirection('desc'); // Start with desc to show most recent first
    }
  };

  const handleStartExtraction = (articleId: string) => {
    navigate(`/projects/${projectId}/extraction/${articleId}`);
  };

  const handleContinueExtraction = (articleId: string) => {
    navigate(`/projects/${projectId}/extraction/${articleId}`);
  };

    const getColumnStyle = (columnId: string): CSSProperties => {
        const w = columnWidths[columnId] ?? EXTRACTION_DEFAULT_COLUMN_WIDTHS[columnId];
        return {width: w, minWidth: 80};
    };

  const getStatusBadge = (article: ArticleWithExtraction) => {
    const progress = calculateExtractionProgress(article);
    const roundedProgress = Math.max(0, Math.min(100, Math.round(progress)));
    const uiStatus = roundedProgress >= 100 ? 'complete' : roundedProgress > 0 ? 'in_progress' : 'not_started';
    if (uiStatus === 'not_started') {
      return (
          <TooltipProvider>
              <Tooltip>
                  <TooltipTrigger asChild>
                      <Badge
                          variant="secondary"
                          className="h-7 w-7 cursor-default justify-center rounded-full border border-blue-200/70 bg-blue-50/60 p-0 text-blue-700 shadow-none dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300"
                          aria-label={t('extraction', 'listStatusNotStarted')}
                      >
                          <Circle className="h-3 w-3"/>
                      </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                      <p>{t('extraction', 'listStatusNotStarted')}</p>
                  </TooltipContent>
              </Tooltip>
          </TooltipProvider>
      );
    }

    if (uiStatus === 'complete') {
      return (
          <TooltipProvider>
              <Tooltip>
                  <TooltipTrigger asChild>
                      <Badge
                          variant="secondary"
                          className="h-7 w-7 cursor-default justify-center rounded-full border border-emerald-200/70 bg-emerald-50/60 p-0 text-emerald-700 shadow-none dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
                          aria-label={t('extraction', 'listStatusComplete')}
                      >
                          <CheckCircle2 className="h-3 w-3"/>
                      </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                      <p>{t('extraction', 'listStatusComplete')}</p>
                  </TooltipContent>
              </Tooltip>
          </TooltipProvider>
      );
    }

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Badge
                        variant="secondary"
                        className="h-7 w-7 cursor-default justify-center rounded-full border border-amber-200/80 bg-amber-50/70 p-0 text-amber-700 shadow-none dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
                        aria-label={t('extraction', 'listStatusInProgress')}
                    >
                        <span className="text-[9px] font-semibold leading-none">{roundedProgress}%</span>
                    </Badge>
                </TooltipTrigger>
                <TooltipContent>
                    <p>{t('extraction', 'listStatusInProgress')}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
  };

    const clearListFilters = useCallback(() => {
        setGlobalFilter('');
        setFilterValues(INITIAL_EXTRACTION_FILTER_VALUES);
    }, []);

    const clearFilterField = useCallback((fieldId: string) => {
        const field = EXTRACTION_FILTER_FIELDS.find((f) => f.id === fieldId);
        if (!field) return;
        setFilterValues((prev) => ({
            ...prev,
            [fieldId]:
                field.type === 'categorical'
                    ? []
                    : field.type === 'numericRange'
                        ? {}
                        : '',
        }));
    }, []);

    const extractionFilterLabels = useMemo(
        () =>
            Object.fromEntries(
                EXTRACTION_FILTER_FIELDS.map((f) => [f.id, f.label])
            ) as Record<string, string>,
        []
    );

    const activeFiltersList = useMemo(
        () =>
            buildActiveFiltersList(
                EXTRACTION_FILTER_FIELDS,
                filterValues,
                extractionFilterLabels
            ),
        [filterValues, extractionFilterLabels]
    );

    const activeFiltersCount = useMemo(() => {
        let n = globalFilter.trim() ? 1 : 0;
        EXTRACTION_FILTER_FIELDS.forEach((f) => {
            if (!isFilterValueEmpty(filterValues[f.id])) n += 1;
        });
        return n;
    }, [globalFilter, filterValues]);

    useListKeyboardShortcuts({
        searchInputRef,
        setFilterPopoverOpen,
        filterPopoverOpen,
        deselectAll,
        selectedCount,
        hasActiveFilters: hasActiveFilters || activeFiltersCount > 0,
        selectAll,
        selectFiltered,
    });

    // Loading state — skeleton matching table layout (frontend-ux compact)
  if (loading) {
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-8 flex-1 min-w-[200px] rounded-md"/>
                <Skeleton className="h-8 w-8 rounded-md"/>
                <Skeleton className="h-4 w-24"/>
            </div>
            <div className="rounded-md overflow-hidden border-b border-border/40">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[40px]"><Skeleton className="h-4 w-4"/></TableHead>
                            <TableHead className="w-[30%]"><Skeleton className="h-4 w-20"/></TableHead>
                            <TableHead className="w-[12%]"><Skeleton className="h-4 w-14"/></TableHead>
                            <TableHead className="w-[10%]"><Skeleton className="h-4 w-10"/></TableHead>
                            <TableHead className="w-[18%]"><Skeleton className="h-4 w-16"/></TableHead>
                            <TableHead className="w-[10%]"><Skeleton className="h-4 w-12"/></TableHead>
                            <TableHead className="w-[15%] text-center"><Skeleton
                                className="h-4 w-12 mx-auto"/></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                            <TableRow key={i}>
                                <TableCell><Skeleton className="h-4 w-4"/></TableCell>
                                <TableCell><Skeleton className="h-4 w-full max-w-[280px]"/></TableCell>
                                <TableCell><Skeleton className="h-4 w-24"/></TableCell>
                                <TableCell><Skeleton className="h-4 w-12"/></TableCell>
                                <TableCell><Skeleton className="h-5 w-16"/></TableCell>
                                <TableCell><Skeleton className="h-5 w-20"/></TableCell>
                                <TableCell className="text-center"><Skeleton className="h-8 w-16 mx-auto"/></TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
      </div>
    );
  }

    // Error state
  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
        <div className="flex items-center space-x-3 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <div>
              <p className="font-medium">{t('extraction', 'tableErrorLoadArticles')}</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </div>
        <Button 
          onClick={() => {
            if (loadArticlesRef.current) {
              loadArticlesRef.current();
            }
          }} 
          variant="outline" 
          className="mt-4"
        >
            {t('extraction', 'listTryAgain')}
        </Button>
      </div>
    );
  }

    // Empty state — no articles in project (match ArticlesList pattern)
  if (articles.length === 0) {
    return (
        <div
            className="flex flex-col items-center justify-center py-24 px-4 bg-muted/10 rounded-lg border border-dashed border-border/40">
            <FileText className="h-10 w-10 text-muted-foreground/30 mb-4" strokeWidth={1.2}/>
            <h3 className="text-base font-medium text-foreground mb-1.5 text-center">{t('extraction', 'listNoArticles')}</h3>
            <p className="text-[13px] text-muted-foreground text-center max-w-xs mx-auto">{t('extraction', 'listNoArticlesDesc')}</p>
      </div>
    );
  }

    // Ready state — render table
  return (
      <div className="space-y-2">
          {/* Single toolbar: search + Filter + count/selection (Linear-style) */}
          <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 w-full">
                  <ListToolbarSearch
                      ref={searchInputRef}
                      placeholder={t('extraction', 'tableSearchPlaceholderShortcut')}
            value={globalFilter}
                      onChange={setGlobalFilter}
                  />
                  <FilterButtonWithPopover
                      open={filterPopoverOpen}
                      onOpenChange={setFilterPopoverOpen}
                      activeCount={activeFiltersCount}
                      tooltipLabel={t('extraction', 'tableShortcutFilter')}
                      ariaLabel={t('extraction', 'tableShortcutFilter')}
                  >
                      <ListFilterPanel
                          fields={EXTRACTION_FILTER_FIELDS}
                          values={filterValues}
                          onChange={setFilterValues}
                      />
                  </FilterButtonWithPopover>
                  <ListDisplaySortPopover
                      sortOptions={[
                          {value: 'title', label: t('extraction', 'tableColumnTitle')},
                          {value: 'publication_year', label: t('extraction', 'tableColumnYear')},
                          {value: 'extraction_progress', label: t('extraction', 'tableColumnProgress')},
                          {value: 'status', label: t('extraction', 'tableColumnStatus')},
                          {value: 'created_at', label: t('extraction', 'tableColumnCreatedAt')},
                      ]}
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSortFieldChange={(v) => setSortField(v as SortField)}
                      onSortDirectionChange={() =>
                          setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
                      }
                      orderLabel={t('extraction', 'tableOrdering')}
                      tooltipLabel={t('extraction', 'tableDisplayAndSort')}
                      ariaLabel={t('extraction', 'tableDisplayOptions')}
                  />
                  <div className="flex items-center gap-2 shrink-0 ml-auto">
                      <ListCount
                          visible={filteredAndSortedArticles.length}
                          total={articles.length}
                          label={t('extraction', 'tableArticlesCount')}
                      />
                      {selectedCount > 0 && (
                          <div className="flex items-center gap-2 animate-in fade-in duration-200">
                <span className="text-[11px] font-medium text-foreground">
                  {selectedCount} {selectedCount === 1 ? t('extraction', 'tableArticleSelected') : t('extraction', 'tableArticlesSelected')}
                </span>
                              <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[12px]"
                                              disabled={isExtracting}>
                                          <MoreHorizontal className="h-3.5 w-3.5"/>
                                          {t('extraction', 'tableActions')}
                                      </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end"
                                                       className="w-56 border-border/50 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                                      <DropdownMenuLabel>{t('extraction', 'tableBatchActionsLabel')}</DropdownMenuLabel>
                                      <DropdownMenuSeparator/>
                                      <DropdownMenuItem onClick={handleBatchAIExtraction} disabled={isExtracting}
                                                        className="gap-2">
                                          <Sparkles className="h-4 w-4"/>
                                          <span className="text-[13px]">{t('extraction', 'tableAIExtraction')}</span>
                                      </DropdownMenuItem>
                                  </DropdownMenuContent>
                              </DropdownMenu>
                              <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={deselectAll}
                                  disabled={isExtracting}
                                  className="h-6 text-[11px] text-muted-foreground hover:text-foreground"
                                  aria-label={t('extraction', 'tableClearSelection')}
                              >
                                  <X className="h-3 w-3 mr-0.5"/>
                                  {t('extraction', 'tableClearSelection')}
                              </Button>
                          </div>
                      )}
                  </div>
              </div>
              <ActiveFilterChips
                  filters={activeFiltersList}
                  onClearField={clearFilterField}
                  onClearAll={clearListFilters}
                  clearAllLabel={t('extraction', 'tableClearAll')}
                  removeFilterAriaLabel={(label) =>
                      t('extraction', 'tableRemoveFilter').replace('{{label}}', label)
                  }
              />
          </div>

          {/* Table or card list (responsive) */}
          <ResponsiveList
              isNarrow={isNarrow}
              tableContent={
                  <DataTableWrapper className="overflow-hidden rounded-md border border-border/40">
                      <Table className="table-fixed w-max min-w-full">
                  <TableHeader className="bg-transparent">
                      <TableRow className="hover:bg-transparent border-b border-border/40 h-8">
                          <TableHead className={`w-[40px] min-w-[40px] ${TABLE_CELL_CLASS} text-left align-middle`}>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center">
                        <HeaderCheckbox
                          checked={isAllSelected}
                          indeterminate={isIndeterminate}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              if (hasActiveFilters) {
                                selectFiltered();
                              } else {
                                selectAll();
                              }
                            } else {
                              deselectAll();
                            }
                          }}
                          aria-label={hasActiveFilters ? t('extraction', 'tableSelectFiltered') : t('extraction', 'tableSelectAll')}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        {hasActiveFilters
                            ? t('extraction', 'tableSelectFiltered')
                            : t('extraction', 'tableSelectAll')}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableHead>
                          <TableHead
                              ref={(el) => registerHeaderRef('title', el)}
                              className={`relative ${TABLE_CELL_CLASS}`} style={getColumnStyle('title')}>
                              <div className="pr-4 min-w-0">
                                  <SortIconHeader
                                      label={t('extraction', 'tableColumnTitle')}
                                      direction={sortField === 'title' ? sortDirection : null}
                                      onSort={() => handleSort('title')}
                                  />
                              </div>
                              <div
                                  role="separator"
                                  aria-label={t('extraction', 'tableColumnTitle')}
                                  onMouseDown={(e) => {
                                      e.preventDefault();
                                      startResize('title', e.clientX);
                                  }}
                                  className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/20 shrink-0"
                              />
              </TableHead>
                          <TableHead
                              ref={(el) => registerHeaderRef('authors', el)}
                              className={`relative hidden md:table-cell ${TABLE_CELL_CLASS}`} style={getColumnStyle('authors')}>
                              <span
                                  className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('extraction', 'tableColumnAuthors')}</span>
                              <div
                                  role="separator"
                                  aria-label={t('extraction', 'tableColumnAuthors')}
                                  onMouseDown={(e) => {
                                      e.preventDefault();
                                      startResize('authors', e.clientX);
                                  }}
                                  className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/20 shrink-0"
                              />
              </TableHead>
                          <TableHead
                              ref={(el) => registerHeaderRef('year', el)}
                              className={`relative hidden md:table-cell ${TABLE_CELL_CLASS}`} style={getColumnStyle('year')}>
                              <SortIconHeader
                                  label={t('extraction', 'tableColumnYear')}
                                  direction={sortField === 'publication_year' ? sortDirection : null}
                                  onSort={() => handleSort('publication_year')}
                              />
                              <div
                                  role="separator"
                                  aria-label={t('extraction', 'tableColumnYear')}
                                  onMouseDown={(e) => {
                                      e.preventDefault();
                                      startResize('year', e.clientX);
                                  }}
                                  className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/20 shrink-0"
                              />
              </TableHead>
                          <TableHead
                              ref={(el) => registerHeaderRef('progress', el)}
                              className={`relative hidden lg:table-cell ${TABLE_CELL_CLASS}`} style={getColumnStyle('progress')}>
                              <SortIconHeader
                                  label={t('extraction', 'tableColumnProgress')}
                                  direction={sortField === 'extraction_progress' ? sortDirection : null}
                                  onSort={() => handleSort('extraction_progress')}
                              />
                              <div
                                  role="separator"
                                  aria-label={t('extraction', 'tableColumnProgress')}
                                  onMouseDown={(e) => {
                                      e.preventDefault();
                                      startResize('progress', e.clientX);
                                  }}
                                  className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/20 shrink-0"
                              />
              </TableHead>
                          <TableHead
                              ref={(el) => registerHeaderRef('status', el)}
                              className={`relative ${TABLE_CELL_CLASS} text-center`} style={getColumnStyle('status')}>
                              <SortIconHeader
                                  label={t('extraction', 'tableColumnStatus')}
                                  direction={sortField === 'status' ? sortDirection : null}
                                  onSort={() => handleSort('status')}
                              />
                              <div
                                  role="separator"
                                  aria-label={t('extraction', 'tableColumnStatus')}
                                  onMouseDown={(e) => {
                                      e.preventDefault();
                                      startResize('status', e.clientX);
                                  }}
                                  className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/20 shrink-0"
                              />
              </TableHead>
                          <TableHead
                              ref={(el) => registerHeaderRef('actions', el)}
                              className={`relative ${TABLE_CELL_CLASS} text-center`} style={getColumnStyle('actions')}>
                              {t('extraction', 'tableActions')}
                              <div
                                  role="separator"
                                  aria-label={t('extraction', 'tableActions')}
                                  onMouseDown={(e) => {
                                      e.preventDefault();
                                      startResize('actions', e.clientX);
                                  }}
                                  className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/20 shrink-0"
                              />
                          </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSortedArticles.map((article) => {
              const progress = calculateExtractionProgress(article);
              const isComplete = progress >= 100;
              const hasInstances = article.instances.length > 0;

              return (
                  <TableRow key={article.id}
                            className="border-b border-border/40 hover:bg-muted/40 transition-colors duration-75 group h-10">
                      <TableCell className={`w-[40px] ${TABLE_CELL_CLASS}`}>
                    <Checkbox
                      checked={isSelected(article.id)}
                      onCheckedChange={() => toggleArticle(article.id)}
                      aria-label={`Select article: ${article.title}`}
                    />
                  </TableCell>
                      <TableCell className={`${TABLE_CELL_CLASS} font-medium text-[12px]`} style={getColumnStyle('title')}>
                          <div className="line-clamp-1 leading-tight text-foreground font-medium">{article.title}</div>
                  </TableCell>
                      <TableCell
                          className={`max-w-[120px] hidden md:table-cell ${TABLE_CELL_CLASS} text-[12px] text-muted-foreground`}
                          style={getColumnStyle('authors')}>
                    {article.authors && article.authors.length > 0 ? (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1 cursor-help">
                                        <User className="h-3 w-3 text-muted-foreground flex-shrink-0"/>
                                        <span className="truncate block min-w-0">
                                          {article.authors.slice(0, 1).join(', ')}
                                            {article.authors.length > 1 && ` +${article.authors.length - 1}`}
                                        </span>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                    <p className="text-xs">{article.authors.join(', ')}</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    ) : (
                        <span className="text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                      <TableCell className={`hidden md:table-cell ${TABLE_CELL_CLASS} text-[12px]`} style={getColumnStyle('year')}>
                          <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3 text-muted-foreground" />
                      {article.publication_year || 'N/A'}
                    </div>
                  </TableCell>
                      <TableCell className={`hidden lg:table-cell ${TABLE_CELL_CLASS} text-[13px]`} style={getColumnStyle('progress')}>
                    {hasInstances ? (
                      <div className="space-y-1">
                          <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">{t('extraction', 'tableColumnProgress')}</span>
                          <span className="font-medium">{progress.toFixed(0)}%</span>
                        </div>
                        <Progress value={progress} className="h-1.5" />
                      </div>
                    ) : (
                        <div className="text-muted-foreground flex items-center gap-1">
                        <Database className="h-3 w-3" />
                            {t('extraction', 'listStatusNotStarted')}
                      </div>
                    )}
                  </TableCell>
                      <TableCell className={`${TABLE_CELL_CLASS} text-center`} style={getColumnStyle('status')}>
                    {getStatusBadge(article)}
                  </TableCell>
                      <TableCell className={`${TABLE_CELL_CLASS} text-center`} style={getColumnStyle('actions')}>
                    {!hasInstances ? (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        onClick={() => handleStartExtraction(article.id)}
                                        disabled={article.isLoading}
                                        variant="outline"
                                        size="sm"
                                        aria-label={t('extraction', 'tableStart')}
                                        className="h-8 w-8 rounded-full border-border/60 bg-background p-0 shadow-none hover:bg-muted/60"
                                    >
                                        {article.isLoading ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin"/>
                                        ) : (
                                            <PlayCircle className="h-3.5 w-3.5"/>
                                        )}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>{t('extraction', 'tableStart')}</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    ) : (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        onClick={() => handleContinueExtraction(article.id)}
                                        variant="outline"
                                        size="sm"
                                        aria-label={isComplete ? t('extraction', 'tableView') : t('extraction', 'tableContinue')}
                                        className={`h-8 w-8 rounded-full p-0 shadow-none ${
                                            isComplete
                                                ? 'border-border/60 bg-background hover:bg-muted/60'
                                                : 'border-blue-200/80 bg-blue-50/60 text-blue-700 hover:bg-blue-100/70 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/40'
                                        }`}
                                    >
                                        {isComplete ? (
                                            <CheckCircle className="h-3.5 w-3.5"/>
                                        ) : (
                                            <Edit className="h-3.5 w-3.5"/>
                                        )}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>{isComplete ? t('extraction', 'tableView') : t('extraction', 'tableContinue')}</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
                      </Table>
                  </DataTableWrapper>
              }
              cardContent={
                  <>
                      {filteredAndSortedArticles.map((article) => {
                          const progress = calculateExtractionProgress(article);
                          const isComplete = progress >= 100;
                          const hasInstances = article.instances.length > 0;
                          return (
                              <ListRowCard
                                  key={article.id}
                                  leading={
                                      <Checkbox
                                          checked={isSelected(article.id)}
                                          onCheckedChange={() => toggleArticle(article.id)}
                                          aria-label={`Select: ${article.title}`}
                                      />
                                  }
                                  title={article.title}
                                  subtitle={article.authors?.slice(0, 2).join(', ') || undefined}
                                  meta={
                                      <>
                                          {article.publication_year != null && <span>{article.publication_year}</span>}
                                          {getStatusBadge(article)}
                                      </>
                                  }
                                  primaryAction={
                                      !hasInstances ? (
                                          <TooltipProvider>
                                              <Tooltip>
                                                  <TooltipTrigger asChild>
                                                      <Button onClick={(e) => {
                                                          e.stopPropagation();
                                                          handleStartExtraction(article.id);
                                                      }} variant="outline" size="sm"
                                                              aria-label={t('extraction', 'tableStart')}
                                                              className="h-8 w-8 rounded-full border-border/60 bg-background p-0 shadow-none hover:bg-muted/60"
                                                              disabled={article.isLoading}>
                                                          {article.isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> :
                                                              <PlayCircle className="h-3.5 w-3.5"/>}
                                                      </Button>
                                                  </TooltipTrigger>
                                                  <TooltipContent>
                                                      <p>{t('extraction', 'tableStart')}</p>
                                                  </TooltipContent>
                                              </Tooltip>
                                          </TooltipProvider>
                                      ) : (
                                          <TooltipProvider>
                                              <Tooltip>
                                                  <TooltipTrigger asChild>
                                                      <Button onClick={(e) => {
                                                          e.stopPropagation();
                                                          handleContinueExtraction(article.id);
                                                      }} variant="outline" size="sm"
                                                              aria-label={isComplete ? t('extraction', 'tableView') : t('extraction', 'tableContinue')}
                                                              className={`h-8 w-8 rounded-full p-0 shadow-none ${
                                                                  isComplete
                                                                      ? 'border-border/60 bg-background hover:bg-muted/60'
                                                                      : 'border-blue-200/80 bg-blue-50/60 text-blue-700 hover:bg-blue-100/70 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/40'
                                                              }`}>
                                                          {isComplete ? <CheckCircle className="h-3.5 w-3.5"/> :
                                                              <Edit className="h-3.5 w-3.5"/>}
                                                      </Button>
                                                  </TooltipTrigger>
                                                  <TooltipContent>
                                                      <p>{isComplete ? t('extraction', 'tableView') : t('extraction', 'tableContinue')}</p>
                                                  </TooltipContent>
                                              </Tooltip>
                                          </TooltipProvider>
                                      )
                                  }
                                  onClick={() => (hasInstances ? handleContinueExtraction(article.id) : handleStartExtraction(article.id))}
                              />
                          );
                      })}
                  </>
              }
          />

          {/* Empty state after filters (match ArticlesList) */}
      {filteredAndSortedArticles.length === 0 && articles.length > 0 && (
          <EmptyListState
              icon={Search}
              title={t('extraction', 'tableNoArticles')}
              description={t('extraction', 'tableAdjustFilters')}
              actionLabel={t('extraction', 'tableClearFilters')}
              onAction={clearListFilters}
          />
      )}
    </div>
  );
}
