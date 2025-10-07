import React from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { BreadcrumbItem } from '@/types/navigation';

interface BreadcrumbSectionProps {
  items: BreadcrumbItem[];
  className?: string;
}

export const BreadcrumbSection: React.FC<BreadcrumbSectionProps> = ({ 
  items, 
  className 
}) => {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center gap-2", className)}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const Icon = item.icon;

        return (
          <React.Fragment key={index}>
            {index > 0 && (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            
            {item.href && !isLast ? (
              <Link
                to={item.href}
                className="flex items-center gap-1.5 text-sm hover:text-primary transition-colors"
              >
                {Icon && <Icon className="h-4 w-4" />}
                <span>{item.label}</span>
              </Link>
            ) : (
              <span className={cn(
                "flex items-center gap-1.5 text-sm",
                isLast ? "text-foreground font-medium" : "text-muted-foreground"
              )}>
                {Icon && <Icon className="h-4 w-4" />}
                <span>{item.label}</span>
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
