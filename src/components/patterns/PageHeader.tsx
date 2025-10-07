/**
 * PageHeader - Header padronizado para páginas internas
 * 
 * Uso:
 * <PageHeader 
 *   title="Artigos do Projeto"
 *   description="125 artigos para revisão"
 *   actions={<Button>Adicionar Artigo</Button>}
 * />
 */

import React from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ 
  title, 
  description, 
  actions, 
  className 
}: PageHeaderProps) {
  return (
    <div className={cn("border-b bg-background", className)}>
      <div className="flex h-16 items-center justify-between px-6">
        <div className="space-y-1 flex-1 min-w-0">
          <h1 className="text-2xl font-semibold text-foreground truncate">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground truncate">
              {description}
            </p>
          )}
        </div>
        
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

