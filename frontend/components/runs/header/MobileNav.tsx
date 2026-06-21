import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/copy';

/**
 * Compact-tier app-navigation trigger for the focus shell. Visible only below
 * `lg`, where the desktop ProjectSidebar is `display:none` and its collapse
 * toggle (SidebarToggle) is a no-op; opens the MobileSidebar drawer instead.
 * Mirrors Topbar's hamburger (`lg:hidden` + toggleMobile). Prop-driven and
 * renders nothing without a handler, so the shared header lib stays decoupled
 * from SidebarContext.
 */
export function MobileNav({ onOpen }: { onOpen?: () => void }) {
  if (!onOpen) return null;
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={onOpen}
      aria-label={t('navigation', 'ariaOpenMenu')}
      className="flex h-8 w-8 shrink-0 p-0 text-muted-foreground transition-colors duration-75 hover:bg-muted/50 lg:hidden"
    >
      <Menu className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}
