/**
 * Header Navigation - Assessment Module
 *
 * Sub-componente do header responsável por:
 * - Botão voltar
 * - Breadcrumb de navegação (Projeto > Instrumento > Artigo)
 * - Navegação entre artigos (anterior/próximo)
 *
 * Baseado em ExtractionHeader/HeaderNavigation (DRY + KISS)
 *
 * @component
 */

import {Button} from '@/components/ui/button';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {Tooltip, TooltipContent, TooltipTrigger,} from '@/components/ui/tooltip';
import {ArrowLeft, ChevronLeft, ChevronRight} from 'lucide-react';
import {t} from '@/lib/copy';

// =================== INTERFACES ===================

export interface HeaderNavigationProps {
  projectName: string;
  instrumentName: string;
  articleTitle: string;
  onBack: () => void;

  // Navegação entre artigos
  articles: Array<{ id: string; title: string }>;
  currentArticleId: string;
  onNavigateToArticle: (articleId: string) => void;
}

// =================== COMPONENT ===================

export function HeaderNavigation(props: HeaderNavigationProps) {
  const {
    projectName,
    instrumentName,
    articleTitle,
    onBack,
    articles,
    currentArticleId,
    onNavigateToArticle,
  } = props;

  // Find current article index
  const currentIndex = articles.findIndex((a) => a.id === currentArticleId);
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < articles.length - 1;

  const handlePrevious = () => {
    if (hasPrevious) {
      onNavigateToArticle(articles[currentIndex - 1].id);
    }
  };

  const handleNext = () => {
    if (hasNext) {
      onNavigateToArticle(articles[currentIndex + 1].id);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {/* Botão Voltar */}
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="h-4 w-4 mr-2" />
          {t('assessment', 'headerBack')}
      </Button>

      <div className="h-6 w-px bg-border" />

      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink className="text-muted-foreground cursor-default">
              {projectName}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink className="text-muted-foreground cursor-default">
              {instrumentName}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage className="font-medium max-w-[200px] truncate">
              {articleTitle}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Navegação entre artigos */}
      {articles.length > 1 && (
        <>
          <div className="h-6 w-px bg-border" />
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handlePrevious}
                  disabled={!hasPrevious}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                  <p>{t('assessment', 'headerArticlePrevious')}</p>
              </TooltipContent>
            </Tooltip>

            <span className="text-xs text-muted-foreground px-2">
              {currentIndex + 1} / {articles.length}
            </span>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleNext}
                  disabled={!hasNext}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                  <p>{t('assessment', 'headerArticleNext')}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </>
      )}
    </div>
  );
}
