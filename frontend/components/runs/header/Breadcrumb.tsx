import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/copy';

interface Crumb {
  label: string;
  onClick?: () => void;
}

interface BreadcrumbProps {
  onBack: () => void;
  crumbs: Crumb[];
}

export function Breadcrumb({ onBack, crumbs }: BreadcrumbProps) {
  return (
    <nav className="flex shrink-0 items-center gap-1" aria-label="breadcrumb">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 shrink-0"
        aria-label={t('common', 'back')}
        onClick={onBack}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <ol className="flex min-w-0 items-center gap-1">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          const crumbClass = isLast
            ? 'truncate max-w-[220px] font-medium text-foreground text-sm'
            : 'text-sm text-muted-foreground';
          return (
            <li key={index} className="flex items-center gap-1">
              {index > 0 && (
                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
              )}
              {crumb.onClick ? (
                <button
                  type="button"
                  className={`${crumbClass} hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded`}
                  onClick={crumb.onClick}
                >
                  {crumb.label}
                </button>
              ) : (
                <span className={crumbClass}>{crumb.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
