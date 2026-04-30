import {AlertCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';

export interface ErrorStateProps {
  error: Error;
  onRetry?: () => void;
}

export function ErrorState({error, onRetry}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center"
    >
      <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
      <div>
        <p className="font-medium">Failed to load PDF</p>
        <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
