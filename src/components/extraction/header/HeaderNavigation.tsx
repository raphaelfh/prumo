/**
 * Componente de navegação do header (Voltar + Breadcrumb + Navegação entre artigos)
 * Reutilizável e responsivo
 */

import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Article {
  id: string;
  title: string;
}

interface HeaderNavigationProps {
  projectId: string;
  projectName: string;
  articleTitle: string;
  onBack: () => void;
  /** Mostrar texto "Voltar" ou apenas ícone (mobile) */
  showBackText?: boolean;
  /** Largura máxima do breadcrumb para truncar */
  maxBreadcrumbWidth?: string;
  /** Navegação entre artigos */
  articles?: Article[];
  currentArticleId?: string;
  onNavigateToArticle?: (articleId: string) => void;
}

export function HeaderNavigation({
  projectId,
  projectName,
  articleTitle,
  onBack,
  showBackText = true,
  maxBreadcrumbWidth = '400px',
  articles = [],
  currentArticleId,
  onNavigateToArticle,
}: HeaderNavigationProps) {
  const navigate = useNavigate();

  // Calcular posição do artigo atual e artigos adjacentes
  const currentIndex = currentArticleId 
    ? articles.findIndex(article => article.id === currentArticleId)
    : -1;
  const currentArticleNumber = currentIndex >= 0 ? currentIndex + 1 : 0;
  const totalArticles = articles.length;
  const previousArticle = currentIndex > 0 ? articles[currentIndex - 1] : null;
  const nextArticle = currentIndex < articles.length - 1 ? articles[currentIndex + 1] : null;
  const hasArticleNavigation = articles.length > 0 && currentArticleId && onNavigateToArticle;

  return (
    <div className="flex items-center gap-3 flex-1 min-w-0">
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={onBack}
        className="flex-shrink-0 h-8 px-2 -ml-2 hover:bg-muted/50 transition-colors duration-150"
      >
        <ArrowLeft className={`${showBackText ? 'mr-1.5' : ''} h-4 w-4`} />
        {showBackText && <span className="text-sm font-medium hidden sm:inline">Voltar</span>}
      </Button>
      
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Breadcrumb className="min-w-0 flex-1">
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink
                onClick={() => navigate(`/projects/${projectId}`)}
                className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors text-sm"
              >
                {projectName}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block text-muted-foreground/50" />
            <BreadcrumbItem>
              <Tooltip>
                <TooltipTrigger asChild>
                  <BreadcrumbPage 
                    className="truncate text-sm font-medium block max-w-full cursor-default" 
                    style={{ maxWidth: maxBreadcrumbWidth }}
                    title={articleTitle}
                  >
                    {articleTitle}
                  </BreadcrumbPage>
                </TooltipTrigger>
                {/* Mostrar tooltip com nome completo quando truncado */}
                <TooltipContent side="bottom" className="max-w-md">
                  <p className="break-words">{articleTitle}</p>
                </TooltipContent>
              </Tooltip>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Navegação entre artigos ao lado direito do nome */}
        {hasArticleNavigation && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => previousArticle && onNavigateToArticle(previousArticle.id)}
                  disabled={!previousArticle}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                  aria-label="Artigo anterior"
                >
                  <ChevronLeft className="h-4 w-4 transition-transform duration-150 hover:-translate-x-0.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {previousArticle ? `Artigo anterior: ${previousArticle.title}` : 'Primeiro artigo'}
              </TooltipContent>
            </Tooltip>
            
            {/* Contador de artigos */}
            <span className="text-xs text-muted-foreground tabular-nums px-1 min-w-[3rem] text-center">
              {currentArticleNumber} / {totalArticles}
            </span>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => nextArticle && onNavigateToArticle(nextArticle.id)}
                  disabled={!nextArticle}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                  aria-label="Próximo artigo"
                >
                  <ChevronRight className="h-4 w-4 transition-transform duration-150 hover:translate-x-0.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {nextArticle ? `Próximo artigo: ${nextArticle.title}` : 'Último artigo'}
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}

