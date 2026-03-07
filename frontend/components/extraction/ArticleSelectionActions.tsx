/**
 * Barra de ações para artigos selecionados
 *
 * Minimal component that appears when articles are selected.
 * Exibe contador, menu de ações e botão para limpar seleção.
 */

import {Button} from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Badge} from '@/components/ui/badge';
import {Download, MoreHorizontal, Sparkles, X} from 'lucide-react';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';

interface ArticleSelectionActionsProps {
  /**
   * Número de artigos selecionados
   */
  selectedCount: number;
  
  /**
   * IDs dos artigos selecionados
   */
  selectedArticleIds: string[];
  
  /**
   * Títulos dos artigos selecionados (para exibição)
   */
  selectedArticleTitles: string[];
  
  /**
   * Callback to clear selection
   */
  onClearSelection: () => void;
  
  /**
   * Callback to run batch AI extraction
   */
  onBatchAIExtraction: () => void;
  
  /**
   * Se a extração IA está em progresso
   */
  isExtracting?: boolean;
}

export function ArticleSelectionActions({
  selectedCount,
                                            selectedArticleIds: _selectedArticleIds,
                                            selectedArticleTitles: _selectedArticleTitles,
  onClearSelection,
  onBatchAIExtraction,
  isExtracting = false,
}: ArticleSelectionActionsProps) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className="sticky top-0 z-10 mb-4 rounded-lg border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 shadow-sm">
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
            <span className="font-medium">{selectedCount}</span>
            <span className="text-muted-foreground">
              {selectedCount === 1 ? t('extraction', 'tableArticleSelected') : t('extraction', 'tableArticlesSelected')}
            </span>
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={isExtracting}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                        {t('extraction', 'tableActions')}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>
                    <p>{t('extraction', 'tableSelectionMenuTooltip')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>{t('extraction', 'tableBatchActionsLabel')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              
              <DropdownMenuItem
                onClick={onBatchAIExtraction}
                disabled={isExtracting}
                className="gap-2"
              >
                <Sparkles className="h-4 w-4" />
                  <span>{t('extraction', 'tableAIExtraction')}</span>
              </DropdownMenuItem>
              
              <DropdownMenuItem
                disabled
                className="gap-2 opacity-50 cursor-not-allowed"
              >
                <Download className="h-4 w-4" />
                  <span>{t('extraction', 'tableExport')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{t('extraction', 'tableInDevelopment')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClearSelection}
                  disabled={isExtracting}
                  className="h-8 w-8 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                  <p>{t('extraction', 'tableClearSelection')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
}

