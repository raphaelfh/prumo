/**
 * Tabela elegante para avaliação de artigos
 * 
 * Exibe artigos em formato de tabela com:
 * - Filtro global por texto
 * - Filtros por coluna (discretos até ativados)
 * - Ordenação por coluna
 * - Progresso visual minimalista
 * - Ações contextuais
 */

import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  FileText, 
  PlayCircle, 
  Edit, 
  CheckCircle, 
  Clock,
  Loader2,
  AlertCircle,
  Search,
  Filter,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Calendar,
  User,
  BarChart3
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Article {
  id: string;
  title: string;
  authors: string[] | null;
  publication_year: number | null;
  created_at: string;
}

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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  
  // Estados para filtros e ordenação
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

  // Carregar ID do usuário atual
  useEffect(() => {
    loadCurrentUser();
  }, []);

  // Carregar artigos do projeto
  useEffect(() => {
    if (projectId && instrumentId && currentUserId) {
      loadArticles();
    }
  }, [projectId, instrumentId, currentUserId]);

  const loadCurrentUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
      }
    } catch (error: any) {
      console.error('Erro ao carregar usuário:', error);
    }
  };

  const loadArticles = async () => {
    setLoading(true);
    setError(null);

    try {
      // 1. Buscar artigos do projeto
      const { data: articlesData, error: articlesError } = await supabase
        .from('articles')
        .select('id, title, authors, publication_year, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (articlesError) {
        console.error('Erro ao buscar artigos:', articlesError);
        throw articlesError;
      }

      if (!articlesData || articlesData.length === 0) {
        setArticles([]);
        return;
      }

      // 2. Buscar avaliações do usuário atual para esses artigos
      const { data: assessmentsData, error: assessmentsError } = await supabase
        .from('assessments')
        .select('*')
        .eq('project_id', projectId)
        .eq('instrument_id', instrumentId)
        .eq('user_id', currentUserId)
        .eq('is_current_version', true);

      if (assessmentsError) {
        console.error('Erro ao buscar avaliações:', assessmentsError);
        throw assessmentsError;
      }

      // 3. Combinar artigos com suas avaliações
      const articlesWithAssessment: ArticleWithAssessment[] = articlesData.map(article => {
        const assessment = assessmentsData?.find(a => a.article_id === article.id) || null;
        return {
          ...article,
          assessment,
          isLoading: false,
        };
      });

      setArticles(articlesWithAssessment);
    } catch (err: any) {
      console.error('Erro ao carregar artigos:', err);
      setError(err.message);
      toast.error(`Erro ao carregar artigos: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Função para filtrar e ordenar artigos
  const filteredAndSortedArticles = useMemo(() => {
    let filtered = articles.filter(article => {
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
        
        if (filterValue.includes('completo') && progress < 100) return false;
        if (filterValue.includes('andamento') && (progress === 0 || progress >= 100)) return false;
        if (filterValue.includes('não iniciado') && progress > 0) return false;
        if (!isNaN(Number(filterValue)) && !progress.toString().includes(filterValue)) return false;
      }

      // Filtro por status
      if (columnFilters.status && columnFilters.status !== 'all') {
        const hasAssessment = !!article.assessment;
        const progress = article.assessment?.completion_percentage || 0;
        const isComplete = article.assessment?.status === 'submitted' || progress >= 100;
        const isInProgress = hasAssessment && progress > 0 && progress < 100;
        const isNotStarted = !hasAssessment;
        
        const filterValue = columnFilters.status.toLowerCase();
        
        if (filterValue === 'completo' && !isComplete) return false;
        if (filterValue === 'em andamento' && !isInProgress) return false;
        if (filterValue === 'não iniciado' && !isNotStarted) return false;
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

    // Ordenação
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
        case 'completion_percentage':
          aValue = a.assessment?.completion_percentage || 0;
          bValue = b.assessment?.completion_percentage || 0;
          break;
        case 'status':
          // Ordenar por status: não iniciado (0), em andamento (1), completo (2)
          const aProgress = a.assessment?.completion_percentage || 0;
          const bProgress = b.assessment?.completion_percentage || 0;
          const aHasAssessment = !!a.assessment;
          const bHasAssessment = !!b.assessment;
          
          aValue = !aHasAssessment ? 0 : (aProgress >= 100 ? 2 : 1);
          bValue = !bHasAssessment ? 0 : (bProgress >= 100 ? 2 : 1);
          break;
        case 'created_at':
          aValue = new Date(a.created_at).getTime();
          bValue = new Date(b.created_at).getTime();
          break;
        default:
          return 0;
      }

      // Lógica de ordenação corrigida
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
    if (!article.assessment) {
      return (
        <Badge variant="secondary" className="gap-1 text-xs">
          <Clock className="h-3 w-3" />
          Não iniciada
        </Badge>
      );
    }

    const progress = article.assessment.completion_percentage || 0;

    if (article.assessment.status === 'submitted' || progress >= 100) {
      return (
        <Badge variant="default" className="gap-1 bg-green-500 text-xs">
          <CheckCircle className="h-3 w-3" />
          Completa
        </Badge>
      );
    }

    return (
      <Badge variant="default" className="gap-1 bg-blue-500 text-xs">
        <Edit className="h-3 w-3" />
        Em andamento
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

    // Status options para o dropdown
    const statusOptions = [
      { value: 'all', label: 'Todos os status' },
      { value: 'não iniciado', label: 'Não iniciado' },
      { value: 'em andamento', label: 'Em andamento' },
      { value: 'completo', label: 'Completo' }
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
              Filtrar por {
                column === 'title' ? 'Título' : 
                column === 'publication_year' ? 'Ano' : 
                column === 'completion_percentage' ? 'Progresso' :
                column === 'status' ? 'Status' :
                column === 'authors' ? 'Autores' :
                'Campo'
              }
            </label>
            
            {column === 'status' ? (
              <Select 
                value={columnFilters[column] || 'all'} 
                onValueChange={(value) => updateColumnFilter(column, value)}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Selecionar status..." />
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
                  column === 'title' ? 'Buscar no título...' :
                  column === 'publication_year' ? 'Ex: 2023, 2020-2024...' :
                  column === 'completion_percentage' ? 'Ex: completo, andamento, 50...' :
                  column === 'authors' ? 'Buscar autor...' :
                  'Buscar...'
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
                Limpar
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  // Estado: Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Carregando artigos...</span>
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
            <p className="font-medium">Erro ao carregar artigos</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </div>
        <Button onClick={loadArticles} variant="outline" className="mt-4">
          Tentar novamente
        </Button>
      </div>
    );
  }

  // Estado: Empty
  if (articles.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p className="font-medium">Nenhum artigo encontrado neste projeto</p>
        <p className="text-sm mt-2">Adicione artigos primeiro para iniciar as avaliações.</p>
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
            placeholder="Buscar em todos os campos..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-10 h-9"
          />
        </div>
        <div className="text-sm text-muted-foreground">
          {filteredAndSortedArticles.length} de {articles.length} artigos
        </div>
      </div>

      {/* Tabela */}
      <div className="rounded-lg border">
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
                    Título
                  </Button>
                  {getSortIcon('title')}
                  <ColumnFilterButton column="title" />
                </div>
              </TableHead>
              <TableHead className="w-[15%]">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Autores</span>
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
                    Ano
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
                    Progresso
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
                    Status
                  </Button>
                  {getSortIcon('status')}
                  <ColumnFilterButton column="status" />
                </div>
              </TableHead>
              <TableHead className="w-[15%] text-center">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSortedArticles.map((article) => {
              const progress = article.assessment?.completion_percentage || 0;
              const isComplete = article.assessment?.status === 'submitted' || progress >= 100;

              return (
                <TableRow key={article.id} className="hover:bg-muted/50">
                  <TableCell>
                    <div className="font-medium text-sm leading-tight">
                      {article.title}
                    </div>
                  </TableCell>
                  <TableCell>
                    {article.authors && article.authors.length > 0 ? (
                      <div className="text-sm flex items-center gap-1 max-w-full overflow-hidden">
                        <User className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        <span className="truncate block" title={article.authors.join(', ')}>
                          {article.authors.slice(0, 2).join(', ')}
                          {article.authors.length > 2 && ` +${article.authors.length - 2}`}
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-sm">
                      <Calendar className="h-3 w-3 text-muted-foreground" />
                      {article.publication_year || 'N/A'}
                    </div>
                  </TableCell>
                  <TableCell>
                    {article.assessment ? (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Progresso</span>
                          <span className="font-medium">{progress.toFixed(0)}%</span>
                        </div>
                        <Progress value={progress} className="h-1.5" />
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <BarChart3 className="h-3 w-3" />
                        Não iniciada
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(article)}
                  </TableCell>
                  <TableCell className="text-center">
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
                        Iniciar
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
                        {isComplete ? 'Ver' : 'Continuar'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Estado vazio após filtros */}
      {filteredAndSortedArticles.length === 0 && articles.length > 0 && (
        <div className="text-center text-muted-foreground py-8">
          <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="font-medium">Nenhum artigo encontrado</p>
          <p className="text-sm mt-1">Tente ajustar os filtros de busca.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setGlobalFilter('');
              setColumnFilters({ title: '', publication_year: '', completion_percentage: '', status: 'all', authors: '' });
            }}
            className="mt-2"
          >
            Limpar filtros
          </Button>
        </div>
      )}
    </div>
  );
}
