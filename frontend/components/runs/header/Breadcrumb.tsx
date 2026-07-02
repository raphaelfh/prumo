import { ArrowLeft } from 'lucide-react';
import { HeaderIconButton } from '@/components/layout/HeaderIconButton';
import { t } from '@/lib/copy';
import { TruncatedText } from './TruncatedText';

interface BreadcrumbProps {
  onBack: () => void;
  title: string;
}

/**
 * Single-title identity slot (spec 2026-07-02): the article/template title is
 * the only identity text — the project crumb is gone (the sidebar and the
 * back arrow carry project context). The title is the flex cushion of the
 * Left track: pure flex-shrink, truncates last, never drops.
 */
export function Breadcrumb({ onBack, title }: BreadcrumbProps) {
  return (
    <nav className="flex min-w-0 shrink items-center gap-1" aria-label="breadcrumb">
      <HeaderIconButton
        aria-label={t('common', 'back')}
        onClick={onBack}
        // Lowest-priority identity affordance, so the back arrow folds first.
        // App-nav escape stays available via the always-present SidebarToggle
        // (and the MobileNav drawer below lg, plus the browser back button).
        className="hidden @[42rem]/headerbar:inline-flex"
      >
        <ArrowLeft strokeWidth={1.5} aria-hidden="true" />
      </HeaderIconButton>
      <TruncatedText text={title} className="min-w-0 text-sm font-medium text-foreground" />
    </nav>
  );
}
