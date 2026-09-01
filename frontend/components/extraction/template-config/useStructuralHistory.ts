/**
 * The Configuration surface's one-level Undo/Redo slot, and the ONE Sonner
 * toast that announces it.
 *
 * Every structural edit on this screen is written to the server the moment
 * it is made — there is no client-side draft to rewind — so "history" here
 * is not a buffer of pending state but a pair of *inverse writes* the
 * toolbar can dispatch. A step therefore carries a function rather than a
 * snapshot: `apply()` performs the write and resolves the step that
 * reverses it, which is what makes Undo and Redo the same machinery
 * pointed in opposite directions.
 *
 * One level, deliberately. A deeper stack would have to re-resolve every
 * older step against a tree that later edits have already moved, and a
 * restore comes back with a NEW id (the row is re-created, not
 * tombstoned) — so entry N-2 can address a row that entry N-1's undo
 * replaced. The whole-draft rewind that a real history would compete with
 * already exists and is honest about its granularity: Discard.
 *
 * `push` retires the redo branch, the usual editor semantics: a fresh edit
 * makes the previously-undone one unreachable rather than leaving a
 * redo that would re-apply an edit the manager has since diverged from.
 *
 * The toast lives HERE, raised by `push` and dismissed by a dispatch,
 * rather than at each call site. Callers own the write; the slot owns how
 * the slot is announced. Three hand-copied `toast(...)` blocks was three
 * chances for the id, the 6s duration or the action label to drift — and
 * the id IS the single-slot mechanism (same-id push replaces a live toast
 * in Sonner 2.x), so a fourth structural edit shipping without it would
 * silently stack a second undo. A Redo raises nothing: only a fresh edit
 * announces itself.
 */
import {useCallback, useRef, useState} from 'react';
import {toast} from 'sonner';

import {t} from '@/lib/copy';

/** The ONE toast slot for the whole Configuration surface. */
export const STRUCTURAL_UNDO_TOAST_ID = 'template-config-structural-undo';

export interface StructuralStep {
  /** Names the edit this step acts on, already interpolated — e.g.
   * "Deleted Sample size". It is both the toast's message and the half of
   * the toolbar tooltip that says WHICH edit is on the slot. */
  label: string;
  /**
   * Performs the write and resolves the step that reverses it.
   *
   * Resolves null when the write was refused or the target no longer
   * exists; the slot then empties rather than offering a button that
   * dispatches against a ghost. Callers own their own error toast — this
   * layer never invents one.
   */
  apply: () => Promise<StructuralStep | null>;
}

export interface StructuralHistory {
  undoStep: StructuralStep | null;
  redoStep: StructuralStep | null;
  /** A dispatch is in flight; both buttons disable until it lands. */
  busy: boolean;
  /** Register the step that undoes a just-completed edit, and announce it. */
  push: (step: StructuralStep) => void;
  undo: () => void;
  redo: () => void;
}

interface Slot {
  undo: StructuralStep | null;
  redo: StructuralStep | null;
  busy: boolean;
}

const EMPTY: Slot = {undo: null, redo: null, busy: false};

export function useStructuralHistory(): StructuralHistory {
  // The slot is held in a ref and MIRRORED into state, written through one
  // door so the two cannot drift.
  //
  // The ref is not a memoization nicety: the toast that offers Undo is
  // armed inside `push`, whose caller reached it from the `settled`
  // continuation of the edit — the render that follows has not happened
  // yet. A callback closing over state would still see the empty slot, and
  // the toast's Undo would silently do nothing. The ref is current whenever
  // the click lands, and the identity of `undo`/`redo` stays stable for the
  // toolbar's buttons. It is also what guards re-entrancy: two clicks
  // inside one frame both read `busy === false` from state, and a
  // double-dispatched delete is exactly what this slot protects against.
  const ref = useRef<Slot>(EMPTY);
  const [slot, setSlot] = useState<Slot>(EMPTY);

  const commit = useCallback((next: Slot) => {
    ref.current = next;
    setSlot(next);
  }, []);

  const dispatch = useCallback(
    (direction: 'undo' | 'redo') => {
      const step = ref.current[direction];
      if (!step || ref.current.busy) return;
      const opposite = direction === 'undo' ? 'redo' : 'undo';
      // The consumed side empties BEFORE the write lands: the button must
      // not stay armed while its own dispatch is in flight.
      commit({...ref.current, [direction]: null, busy: true});
      toast.dismiss(STRUCTURAL_UNDO_TOAST_ID);
      void step.apply().then((inverse) => {
        commit({...ref.current, [opposite]: inverse, busy: false});
      });
    },
    [commit],
  );

  const undo = useCallback(() => dispatch('undo'), [dispatch]);
  const redo = useCallback(() => dispatch('redo'), [dispatch]);

  const push = useCallback(
    (step: StructuralStep) => {
      commit({...ref.current, undo: step, redo: null});
      toast(step.label, {
        id: STRUCTURAL_UNDO_TOAST_ID,
        duration: 6000,
        action: {label: t('templateConfig', 'undoAction'), onClick: undo},
      });
    },
    [commit, undo],
  );

  return {undoStep: slot.undo, redoStep: slot.redo, busy: slot.busy, push, undo, redo};
}
