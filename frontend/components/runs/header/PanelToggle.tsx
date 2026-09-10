import { PanelToggleButton } from '@/components/layout/PanelToggleButton';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { t } from '@/lib/copy';

// ⌘⇧B / Ctrl+⇧B: the Articles panel's chord; ⌘B is the sidebar on the other edge.
const PANEL_KEYS = ['mod', '⇧', 'B'];

/** Right-hand source-panel (PDF) toggle. `pressed` = panel OPEN. */
export function PanelToggle({ pressed, onToggle }: { pressed: boolean; onToggle: () => void }) {
  // The toggle binds the chord it advertises, so the two cannot drift. Through the
  // shared hook: a chord types nothing, so it works mid-field, and an open dialog
  // swallows it.
  useKeyboardShortcuts({
    bindings: [{ type: 'chord', key: 'b', mod: true, shift: true, handler: onToggle }],
    enabled: true,
  });
  return (
    <PanelToggleButton
      side="right"
      pressed={pressed}
      onToggle={onToggle}
      ariaLabel={t('runs', 'togglePanel')}
      shortcut={PANEL_KEYS}
    />
  );
}
