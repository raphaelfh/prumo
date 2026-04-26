/**
 * Table for article assessment
 *
 * Displays articles in table format with:
 * - Global search and centralized filter panel (status, year, completion %, title, authors)
 * - Column sorting
 * - Minimal progress display
 * - Contextual actions
 */

import {useEffect, useMemo, useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {supabase} from '@/integrations/supabase/client';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Progress} from '@/components/ui/progress';
import {
    AlertCircle,
    BarChart3,
    Calendar,
    CheckCircle,
    Clock,
    Edit,
    FileText,
    Loader2,
    PlayCircle,
    Search,
    User
} from 'lucide-react';
import {toast} from 'sonner';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow,} from "@/components/ui/table";
import {Skeleton} from "@/components/ui/skeleton";
import type {Article as ArticleRow} from '@/types/article';
import {getAssessmentStatus, getStatusColor, getStatusLabel} from '@/lib/assessment-utils';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {useListKeyboardShortcuts} from '@/hooks/useListKeyboardShortcuts';
import {t} from '@/lib/copy';
import {TABLE_CELL_CLASS} from '@/lib/table-constants';
import type {FilterFieldConfig, FilterValues} from '@/components/shared/list';
import {
    EmptyListState,
    FilterButtonWithPopover,
    isFilterValueEmpty,
    ListCount,
    ListFilterPanel,
    ListRowCard,
    SortIconHeader,
    ListToolbarSearch,
    ResponsiveList,
} from '@/components/shared/list';
import {useIsNarrow} from '@/hooks/use-mobile';

type Article = Pick<ArticleRow, 'id' | 'title' | 'authors' | 'publication_year' | 'created_at'>;

interface Assessment {
  id: string;
  article_id: string;
  instrument_id: string;
  status: string;
  completion_percentage: number;
  updated_at: string;
}

interface ArticleWithAssessment extends Article {
  assessment: Assessment | null;
  isLoading: boolean;
}

interface ArticleAssessmentTableProps {
  projectId: string;
  instrumentId: string;
}

type SortField = 'title' | 'publication_year' | 'completion_percentage' | 'status' | 'created_at';
type SortDirection = 'asc' | 'desc';

const ASSESSMENT_FILTER_FIELDS: FilterFieldConfig[] = [
    {
        id: 'status', type: 'categorical', label: t('assessment', 'tableColumnStatus'), options: [
            {value: 'not_started', label: t('assessment', 'statusNotStarted')},
            {value: 'in_progress', label: t('assessment', 'statusInProgress')},
            {value: 'complete', label: t('assessment', 'statusComplete')},
        ]
    },
    {
        id: 'publication_year',
        type: 'numericRange',
        label: t('assessment', 'tableColumnYear'),
        minBound: 1900,
        maxBound: new Date().getFullYear() + 2
    },
    {
        id: 'completion_percentage',
        type: 'numericRange',
        label: t('assessment', 'tableColumnProgress'),
        minBound: 0,
        maxBound: 100
    },
    {
        id: 'title',
        type: 'text',
        label: t('assessment', 'tableColumnTitle'),
        placeholder: t('assessment', 'tableFilterTitlePlaceholder')
    },
    {
        id: 'authors',
        type: 'text',
        label: t('assessment', 'tableColumnAuthors'),
        placeholder: t('assessment', 'tableFilterAuthorsPlaceholder')
    },
];

