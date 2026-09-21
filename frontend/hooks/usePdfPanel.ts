import { useState } from "react";

export interface UsePdfPanelResult {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** True while the PDF is maximized over the form pane. */
  isExpanded: boolean;
  toggleExpanded: () => void;
  /** Back to the split view, leaving the panel open (Escape, and the run header's own toggle). */
  collapse: () => void;
}

/**
 * Encapsulates PDF panel show/hide state for assessment screens.
 * Defaults to **closed** to keep the form panel full-width on entry.
 *
 * Open and expanded live together here because they are not independent: the
 * panel cannot be maximized while hidden. Expanding opens it, and hiding it
 * collapses — otherwise ⌘⇧B would hide a maximized pane and leave `expanded`
 * stranded, so reopening would restore a full-width PDF the reviewer never
 * asked for.
 */
export function usePdfPanel(opts?: {
  initialOpen?: boolean;
  /**
   * The viewport cannot host a side-by-side split: phone width, below Tailwind
   * `sm`. An open panel is then ALWAYS maximized, and leaving the maximized
   * view closes it instead of restoring a split. A phone split gives the PDF
   * ~195px: its toolbar alone needs ~208px of 44px touch targets, so the
   * trailing controls (☰, then expand) were pushed off the edge, and neither
   * pane was readable.
   *
   * NOT `lg`: between `sm` and `lg` (a tablet, a narrow desktop window) the
   * split still gives the PDF 320px+, the toolbar fits, and the reviewer keeps
   * the header — and with it the source-panel toggle and its ⌘⇧B chord.
   */
  compact?: boolean;
}): UsePdfPanelResult {
  const [isOpen, setIsOpen] = useState<boolean>(opts?.initialOpen ?? false);
  const [isExpanded, setIsExpanded] = useState(false);

  const open = () => setIsOpen(true);
  const close = () => {
    setIsOpen(false);
    setIsExpanded(false);
  };
  const toggle = () =>
    setIsOpen((wasOpen) => {
      if (wasOpen) setIsExpanded(false);
      return !wasOpen;
    });
  const toggleExpanded = () =>
    setIsExpanded((wasExpanded) => {
      if (!wasExpanded) setIsOpen(true);
      return !wasExpanded;
    });
  const collapse = () => setIsExpanded(false);

  if (opts?.compact) {
    return {
      isOpen,
      open,
      close,
      toggle,
      isExpanded: isOpen,
      toggleExpanded: isOpen ? close : open,
      collapse: close,
    };
  }
  return { isOpen, open, close, toggle, isExpanded, toggleExpanded, collapse };
}
