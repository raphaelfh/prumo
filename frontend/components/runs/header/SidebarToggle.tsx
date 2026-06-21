import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';

/**
 * Left app-navigation toggle. Prop-driven so the shared lib stays decoupled
 * from SidebarContext; renders nothing when no handler is wired. Mirrors the
 * right-hand PanelToggle (Meta+B ↔ "\") to bracket the bar.
 *
 * Gated to `lg+` to match the desktop ProjectSidebar (`hidden lg:block`): below
 * `lg` the sidebar is `display:none`, so collapsing/expanding it is a no-op.
 * The RunHeader.MobileNav hamburger covers the sub-`lg` tier (opens a drawer).
 *
 * `pressed` = sidebar OPEN; PanelLeftClose shows when open (matches Topbar.tsx).
 */
export function SidebarToggle({ pressed, onToggle }: { pressed?: boolean; onToggle?: () => void }) {
  if (!onToggle) return null;
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={onToggle}
      aria-pressed={pressed}
      aria-keyshortcuts="Meta+B"
      aria-label={t('runs', 'sidebarToggle')}
      className="relative hidden h-8 w-8 shrink-0 p-0 text-muted-foreground transition-colors duration-75 hover:bg-muted/50 lg:inline-flex"
    >
      <span className="relative block h-4 w-4">
        <PanelLeftClose
          className={cn(
            'absolute inset-0 h-4 w-4 transition-opacity duration-150 ease-out motion-reduce:duration-0',
            pressed ? 'opacity-100' : 'opacity-0',
          )}
          aria-hidden="true"
        />
        <PanelLeftOpen
          className={cn(
            'absolute inset-0 h-4 w-4 transition-opacity duration-150 ease-out motion-reduce:duration-0',
            pressed ? 'opacity-0' : 'opacity-100',
          )}
          aria-hidden="true"
        />
      </span>
    </Button>
  );
}
