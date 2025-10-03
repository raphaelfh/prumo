import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Eye, 
  EyeOff, 
  Lock, 
  AlertTriangle,
  Loader2 
} from 'lucide-react';
import { toast } from 'sonner';
import { useBlindReview } from '@/hooks/assessment/useBlindReview';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface BlindModeToggleProps {
  projectId: string;
  userId: string;
  className?: string;
}

export const BlindModeToggle = ({ 
  projectId, 
  userId, 
  className 
}: BlindModeToggleProps) => {
  const {
    isBlindMode,
    canManageBlindMode,
    isLoading,
    error,
    toggleBlindMode
  } = useBlindReview(projectId, userId);

  const [isToggling, setIsToggling] = useState(false);

  const handleToggle = async () => {
    if (!canManageBlindMode) {
      toast.error('Apenas managers podem alterar o modo blind');
      return;
    }

    setIsToggling(true);
    try {
      const newMode = await toggleBlindMode();
      toast.success(
        newMode 
          ? 'Modo blind ativado - reviewers não podem ver outras avaliações'
          : 'Modo blind desativado - reviewers podem ver outras avaliações'
      );
    } catch (error: any) {
      console.error('Error toggling blind mode:', error);
      toast.error(error.message || 'Erro ao alterar modo blind');
    } finally {
      setIsToggling(false);
    }
  };

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm text-muted-foreground">Carregando...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <AlertTriangle className="h-4 w-4 text-destructive" />
        <span className="text-sm text-destructive">Erro: {error}</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Badge 
        variant={isBlindMode ? "destructive" : "secondary"}
        className="flex items-center gap-1"
      >
        {isBlindMode ? (
          <>
            <EyeOff className="h-3 w-3" />
            Blind Ativo
          </>
        ) : (
          <>
            <Eye className="h-3 w-3" />
            Blind Inativo
          </>
        )}
      </Badge>

      {canManageBlindMode ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                onClick={handleToggle}
                disabled={isToggling}
                className="h-8 px-2"
              >
                {isToggling ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : isBlindMode ? (
                  <EyeOff className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {isBlindMode 
                  ? 'Desativar modo blind' 
                  : 'Ativar modo blind'
                }
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center">
                <Lock className="h-3 w-3 text-muted-foreground" />
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Apenas managers podem alterar o modo blind</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
};
