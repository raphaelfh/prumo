import { usePDFStore } from '@/stores/usePDFStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Trash2, MessageSquare, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
// import { AnnotationThreadDialog } from './AnnotationThreadDialog';

interface AnnotationSidebarProps {
  className?: string;
}

export function AnnotationSidebar({ className }: AnnotationSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [commentDialogOpen, setCommentDialogOpen] = useState(false);
  
  const {
    annotations,
    selectedAnnotationId,
    selectAnnotation,
    deleteAnnotation,
    goToPage,
  } = usePDFStore();

  const activeAnnotations = annotations.filter(a => a.status === 'active');

  if (activeAnnotations.length === 0) {
    return (
      <div className={cn('h-full flex items-center justify-center', className)}>
        <p className="text-sm text-muted-foreground text-center px-4">
          Nenhuma anotação ainda
        </p>
      </div>
    );
  }

  const getTypeLabel = (type: string) => {
    const labels = {
      highlight: 'Destaque',
      area: 'Área',
      note: 'Nota',
      underline: 'Sublinhado',
    };
    return labels[type as keyof typeof labels] || type;
  };

  return (
    <div className={cn('h-full flex flex-col overflow-hidden', className)}>
      <ScrollArea className="flex-1 h-full">
        <div className="p-2 space-y-2">
          {activeAnnotations.map((annotation) => {
            const isSelected = selectedAnnotationId === annotation.id;
            
            return (
              <div
                key={annotation.id}
                className={cn(
                  'p-3 rounded-md border cursor-pointer transition-colors relative',
                  isSelected
                    ? 'bg-primary/10 border-primary'
                    : 'bg-background hover:bg-accent',
                  // annotation.isResolved && 'opacity-60'
                )}
                onClick={() => {
                  selectAnnotation(annotation.id);
                  goToPage(annotation.pageNumber);
                }}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex gap-2 items-center">
                    <Badge variant="secondary" className="text-xs">
                      {getTypeLabel(annotation.type)}
                    </Badge>
                    {/* TODO: Implement resolved status */}
                    {/* {annotation.isResolved && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <CheckCircle2 className="h-2 w-2" />
                        Resolvido
                      </Badge>
                    )} */}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 relative"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(annotation.id);
                        setCommentDialogOpen(true);
                      }}
                      title="Ver comentários"
                    >
                      <MessageSquare className="h-3 w-3" />
                      {/* TODO: Implement comments functionality */}
                      {/* {annotation.comments && annotation.comments.length > 0 && (
                        <Badge 
                          variant="destructive" 
                          className="absolute -top-1 -right-1 h-3 w-3 p-0 flex items-center justify-center text-[8px]"
                        >
                          {annotation.comments.length}
                        </Badge>
                      )} */}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteAnnotation(annotation.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {/* Color indicator */}
                <div 
                  className="absolute left-0 top-0 bottom-0 w-1 rounded-l-md"
                  style={{ backgroundColor: annotation.color, opacity: annotation.opacity }}
                />

                {/* Selected text preview - TODO: Fix type checking */}
                {/* {annotation.selectedText && (
                  <div className="mb-2 p-2 bg-muted/50 rounded text-xs italic line-clamp-2">
                    "{annotation.selectedText}"
                  </div>
                )} */}

                {/* Initial comment - TODO: Implement comments functionality */}
                {/* {annotation.comment && (
                  <div className="flex items-start gap-2 mb-2">
                    <MessageSquare className="h-3 w-3 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <p className="text-xs text-foreground line-clamp-2">
                      {annotation.comment}
                    </p>
                  </div>
                )} */}

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Página {annotation.pageNumber}</span>
                  <span>
                    {formatDistanceToNow(new Date(annotation.createdAt), {
                      addSuffix: true,
                      locale: ptBR,
                    })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* TODO: Implement comments functionality */}
      {/* <AnnotationThreadDialog
        annotationId={editingId}
        open={commentDialogOpen}
        onOpenChange={setCommentDialogOpen}
      /> */}
    </div>
  );
}
