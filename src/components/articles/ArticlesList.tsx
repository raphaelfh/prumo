import { useState, useMemo, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Search, 
  Filter, 
  FileText, 
  ExternalLink, 
  Trash2, 
  Upload, 
  MoreHorizontal,
  ChevronsUpDown,
  ChevronUp,
  ChevronDown,
  Settings2,
  Calendar,
  BookOpen,
  Users,
  FilePlus
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuCheckboxItem, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArticleFileUploadDialog } from "./ArticleFileUploadDialog";
import { ZoteroImportDialog } from "./ZoteroImportDialog";
import { useZoteroIntegration } from "@/hooks/useZoteroIntegration";

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
    let filtered = articles.filter(article => {
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
    <div className="space-y-4">
      {/* Barra de Busca e Controles */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Busca Global */}
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar em todos os campos..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
            </div>
            
            {/* Botão Importar do Zotero */}
            {hasZoteroConfigured && (
              <Button 
                variant="outline" 
                size="sm" 
                className="h-9 gap-2"
                onClick={() => setZoteroImportOpen(true)}
              >
                <Upload className="h-4 w-4" />
                Importar do Zotero
              </Button>
            )}

            {/* Seletor de Colunas */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-2">
                  <Settings2 className="h-4 w-4" />
                  Colunas
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Colunas visíveis</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={visibleColumns.title}
                  onCheckedChange={() => toggleColumn('title')}
                  disabled
                >
                  Título (obrigatório)
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns.pdf}
                  onCheckedChange={() => toggleColumn('pdf')}
                >
                  PDF
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns.authors}
                  onCheckedChange={() => toggleColumn('authors')}
                >
                  Autores
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns.journal}
                  onCheckedChange={() => toggleColumn('journal')}
                >
                  Revista
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns.year}
                  onCheckedChange={() => toggleColumn('year')}
                >
                  Ano
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns.keywords}
                  onCheckedChange={() => toggleColumn('keywords')}
                >
                  Palavras-chave
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns.doi}
                  onCheckedChange={() => toggleColumn('doi')}
                >
                  DOI
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns.abstract}
                  onCheckedChange={() => toggleColumn('abstract')}
                >
                  Resumo
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {filteredArticles.length} de {articles.length} artigo(s)
            </div>
            
            {selectedArticles.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {selectedArticles.size} selecionado(s)
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setBulkDeleteDialogOpen(true)}
                  disabled={deleting}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Deletar Selecionados
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Articles Table */}
      {filteredArticles.length === 0 && articles.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="mb-2 text-lg font-medium">Nenhum artigo encontrado</h3>
              <p className="text-sm text-muted-foreground">
                Comece adicionando artigos à sua revisão
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {/* Checkbox de seleção */}
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={selectedArticles.size === filteredArticles.length && filteredArticles.length > 0}
                        onCheckedChange={handleSelectAll}
                        aria-label="Selecionar todos"
                      />
                    </TableHead>

                    {/* Título - sempre visível */}
                    <TableHead className="min-w-[300px]">
                      <div className="flex items-center gap-1.5">
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

                    {/* PDF */}
                    {visibleColumns.pdf && (
                      <TableHead className="w-[90px]">
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSort('has_main_file')}
                            className="h-auto p-0 font-semibold hover:bg-transparent"
                          >
                            <FileText className="h-3.5 w-3.5 mr-1" />
                            PDF
                          </Button>
                          {getSortIcon('has_main_file')}
                        </div>
                      </TableHead>
                    )}

                    {/* Autores */}
                    {visibleColumns.authors && (
                      <TableHead className="w-[120px]">
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSort('authors')}
                            className="h-auto p-0 font-semibold hover:bg-transparent"
                          >
                            <Users className="h-3.5 w-3.5 mr-1" />
                            Autores
                          </Button>
                          {getSortIcon('authors')}
                          <ColumnFilterButton column="authors" />
                        </div>
                      </TableHead>
                    )}

                    {/* Revista */}
                    {visibleColumns.journal && (
                      <TableHead className="w-[140px]">
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSort('journal_title')}
                            className="h-auto p-0 font-semibold hover:bg-transparent"
                          >
                            <BookOpen className="h-3.5 w-3.5 mr-1" />
                            Revista
                          </Button>
                          {getSortIcon('journal_title')}
                          <ColumnFilterButton column="journal_title" />
                        </div>
                      </TableHead>
                    )}

                    {/* Ano */}
                    {visibleColumns.year && (
                      <TableHead className="w-[100px]">
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSort('publication_year')}
                            className="h-auto p-0 font-semibold hover:bg-transparent"
                          >
                            <Calendar className="h-3.5 w-3.5 mr-1" />
                            Ano
                          </Button>
                          {getSortIcon('publication_year')}
                          <ColumnFilterButton column="publication_year" />
                        </div>
                      </TableHead>
                    )}

                    {/* Keywords */}
                    {visibleColumns.keywords && (
                      <TableHead className="w-[150px]">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-sm">Palavras-chave</span>
                          <ColumnFilterButton column="keywords" />
                        </div>
                      </TableHead>
                    )}

                    {/* DOI */}
                    {visibleColumns.doi && (
                      <TableHead className="w-[120px]">
                        <span className="font-semibold text-sm">DOI</span>
                      </TableHead>
                    )}

                    {/* Abstract */}
                    {visibleColumns.abstract && (
                      <TableHead className="w-[250px]">
                        <span className="font-semibold text-sm">Resumo</span>
                      </TableHead>
                    )}

                    {/* Ações */}
                    <TableHead className="w-[100px] text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredArticles.map((article) => (
                    <TableRow 
                      key={article.id}
                      className="hover:bg-muted/50"
                    >
                      {/* Checkbox */}
                      <TableCell>
                        <Checkbox
                          checked={selectedArticles.has(article.id)}
                          onCheckedChange={(checked) => handleSelectArticle(article.id, checked as boolean)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Selecionar ${article.title}`}
                        />
                      </TableCell>

                      {/* Título */}
                      <TableCell 
                        className="font-medium cursor-pointer"
                        onClick={() => onArticleClick(article.id)}
                      >
                        <div className="line-clamp-2 text-sm leading-tight">
                          {article.title}
                        </div>
                      </TableCell>

                      {/* PDF */}
                      {visibleColumns.pdf && (
                        <TableCell>
                          {articlesWithMainFile.has(article.id) ? (
                            <Badge 
                              variant="default" 
                              className="text-xs bg-green-600 hover:bg-green-700 px-2 py-0.5 cursor-pointer"
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  // Buscar o arquivo PDF MAIN do artigo
                                  const { data: fileData, error } = await supabase
                                    .from("article_files")
                                    .select("storage_key, original_filename")
                                    .eq("article_id", article.id)
                                    .eq("file_role", "MAIN")
                                    .single();

                                  if (error || !fileData) {
                                    toast.error("Arquivo PDF não encontrado");
                                    return;
                                  }

                                  // Gerar URL assinada para download/visualização
                                  const { data: signedUrl, error: urlError } = await supabase.storage
                                    .from("articles")
                                    .createSignedUrl(fileData.storage_key, 3600); // 1 hora de validade

                                  if (urlError) {
                                    toast.error("Erro ao acessar arquivo PDF");
                                    return;
                                  }

                                  // Abrir PDF em nova aba
                                  window.open(signedUrl.signedUrl, "_blank");
                                } catch (error) {
                                  console.error("Error opening PDF:", error);
                                  toast.error("Erro ao abrir PDF");
                                }
                              }}
                            >
                              PDF
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                openUploadDialog(article.id);
                              }}
                              className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                              <FilePlus className="h-3 w-3" />
                              Adicionar
                            </Button>
                          )}
                        </TableCell>
                      )}

                      {/* Autores */}
                      {visibleColumns.authors && (
                        <TableCell className="text-sm text-muted-foreground">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="truncate cursor-help">
                                  {(() => {
                                    const authorsText = article.authors?.slice(0, 2).join(", ") + 
                                      ((article.authors?.length || 0) > 2 ? " et al." : "");
                                    return authorsText && authorsText.length > 15 
                                      ? authorsText.substring(0, 15) + "..." 
                                      : authorsText;
                                  })()}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="max-w-xs">
                                  <p className="font-medium">Autores:</p>
                                  <p className="text-sm">{article.authors?.join(", ")}</p>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                      )}

                      {/* Revista */}
                      {visibleColumns.journal && (
                        <TableCell className="text-sm text-muted-foreground">
                          <span 
                            className="line-clamp-2 italic block" 
                            title={article.journal_title || undefined}
                          >
                            {article.journal_title || "-"}
                          </span>
                        </TableCell>
                      )}

                      {/* Ano */}
                      {visibleColumns.year && (
                        <TableCell>
                          {article.publication_year ? (
                            <Badge variant="secondary" className="text-xs">
                              {article.publication_year}
                            </Badge>
                          ) : (
                            <span className="text-sm text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      )}

                      {/* Keywords */}
                      {visibleColumns.keywords && (
                        <TableCell>
                          {article.keywords && article.keywords.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {article.keywords.slice(0, 2).map((keyword, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs">
                                  {keyword}
                                </Badge>
                              ))}
                              {article.keywords.length > 2 && (
                                <Badge variant="outline" className="text-xs">
                                  +{article.keywords.length - 2}
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      )}

                      {/* DOI */}
                      {visibleColumns.doi && (
                        <TableCell>
                          {article.doi ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(`https://doi.org/${article.doi}`, "_blank");
                              }}
                              className="h-7 gap-1 text-xs"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Ver DOI
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      )}

                      {/* Abstract */}
                      {visibleColumns.abstract && (
                        <TableCell>
                          <div className="text-xs text-muted-foreground line-clamp-3">
                            {article.abstract || "-"}
                          </div>
                        </TableCell>
                      )}

                      {/* Ações */}
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                onArticleClick(article.id);
                              }}
                            >
                              <FileText className="mr-2 h-4 w-4" />
                              Ver Detalhes
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                openUploadDialog(article.id);
                              }}
                            >
                              <Upload className="mr-2 h-4 w-4" />
                              Vincular Arquivo
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                openDeleteDialog(article.id);
                              }}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
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
          </CardContent>
        </Card>
      )}

      {/* Estado vazio após filtros */}
      {filteredArticles.length === 0 && articles.length > 0 && (
        <div className="text-center py-8 border rounded-lg bg-muted/20">
          <Search className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
          <p className="font-medium">Nenhum artigo encontrado</p>
          <p className="text-sm text-muted-foreground mt-1">Tente ajustar os filtros de busca.</p>
          <Button
            variant="outline"
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
            className="mt-3"
          >
            Limpar filtros
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
        <ArticleFileUploadDialog
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