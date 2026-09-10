import { PanelToggleButton } from '@/components/layout/PanelToggleButton';
import { t } from '@/lib/copy';

/** Right-hand source-panel (PDF) toggle. `pressed` = panel OPEN. */
export function PanelToggle({ pressed, onToggle }: { pressed: boolean; onToggle: () => void }) {
  // The run screens bind this key for real (`useRunShortcuts` -> onTogglePanel),
  // so this is the one toggle that may advertise it.
  return (
    <PanelToggleButton
      side="right"
      pressed={pressed}
      onToggle={onToggle}
      ariaLabel={t('runs', 'togglePanel')}
      shortcut={['\\']}
    />
  );
}
