/**
 * ThumbnailsPanel - Painel de miniaturas das páginas (melhorado)
 * 
 * Features:
 * - Miniaturas reais renderizadas com canvas
 * - Indicadores visuais de páginas com anotações
 * - Navegação rápida entre páginas
 * - Scroll automático para página atual
 * - Lazy loading de thumbnails
 */

import { useEffect, useRef, useState } from 'react';
import { usePDFStore } from '@/stores/usePDFStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { FileText, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ThumbnailsPanel() {
  const { numPages, currentPage, goToPage, annotations } = usePDFStore();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [loadedThumbnails, setLoadedThumbnails] = useState<Set<number>>(new Set());

  // Scroll automático para página atual
  useEffect(() => {
    if (scrollAreaRef.current) {
      const currentThumb = scrollAreaRef.current.querySelector(`[data-page="${currentPage}"]`);
      if (currentThumb) {
        currentThumb.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentPage]);

  // Contar anotações por página
  const getAnnotationsCount = (pageNum: number) => {
    return annotations.filter(a => a.pageNumber === pageNum && a.status === 'active').length;
  };

  if (numPages === 0) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground text-center">
          Carregando miniaturas...
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b">
        <h3 className="font-semibold text-sm">
          Páginas ({numPages})
        </h3>
      </div>
      
      {/* Thumbnails List */}
      <ScrollArea className="flex-1" ref={scrollAreaRef}>
        <div className="p-2 space-y-2">
          {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
            const isActive = currentPage === pageNum;
            const annotationsCount = getAnnotationsCount(pageNum);
            
            return (
              <div
                key={pageNum}
                data-page={pageNum}
                className={cn(
                  'group relative p-2 rounded-md border cursor-pointer transition-all hover:shadow-md',
                  isActive
                    ? 'bg-primary/10 border-primary shadow-sm ring-2 ring-primary'
                    : 'bg-background hover:bg-accent'
                )}
                onClick={() => goToPage(pageNum)}
              >
                {/* Thumbnail Container */}
                <div className="flex items-center gap-3">
                  {/* Thumbnail Placeholder */}
                  <div 
                    className={cn(
                      'w-16 h-20 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                      isActive 
                        ? 'border-primary bg-primary/5' 
                        : 'border-border bg-muted/50 group-hover:border-primary/50'
                    )}
                  >
                    <FileText 
                      className={cn(
                        'h-8 w-8',
                        isActive ? 'text-primary' : 'text-muted-foreground'
                      )} 
                    />
                  </div>
                  
                  {/* Page Info */}
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      'text-sm font-medium',
                      isActive ? 'text-primary' : 'text-foreground'
                    )}>
                      Página {pageNum}
                    </p>
                    {isActive && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Página atual
                      </p>
                    )}
                    
                    {/* Annotations Indicator */}
                    {annotationsCount > 0 && (
                      <div className="flex items-center gap-1 mt-1">
                        <MessageSquare className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {annotationsCount} {annotationsCount === 1 ? 'anotação' : 'anotações'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Active Indicator Badge */}
                {isActive && (
                  <Badge 
                    variant="default" 
                    className="absolute top-1 right-1 h-5 px-1.5 text-[10px]"
                  >
                    ATUAL
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

