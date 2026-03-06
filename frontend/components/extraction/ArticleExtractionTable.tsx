/**
 * Table for article data extraction
 *
 * Displays articles in table format with:
 * - Global text filter
 * - Per-column filters (hidden until activated)
 * - Column sorting
 * - Minimal progress display
 * - Contextual actions
 */

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {supabase} from '@/integrations/supabase/client';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Progress} from '@/components/ui/progress';
import {Input} from '@/components/ui/input';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {
    AlertCircle,
    Calendar,
    CheckCircle,
    ChevronDown,
    ChevronsUpDown,
    ChevronUp,
    Clock,
    Database,
    Edit,
    FileText,
    Filter,
    Loader2,
    PlayCircle,
    Search,
    User
} from 'lucide-react';
import {toast} from 'sonner';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow,} from "@/components/ui/table";
import {Skeleton} from "@/components/ui/skeleton";
import {Popover, PopoverContent, PopoverTrigger,} from "@/components/ui/popover";
import {Checkbox} from "@/components/ui/checkbox";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import {useArticleSelection} from "@/hooks/extraction/useArticleSelection";
import {ArticleSelectionActions} from "./ArticleSelectionActions";
import {useFullAIExtraction} from "@/hooks/extraction/useFullAIExtraction";
import {t} from '@/lib/copy';

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

interface ExtractedValue {
  id: string;
  instance_id: string;
  field_id: string;
  value: any;
  reviewer_id: string | null;
  created_at: string;
}

interface ArticleWithExtraction extends Article {
  instances: ExtractionInstance[];
  extractedValues: ExtractedValue[];
  isLoading: boolean;
}

interface ArticleExtractionTableProps {
  projectId: string;
  templateId: string;
}

type SortField = 'title' | 'publication_year' | 'extraction_progress' | 'status' | 'created_at';
type SortDirection = 'asc' | 'desc';

interface ColumnFilter {
  title: string;
  publication_year: string;
  extraction_progress: string;
  status: string;
  authors: string;
}

