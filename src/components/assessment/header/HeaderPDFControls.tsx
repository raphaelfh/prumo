/**
 * Header PDF Controls - Assessment Module
 *
 * Sub-componente do header responsável por:
 * - Toggle de visualização do PDF
 * - Toggle de modo de comparação (quando disponível)
 * - Navegação dropdown de artigos
 *
 * Baseado em ExtractionHeader/HeaderPDFControls (DRY + KISS)
 *
 * @component
 */

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { FileText, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

// =================== INTERFACES ===================

export interface HeaderPDFControlsProps {
  showPDF: boolean;
  onTogglePDF: () => void;
  showComparison: boolean;
  onToggleComparison: () => void;
  hasOtherAssessments: boolean;

  // Navegação de artigos via dropdown
  articles: Array<{ id: string; title: string }>;
  currentArticleId: string;
  onNavigateToArticle: (articleId: string) => void;
}

// =================== COMPONENT ===================

export function HeaderPDFControls(props: HeaderPDFControlsProps) {
  const {
    showPDF,
    onTogglePDF,
    showComparison,
    onToggleComparison,
    hasOtherAssessments,
    articles,
    currentArticleId,
    onNavigateToArticle,
  } = props;

  return (
    <div className="flex items-center gap-2">
      {/* Toggle PDF */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={showPDF ? 'default' : 'outline'}
            size="sm"
            onClick={onTogglePDF}
            className="gap-2"
          >
            <FileText className="h-4 w-4" />
            PDF
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{showPDF ? 'Ocultar PDF' : 'Mostrar PDF'}</p>
        </TooltipContent>
      </Tooltip>

      {/* Toggle Comparação (só se houver outras avaliações) */}
      {hasOtherAssessments && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={showComparison ? 'default' : 'outline'}
              size="sm"
              onClick={onToggleComparison}
              className="gap-2"
            >
              <Users className="h-4 w-4" />
              Comparar
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{showComparison ? 'Ocultar comparação' : 'Comparar com outros'}</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Dropdown de Navegação de Artigos (mobile/tablet) */}
      {articles.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="md:hidden">
              Artigos ({articles.findIndex((a) => a.id === currentArticleId) + 1}/
              {articles.length})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[300px]">
            {articles.map((article) => (
              <DropdownMenuItem
                key={article.id}
                onClick={() => onNavigateToArticle(article.id)}
                className={cn(
                  article.id === currentArticleId && 'bg-accent font-medium'
                )}
              >
                <span className="truncate">{article.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
