/**
 * Header PDF Controls - Assessment Module
 *
 * Header sub-component responsible for:
 * - PDF view toggle
 * - Comparison mode toggle (when available)
 * - Article dropdown navigation
 *
 * Baseado em ExtractionHeader/HeaderPDFControls (DRY + KISS)
 *
 * @component
 */

import {Button} from '@/components/ui/button';
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,} from '@/components/ui/dropdown-menu';
import {Tooltip, TooltipContent, TooltipTrigger,} from '@/components/ui/tooltip';
import {FileText, Users} from 'lucide-react';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

// =================== INTERFACES ===================

export interface HeaderPDFControlsProps {
  showPDF: boolean;
  onTogglePDF: () => void;
  showComparison: boolean;
  onToggleComparison: () => void;
  hasOtherAssessments: boolean;

    // Article navigation via dropdown
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
            <p>{showPDF ? t('assessment', 'headerPdfHide') : t('assessment', 'headerPdfShow')}</p>
        </TooltipContent>
      </Tooltip>

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
                {t('assessment', 'headerCompare')}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
              <p>{showComparison ? t('assessment', 'headerHideComparison') : t('assessment', 'headerCompareWithOthers')}</p>
          </TooltipContent>
        </Tooltip>
      )}

      {articles.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="md:hidden">
                {t('assessment', 'headerArticles')} ({articles.findIndex((a) => a.id === currentArticleId) + 1}/
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
