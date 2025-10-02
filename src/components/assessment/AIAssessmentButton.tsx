import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Sparkles } from 'lucide-react';
import { AIAssessmentPanel } from './AIAssessmentPanel';

interface AIAssessmentButtonProps {
  projectId: string;
  articleId: string;
  assessmentItemId: string;
  instrumentId: string;
  itemQuestion: string;
  onAccept: (level: string, comment: string) => void;
}

export const AIAssessmentButton = ({
  projectId,
  articleId,
  assessmentItemId,
  instrumentId,
  itemQuestion,
  onAccept
}: AIAssessmentButtonProps) => {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <Sparkles className="h-4 w-4" />
          Avaliar com IA
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Avaliação com Inteligência Artificial
          </DialogTitle>
        </DialogHeader>
        <AIAssessmentPanel
          projectId={projectId}
          articleId={articleId}
          assessmentItemId={assessmentItemId}
          instrumentId={instrumentId}
          itemQuestion={itemQuestion}
          onAccept={(level, comment) => {
            onAccept(level, comment);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};