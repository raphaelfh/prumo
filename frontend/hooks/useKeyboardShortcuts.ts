/**
 * Generic keyboard shortcut hook with input/dialog guards.
 * See docs/superpowers/design-system/sidebar-and-panels.md §7.
 */
import {useEffect, useRef} from 'react';
import {modifierKey} from '@/lib/platform';

export type ChordBinding = {
  type: 'chord';
  key: string;
  mod?: boolean;
  shift?: boolean;
  handler: () => void;
  allowInInputs?: boolean;
};

export type SequenceBinding = {
  type: 'sequence';
  prefix: string;
  key: string;
  handler: () => void;
};

export type Binding = ChordBinding | SequenceBinding;

interface UseKeyboardShortcutsOptions {
  bindings: Binding[];
  enabled: boolean;
  sequenceTimeoutMs?: number;
}

const DEFAULT_SEQUENCE_TIMEOUT = 1500;

function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return true;
  return false;
}

function isDialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"][data-state="open"]');
}

export function useKeyboardShortcuts({
  bindings,
  enabled,
  sequenceTimeoutMs = DEFAULT_SEQUENCE_TIMEOUT,
}: UseKeyboardShortcutsOptions): void {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;
  const pendingPrefixRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const modProp = modifierKey();

    function clearPending() {
      pendingPrefixRef.current = null;
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      const modActive = (e as unknown as Record<string, boolean>)[modProp] === true;

      if (isDialogOpen()) {
        clearPending();
        return;
      }

      // Chord bindings (always considered first; mod chords bypass input guard).
      for (const b of bindingsRef.current) {
        if (b.type !== 'chord') continue;
        const requireMod = !!b.mod;
        const requireShift = !!b.shift;
        if (key !== b.key.toLowerCase()) continue;
        if (requireMod !== modActive) continue;
        if (requireShift !== e.shiftKey) continue;
        if (!requireMod && !b.allowInInputs && isTypingTarget(e)) continue;
        e.preventDefault();
        clearPending();
        b.handler();
        return;
      }

      // Sequence bindings — never inside inputs, never with modifiers.
      if (modActive || e.shiftKey || e.altKey) {
        clearPending();
        return;
      }
      if (isTypingTarget(e)) {
        clearPending();
        return;
      }

      const prefix = pendingPrefixRef.current;
      if (prefix) {
        for (const b of bindingsRef.current) {
          if (b.type !== 'sequence') continue;
          if (b.prefix.toLowerCase() === prefix && b.key.toLowerCase() === key) {
            e.preventDefault();
            clearPending();
            b.handler();
            return;
          }
        }
        clearPending();
        return;
      }

      // Start a sequence if any binding uses this prefix.
      const startsSeq = bindingsRef.current.some(
        (b) => b.type === 'sequence' && b.prefix.toLowerCase() === key,
      );
      if (startsSeq) {
        pendingPrefixRef.current = key;
        pendingTimerRef.current = setTimeout(clearPending, sequenceTimeoutMs);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearPending();
    };
  }, [enabled, sequenceTimeoutMs]);
}