export function ArticleExtractionTable({ projectId, templateId }: ArticleExtractionTableProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [articles, setArticles] = useState<ArticleWithExtraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

    // Filter and sort state
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFilter>({
    title: '',
    publication_year: '',
    extraction_progress: '',
    status: 'all',
    authors: ''
  });
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [activeFilterColumn, setActiveFilterColumn] = useState<keyof ColumnFilter | null>(null);

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

        // 3. Fetch extracted values for current user
      const { data: valuesData, error: valuesError } = await supabase
        .from('extracted_values')
        .select('*')
        .eq('project_id', projectId)
        .eq('reviewer_id', currentUserId);

      if (valuesError) {
          console.error('Error fetching extracted values:', valuesError);
        throw valuesError;
      }

        // 4. Combine articles with their extractions
      const articlesWithExtraction: ArticleWithExtraction[] = articlesData.map(article => {
        const articleInstances = instancesData?.filter(i => i.article_id === article.id) || [];
        const articleValues = valuesData?.filter(v => 
          articleInstances.some(instance => instance.id === v.instance_id)
        ) || [];
        
        return {
          ...article,
          instances: articleInstances as ExtractionInstance[],
          extractedValues: articleValues as ExtractedValue[],
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

        // Column filters
      if (columnFilters.title && !article.title.toLowerCase().includes(columnFilters.title.toLowerCase())) {
        return false;
      }
      
      if (columnFilters.publication_year && article.publication_year) {
        if (!article.publication_year.toString().includes(columnFilters.publication_year)) {
          return false;
        }
      }

      if (columnFilters.extraction_progress) {
        const progress = calculateExtractionProgress(article);
        const filterValue = columnFilters.extraction_progress.toLowerCase();

          // Text filters
          if (filterValue.includes('complete') && progress < 100) return false;
          if (filterValue.includes('progress') && (progress === 0 || progress >= 100)) return false;
          if (filterValue.includes('not started') && progress > 0) return false;

          // Numeric filter (percentage)
        if (!isNaN(Number(filterValue))) {
          const targetProgress = Number(filterValue);
            if (Math.abs(progress - targetProgress) > 5) return false; // 5% tolerance
        }
      }

        // Status filter
      if (columnFilters.status && columnFilters.status !== 'all') {
        const progress = calculateExtractionProgress(article);
        const hasInstances = article.instances.length > 0;
        const isComplete = progress >= 100;
        const isInProgress = hasInstances && progress > 0 && progress < 100;
        const isNotStarted = !hasInstances;
        
        const filterValue = columnFilters.status.toLowerCase();

          if (filterValue === 'complete' && !isComplete) return false;
          if (filterValue === 'in_progress' && !isInProgress) return false;
          if (filterValue === 'not_started' && !isNotStarted) return false;
      }

        // Authors filter
      if (columnFilters.authors && article.authors) {
        const authorMatch = article.authors.some(author => 
          author.toLowerCase().includes(columnFilters.authors.toLowerCase())
        );
        if (!authorMatch) return false;
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
  }, [articles, globalFilter, columnFilters, sortField, sortDirection]);

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

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ChevronsUpDown className="h-4 w-4 text-muted-foreground opacity-50" />;
    }
    return sortDirection === 'asc' 
      ? <ChevronUp className="h-4 w-4 text-primary" />
      : <ChevronDown className="h-4 w-4 text-primary" />;
  };

  const handleStartExtraction = (articleId: string) => {
    navigate(`/projects/${projectId}/extraction/${articleId}`);
  };

  const handleContinueExtraction = (articleId: string) => {
    navigate(`/projects/${projectId}/extraction/${articleId}`);
  };

  const getStatusBadge = (article: ArticleWithExtraction) => {
    const progress = calculateExtractionProgress(article);
    const hasInstances = article.instances.length > 0;

    if (!hasInstances) {
      return (
        <Badge variant="secondary" className="gap-1 text-xs">
          <Clock className="h-3 w-3" />
            {t('extraction', 'listStatusNotStarted')}
        </Badge>
      );
    }

    if (progress >= 100) {
      return (
        <Badge variant="default" className="gap-1 bg-green-500 text-xs">
          <CheckCircle className="h-3 w-3" />
            {t('extraction', 'listStatusComplete')}
        </Badge>
      );
    }

    return (
      <Badge variant="default" className="gap-1 bg-blue-500 text-xs">
        <Edit className="h-3 w-3" />
          {t('extraction', 'listStatusInProgress')}
      </Badge>
    );
  };

  const updateColumnFilter = (column: keyof ColumnFilter, value: string) => {
    setColumnFilters(prev => ({
      ...prev,
      [column]: value
    }));
  };

  const ColumnFilterButton = ({ column }: { column: keyof ColumnFilter }) => {
    const isActive = activeFilterColumn === column;
    const hasFilter = column === 'status' 
      ? (columnFilters[column].length > 0 && columnFilters[column] !== 'all')
      : columnFilters[column].length > 0;

    const statusOptions = [
        {value: 'all', label: t('extraction', 'tableFilterAllStatus')},
        {value: 'not_started', label: t('extraction', 'listStatusNotStarted')},
        {value: 'in_progress', label: t('extraction', 'listStatusInProgress')},
        {value: 'complete', label: t('extraction', 'listStatusComplete')}
    ];

    return (
      <Popover open={isActive} onOpenChange={(open) => setActiveFilterColumn(open ? column : null)}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`h-6 w-6 p-0 ${hasFilter ? 'text-primary' : 'text-muted-foreground'}`}
          >
            <Filter className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <div className="space-y-2">
            <label className="text-sm font-medium">
                {t('common', 'filterBy')}{' '}{
                column === 'title' ? t('extraction', 'tableColumnTitle') :
                    column === 'publication_year' ? t('extraction', 'tableColumnYear') :
                        column === 'extraction_progress' ? t('extraction', 'tableColumnProgress') :
                            column === 'status' ? t('extraction', 'tableColumnStatus') :
                                column === 'authors' ? t('extraction', 'tableColumnAuthors') :
                                    t('extraction', 'tableColumnField')
              }
            </label>
            
            {column === 'status' ? (
              <Select 
                value={columnFilters[column] || 'all'} 
                onValueChange={(value) => updateColumnFilter(column, value)}
              >
                <SelectTrigger className="h-8">
                    <SelectValue placeholder={t('extraction', 'tableFilterSelectStatus')}/>
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                autoFocus
                placeholder={
                    column === 'title' ? t('extraction', 'tableSearchTitle') :
                        column === 'publication_year' ? t('extraction', 'tableSearchYearPlaceholder') :
                            column === 'extraction_progress' ? t('extraction', 'tableSearchProgressPlaceholder') :
                                column === 'authors' ? t('extraction', 'tableSearchAuthor') :
                                    t('extraction', 'tableSearchPlaceholder')
                }
                value={columnFilters[column]}
                onChange={(e) => updateColumnFilter(column, e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                className="h-8"
              />
            )}
            
            {hasFilter && columnFilters[column] !== 'all' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateColumnFilter(column, column === 'status' ? 'all' : '')}
                className="h-6 text-xs"
              >
                  {t('extraction', 'tableClearFilter')}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  };

    // Loading state — skeleton matching table layout
  if (loading) {
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <Skeleton className="h-9 flex-1 max-w-sm"/>
                <Skeleton className="h-4 w-24"/>
            </div>
            <div className="rounded-lg border border-border/40">
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

    // Empty state
  if (articles.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="font-medium">{t('extraction', 'listNoArticles')}</p>
          <p className="text-sm mt-2">{t('extraction', 'listNoArticlesDesc')}</p>
      </div>
    );
  }

    // Ready state — render table
  const selectedArticleIds = Array.from(selectedIds);
  const selectedArticleTitles = filteredAndSortedArticles
    .filter(a => selectedIds.has(a.id))
    .map(a => a.title);

  return (
    <div className="space-y-4">
        {/* Selection actions bar */}
      <ArticleSelectionActions
        selectedCount={selectedCount}
        selectedArticleIds={selectedArticleIds}
        selectedArticleTitles={selectedArticleTitles}
        onClearSelection={deselectAll}
        onBatchAIExtraction={handleBatchAIExtraction}
        isExtracting={isExtracting}
      />

        {/* Global filter */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
              placeholder={t('extraction', 'tableSearchAllFields')}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-10 h-9"
          />
        </div>
          <div className="text-[13px] text-muted-foreground">
              {filteredAndSortedArticles.length} {t('common', 'of')} {articles.length} {t('extraction', 'tableArticlesCount')}
        </div>
      </div>

        {/* Table */}
        <div className="rounded-lg border border-border/40">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
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
              <TableHead className="w-[30%]">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort('title')}
                    className="h-auto p-0 font-semibold hover:bg-transparent"
                  >
                      {t('extraction', 'tableColumnTitle')}
                  </Button>
                  {getSortIcon('title')}
                  <ColumnFilterButton column="title" />
                </div>
              </TableHead>
              <TableHead className="w-[12%]">
                <div className="flex items-center gap-2">
                    <span className="font-semibold">{t('extraction', 'tableColumnAuthors')}</span>
                  <ColumnFilterButton column="authors" />
                </div>
              </TableHead>
              <TableHead className="w-[10%]">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort('publication_year')}
                    className="h-auto p-0 font-semibold hover:bg-transparent"
                  >
                      {t('extraction', 'tableColumnYear')}
                  </Button>
                  {getSortIcon('publication_year')}
                  <ColumnFilterButton column="publication_year" />
                </div>
              </TableHead>
              <TableHead className="w-[18%]">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort('extraction_progress')}
                    className="h-auto p-0 font-semibold hover:bg-transparent"
                  >
                      {t('extraction', 'tableColumnProgress')}
                  </Button>
                  {getSortIcon('extraction_progress')}
                  <ColumnFilterButton column="extraction_progress" />
                </div>
              </TableHead>
              <TableHead className="w-[10%]">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort('status')}
                    className="h-auto p-0 font-semibold hover:bg-transparent"
                  >
                      {t('extraction', 'tableColumnStatus')}
                  </Button>
                  {getSortIcon('status')}
                  <ColumnFilterButton column="status" />
                </div>
              </TableHead>
                <TableHead className="w-[15%] text-center">{t('extraction', 'tableActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSortedArticles.map((article) => {
              const progress = calculateExtractionProgress(article);
              const isComplete = progress >= 100;
              const hasInstances = article.instances.length > 0;

              return (
                  <TableRow key={article.id} className="hover:bg-muted/50 transition-[background-color] duration-75">
                  <TableCell className="w-[40px]">
                    <Checkbox
                      checked={isSelected(article.id)}
                      onCheckedChange={() => toggleArticle(article.id)}
                      aria-label={`Select article: ${article.title}`}
                    />
                  </TableCell>
                      <TableCell className="text-[13px]">
                          <div className="font-medium leading-tight">
                      {article.title}
                    </div>
                  </TableCell>
                      <TableCell className="max-w-[120px] text-[13px]">
                    {article.authors && article.authors.length > 0 ? (
                      <div
                          className="flex items-center gap-1 cursor-help group relative"
                        title={article.authors.join(', ')}
                      >
                        <User className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        <span className="truncate block min-w-0">
                          {article.authors.slice(0, 1).join(', ')}
                          {article.authors.length > 1 && ` +${article.authors.length - 1}`}
                        </span>
                          {/* Tooltip on hover */}
                        <div className="absolute left-0 top-full mt-1 z-10 hidden group-hover:block bg-popover border rounded-md shadow-lg p-2 max-w-xs">
                          <div className="text-xs text-popover-foreground">
                            {article.authors.join(', ')}
                          </div>
                        </div>
                      </div>
                    ) : (
                        <span className="text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                      <TableCell className="text-[13px]">
                          <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3 text-muted-foreground" />
                      {article.publication_year || 'N/A'}
                    </div>
                  </TableCell>
                      <TableCell className="text-[13px]">
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
                      <TableCell className="text-[13px]">
                    {getStatusBadge(article)}
                  </TableCell>
                      <TableCell className="text-center text-[13px]">
                    {!hasInstances ? (
                      <Button 
                        onClick={() => handleStartExtraction(article.id)}
                        disabled={article.isLoading}
                        size="sm"
                        className="gap-1 h-8"
                      >
                        {article.isLoading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <PlayCircle className="h-3 w-3" />
                        )}
                          {t('extraction', 'tableStart')}
                      </Button>
                    ) : (
                      <Button 
                        onClick={() => handleContinueExtraction(article.id)}
                        variant={isComplete ? "outline" : "default"}
                        size="sm"
                        className="gap-1 h-8"
                      >
                        {isComplete ? (
                          <CheckCircle className="h-3 w-3" />
                        ) : (
                          <Edit className="h-3 w-3" />
                        )}
                          {isComplete ? t('extraction', 'tableView') : t('extraction', 'tableContinue')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

        {/* Empty state after filters */}
      {filteredAndSortedArticles.length === 0 && articles.length > 0 && (
        <div className="text-center text-muted-foreground py-8">
          <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="font-medium">{t('extraction', 'tableNoArticles')}</p>
            <p className="text-sm mt-1">{t('extraction', 'tableAdjustFilters')}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setGlobalFilter('');
              setColumnFilters({ title: '', publication_year: '', extraction_progress: '', status: 'all', authors: '' });
            }}
            className="mt-2"
          >
              {t('extraction', 'tableClearFilters')}
          </Button>
        </div>
      )}
    </div>
  );
}
