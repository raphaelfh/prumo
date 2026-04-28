import {Loader2} from 'lucide-react';

export function LoadingState({message = 'Loading PDF...'}: {message?: string}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <span className="text-sm">{message}</span>
    </div>
  );
}