const INITIAL_ASSESSMENT_FILTER_VALUES: FilterValues = Object.fromEntries(
    ASSESSMENT_FILTER_FIELDS.map(f => [f.id, f.type === 'categorical' ? [] : f.type === 'numericRange' ? {
        min: undefined,
        max: undefined
    } : ''])
) as FilterValues;
export function ArticleAssessmentTable({ projectId, instrumentId }: ArticleAssessmentTableProps) {
  const navigate = useNavigate();
    const isNarrow = useIsNarrow();
  const [articles, setArticles] = useState<ArticleWithAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, loading: authLoading } = useCurrentUser();
  const currentUserId = user?.id ?? null;

    // State for filters and sort
    const [searchQuery, setSearchQuery] = useState('');
    const [filterValues, setFilterValues] = useState<FilterValues>(INITIAL_ASSESSMENT_FILTER_VALUES);
    const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Carregar artigos do projeto
  useEffect(() => {
    if (projectId && instrumentId && currentUserId && !authLoading) {
      loadArticles();
    }
  }, [projectId, instrumentId, currentUserId, authLoading]);

  const loadArticles = async () => {
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

        // 2. Fetch current user assessments for those articles
      const { data: assessmentsData, error: assessmentsError } = await supabase
        .from('assessments')
        .select('*')
        .eq('project_id', projectId)
        .eq('instrument_id', instrumentId)
        .eq('user_id', currentUserId)
        .eq('is_current_version', true);

      if (assessmentsError) {
          console.error('Error fetching assessments:', assessmentsError);
        throw assessmentsError;
      }

        // 3. Combine articles with their assessments
      const articlesWithAssessment: ArticleWithAssessment[] = articlesData.map(article => {
        const assessment = assessmentsData?.find(a => a.article_id === article.id) || null;
        return {
          ...article,
          assessment,
          isLoading: false,
        };
      });

      setArticles(articlesWithAssessment);
    } catch (err) {
        const message = err instanceof Error ? err.message : t('assessment', 'tableErrorLoad');
        console.error('Error loading articles:', err);
      setError(message);
        toast.error(`${t('assessment', 'tableErrorLoad')}: ${message}`);
    } finally {
      setLoading(false);
    }
  };

    // Filter and sort articles from filterValues + searchQuery
  const filteredAndSortedArticles = useMemo(() => {
    const filtered = articles.filter(article => {
        // Global search (toolbar)
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            const matchesTitle = article.title.toLowerCase().includes(q);
            const matchesAuthors = article.authors?.some(a => a.toLowerCase().includes(q)) ?? false;
            const matchesYear = article.publication_year?.toString().includes(q) ?? false;
            if (!matchesTitle && !matchesAuthors && !matchesYear) return false;
        }

        const titleVal = filterValues.title;
        if (typeof titleVal === 'string' && titleVal.trim() && !article.title.toLowerCase().includes(titleVal.toLowerCase().trim())) return false;

        const authorsVal = filterValues.authors;
        if (typeof authorsVal === 'string' && authorsVal.trim() && article.authors?.length) {
            const match = article.authors.some(a => a.toLowerCase().includes((authorsVal as string).toLowerCase().trim()));
            if (!match) return false;
      }

        const yearVal = filterValues.publication_year;
        if (typeof yearVal === 'object' && yearVal && (yearVal.min !== undefined || yearVal.max !== undefined)) {
            const y = article.publication_year ?? 0;
            if (yearVal.min !== undefined && y < yearVal.min) return false;
            if (yearVal.max !== undefined && y > yearVal.max) return false;
      }

        const completionVal = filterValues.completion_percentage;
        if (typeof completionVal === 'object' && completionVal && (completionVal.min !== undefined || completionVal.max !== undefined)) {
            const p = article.assessment?.completion_percentage ?? 0;
            if (completionVal.min !== undefined && p < completionVal.min) return false;
            if (completionVal.max !== undefined && p > completionVal.max) return false;
      }

        const statusVal = filterValues.status;
        if (Array.isArray(statusVal) && statusVal.length > 0) {
            const progress = article.assessment?.completion_percentage ?? 0;
        const statusType = getAssessmentStatus(article.assessment?.status, progress);
            if (!statusVal.includes(statusType)) return false;
      }

      return true;
    });

    filtered.sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;
      switch (sortField) {
        case 'title':
          aValue = a.title.toLowerCase();
          bValue = b.title.toLowerCase();
          break;
        case 'publication_year':
          aValue = a.publication_year || 0;
          bValue = b.publication_year || 0;
          break;
        case 'completion_percentage':
          aValue = a.assessment?.completion_percentage || 0;
          bValue = b.assessment?.completion_percentage || 0;
          break;
        case 'status': {
          const aProgress = a.assessment?.completion_percentage || 0;
          const bProgress = b.assessment?.completion_percentage || 0;
          const aStatus = getAssessmentStatus(a.assessment?.status, aProgress);
          const bStatus = getAssessmentStatus(b.assessment?.status, bProgress);
            const toOrder = (s: string) => (s === 'complete' ? 2 : s === 'in_progress' ? 1 : 0);
          aValue = toOrder(aStatus);
          bValue = toOrder(bStatus);
          break;
        }
        case 'created_at':
          aValue = new Date(a.created_at).getTime();
          bValue = new Date(b.created_at).getTime();
          break;
        default:
          return 0;
      }
      if (sortDirection === 'asc') {
        if (aValue < bValue) return -1;
        if (aValue > bValue) return 1;
        return 0;
      }
        if (aValue > bValue) return -1;
        if (aValue < bValue) return 1;
        return 0;
    });

    return filtered;
  }, [articles, searchQuery, filterValues, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleStartAssessment = (articleId: string) => {
    navigate(`/projects/${projectId}/assessment/${articleId}/${instrumentId}`);
  };

  const handleContinueAssessment = (articleId: string) => {
    navigate(`/projects/${projectId}/assessment/${articleId}/${instrumentId}`);
  };

  const getStatusBadge = (article: ArticleWithAssessment) => {
    const progress = article.assessment?.completion_percentage || 0;
    const statusType = getAssessmentStatus(article.assessment?.status, progress);
    const color = getStatusColor(statusType);
    const label = getStatusLabel(statusType);

    if (statusType === 'not_started') {
      return (
        <Badge variant="secondary" className="gap-1 text-xs">
          <Clock className="h-3 w-3" />
          {label}
        </Badge>
      );
    }

    const Icon = statusType === 'complete' ? CheckCircle : Edit;
    return (
      <Badge variant="default" className={`gap-1 ${color} text-xs`}>
        <Icon className="h-3 w-3" />
        {label}
      </Badge>
    );
  };

    const clearListFilters = () => {
        setSearchQuery('');
        setFilterValues(INITIAL_ASSESSMENT_FILTER_VALUES);
  };

    const activeFiltersCount = ASSESSMENT_FILTER_FIELDS.filter(
        f => !isFilterValueEmpty(filterValues[f.id])
    ).length;

    useListKeyboardShortcuts({
        searchInputRef,
        setFilterPopoverOpen,
        filterPopoverOpen,
    });

    // Estado: Loading — skeleton que espelha o layout da tabela
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
                            <TableHead className="w-[30%]"><Skeleton className="h-4 w-20"/></TableHead>
                            <TableHead className="w-[15%]"><Skeleton className="h-4 w-14"/></TableHead>
                            <TableHead className="w-[10%]"><Skeleton className="h-4 w-10"/></TableHead>
                            <TableHead className="w-[15%]"><Skeleton className="h-4 w-16"/></TableHead>
                            <TableHead className="w-[10%]"><Skeleton className="h-4 w-12"/></TableHead>
                            <TableHead className="w-[15%] text-center"><Skeleton
                                className="h-4 w-12 mx-auto"/></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                            <TableRow key={i}>
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

  // Estado: Error
  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
        <div className="flex items-center space-x-3 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <div>
              <p className="font-medium">{t('assessment', 'tableErrorLoad')}</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </div>
        <Button onClick={loadArticles} variant="outline" className="mt-4">
            {t('assessment', 'tableTryAgain')}
        </Button>
      </div>
    );
  }

    // Estado: Empty (no articles in project)
  if (articles.length === 0) {
    return (
        <EmptyListState
            icon={FileText}
            title={t('assessment', 'tableNoArticlesInProject')}
            description={t('assessment', 'tableNoArticlesDesc')}
        />
    );
  }

    // Estado: Ready — toolbar + table
  return (
    <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 w-full">
            <ListToolbarSearch
                ref={searchInputRef}
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder={t('assessment', 'tableSearchPlaceholder')}
            />
            <FilterButtonWithPopover
                open={filterPopoverOpen}
                onOpenChange={setFilterPopoverOpen}
                activeCount={activeFiltersCount}
                tooltipLabel={t('assessment', 'tableFilterLabel')}
                ariaLabel={t('assessment', 'tableFilterLabel')}
            >
                <ListFilterPanel
                    fields={ASSESSMENT_FILTER_FIELDS}
                    values={filterValues}
                    onChange={setFilterValues}
                />
            </FilterButtonWithPopover>
            <ListCount
                visible={filteredAndSortedArticles.length}
                total={articles.length}
                label={t('assessment', 'tableArticlesCount')}
            />
        </div>

        <ResponsiveList
            isNarrow={isNarrow}
            tableContent={
        <Table>
          <TableHeader>
              <TableRow className="border-b border-border/40">
                  <TableHead
                      className="w-[30%] h-8 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                <SortIconHeader
                    label={t('assessment', 'tableColumnTitle')}
                    direction={sortField === 'title' ? sortDirection : null}
                    onSort={() => handleSort('title')}
                    containerClassName="flex items-center gap-2"
                    labelClassName="text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
                    iconClassName={sortField === 'title' ? 'h-4 w-4 text-foreground' : 'h-4 w-4 text-muted-foreground'}
                />
              </TableHead>
                  <TableHead
                      className="w-[15%] hidden md:table-cell h-8 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      {t('assessment', 'tableColumnAuthors')}
              </TableHead>
                  <TableHead
                      className="w-[10%] hidden md:table-cell h-8 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                <SortIconHeader
                    label={t('assessment', 'tableColumnYear')}
                    direction={sortField === 'publication_year' ? sortDirection : null}
                    onSort={() => handleSort('publication_year')}
                    containerClassName="flex items-center gap-2"
                    labelClassName="text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
                    iconClassName={sortField === 'publication_year' ? 'h-4 w-4 text-foreground' : 'h-4 w-4 text-muted-foreground'}
                />
              </TableHead>
                  <TableHead
                      className="w-[15%] hidden lg:table-cell h-8 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                <SortIconHeader
                    label={t('assessment', 'tableColumnProgress')}
                    direction={sortField === 'completion_percentage' ? sortDirection : null}
                    onSort={() => handleSort('completion_percentage')}
                    containerClassName="flex items-center gap-2"
                    labelClassName="text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
                    iconClassName={sortField === 'completion_percentage' ? 'h-4 w-4 text-foreground' : 'h-4 w-4 text-muted-foreground'}
                />
              </TableHead>
                  <TableHead
                      className="w-[10%] h-8 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                <SortIconHeader
                    label={t('assessment', 'tableColumnStatus')}
                    direction={sortField === 'status' ? sortDirection : null}
                    onSort={() => handleSort('status')}
                    containerClassName="flex items-center gap-2"
                    labelClassName="text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
                    iconClassName={sortField === 'status' ? 'h-4 w-4 text-foreground' : 'h-4 w-4 text-muted-foreground'}
                />
              </TableHead>
                  <TableHead
                      className="w-[15%] text-center h-8 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      {t('assessment', 'tableActions')}
                  </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSortedArticles.map((article) => {
              const progress = article.assessment?.completion_percentage || 0;
              const isComplete = getAssessmentStatus(article.assessment?.status, progress) === 'complete';

              return (
                  <TableRow key={article.id} className="hover:bg-muted/50 transition-[background-color] duration-75">
                      <TableCell className={TABLE_CELL_CLASS}>
                          <div className="font-medium leading-tight text-[13px]">
                      {article.title}
                    </div>
                  </TableCell>
                      <TableCell className={`hidden md:table-cell ${TABLE_CELL_CLASS}`}>
                    {article.authors && article.authors.length > 0 ? (
                      <div className="text-sm flex items-center gap-1 max-w-full overflow-hidden">
                        <User className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        <span className="truncate block" title={article.authors.join(', ')}>
                          {article.authors.slice(0, 2).join(', ')}
                          {article.authors.length > 2 && ` +${article.authors.length - 2}`}
                        </span>
                      </div>
                    ) : (
                        <span className="text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                      <TableCell className={`hidden md:table-cell ${TABLE_CELL_CLASS}`}>
                          <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3 text-muted-foreground" />
                      {article.publication_year || 'N/A'}
                    </div>
                  </TableCell>
                      <TableCell className={`hidden lg:table-cell ${TABLE_CELL_CLASS}`}>
                    {article.assessment ? (
                      <div className="space-y-1">
                          <div className="flex items-center justify-between text-[13px]">
                              <span className="text-muted-foreground">{t('assessment', 'tableColumnProgress')}</span>
                          <span className="font-medium">{progress.toFixed(0)}%</span>
                        </div>
                        <Progress value={progress} className="h-1.5" />
                      </div>
                    ) : (
                        <div className="text-muted-foreground flex items-center gap-1">
                        <BarChart3 className="h-3 w-3" />
                            {t('assessment', 'tableNotStarted')}
                      </div>
                    )}
                  </TableCell>
                      <TableCell className={TABLE_CELL_CLASS}>
                    {getStatusBadge(article)}
                  </TableCell>
                      <TableCell className={`text-center ${TABLE_CELL_CLASS}`}>
                    {!article.assessment ? (
                      <Button 
                        onClick={() => handleStartAssessment(article.id)}
                        disabled={article.isLoading}
                        size="sm"
                        className="gap-1 h-8"
                      >
                        {article.isLoading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <PlayCircle className="h-3 w-3" />
                        )}
                          {t('assessment', 'tableStart')}
                      </Button>
                    ) : (
                      <Button 
                        onClick={() => handleContinueAssessment(article.id)}
                        variant={isComplete ? "outline" : "default"}
                        size="sm"
                        className="gap-1 h-8"
                      >
                        {isComplete ? (
                          <CheckCircle className="h-3 w-3" />
                        ) : (
                          <Edit className="h-3 w-3" />
                        )}
                          {isComplete ? t('assessment', 'tableView') : t('assessment', 'tableContinue')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
            }
            cardContent={
                <>
                    {filteredAndSortedArticles.map((article) => {
                        const progress = article.assessment?.completion_percentage || 0;
                        const isComplete = getAssessmentStatus(article.assessment?.status, progress) === 'complete';
                        const hasAssessment = !!article.assessment;
                        return (
                            <ListRowCard
                                key={article.id}
                                title={article.title}
                                subtitle={article.authors?.slice(0, 2).join(', ') || undefined}
                                meta={
                                    <>
                                        {article.publication_year != null && <span>{article.publication_year}</span>}
                                        {getStatusBadge(article)}
                                    </>
                                }
                                primaryAction={
                                    !hasAssessment ? (
                                        <Button onClick={(e) => {
                                            e.stopPropagation();
                                            handleStartAssessment(article.id);
                                        }} size="sm" className="h-8 gap-1" disabled={article.isLoading}>
                                            {article.isLoading ? <Loader2 className="h-3 w-3 animate-spin"/> :
                                                <PlayCircle className="h-3 w-3"/>}
                                            {t('assessment', 'tableStart')}
                                        </Button>
                                    ) : (
                                        <Button onClick={(e) => {
                                            e.stopPropagation();
                                            handleContinueAssessment(article.id);
                                        }} variant={isComplete ? 'outline' : 'default'} size="sm" className="h-8 gap-1">
                                            {isComplete ? <CheckCircle className="h-3 w-3"/> :
                                                <Edit className="h-3 w-3"/>}
                                            {isComplete ? t('assessment', 'tableView') : t('assessment', 'tableContinue')}
                                        </Button>
                                    )
                                }
                                onClick={() => (hasAssessment ? handleContinueAssessment(article.id) : handleStartAssessment(article.id))}
                            />
                        );
                    })}
                </>
            }
        />

      {filteredAndSortedArticles.length === 0 && articles.length > 0 && (
          <EmptyListState
              icon={Search}
              title={t('assessment', 'tableNoArticlesFilter')}
              description={t('assessment', 'tableAdjustFilters')}
              actionLabel={t('assessment', 'tableClearFilters')}
              onAction={clearListFilters}
          />
      )}
    </div>
  );
}
