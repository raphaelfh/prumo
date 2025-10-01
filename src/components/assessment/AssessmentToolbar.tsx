import { Button } from "@/components/ui/button";
import { Undo2, Redo2, Loader2, Check } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface AssessmentToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  isSaving: boolean;
  lastSaved: Date | null;
  completionPercentage: number;
}

export const AssessmentToolbar = ({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  isSaving,
  lastSaved,
  completionPercentage,
}: AssessmentToolbarProps) => {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onUndo}
          disabled={!canUndo}
          className="h-8 w-8 p-0"
          title="Desfazer (Ctrl+Z)"
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRedo}
          disabled={!canRedo}
          className="h-8 w-8 p-0"
          title="Refazer (Ctrl+Shift+Z)"
        >
          <Redo2 className="h-4 w-4" />
        </Button>
        <div className="h-4 w-px bg-border mx-2" />
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          {isSaving ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Salvando...</span>
            </>
          ) : lastSaved ? (
            <>
              <Check className="h-3 w-3 text-success" />
              <span>Salvo {formatDistanceToNow(lastSaved, { addSuffix: true, locale: ptBR })}</span>
            </>
          ) : (
            <span>Não salvo</span>
          )}
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <div className="text-sm font-medium">
          Progresso: {completionPercentage}%
        </div>
      </div>
    </div>
  );
};
