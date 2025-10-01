import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Filter, FileText, ExternalLink } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
}

export function ArticlesList({ articles, onArticleClick }: ArticlesListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");

  // Get unique years for filter
  const years = Array.from(
    new Set(articles.map(a => a.publication_year).filter(Boolean))
  ).sort((a, b) => (b || 0) - (a || 0));

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

          <div className="mt-4 text-sm text-muted-foreground">
            {filteredArticles.length} artigo(s) encontrado(s)
            {searchTerm && ` para "${searchTerm}"`}
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
                    <TableHead className="w-[40%]">Título</TableHead>
                    <TableHead className="w-[25%]">Autores</TableHead>
                    <TableHead className="w-[20%]">Revista</TableHead>
                    <TableHead className="w-[10%]">Ano</TableHead>
                    <TableHead className="w-[5%] text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredArticles.map((article) => (
                    <TableRow 
                      key={article.id}
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => onArticleClick(article.id)}
                    >
                      <TableCell className="font-medium">
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}