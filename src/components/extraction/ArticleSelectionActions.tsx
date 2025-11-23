/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Barra de ações para artigos selecionados
 * 
 * Componente minimalista e elegante que aparece quando há artigos selecionados.
 * Exibe contador, menu de ações e botão para limpar seleção.
 */

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Sparkles, X, Download, MoreHorizontal } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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
   * Callback para limpar seleção
   */
  onClearSelection: () => void;
  
  /**
   * Callback para executar extração IA em batch
   */
  onBatchAIExtraction: () => void;
  
  /**
   * Se a extração IA está em progresso
   */
  isExtracting?: boolean;
}

export function ArticleSelectionActions({
  selectedCount,
  selectedArticleIds,
  selectedArticleTitles,
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
              {selectedCount === 1 ? 'artigo selecionado' : 'artigos selecionados'}
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
                      Ações
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Menu de ações para artigos selecionados</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Ações em lote</DropdownMenuLabel>
              <DropdownMenuSeparator />
              
              <DropdownMenuItem
                onClick={onBatchAIExtraction}
                disabled={isExtracting}
                className="gap-2"
              >
                <Sparkles className="h-4 w-4" />
                <span>Extração por IA</span>
              </DropdownMenuItem>
              
              <DropdownMenuItem
                disabled
                className="gap-2 opacity-50 cursor-not-allowed"
              >
                <Download className="h-4 w-4" />
                <span>Exportar</span>
                <span className="ml-auto text-xs text-muted-foreground">Em desenvolvimento</span>
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
                <p>Limpar seleção</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
}

