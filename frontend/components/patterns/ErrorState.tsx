/**
 * ErrorState - Estado de erro padronizado
 * 
 * Uso:
 * <ErrorState
 *   title="Erro ao carregar"
 *   message="Não foi possível carregar os dados"
 *   onRetry={refetch}
 * />
 */

import React from 'react';
import {AlertCircle, RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ 
  title = 'Algo deu errado', 
  message, 
  onRetry,
  className 
}: ErrorStateProps) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center py-12 px-4 text-center",
      className
    )}>
      <AlertCircle className="h-12 w-12 text-destructive mb-4" />
      
      <h3 className="text-lg font-semibold text-foreground mb-2">
        {title}
      </h3>
      
      <p className="text-sm text-muted-foreground mb-6 max-w-sm">
        {message}
      </p>
      
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Tentar Novamente
        </Button>
      )}
    </div>
  );
}

