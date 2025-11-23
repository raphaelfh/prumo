/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Tabela elegante para extração de dados de artigos
 * 
 * Exibe artigos em formato de tabela com:
 * - Filtro global por texto
 * - Filtros por coluna (discretos até ativados)
 * - Ordenação por coluna
 * - Progresso visual minimalista
 * - Ações contextuais
 */

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
  Database
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
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useArticleSelection } from "@/hooks/extraction/useArticleSelection";
import { ArticleSelectionActions } from "./ArticleSelectionActions";
import { useFullAIExtraction } from "@/hooks/extraction/useFullAIExtraction";

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
  
  // Estados para filtros e ordenação
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

  // Ref para rastrear última rota visitada (evitar refresh desnecessário)
  const lastPathRef = useRef<string>('');
  const loadArticlesRef = useRef<() => Promise<void>>();

  // Hook para extração IA em batch
  const { extractFullAI, loading: isExtracting } = useFullAIExtraction({
    onSuccess: async () => {
      // Recarregar artigos após extração
      await loadArticles();
      toast.success('Extração concluída com sucesso!');
    },
  });

  // Declarar loadCurrentUser antes de qualquer uso para evitar TDZ
  const loadCurrentUser = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
      }
    } catch (error: any) {
      console.error('Erro ao carregar usuário:', error);
    }
  }, []);

  // Declarar loadArticles antes de qualquer uso para evitar TDZ
  const loadArticles = useCallback(async () => {
    if (!projectId || !templateId || !currentUserId) {
      return;
    }

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

      // 2. Buscar instâncias de extração para o template
      const { data: instancesData, error: instancesError } = await supabase
        .from('extraction_instances')
        .select('*')
        .eq('project_id', projectId)
        .eq('template_id', templateId);

      if (instancesError) {
        console.error('Erro ao buscar instâncias:', instancesError);
        throw instancesError;
      }

      // 3. Buscar valores extraídos pelo usuário atual
      const { data: valuesData, error: valuesError } = await supabase
        .from('extracted_values')
        .select('*')
        .eq('project_id', projectId)
        .eq('reviewer_id', currentUserId);

      if (valuesError) {
        console.error('Erro ao buscar valores extraídos:', valuesError);
        throw valuesError;
      }

      // 4. Combinar artigos com suas extrações
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
      console.error('Erro ao carregar artigos:', err);
      setError(err.message);
      toast.error(`Erro ao carregar artigos: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [projectId, templateId, currentUserId]);

  // Atualizar ref da função loadArticles quando ela mudar (deve vir antes de qualquer uso)
  useEffect(() => {
    loadArticlesRef.current = loadArticles;
  }, [loadArticles]);

  // Carregar ID do usuário atual
  useEffect(() => {
    loadCurrentUser();
  }, [loadCurrentUser]);

  // Carregar artigos do projeto
  useEffect(() => {
    if (projectId && templateId && currentUserId) {
      // Usar loadArticles diretamente para evitar problemas de timing com o ref
      loadArticles();
    }
  }, [projectId, templateId, currentUserId, loadArticles]);

  // Refresh automático quando voltar para a página (após finalizar extração)
  // Isso garante que os dados sejam atualizados após mudanças feitas em outras páginas
  useEffect(() => {
    const currentPath = location.pathname;
    
    // Só recarregar se:
    // 1. Estamos na rota de projetos (mas não na rota de extração fullscreen)
    // 2. A rota mudou (não é a primeira renderização)
    // 3. Voltamos de uma página de extração fullscreen (tinha articleId antes, não tem agora)
    const isProjectExtractionRoute = currentPath.includes('/projects/') && 
                                     !currentPath.match(/\/extraction\/[^/]+$/); // Não está na rota de extração específica
    const cameFromExtractionFullscreen = lastPathRef.current.match(/\/extraction\/[^/]+$/); // Veio de uma rota de extração específica
    
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
      
      // Pequeno delay para garantir que a navegação foi completada
      const timer = setTimeout(() => {
        if (loadArticlesRef.current) {
          loadArticlesRef.current();
        }
      }, 300);
      
      return () => clearTimeout(timer);
    } else if (currentPath !== lastPathRef.current) {
      // Atualizar ref mesmo se não recarregar
      lastPathRef.current = currentPath;
    }
  }, [location.pathname, projectId, templateId, currentUserId]); // Recarregar quando a rota mudar

  // Função para calcular progresso de extração
  const calculateExtractionProgress = (article: ArticleWithExtraction) => {
    if (article.instances.length === 0) return 0;
    
    // Verificar se todas as instâncias estão com status 'completed'
    const allCompleted = article.instances.every(instance => instance.status === 'completed');
    if (allCompleted && article.instances.length > 0) {
      return 100;
    }
    
    // Contar instâncias com pelo menos um valor extraído
    const instancesWithValues = article.instances.filter(instance =>
      article.extractedValues.some(value => value.instance_id === instance.id)
    ).length;
    
    return Math.round((instancesWithValues / article.instances.length) * 100);
  };

  // Função para filtrar e ordenar artigos
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

      if (columnFilters.extraction_progress) {
        const progress = calculateExtractionProgress(article);
        const filterValue = columnFilters.extraction_progress.toLowerCase();
        
        // Filtros por texto
        if (filterValue.includes('completo') && progress < 100) return false;
        if (filterValue.includes('andamento') && (progress === 0 || progress >= 100)) return false;
        if (filterValue.includes('não iniciado') && progress > 0) return false;
        
        // Filtro por número (percentual)
        if (!isNaN(Number(filterValue))) {
          const targetProgress = Number(filterValue);
          if (Math.abs(progress - targetProgress) > 5) return false; // Tolerância de 5%
        }
      }

      // Filtro por status
      if (columnFilters.status && columnFilters.status !== 'all') {
        const progress = calculateExtractionProgress(article);
        const hasInstances = article.instances.length > 0;
        const isComplete = progress >= 100;
        const isInProgress = hasInstances && progress > 0 && progress < 100;
        const isNotStarted = !hasInstances;
        
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
        case 'extraction_progress':
          aValue = calculateExtractionProgress(a);
          bValue = calculateExtractionProgress(b);
          break;
        case 'status': {
          // Ordenar por status: não iniciado (0), em andamento (1), completo (2)
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

  // Hook para gerenciar seleção de artigos
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

  // Handler para extração IA em batch
  const handleBatchAIExtraction = useCallback(async () => {
    if (selectedIds.size === 0) {
      toast.error('Selecione pelo menos um artigo');
      return;
    }

    const selectedArticles = filteredAndSortedArticles.filter(a => selectedIds.has(a.id));
    
    toast.info(`Iniciando extração IA para ${selectedArticles.length} artigo(s)...`, {
      description: 'Isso pode levar alguns minutos',
    });

    try {
      // Processar artigos sequencialmente para evitar sobrecarga
      for (let i = 0; i < selectedArticles.length; i++) {
        const article = selectedArticles[i];
        toast.info(`Processando artigo ${i + 1}/${selectedArticles.length}: ${article.title}`);
        
        await extractFullAI({
          projectId,
          articleId: article.id,
          templateId,
        });
      }

      // Limpar seleção após sucesso
      deselectAll();
    } catch (error: any) {
      console.error('Erro na extração IA em batch:', error);
      toast.error('Erro ao processar extração IA', {
        description: error.message || 'Erro desconhecido',
      });
    }
  }, [selectedIds, filteredAndSortedArticles, projectId, templateId, extractFullAI, deselectAll]);

  // Componente de checkbox do header com suporte a indeterminate
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
        // Acessar o elemento DOM subjacente do Radix UI
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
      setSortDirection('desc'); // Mudança: começar com desc para mostrar os mais recentes primeiro
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
          Não iniciada
        </Badge>
      );
    }

    if (progress >= 100) {
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
                column === 'extraction_progress' ? 'Progresso' :
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
                  column === 'extraction_progress' ? 'Ex: completo, andamento, 50...' :
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
        <Button 
          onClick={() => {
            if (loadArticlesRef.current) {
              loadArticlesRef.current();
            }
          }} 
          variant="outline" 
          className="mt-4"
        >
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
        <p className="text-sm mt-2">Adicione artigos primeiro para iniciar as extrações.</p>
      </div>
    );
  }

  // Estado: Ready - Renderizar tabela
  const selectedArticleIds = Array.from(selectedIds);
  const selectedArticleTitles = filteredAndSortedArticles
    .filter(a => selectedIds.has(a.id))
    .map(a => a.title);

  return (
    <div className="space-y-4">
      {/* Barra de ações de seleção */}
      <ArticleSelectionActions
        selectedCount={selectedCount}
        selectedArticleIds={selectedArticleIds}
        selectedArticleTitles={selectedArticleTitles}
        onClearSelection={deselectAll}
        onBatchAIExtraction={handleBatchAIExtraction}
        isExtracting={isExtracting}
      />

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
                          aria-label={hasActiveFilters ? 'Selecionar artigos filtrados' : 'Selecionar todos os artigos'}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        {hasActiveFilters 
                          ? 'Selecionar artigos filtrados' 
                          : 'Selecionar todos os artigos'}
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
                    Título
                  </Button>
                  {getSortIcon('title')}
                  <ColumnFilterButton column="title" />
                </div>
              </TableHead>
              <TableHead className="w-[12%]">
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
              <TableHead className="w-[18%]">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort('extraction_progress')}
                    className="h-auto p-0 font-semibold hover:bg-transparent"
                  >
                    Progresso
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
              const progress = calculateExtractionProgress(article);
              const isComplete = progress >= 100;
              const hasInstances = article.instances.length > 0;

              return (
                <TableRow key={article.id} className="hover:bg-muted/50">
                  <TableCell className="w-[40px]">
                    <Checkbox
                      checked={isSelected(article.id)}
                      onCheckedChange={() => toggleArticle(article.id)}
                      aria-label={`Selecionar artigo: ${article.title}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-sm leading-tight">
                      {article.title}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[120px]">
                    {article.authors && article.authors.length > 0 ? (
                      <div 
                        className="text-sm flex items-center gap-1 cursor-help group relative"
                        title={article.authors.join(', ')}
                      >
                        <User className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        <span className="truncate block min-w-0">
                          {article.authors.slice(0, 1).join(', ')}
                          {article.authors.length > 1 && ` +${article.authors.length - 1}`}
                        </span>
                        {/* Tooltip no hover */}
                        <div className="absolute left-0 top-full mt-1 z-10 hidden group-hover:block bg-popover border rounded-md shadow-lg p-2 max-w-xs">
                          <div className="text-xs text-popover-foreground">
                            {article.authors.join(', ')}
                          </div>
                        </div>
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
                    {hasInstances ? (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Progresso</span>
                          <span className="font-medium">{progress.toFixed(0)}%</span>
                        </div>
                        <Progress value={progress} className="h-1.5" />
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Database className="h-3 w-3" />
                        Não iniciada
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(article)}
                  </TableCell>
                  <TableCell className="text-center">
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
                        Iniciar
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
              setColumnFilters({ title: '', publication_year: '', extraction_progress: '', status: 'all', authors: '' });
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
