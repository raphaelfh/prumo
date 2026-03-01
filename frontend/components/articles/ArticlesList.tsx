import {useEffect, useMemo, useState} from "react";
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {Badge} from "@/components/ui/badge";
import {Checkbox} from "@/components/ui/checkbox";
import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  FileText,
  Filter,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Trash2,
  Upload
} from "lucide-react";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import {supabase} from "@/integrations/supabase/client";
import {toast} from "sonner";
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
}

type SortField = 'title' | 'authors' | 'journal_title' | 'publication_year' | 'created_at' | 'has_main_file';
type SortDirection = 'asc' | 'desc';

interface ColumnFilter {
  title: string;
  authors: string;
  journal_title: string;
  publication_year: string;
  keywords: string;
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

export function ArticlesList({ articles, onArticleClick, projectId, onArticlesChange }: ArticlesListProps) {
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
  
  // Hook para verificar se usuário tem integração Zotero configurada
  const { isConfigured: hasZoteroConfigured } = useZoteroIntegration();
  
  // Buscar artigos que têm arquivo PDF MAIN
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
  
  // Estados para ordenação e filtros
  const [sortField, setSortField] = useState<SortField>('publication_year');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [columnFilters, setColumnFilters] = useState<ColumnFilter>({
    title: '',
    authors: '',
    journal_title: '',
    publication_year: '',
    keywords: ''
  });
  const [activeFilterColumn, setActiveFilterColumn] = useState<keyof ColumnFilter | null>(null);
  
  // Colunas visíveis
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

  // Funções de ordenação
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
      return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    }
    return sortDirection === 'asc' 
      ? <ChevronUp className="h-3.5 w-3.5 text-foreground" />
      : <ChevronDown className="h-3.5 w-3.5 text-foreground" />;
  };

  // Atualizar filtro de coluna
  const updateColumnFilter = (column: keyof ColumnFilter, value: string) => {
    setColumnFilters(prev => ({
      ...prev,
      [column]: value
    }));
  };

  // Componente de filtro por coluna
  const ColumnFilterButton = ({ column }: { column: keyof ColumnFilter }) => {
    const isActive = activeFilterColumn === column;
    const hasFilter = columnFilters[column].length > 0;

    const columnLabels: Record<keyof ColumnFilter, string> = {
      title: 'Título',
      authors: 'Autores',
      journal_title: 'Revista',
      publication_year: 'Ano',
      keywords: 'Palavras-chave'
    };

    const columnPlaceholders: Record<keyof ColumnFilter, string> = {
      title: 'Buscar no título...',
      authors: 'Buscar autor...',
      journal_title: 'Buscar revista...',
      publication_year: 'Ex: 2023, 2020...',
      keywords: 'Buscar palavra-chave...'
    };

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
              Filtrar por {columnLabels[column]}
            </label>
            <Input
              autoFocus
              placeholder={columnPlaceholders[column]}
              value={columnFilters[column]}
              onChange={(e) => updateColumnFilter(column, e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="h-8"
            />
            {hasFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateColumnFilter(column, '')}
                className="h-6 text-xs w-full"
              >
                Limpar filtro
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  // Toggle de colunas visíveis
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

      toast.success("Artigo deletado com sucesso!");
      onArticlesChange?.();
    } catch (error: any) {
      console.error("Error deleting article:", error);
      toast.error("Erro ao deletar artigo");
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

      toast.success(`${articleIds.length} artigo(s) deletado(s) com sucesso!`);
      setSelectedArticles(new Set());
      onArticlesChange?.();
    } catch (error: any) {
      console.error("Error deleting articles:", error);
      toast.error("Erro ao deletar artigos");
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
          article.title.toLowerCase().includes(searchLower) ||
          article.abstract?.toLowerCase().includes(searchLower) ||
          article.authors?.some(a => a.toLowerCase().includes(searchLower)) ||
          article.journal_title?.toLowerCase().includes(searchLower) ||
          article.keywords?.some(k => k.toLowerCase().includes(searchLower));
        
        if (!matchesSearch) return false;
      }

      // Filtros por coluna
      if (columnFilters.title && !article.title.toLowerCase().includes(columnFilters.title.toLowerCase())) {
        return false;
      }

      if (columnFilters.authors && article.authors) {
        const authorMatch = article.authors.some(author => 
          author.toLowerCase().includes(columnFilters.authors.toLowerCase())
        );
        if (!authorMatch) return false;
      }

      if (columnFilters.journal_title && article.journal_title) {
        if (!article.journal_title.toLowerCase().includes(columnFilters.journal_title.toLowerCase())) {
          return false;
        }
      }

      if (columnFilters.publication_year && article.publication_year) {
        if (!article.publication_year.toString().includes(columnFilters.publication_year)) {
          return false;
        }
      }

      if (columnFilters.keywords && article.keywords) {
        const keywordMatch = article.keywords.some(keyword =>
          keyword.toLowerCase().includes(columnFilters.keywords.toLowerCase())
        );
        if (!keywordMatch) return false;
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
      <div className="space-y-6">
          {/* Barra de Busca e Controles - Estilo Command Line Linear */}
          <div className="flex flex-col gap-4">
              <div className="flex flex-col md:flex-row gap-3 items-center">
                  {/* Busca Global */}
                  <div className="flex-1 w-full group">
                      <div className="relative">
                          <Search
                              className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground transition-colors group-focus-within:text-foreground"/>
                          <Input
                              placeholder="Buscar em todos os campos... (⌘ K)"
                              value={searchTerm}
                              onChange={(e) => setSearchTerm(e.target.value)}
                              className="pl-9 h-9 bg-muted/40 border-transparent focus:bg-background focus:ring-0 focus:border-border/60 focus:shadow-sm transition-all text-sm rounded-md"
                          />
                          <div
                              className="absolute right-3 top-1/2 -translate-y-1/2 hidden md:flex items-center gap-1 opacity-40">
                              <kbd className="text-[10px] font-sans border rounded px-1.5 py-0.5 bg-background">⌘</kbd>
                              <kbd className="text-[10px] font-sans border rounded px-1.5 py-0.5 bg-background">K</kbd>
                          </div>
                      </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
            {/* Botão Importar do Zotero */}
            {hasZoteroConfigured && (
              <Button
                  variant="ghost"
                size="sm"
                  className="h-9 px-3 text-xs font-medium hover:bg-muted/60 transition-colors"
                onClick={() => setZoteroImportOpen(true)}
              >
                  <Upload className="h-3.5 w-3.5 mr-2"/>
                  Zotero
              </Button>
            )}

            {/* Seletor de Colunas */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm"
                          className="h-9 px-3 text-xs font-medium hover:bg-muted/60 transition-colors">
                      <Settings2 className="h-3.5 w-3.5 mr-2"/>
                  Colunas
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel
                      className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider p-2">Colunas
                      visíveis</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={visibleColumns.title}
                  onCheckedChange={() => toggleColumn('title')}
                  disabled
                  className="text-xs"
                >
                    Título
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns.pdf}
                  onCheckedChange={() => toggleColumn('pdf')}
                  className="text-xs"
                >
                  PDF
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns.authors}
                  onCheckedChange={() => toggleColumn('authors')}
                  className="text-xs"
                >
                  Autores
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns.journal}
                  onCheckedChange={() => toggleColumn('journal')}
                  className="text-xs"
                >
                  Revista
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns.year}
                  onCheckedChange={() => toggleColumn('year')}
                  className="text-xs"
                >
                  Ano
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns.keywords}
                  onCheckedChange={() => toggleColumn('keywords')}
                  className="text-xs"
                >
                  Palavras-chave
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns.doi}
                  onCheckedChange={() => toggleColumn('doi')}
                  className="text-xs"
                >
                  DOI
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns.abstract}
                  onCheckedChange={() => toggleColumn('abstract')}
                  className="text-xs"
                >
                  Resumo
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
              </div>

              <div className="flex items-center justify-between px-1">
                  <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      {filteredArticles.length} de {articles.length} artigo(s)
                  </div>

                  {selectedArticles.size > 0 && (
                      <div className="flex items-center gap-3 animate-in fade-in slide-in-from-right-2 duration-200">
              <span className="text-xs font-medium text-foreground">
                {selectedArticles.size} selecionado(s)
              </span>
                          <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setBulkDeleteDialogOpen(true)}
                              disabled={deleting}
                              className="h-7 text-[11px] font-semibold text-destructive hover:text-destructive hover:bg-destructive/10 uppercase tracking-tight"
                          >
                              <Trash2 className="mr-1.5 h-3 w-3"/>
                              Deletar
                          </Button>
                      </div>
                  )}
              </div>
          </div>

      {/* Articles Table */}
      {filteredArticles.length === 0 && articles.length === 0 ? (
          <div
              className="flex flex-col items-center justify-center py-24 px-4 bg-muted/10 rounded-lg border border-dashed">
              <FileText className="h-10 w-10 text-muted-foreground/30 mb-4" strokeWidth={1.2}/>
              <h3 className="text-base font-medium text-foreground mb-1.5 text-center">Nenhum artigo ainda</h3>
              <p className="text-sm text-muted-foreground text-center mb-8 max-w-xs mx-auto">
                  Comece importando seus artigos de pesquisa para organizar sua revisão.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                  <Button
                      onClick={() => (window.location.href = `/projects/${projectId}/articles/add`)}
                      className="bg-[#111111] hover:bg-[#2c2c2c] text-white h-9 px-6 text-xs font-medium rounded-md transition-all"
                  >
                      <Plus className="mr-2 h-3.5 w-3.5"/>
                      Adicionar Primeiro Artigo
                  </Button>
                  {hasZoteroConfigured && (
                      <Button
                          variant="outline"
                          onClick={() => setZoteroImportOpen(true)}
                          className="h-9 px-6 text-xs font-medium rounded-md transition-all"
                      >
                          <Upload className="mr-2 h-3.5 w-3.5"/>
                          Importar via Zotero
                      </Button>
                  )}
              </div>
          </div>
      ) : (
          <div className="border rounded-md overflow-hidden bg-background shadow-sm border-border/60">
              <div className="overflow-x-auto scrollbar-horizontal">
                  <Table>
                      <TableHeader className="bg-muted/30">
                          <TableRow className="hover:bg-transparent border-b-border/60">
                              {/* Checkbox de seleção */}
                              <TableHead className="w-[45px] px-3">
                                  <Checkbox
                                      checked={selectedArticles.size === filteredArticles.length && filteredArticles.length > 0}
                                      onCheckedChange={handleSelectAll}
                                      aria-label="Selecionar todos"
                                      className="h-3.5 w-3.5 rounded-sm"
                                  />
                              </TableHead>

                              {/* Título - sempre visível */}
                              <TableHead className="min-w-[320px] px-3">
                                  <div className="flex items-center gap-1.5">
                                      <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => handleSort('title')}
                                          className="h-auto p-0 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hover:bg-transparent hover:text-foreground transition-colors"
                                      >
                                          Título
                                      </Button>
                                      {getSortIcon('title')}
                                      <ColumnFilterButton column="title"/>
                                  </div>
                              </TableHead>

                              {/* PDF */}
                              {visibleColumns.pdf && (
                                  <TableHead className="w-[100px] px-3">
                                      <div className="flex items-center gap-1.5">
                                          <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => handleSort('has_main_file')}
                                              className="h-auto p-0 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hover:bg-transparent hover:text-foreground transition-colors"
                                          >
                                              PDF
                                          </Button>
                                          {getSortIcon('has_main_file')}
                                      </div>
                                  </TableHead>
                              )}

                              {/* Autores */}
                              {visibleColumns.authors && (
                                  <TableHead className="w-[140px] px-3">
                                      <div className="flex items-center gap-1.5">
                                          <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => handleSort('authors')}
                                              className="h-auto p-0 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hover:bg-transparent hover:text-foreground transition-colors"
                                          >
                                              Autores
                                          </Button>
                                          {getSortIcon('authors')}
                                          <ColumnFilterButton column="authors"/>
                                      </div>
                                  </TableHead>
                              )}

                              {/* Revista */}
                              {visibleColumns.journal && (
                                  <TableHead className="w-[160px] px-3">
                                      <div className="flex items-center gap-1.5">
                                          <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => handleSort('journal_title')}
                                              className="h-auto p-0 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hover:bg-transparent hover:text-foreground transition-colors"
                                          >
                                              Revista
                                          </Button>
                                          {getSortIcon('journal_title')}
                                          <ColumnFilterButton column="journal_title"/>
                                      </div>
                                  </TableHead>
                              )}

                              {/* Ano */}
                              {visibleColumns.year && (
                                  <TableHead className="w-[100px] px-3">
                                      <div className="flex items-center gap-1.5">
                                          <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => handleSort('publication_year')}
                                              className="h-auto p-0 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hover:bg-transparent hover:text-foreground transition-colors"
                                          >
                                              Ano
                                          </Button>
                                          {getSortIcon('publication_year')}
                                          <ColumnFilterButton column="publication_year"/>
                                      </div>
                                  </TableHead>
                              )}

                              {/* Keywords */}
                              {visibleColumns.keywords && (
                                  <TableHead className="w-[160px] px-3">
                                      <div className="flex items-center gap-1.5">
                                          <span
                                              className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Keywords</span>
                                          <ColumnFilterButton column="keywords"/>
                                      </div>
                                  </TableHead>
                              )}

                              {/* DOI */}
                              {visibleColumns.doi && (
                                  <TableHead className="w-[130px] px-3">
                                      <span
                                          className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">DOI</span>
                                  </TableHead>
                              )}

                              {/* Abstract */}
                              {visibleColumns.abstract && (
                                  <TableHead className="w-[280px] px-3">
                                      <span
                                          className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Resumo</span>
                                  </TableHead>
                              )}

                              {/* Ações */}
                              <TableHead className="w-[60px] px-3 text-right"></TableHead>
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                          {filteredArticles.map((article) => (
                              <TableRow
                                  key={article.id}
                                  className="hover:bg-muted/40 transition-colors group border-b-border/40"
                              >
                                  {/* Checkbox */}
                                  <TableCell className="px-3">
                                      <Checkbox
                                          checked={selectedArticles.has(article.id)}
                                          onCheckedChange={(checked) => handleSelectArticle(article.id, checked as boolean)}
                                          onClick={(e) => e.stopPropagation()}
                                          aria-label={`Selecionar ${article.title}`}
                                          className="h-3.5 w-3.5 rounded-sm"
                                      />
                                  </TableCell>

                                  {/* Título */}
                                  <TableCell
                                      className="px-3 py-4 font-medium cursor-pointer"
                                      onClick={() => onArticleClick(article.id)}
                                  >
                                      <div
                                          className="line-clamp-2 text-sm leading-[1.3] text-foreground font-semibold group-hover:text-primary transition-colors">
                                          {article.title}
                                      </div>
                                  </TableCell>

                                  {/* PDF */}
                                  {visibleColumns.pdf && (
                                      <TableCell className="px-3">
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
                                                              toast.error("Arquivo PDF não encontrado");
                                                              return;
                                                          }

                                                          const {
                                                              data: signedUrl,
                                                              error: urlError
                                                          } = await supabase.storage
                                                              .from("articles")
                                                              .createSignedUrl(fileData.storage_key, 3600);

                                                          if (urlError) {
                                                              toast.error("Erro ao acessar arquivo PDF");
                                                              return;
                                                          }

                                                          window.open(signedUrl.signedUrl, "_blank");
                                                      } catch (error) {
                                                          console.error("Error opening PDF:", error);
                                                          toast.error("Erro ao abrir PDF");
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
                                                  className="h-6 px-1.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-all"
                                              >
                                                  <Plus className="h-2.5 w-2.5 mr-1"/>
                                                  Vincular
                                              </Button>
                                          )}
                                      </TableCell>
                                  )}

                                  {/* Autores */}
                                  {visibleColumns.authors && (
                                      <TableCell className="px-3 text-[13px] text-muted-foreground font-medium">
                                          <TooltipProvider>
                                              <Tooltip>
                                                  <TooltipTrigger asChild>
                                                      <div className="truncate max-w-[120px]">
                                                          {(() => {
                                                              const authorsText = article.authors?.slice(0, 2).join(", ") +
                                                                  ((article.authors?.length || 0) > 2 ? " et al." : "");
                                                              return authorsText || "-";
                                                          })()}
                                                      </div>
                                                  </TooltipTrigger>
                                                  <TooltipContent>
                                                      <div className="max-w-xs p-1">
                                                          <p className="font-semibold text-xs mb-1">Autores:</p>
                                                          <p className="text-[11px] leading-relaxed">{article.authors?.join(", ")}</p>
                                                      </div>
                                                  </TooltipContent>
                                              </Tooltip>
                                          </TooltipProvider>
                                      </TableCell>
                                  )}

                                  {/* Revista */}
                                  {visibleColumns.journal && (
                                      <TableCell className="px-3 text-[13px] text-muted-foreground italic">
                        <span
                            className="line-clamp-2 leading-tight"
                            title={article.journal_title || undefined}
                        >
                          {article.journal_title || "-"}
                        </span>
                                      </TableCell>
                                  )}

                                  {/* Ano */}
                                  {visibleColumns.year && (
                                      <TableCell className="px-3">
                                          {article.publication_year ? (
                                              <span
                                                  className="text-xs font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {article.publication_year}
                          </span>
                                          ) : (
                                              <span className="text-[13px] text-muted-foreground/40">-</span>
                                          )}
                                      </TableCell>
                                  )}

                                  {/* Keywords */}
                                  {visibleColumns.keywords && (
                                      <TableCell className="px-3">
                                          {article.keywords && article.keywords.length > 0 ? (
                                              <div className="flex flex-wrap gap-1">
                                                  {article.keywords.slice(0, 1).map((keyword, idx) => (
                                                      <Badge key={idx} variant="outline"
                                                             className="text-[10px] h-4.5 px-1 font-medium bg-transparent border-border/60">
                                                          {keyword}
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
                                              <span className="text-[13px] text-muted-foreground/40">-</span>
                                          )}
                                      </TableCell>
                                  )}

                                  {/* DOI */}
                                  {visibleColumns.doi && (
                                      <TableCell className="px-3">
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
                                              <span className="text-[13px] text-muted-foreground/40">-</span>
                                          )}
                                      </TableCell>
                                  )}

                                  {/* Abstract */}
                                  {visibleColumns.abstract && (
                                      <TableCell className="px-3">
                                          <div
                                              className="text-[12px] text-muted-foreground/80 line-clamp-2 leading-tight">
                                              {article.abstract || "-"}
                                          </div>
                                      </TableCell>
                                  )}

                                  {/* Ações */}
                                  <TableCell className="px-3 text-right">
                                      <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                              <Button
                                                  size="icon"
                                                  variant="ghost"
                                                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
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
                                                  Vincular Arquivo
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
                                                  Deletar
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

      {/* Estado vazio após filtros */}
      {filteredArticles.length === 0 && articles.length > 0 && (
          <div className="text-center py-16 border rounded-lg bg-muted/10 border-dashed">
              <Search className="h-8 w-8 mx-auto mb-3 text-muted-foreground/30" strokeWidth={1.2}/>
              <p className="text-sm font-semibold">Nenhum artigo corresponde à sua busca</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">Tente ajustar seus termos de pesquisa
                  ou limpar os filtros ativos.</p>
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
                keywords: '' 
              });
            }}
              className="mt-6 text-xs font-semibold underline underline-offset-4 hover:bg-transparent"
          >
              Limpar todos os filtros
          </Button>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja deletar este artigo? Esta ação não pode ser desfeita.
              Todos os arquivos PDF vinculados também serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => articleToDelete && handleDeleteArticle(articleToDelete)}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deletando..." : "Deletar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Exclusão em Massa</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja deletar {selectedArticles.size} artigo(s) selecionado(s)? 
              Esta ação não pode ser desfeita. Todos os arquivos PDF vinculados também serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deletando..." : `Deletar ${selectedArticles.size} artigo(s)`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* File Upload Dialog */}
      {articleToUpload && (
        <ArticleFileUploadDialogNew
          open={uploadDialogOpen}
          onOpenChange={setUploadDialogOpen}
          articleId={articleToUpload}
          projectId={projectId}
          onFileUploaded={() => {
            onArticlesChange?.();
            setArticleToUpload(null);
          }}
        />
      )}

      {/* Zotero Import Dialog */}
      <ZoteroImportDialog
        open={zoteroImportOpen}
        onOpenChange={setZoteroImportOpen}
        projectId={projectId}
        onImportComplete={() => {
          onArticlesChange?.();
        }}
      />
    </div>
  );
}