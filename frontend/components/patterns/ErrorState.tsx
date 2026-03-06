/**
 * ErrorState - Standard error state (English copy from patterns).
 * Use: <ErrorState message="..." onRetry={refetch} /> or pass title.
 */

import React from 'react';
import {AlertCircle, RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
                               title,
                               message,
  onRetry,
                               className
}: ErrorStateProps) {
    const displayTitle = title ?? t('patterns', 'errorDefaultTitle');
  return (
    <div className={cn(
      "flex flex-col items-center justify-center py-12 px-4 text-center",
      className
    )}>
      <AlertCircle className="h-12 w-12 text-destructive mb-4" />

      <h3 className="text-lg font-semibold text-foreground mb-2">
          {displayTitle}
      </h3>

        <p className="text-sm text-muted-foreground mb-6 max-w-sm">
        {message}
      </p>

        {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
            {t('patterns', 'errorTryAgain')}
        </Button>
      )}
    </div>
  );
}

