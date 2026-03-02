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
import {cn} from '@/lib/utils';

interface PageHeaderProps {
    title?: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({title, description, actions, className}: PageHeaderProps) {
  return (
      <div className={cn(
          "h-11 flex items-center justify-between border-b border-border/30 bg-background/80 backdrop-blur-sm px-6 flex-shrink-0",
          className
      )}>
          <div className="flex items-baseline gap-3 flex-1 min-w-0">
              {title && (
                  <span className="text-[13px] font-medium text-foreground truncate">{title}</span>
              )}
              {description && (
                  <span className="text-[12px] text-muted-foreground/70 truncate">{description}</span>
              )}
          </div>
          {actions && (
              <div className="flex items-center gap-2 flex-shrink-0">
                  {actions}
              </div>
          )}
    </div>
  );
}

