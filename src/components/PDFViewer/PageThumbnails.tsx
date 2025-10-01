import { usePDFStore } from '@/stores/usePDFStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { FileText } from 'lucide-react';

interface PageThumbnailsProps {
  className?: string;
}

export function PageThumbnails({ className }: PageThumbnailsProps) {
  const { numPages, currentPage, goToPage } = usePDFStore();

  if (numPages === 0) {
    return (
      <div className={cn('h-full border-r bg-muted/20 flex items-center justify-center', className)}>
        <p className="text-sm text-muted-foreground text-center px-4">
          Nenhuma página disponível
        </p>
      </div>
    );
  }

  return (
    <div className={cn('h-full border-r bg-muted/20 flex flex-col', className)}>
      <div className="p-4 border-b">
        <h3 className="font-semibold text-sm">
          Páginas ({numPages})
        </h3>
      </div>
      
      <ScrollArea className="flex-1 h-full">
        <div className="p-2 space-y-2">
          {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
            const isActive = currentPage === pageNum;
            
            return (
              <div
                key={pageNum}
                className={cn(
                  'p-3 rounded-md border cursor-pointer transition-all',
                  isActive
                    ? 'bg-primary/10 border-primary shadow-sm'
                    : 'bg-background hover:bg-accent hover:shadow'
                )}
                onClick={() => goToPage(pageNum)}
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-12 h-16 rounded border-2 flex items-center justify-center transition-colors',
                    isActive ? 'border-primary bg-primary/5' : 'border-border bg-muted/50'
                  )}>
                    <FileText className={cn(
                      'h-6 w-6',
                      isActive ? 'text-primary' : 'text-muted-foreground'
                    )} />
                  </div>
                  
                  <div className="flex-1">
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
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
