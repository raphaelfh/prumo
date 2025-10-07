/**
 * PageToolbar - Barra de ferramentas abaixo do header
 * 
 * Uso:
 * <PageToolbar
 *   leftActions={<>...</>}
 *   rightActions={<>...</>}
 * />
 */

import React from 'react';
import { cn } from '@/lib/utils';

interface PageToolbarProps {
  leftActions?: React.ReactNode;
  rightActions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function PageToolbar({ 
  leftActions, 
  rightActions, 
  children, 
  className 
}: PageToolbarProps) {
  return (
    <div className={cn(
      "flex h-12 items-center justify-between border-b bg-muted/50 px-6",
      className
    )}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {leftActions}
      </div>
      
      {children}
      
      <div className="flex items-center gap-2 flex-shrink-0">
        {rightActions}
      </div>
    </div>
  );
}

