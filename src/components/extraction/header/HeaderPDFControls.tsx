/**
 * Componente de controles do PDF (Toggle + Navegação entre artigos + Comparação)
 * Responsivo com ícones em mobile e texto em desktop
 */

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { 
  Users,
  Eye,
  EyeOff 
} from 'lucide-react';

interface Article {
  id: string;
  title: string;
}

interface HeaderPDFControlsProps {
  showPDF: boolean;
  onTogglePDF: () => void;
  
  // Navegação entre artigos (mantido para compatibilidade, mas não usado mais aqui)
  articles?: Article[];
  currentArticleId?: string;
  onNavigateToArticle?: (articleId: string) => void;
  
  // Modo comparação
  viewMode: 'extract' | 'compare';
  onViewModeChange: (mode: 'extract' | 'compare') => void;
  hasOtherExtractions: boolean;
  
  /** Modo compacto (apenas ícones) para mobile */
  compact?: boolean;
}

export function HeaderPDFControls({
  showPDF,
  onTogglePDF,
  viewMode,
  onViewModeChange,
  hasOtherExtractions,
  compact = false,
}: HeaderPDFControlsProps) {
  const toggleButton = compact ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          onClick={onTogglePDF}
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-150"
          aria-label={showPDF ? 'Ocultar PDF' : 'Mostrar PDF'}
        >
          {showPDF ? <EyeOff className="h-4 w-4 transition-transform duration-150" /> : <Eye className="h-4 w-4 transition-transform duration-150" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{showPDF ? 'Ocultar PDF' : 'Mostrar PDF'}</TooltipContent>
    </Tooltip>
  ) : (
    <Button
      variant="ghost"
      size="sm"
      onClick={onTogglePDF}
      className="text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-150"
    >
      {showPDF ? <EyeOff className="h-3.5 w-3.5 mr-1.5 transition-transform duration-150" /> : <Eye className="h-3.5 w-3.5 mr-1.5 transition-transform duration-150" />}
      {showPDF ? 'Ocultar' : 'Mostrar'}
    </Button>
  );

  const comparisonButton = hasOtherExtractions ? (
    compact ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onViewModeChange(viewMode === 'extract' ? 'compare' : 'extract')}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-150"
            aria-label="Alternar modo de comparação"
          >
            <Users className="h-4 w-4 transition-transform duration-150" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Comparação</TooltipContent>
      </Tooltip>
    ) : (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onViewModeChange(viewMode === 'extract' ? 'compare' : 'extract')}
        className="text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-150"
      >
        <Users className="h-3.5 w-3.5 mr-1.5 transition-transform duration-150" />
        Comparação
      </Button>
    )
  ) : null;

  return (
    <div className="flex items-center gap-1">
      {toggleButton}
      {comparisonButton}
    </div>
  );
}

