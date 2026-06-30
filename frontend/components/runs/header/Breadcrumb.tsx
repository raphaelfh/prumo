import { ArrowLeft, ChevronRight } from 'lucide-react';
import { HeaderIconButton } from '@/components/layout/HeaderIconButton';
import { cn } from '@/lib/utils';
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
    // min-w-0 so the title truncates under pressure instead of overflowing. The
    // priority-drop order lives here: the back button and the non-final
    // (project) crumbs disappear via @container queries before the final
    // (article-title) crumb is ever forced to truncate — back drops first, then
    // project, then the title is the last casualty (it only truncates, never
    // hides). A dropped leaf is display:none (zero space); RunHeader.Left's
    // overflow-hidden backstop only guards whitespace-nowrap paint-over.
    <nav className="flex min-w-0 shrink items-center gap-1" aria-label="breadcrumb">
      <HeaderIconButton
        aria-label={t('common', 'back')}
        onClick={onBack}
        // Lowest-priority breadcrumb affordance, so the back arrow folds first.
        // App-nav escape stays available via the always-present SidebarToggle
        // (and the MobileNav drawer below lg, plus the browser back button); the
        // back arrow is a convenience, not the only way out.
        className="hidden @[42rem]/headerbar:inline-flex"
      >
        <ArrowLeft strokeWidth={1.5} aria-hidden="true" />
      </HeaderIconButton>
      <ol className="flex min-w-0 items-center gap-1">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            // The article title (last crumb) is the correctness anchor ("which
            // paper am I on"). Non-final crumbs + their separator chevron HIDE
            // below 36rem (and shrink 8x faster above it) so the project name is
            // gone before the article title even truncates.
            <li
              key={index}
              className={cn(
                'min-w-0 items-center gap-1',
                isLast ? 'flex shrink' : 'hidden shrink-[8] @[36rem]/headerbar:flex',
              )}
            >
              {index > 0 && (
                <ChevronRight className="hidden h-3 w-3 shrink-0 text-muted-foreground @[36rem]/headerbar:block" aria-hidden="true" />
              )}
              {crumb.onClick ? (
                // min-w-0 + truncate so the non-final crumb shrinks WITH its li
                // under flex pressure (above its 36rem hide threshold).
                <button
                  type="button"
                  className="min-w-0 max-w-[180px] truncate rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={crumb.onClick}
                >
                  {crumb.label}
                </button>
              ) : isLast ? (
                <TruncatedText text={crumb.label} className="min-w-0 max-w-[20rem] text-sm font-medium text-foreground" />
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
