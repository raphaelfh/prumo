import { PanelToggleButton } from '@/components/layout/PanelToggleButton';
import { t } from '@/lib/copy';

/** Right-hand source-panel (PDF) toggle. `pressed` = panel OPEN. */
export function PanelToggle({ pressed, onToggle }: { pressed: boolean; onToggle: () => void }) {
  return <PanelToggleButton side="right" pressed={pressed} onToggle={onToggle} ariaLabel={t('runs', 'togglePanel')} />;
}
