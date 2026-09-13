import {useState} from 'react';

/**
 * Which inspector host is showing: the docked pane at wide container widths
 * (open by default) or the Sheet below the breakpoint (opt-in — an overlay
 * must never auto-cover the grid on mount). ⌘., the toolbar button, the ✨
 * deep-links and the config bar's AI instruction trigger all act on the
 * ACTIVE host through this one surface.
 */
export function useInspectorHost(isNarrow: boolean) {
  const [dockedOpen, setDockedOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  return {
    dockedOpen,
    sheetOpen,
    setSheetOpen,
    pressed: isNarrow ? sheetOpen : dockedOpen,
    open: () => (isNarrow ? setSheetOpen(true) : setDockedOpen(true)),
    close: () => (isNarrow ? setSheetOpen(false) : setDockedOpen(false)),
    toggle: () => (isNarrow ? setSheetOpen((o) => !o) : setDockedOpen((o) => !o)),
  };
}
