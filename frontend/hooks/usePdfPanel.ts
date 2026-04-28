import { useCallback, useState } from "react";

export interface UsePdfPanelResult {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/**
 * Encapsulates PDF panel show/hide state for assessment screens.
 * Defaults to **closed** to keep the form panel full-width on entry.
 */
export function usePdfPanel(opts?: { initialOpen?: boolean }): UsePdfPanelResult {
  const [isOpen, setIsOpen] = useState<boolean>(opts?.initialOpen ?? false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);
  return { isOpen, open, close, toggle };
}
