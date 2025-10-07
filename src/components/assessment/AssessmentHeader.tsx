import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Undo2, Redo2, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface AssessmentHeaderProps {
  projectId: string;
  articles: any[];
  currentArticleIndex?: number;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  lastSaved?: Date | null;
  progressPercentage?: number;
  className?: string;
}

export const AssessmentHeader = ({
  projectId,
  articles,
  currentArticleIndex,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  lastSaved,
  progressPercentage = 0,
  className,
}: AssessmentHeaderProps) => {
  const navigate = useNavigate();
  const [saveStatus, setSaveStatus] = useState<string>("");

  // Atualiza status de salvamento
  useEffect(() => {
    if (!lastSaved) {
      setSaveStatus("Não salvo");
      return;
    }

    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - lastSaved.getTime()) / 1000);

    if (diffInSeconds < 60) {
      setSaveStatus("Salvo há menos de um minuto");
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      setSaveStatus(`Salvo há ${minutes} minuto${minutes > 1 ? 's' : ''}`);
    } else {
      const hours = Math.floor(diffInSeconds / 3600);
      setSaveStatus(`Salvo há ${hours} hora${hours > 1 ? 's' : ''}`);
    }
  }, [lastSaved]);

  // Atalhos de teclado para undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          onRedo?.();
        } else {
          onUndo?.();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onUndo, onRedo]);

  const handleGoBack = () => {
    navigate(`/projects/${projectId}`);
  };

  const handlePreviousArticle = () => {
    if (currentArticleIndex !== undefined && currentArticleIndex > 0) {
      const prevArticle = articles[currentArticleIndex - 1];
      if (prevArticle) {
        navigate(`/projects/${projectId}/assessment/${prevArticle.id}`);
      }
    }
  };

  const handleNextArticle = () => {
    if (currentArticleIndex !== undefined && currentArticleIndex < articles.length - 1) {
      const nextArticle = articles[currentArticleIndex + 1];
      if (nextArticle) {
        navigate(`/projects/${projectId}/assessment/${nextArticle.id}`);
      }
    }
  };

  const canGoPrevious = currentArticleIndex !== undefined && currentArticleIndex > 0;
  const canGoNext = currentArticleIndex !== undefined && currentArticleIndex < articles.length - 1;

  return (
    <header className={cn("sticky top-0 z-40 w-full border-b bg-background", className)}>
      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-3 px-4">
        {/* Botão de voltar - extremo esquerdo */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleGoBack}
          className="shrink-0"
          title="Voltar para o projeto"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        {/* Undo/Redo - centro esquerdo */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onUndo}
            disabled={!canUndo}
            title="Desfazer (Ctrl+Z)"
            className="shrink-0"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRedo}
            disabled={!canRedo}
            title="Refazer (Ctrl+Shift+Z)"
            className="shrink-0"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Status de salvamento - centro */}
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm text-muted-foreground">{saveStatus}</span>
        </div>

        {/* Navegação entre artigos - centro direita */}
        {articles.length > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handlePreviousArticle}
              disabled={!canGoPrevious}
              title="Artigo anterior"
              className="shrink-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground px-2">
              {currentArticleIndex !== undefined ? `${currentArticleIndex + 1}/${articles.length}` : ''}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNextArticle}
              disabled={!canGoNext}
              title="Próximo artigo"
              className="shrink-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Progresso - extremo direita */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-muted-foreground">Progresso:</span>
          <span className="text-sm font-medium">{progressPercentage}%</span>
        </div>
      </div>
    </header>
  );
};
