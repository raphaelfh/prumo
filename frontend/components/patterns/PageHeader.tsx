/**
 * PageHeader - Standard header for internal pages.
 *
 * Usage:
 * <PageHeader
 *   title="Project Articles"
 *   description="125 articles for review"
 *   actions={<Button>Add Article</Button>}
 * />
 */

import React from 'react';
import {cn} from '@/lib/utils';

interface PageHeaderProps {
    title?: string;
  description?: string;
    /** Content on the left (e.g. Back button) */
    leading?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({title, description, leading, actions, className}: PageHeaderProps) {
  return (
      <div
          className={cn(
              'h-12 flex items-center justify-between border-b border-border/40 bg-background/80 backdrop-blur-md px-6 flex-shrink-0',
              className
          )}
      >
          <div className="flex items-center gap-4 flex-1 min-w-0">
              {leading && <div className="flex-shrink-0">{leading}</div>}
              <div className="flex items-baseline gap-3 min-w-0">
                  {title && (
                      <span className="text-[13px] font-medium text-foreground truncate">{title}</span>
                  )}
                  {description && (
                      <span className="text-[12px] text-muted-foreground truncate">{description}</span>
                  )}
              </div>
          </div>
          {actions && (
              <div className="flex items-center gap-2 flex-shrink-0">
                  {actions}
              </div>
          )}
    </div>
  );
}

