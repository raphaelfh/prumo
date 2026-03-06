/**
 * Table for article assessment
 * 
 * Exibe artigos em formato de tabela com:
 * - Global text filter
 * - Per-column filters (discrete until activated)
 * - Per-column sorting
 * - Minimalist visual progress
 * - Contextual actions
 */

import {useEffect, useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {supabase} from '@/integrations/supabase/client';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Progress} from '@/components/ui/progress';
import {Input} from '@/components/ui/input';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {
    AlertCircle,
    BarChart3,
    Calendar,
    CheckCircle,
    ChevronDown,
    ChevronsUpDown,
    ChevronUp,
    Clock,
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
import type {Article as ArticleRow} from '@/types/article';
import {getAssessmentStatus, getStatusColor, getStatusLabel} from '@/lib/assessment-utils';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {t} from '@/lib/copy';

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

interface ColumnFilter {
  title: string;
  publication_year: string;
  completion_percentage: string;
  status: string;
  authors: string;
}

export function ArticleAssessmentTable({ projectId, instrumentId }: ArticleAssessmentTableProps) {
  const navigate = useNavigate();
  const [articles, setArticles] = useState<ArticleWithAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, loading: authLoading } = useCurrentUser();
  const currentUserId = user?.id ?? null;

    // State for filters and sort
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFilter>({
    title: '',
    publication_year: '',
    completion_percentage: '',
    status: 'all',
    authors: ''
  });
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [activeFilterColumn, setActiveFilterColumn] = useState<keyof ColumnFilter | null>(null);

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

    // Function to filter and sort articles
  const filteredAndSortedArticles = useMemo(() => {
    const filtered = articles.filter(article => {
      // Filtro global
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

      // Filtros por coluna
      if (columnFilters.title && !article.title.toLowerCase().includes(columnFilters.title.toLowerCase())) {
        return false;
      }
      
      if (columnFilters.publication_year && article.publication_year) {
        if (!article.publication_year.toString().includes(columnFilters.publication_year)) {
          return false;
        }
      }

      if (columnFilters.completion_percentage) {
        const progress = article.assessment?.completion_percentage || 0;
        const filterValue = columnFilters.completion_percentage.toLowerCase();

          if (filterValue.includes('complete') && progress < 100) return false;
          if (filterValue.includes('progress') && (progress === 0 || progress >= 100)) return false;
          if (filterValue.includes('not started') && progress > 0) return false;
        if (!isNaN(Number(filterValue)) && !progress.toString().includes(filterValue)) return false;
      }

      // Filtro por status
      if (columnFilters.status && columnFilters.status !== 'all') {
        const progress = article.assessment?.completion_percentage || 0;
        const statusType = getAssessmentStatus(article.assessment?.status, progress);
        
        const filterValue = columnFilters.status.toLowerCase();

          if (filterValue === 'complete' && statusType !== 'complete') return false;
          if (filterValue === 'in_progress' && statusType !== 'in_progress') return false;
          if (filterValue === 'not_started' && statusType !== 'not_started') return false;
      }

      // Filtro por autores
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
            // Sort by status: not started (0), in progress (1), complete (2)
          const aProgress = a.assessment?.completion_percentage || 0;
          const bProgress = b.assessment?.completion_percentage || 0;
          const aStatus = getAssessmentStatus(a.assessment?.status, aProgress);
          const bStatus = getAssessmentStatus(b.assessment?.status, bProgress);

          const toOrder = (status: string) => {
            if (status === 'complete') return 2;
            if (status === 'in_progress') return 1;
            return 0;
          };

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

        // Corrected sort logic
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

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />;
    }
    return sortDirection === 'asc' 
      ? <ChevronUp className="h-4 w-4 text-foreground" />
      : <ChevronDown className="h-4 w-4 text-foreground" />;
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
        {value: 'all', label: t('assessment', 'statusAll')},
        {value: 'not_started', label: t('assessment', 'statusNotStarted')},
        {value: 'in_progress', label: t('assessment', 'statusInProgress')},
        {value: 'complete', label: t('assessment', 'statusComplete')}
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
                {t('assessment', 'tableFilterLabel')}{' '}
                {column === 'title' ? t('assessment', 'tableColumnTitle') :
                    column === 'publication_year' ? t('assessment', 'tableColumnYear') :
                        column === 'completion_percentage' ? t('assessment', 'tableColumnProgress') :
                            column === 'status' ? t('assessment', 'tableColumnStatus') :
                                column === 'authors' ? t('assessment', 'tableColumnAuthors') :
                                    t('assessment', 'filterColumnField')}
            </label>
            
            {column === 'status' ? (
              <Select 
                value={columnFilters[column] || 'all'} 
                onValueChange={(value) => updateColumnFilter(column, value)}
              >
                <SelectTrigger className="h-8">
                    <SelectValue placeholder={t('assessment', 'tableFilterStatusPlaceholder')}/>
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
                    column === 'title' ? t('assessment', 'tableFilterTitlePlaceholder') :
                        column === 'publication_year' ? t('assessment', 'tableFilterYearPlaceholder') :
                            column === 'completion_percentage' ? t('assessment', 'tableFilterProgressPlaceholder') :
                                column === 'authors' ? t('assessment', 'tableFilterAuthorsPlaceholder') :
                                    t('assessment', 'tableFilterSearchPlaceholder')
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
                  {t('assessment', 'tableFilterClear')}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  };

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

  // Estado: Empty
  if (articles.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="font-medium">{t('assessment', 'tableNoArticlesInProject')}</p>
          <p className="text-sm mt-2">{t('assessment', 'tableNoArticlesDesc')}</p>
      </div>
    );
  }

  // Estado: Ready - Renderizar tabela
  return (
    <div className="space-y-4">
      {/* Filtro Global */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
              placeholder={t('assessment', 'tableSearchPlaceholder')}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-10 h-9"
          />
        </div>
          <div className="text-[13px] text-muted-foreground">
              {filteredAndSortedArticles.length} / {articles.length} {t('assessment', 'tableArticlesCount')}
        </div>
      </div>

      {/* Tabela */}
        <div className="rounded-lg border border-border/40">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30%]">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort('title')}
                    className="h-auto p-0 font-semibold hover:bg-transparent"
                  >
                      {t('assessment', 'tableColumnTitle')}
                  </Button>
                  {getSortIcon('title')}
                  <ColumnFilterButton column="title" />
                </div>
              </TableHead>
              <TableHead className="w-[15%]">
                <div className="flex items-center gap-2">
                    <span className="font-semibold">{t('assessment', 'tableColumnAuthors')}</span>
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
                      {t('assessment', 'tableColumnYear')}
                  </Button>
                  {getSortIcon('publication_year')}
                  <ColumnFilterButton column="publication_year" />
                </div>
              </TableHead>
              <TableHead className="w-[15%]">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort('completion_percentage')}
                    className="h-auto p-0 font-semibold hover:bg-transparent"
                  >
                      {t('assessment', 'tableColumnProgress')}
                  </Button>
                  {getSortIcon('completion_percentage')}
                  <ColumnFilterButton column="completion_percentage" />
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
                      {t('assessment', 'tableColumnStatus')}
                  </Button>
                  {getSortIcon('status')}
                  <ColumnFilterButton column="status" />
                </div>
              </TableHead>
                <TableHead className="w-[15%] text-center">{t('assessment', 'tableActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSortedArticles.map((article) => {
              const progress = article.assessment?.completion_percentage || 0;
              const isComplete = getAssessmentStatus(article.assessment?.status, progress) === 'complete';

              return (
                  <TableRow key={article.id} className="hover:bg-muted/50 transition-[background-color] duration-75">
                      <TableCell className="text-[13px]">
                          <div className="font-medium leading-tight">
                      {article.title}
                    </div>
                  </TableCell>
                      <TableCell className="text-[13px]">
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
                      <TableCell className="text-[13px]">
                          <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3 text-muted-foreground" />
                      {article.publication_year || 'N/A'}
                    </div>
                  </TableCell>
                      <TableCell className="text-[13px]">
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
                      <TableCell className="text-[13px]">
                    {getStatusBadge(article)}
                  </TableCell>
                      <TableCell className="text-center text-[13px]">
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
      </div>

        {/* Empty state after filters */}
      {filteredAndSortedArticles.length === 0 && articles.length > 0 && (
        <div className="text-center text-muted-foreground py-8">
          <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="font-medium">{t('assessment', 'tableNoArticlesFilter')}</p>
            <p className="text-sm mt-1">{t('assessment', 'tableAdjustFilters')}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setGlobalFilter('');
              setColumnFilters({ title: '', publication_year: '', completion_percentage: '', status: 'all', authors: '' });
            }}
            className="mt-2"
          >
              {t('assessment', 'tableClearFilters')}
          </Button>
        </div>
      )}
    </div>
  );
}
