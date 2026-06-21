import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/copy';
import { TruncatedText } from './TruncatedText';

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
    <nav className="flex min-w-0 items-center gap-1" aria-label="breadcrumb">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 shrink-0 p-0"
        aria-label={t('common', 'back')}
        onClick={onBack}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <ol className="flex min-w-0 items-center gap-1">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={index} className="flex min-w-0 items-center gap-1">
              {index > 0 && (
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              {crumb.onClick ? (
                // min-w-0 + truncate so the non-final crumb shrinks WITH its
                // li under flex pressure instead of overflowing it and painting
                // over the next crumb (the narrow-width overlap).
                <button
                  type="button"
                  className="min-w-0 max-w-[180px] truncate rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={crumb.onClick}
                >
                  {crumb.label}
                </button>
              ) : isLast ? (
                <TruncatedText text={crumb.label} className="max-w-[220px] text-sm font-medium text-foreground" />
              ) : (
                <span className="block min-w-0 max-w-[180px] truncate text-sm text-muted-foreground">{crumb.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
