import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  message?: string | null;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="flex flex-col items-center gap-4 max-w-md text-center">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <div>
          <h3 className="font-semibold text-lg mb-2">Erro ao carregar PDF</h3>
          <p className="text-sm text-muted-foreground">
            {message || 'Não foi possível carregar o documento. Tente novamente.'}
          </p>
        </div>
        {onRetry && (
          <Button onClick={onRetry} variant="outline">
            Tentar Novamente
          </Button>
        )}
      </div>
    </div>
  );
}
