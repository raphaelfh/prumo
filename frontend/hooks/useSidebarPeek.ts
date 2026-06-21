/**
 * Hover/focus peek state for the collapsed sidebar mini-rail.
 * - onEnter/onLeave drive the hover peek with an in-delay and an out-grace so
 *   the cursor can travel from the rail into the floating panel without it
 *   vanishing (WCAG 1.4.13 "Hoverable").
 * - openNow/closeNow are the keyboard path: focus-within opens the peek, Esc
 *   dismisses it (WCAG 1.4.13 "Dismissable"), both immediate.
 * Pure setTimeout/clearTimeout state — no IO, React-Compiler safe.
 * See docs/superpowers/design-system/sidebar-and-panels.md §1, §8.
 */
import {useCallback, useEffect, useRef, useState} from 'react';

interface UseSidebarPeekOptions {
  inMs?: number;
  outMs?: number;
}

export interface SidebarPeek {
  open: boolean;
  onEnter: () => void;
  onLeave: () => void;
  openNow: () => void;
  closeNow: () => void;
}

export function useSidebarPeek({inMs = 120, outMs = 250}: UseSidebarPeekOptions = {}): SidebarPeek {
  const [open, setOpen] = useState(false);
  const inTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (inTimer.current) {
      clearTimeout(inTimer.current);
      inTimer.current = null;
    }
    if (outTimer.current) {
      clearTimeout(outTimer.current);
      outTimer.current = null;
    }
  }, []);

  const onEnter = useCallback(() => {
    if (outTimer.current) {
      clearTimeout(outTimer.current);
      outTimer.current = null;
    }
    if (inTimer.current) return;
    inTimer.current = setTimeout(() => {
      inTimer.current = null;
      setOpen(true);
    }, inMs);
  }, [inMs]);

  const onLeave = useCallback(() => {
    if (inTimer.current) {
      clearTimeout(inTimer.current);
      inTimer.current = null;
    }
    if (outTimer.current) return;
    outTimer.current = setTimeout(() => {
      outTimer.current = null;
      setOpen(false);
    }, outMs);
  }, [outMs]);

  const openNow = useCallback(() => {
    clearTimers();
    setOpen(true);
  }, [clearTimers]);

  const closeNow = useCallback(() => {
    clearTimers();
    setOpen(false);
  }, [clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  return {open, onEnter, onLeave, openNow, closeNow};
}
