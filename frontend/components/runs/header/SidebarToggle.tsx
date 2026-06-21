import { PanelToggleButton } from '@/components/layout/PanelToggleButton';
import { t } from '@/lib/copy';

/**
 * Left app-navigation toggle. Delegates to the shared PanelToggleButton
 * (Meta+B, PanelLeft crossfade) so the header toggles stay unified.
 *
 * Gated to `lg+` to match the desktop ProjectSidebar (`hidden lg:block`): below
 * `lg` the sidebar is `display:none`, so collapsing/expanding it is a no-op.
 * The RunHeader.MobileNav hamburger covers the sub-`lg` tier (opens a drawer).
 *
 * `pressed` = sidebar OPEN.
 */
export function SidebarToggle({ pressed, onToggle }: { pressed?: boolean; onToggle?: () => void }) {
  if (!onToggle) return null;
  return (
    <PanelToggleButton
      side="left"
      pressed={!!pressed}
      onToggle={onToggle}
      ariaLabel={t('runs', 'sidebarToggle')}
      className="hidden lg:inline-flex"
    />
  );
}
