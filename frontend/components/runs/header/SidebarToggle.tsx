import { PanelToggleButton } from '@/components/layout/PanelToggleButton';
import { t } from '@/lib/copy';

/** Left app-navigation toggle. Prop-driven; renders nothing when unwired. */
export function SidebarToggle({ pressed, onToggle }: { pressed?: boolean; onToggle?: () => void }) {
  if (!onToggle) return null;
  return <PanelToggleButton side="left" pressed={!!pressed} onToggle={onToggle} ariaLabel={t('runs', 'sidebarToggle')} />;
}
