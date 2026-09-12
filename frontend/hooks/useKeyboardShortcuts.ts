/**
 * Generic keyboard shortcut hook with input/dialog guards.
 * See docs/superpowers/design-system/sidebar-and-panels.md §7.
 */
import {useEffect, useRef} from 'react';
import {modifierKey} from '@/lib/platform';

type ChordBinding = {
  type: 'chord';
  key: string;
  mod?: boolean;
  shift?: boolean;
  handler: () => void;
  /** Fire while typing in a field. Defaults to `mod`: a mod chord types nothing, a bare key would. */
  allowInInputs?: boolean;
  /** Fire while a dialog is open — for a binding that operates that dialog, like a palette's own toggle. */
  allowInDialogs?: boolean;
};

type SequenceBinding = {
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
  // Latest-bindings mirror for the keydown listener; written in an effect
  // (refs must not be written during render).
  const bindingsRef = useRef(bindings);
  useEffect(() => {
    bindingsRef.current = bindings;
  }, [bindings]);
  const pendingPrefixRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const modProp = modifierKey();
    const isModActive = (e: KeyboardEvent) => (e as unknown as Record<string, boolean>)[modProp] === true;

    function clearPending() {
      pendingPrefixRef.current = null;
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    }

    /**
     * Runs the first mod (or bare) chord the event matches; true once one matched.
     * Match first, guard dialogs last: `isDialogOpen` queries the whole document,
     * and most keystrokes — typing in a form above all — match no binding.
     */
    function runChord(e: KeyboardEvent, mod: boolean): boolean {
      if (isModActive(e) !== mod) return false;
      // A bare chord is an unmodified key, whichever platform the modifier is.
      if (!mod && (e.metaKey || e.ctrlKey || e.altKey)) return false;
      const key = e.key.toLowerCase();
      for (const b of bindingsRef.current) {
        if (b.type !== 'chord' || !!b.mod !== mod) continue;
        if (key !== b.key.toLowerCase()) continue;
        if (!!b.shift !== e.shiftKey) continue;
        // Mod chords bypass the input guard unless they opt out.
        if (!(b.allowInInputs ?? mod) && isTypingTarget(e)) continue;
        clearPending();
        if (!b.allowInDialogs && isDialogOpen()) return true;
        e.preventDefault();
        b.handler();
        return true;
      }
      return false;
    }

    // A mod chord outranks the focused control, so it claims its key in the
    // capture phase, before React dispatches: Radix primitives skip a
    // defaultPrevented key, and a focused Select trigger opens on ⌘↵ otherwise
    // (its open keys ignore modifiers).
    function onKeyDownCapture(e: KeyboardEvent) {
      runChord(e, true);
    }

    // A bare key is the focused control's first — Escape closes the innermost
    // Radix layer only while it is not defaultPrevented — so bare chords and
    // sequences match in the bubble phase, after it.
    function onKeyDown(e: KeyboardEvent) {
      if (runChord(e, false)) return;
      const key = e.key.toLowerCase();

      // Sequence bindings — never inside inputs, never with modifiers.
      if (isModActive(e) || e.shiftKey || e.altKey) {
        clearPending();
        return;
      }
      if (isTypingTarget(e)) {
        clearPending();
        return;
      }

      const prefix = pendingPrefixRef.current;
      if (prefix) {
        clearPending();
        for (const b of bindingsRef.current) {
          if (b.type !== 'sequence') continue;
          if (b.prefix.toLowerCase() === prefix && b.key.toLowerCase() === key) {
            if (isDialogOpen()) return;
            e.preventDefault();
            b.handler();
            return;
          }
        }
        return;
      }

      // Start a sequence if any binding uses this prefix — not under a dialog.
      const startsSeq = bindingsRef.current.some(
        (b) => b.type === 'sequence' && b.prefix.toLowerCase() === key,
      );
      if (startsSeq && !isDialogOpen()) {
        pendingPrefixRef.current = key;
        pendingTimerRef.current = setTimeout(clearPending, sequenceTimeoutMs);
      }
    }

    window.addEventListener('keydown', onKeyDownCapture, {capture: true});
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDownCapture, {capture: true});
      window.removeEventListener('keydown', onKeyDown);
      clearPending();
    };
  }, [enabled, sequenceTimeoutMs]);
}
