import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Filter, FileText, ExternalLink, Trash2, Upload, MoreHorizontal } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArticleFileUploadDialog } from "./ArticleFileUploadDialog";

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

export function ArticlesList({ articles, onArticleClick, projectId, onArticlesChange }: ArticlesListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [articleToDelete, setArticleToDelete] = useState<string | null>(null);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [articleToUpload, setArticleToUpload] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Get unique years for filter
  const years = Array.from(
    new Set(articles.map(a => a.publication_year).filter(Boolean))
  ).sort((a, b) => (b || 0) - (a || 0));

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

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedArticles(new Set(filteredArticles.map(a => a.id)));
    } else {
      setSelectedArticles(new Set());
    }
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

  // Filter and sort articles
  const filteredArticles = articles
    .filter(article => {
      // Search filter
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = !searchTerm || 
        article.title.toLowerCase().includes(searchLower) ||
        article.abstract?.toLowerCase().includes(searchLower) ||
        article.authors?.some(a => a.toLowerCase().includes(searchLower)) ||
        article.journal_title?.toLowerCase().includes(searchLower) ||
        article.keywords?.some(k => k.toLowerCase().includes(searchLower));

      // Year filter
      const matchesYear = yearFilter === "all" || 
        article.publication_year?.toString() === yearFilter;

      return matchesSearch && matchesYear;
    })
    .sort((a, b) => {
      if (sortBy === "newest") {
        return (b.publication_year || 0) - (a.publication_year || 0);
      } else if (sortBy === "oldest") {
        return (a.publication_year || 0) - (b.publication_year || 0);
      } else if (sortBy === "title") {
        return a.title.localeCompare(b.title);
      }
      return 0;
    });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por título, autores, resumo, palavras-chave..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            
            <div className="flex gap-2">
              <Select value={yearFilter} onValueChange={setYearFilter}>
                <SelectTrigger className="w-[140px]">
                  <Filter className="mr-2 h-4 w-4" />
                  <SelectValue placeholder="Ano" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os anos</SelectItem>
                  {years.map(year => (
                    <SelectItem key={year} value={year!.toString()}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Ordenar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Mais recente</SelectItem>
                  <SelectItem value="oldest">Mais antigo</SelectItem>
                  <SelectItem value="title">Por título</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {filteredArticles.length} artigo(s) encontrado(s)
              {searchTerm && ` para "${searchTerm}"`}
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
      {filteredArticles.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="mb-2 text-lg font-medium">Nenhum artigo encontrado</h3>
              <p className="text-sm text-muted-foreground">
                {searchTerm || yearFilter !== "all" 
                  ? "Tente ajustar seus filtros de busca"
                  : "Comece adicionando artigos à sua revisão"
                }
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
                    <TableHead className="w-[5%]">
                      <Checkbox
                        checked={selectedArticles.size === filteredArticles.length && filteredArticles.length > 0}
                        onCheckedChange={handleSelectAll}
                        aria-label="Selecionar todos"
                      />
                    </TableHead>
                    <TableHead className="w-[35%]">Título</TableHead>
                    <TableHead className="w-[20%]">Autores</TableHead>
                    <TableHead className="w-[15%]">Revista</TableHead>
                    <TableHead className="w-[10%]">Ano</TableHead>
                    <TableHead className="w-[15%] text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredArticles.map((article) => (
                    <TableRow 
                      key={article.id}
                      className="hover:bg-accent/50"
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedArticles.has(article.id)}
                          onCheckedChange={(checked) => handleSelectArticle(article.id, checked as boolean)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Selecionar ${article.title}`}
                        />
                      </TableCell>
                      <TableCell 
                        className="font-medium cursor-pointer"
                        onClick={() => onArticleClick(article.id)}
                      >
                        <div className="space-y-1">
                          <div className="line-clamp-2">{article.title}</div>
                          {article.keywords && article.keywords.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {article.keywords.slice(0, 3).map((keyword, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs">
                                  {keyword}
                                </Badge>
                              ))}
                              {article.keywords.length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{article.keywords.length - 3}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {article.authors?.slice(0, 2).join(", ")}
                        {(article.authors?.length || 0) > 2 && " et al."}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <span className="line-clamp-2 italic">
                          {article.journal_title || "-"}
                        </span>
                      </TableCell>
                      <TableCell>
                        {article.publication_year ? (
                          <Badge variant="secondary">{article.publication_year}</Badge>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {article.doi && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(`https://doi.org/${article.doi}`, "_blank");
                              }}
                              title="Abrir DOI"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          )}
                          
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openUploadDialog(article.id);
                                }}
                              >
                                <Upload className="mr-2 h-4 w-4" />
                                Vincular Arquivo
                              </DropdownMenuItem>
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
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
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
    </div>
  );
}