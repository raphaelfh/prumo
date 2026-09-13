import { Menu } from 'lucide-react';
import { IconButton } from '@/components/patterns/IconButton';
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
    <IconButton
      label={t('navigation', 'ariaOpenMenu')}
      onClick={onOpen}
      className="lg:hidden"
      icon={<Menu strokeWidth={1.5} aria-hidden="true" />}
    />
  );
}
