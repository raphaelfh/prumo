import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { usePDFStore } from '@/stores/usePDFStore';

interface AnnotationCommentDialogProps {
  annotationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AnnotationCommentDialog({
  annotationId,
  open,
  onOpenChange,
}: AnnotationCommentDialogProps) {
  const { getAnnotation, updateAnnotation } = usePDFStore();
  const [comment, setComment] = useState('');

  const annotation = annotationId ? getAnnotation(annotationId) : null;

  useEffect(() => {
    if (annotation) {
      setComment(annotation.comment || '');
    }
  }, [annotation]);

  const handleSave = () => {
    if (annotationId) {
      updateAnnotation(annotationId, { comment });
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Editar Comentário</DialogTitle>
          <DialogDescription>
            Adicione ou edite o comentário desta anotação.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <Textarea
            placeholder="Digite seu comentário aqui..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={5}
            className="resize-none"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
