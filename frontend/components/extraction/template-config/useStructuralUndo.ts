/**
 * The field half of the Configuration surface's structural Undo (B-6 T5,
 * B-9d): it turns a move or a delete into a `StructuralStep` pair and hands
 * it to `useStructuralHistory`, which owns the slot and its toast.
 *
 * Wraps the panel's serialized `moveFieldTo` dispatcher: EVERY structural
 * chokepoint (the ⌘⇧ chord via the grid's `onMoveField`, the inspector
 * Section combobox via `moveFieldToSectionEnd`, and T6's drag `onDragEnd`
 * when it lands) dispatches through `moveFieldWithUndo`, so exactly one
 * step reaches the slot per gesture.
 *
 * The step is pushed only when the record's `settled` resolves true —
 * never before the write. A failed write already error-toasts through
 * the T1 mutation hooks; arming Undo first would double-toast a failure.
 *
 * A step re-enters through the RAW dispatcher, NOT this wrapper: an undo
 * is not a new undoable, so reverting pushes nothing while still
 * inheriting the dispatcher's serialization and live-region announcement.
 * The inverse SLOT is the record's `from`, captured at gesture time and
 * restored EXACTLY (`exactIndex`: a source section collapsed meanwhile
 * must not degrade the restore to append-to-end); the field itself is
 * re-resolved BY ID from the LATEST tree at click time (ids survive moves;
 * the object does not) — a field deleted meanwhile downgrades the click to
 * a gentle info toast and empties the slot instead of dispatching against
 * a ghost.
 */
import {useEffect, useRef} from 'react';
import {toast} from 'sonner';

import {t} from '@/lib/copy';

import {findField, type GridField, type GridSection} from './templateTree';
import type {StructuralHistory, StructuralStep} from './useStructuralHistory';
import type {FieldMoveRecord, MoveFieldOptions} from './useMoveFieldTo';

export type StructuralMoveDispatcher = (
  field: GridField,
  toSectionId: string,
  toIndex: number,
) => FieldMoveRecord | null;

/** Where a field sits: the slot an undo has to put it back into. */
interface FieldSlot {
  sectionId: string;
  index: number;
}

/** Read at click time, not at gesture time — a step outlives its render. */
interface LatestRef {
  tree: GridSection[];
  moveFieldTo: (
    field: GridField,
    toSectionId: string,
    toIndex: number,
    opts?: MoveFieldOptions,
  ) => FieldMoveRecord | null;
  deleteField?: (fieldId: string) => Promise<boolean>;
  restoreField?: (
    field: GridField,
    sectionId: string,
    index: number,
  ) => Promise<string | null>;
}

export function useStructuralUndo(args: {
  tree: GridSection[];
  /** The RAW dispatcher — undo passes `exactIndex` so the captured slot
   * is restored even into a meanwhile-collapsed section. */
  moveFieldTo: LatestRef['moveFieldTo'];
  /** Deletes the field; resolves false when the write was refused. */
  deleteField?: (fieldId: string) => Promise<boolean>;
  /** Re-creates a deleted field in the given slot; resolves the NEW row's
   * id (the restore re-creates, it does not un-tombstone) so Redo has
   * something to address, or null on failure. */
  restoreField?: LatestRef['restoreField'];
  /** The surface's one-level slot; it also raises the Undo toast. */
  history: StructuralHistory;
}): {
  moveFieldWithUndo: StructuralMoveDispatcher;
  deleteFieldWithUndo: (field: GridField) => Promise<void>;
} {
  const {tree, moveFieldTo, deleteField, restoreField, history} = args;
  // The Undo click lands SECONDS after the gesture: resolve the field and
  // the dispatcher from the LATEST render, never the gesture-time closure
  // (a stale dispatcher would plan from a stale tree).
  const latest = useRef<LatestRef>({tree, moveFieldTo, restoreField, deleteField});
  useEffect(() => {
    latest.current = {tree, moveFieldTo, restoreField, deleteField};
  });

  const moveFieldWithUndo: StructuralMoveDispatcher = (field, toSectionId, toIndex) => {
    const record = moveFieldTo(field, toSectionId, toIndex);
    if (!record) return record;
    const {from, to} = record;
    const step = moveStep(latest, field.id, field.label, from, to);
    void record.settled.then((ok) => {
      if (ok) history.push(step);
    });
    return record;
  };

  /**
   * Delete a field with no confirmation, and arm the Undo (B-9d).
   *
   * The modal is gone because the Publish ☑ ack is the real gate now
   * (B-9b2b): a removed field reaches published data only after a manager
   * ticks it in the diff sheet, and whole-draft Discard rewinds anything
   * else. What is left to protect is the seconds after a misclick.
   *
   * A refused delete arms NOTHING. The five ``field_id`` ON DELETE RESTRICT
   * FKs mean a field holding recorded work cannot be deleted at all, and
   * `useDeleteTemplateField` already toasts that 23503 as friendly copy —
   * offering Undo on a delete that never happened would be a lie.
   *
   * The restore re-creates the field from the grid projection, so it comes
   * back with a NEW id. That is sound precisely BECAUSE the delete
   * succeeded: nothing in the review workflow referenced it, or the FKs
   * would have refused. The delete runs through the SAME step a Redo
   * would, so the write itself exists in one place.
   */
  const deleteFieldWithUndo = async (field: GridField): Promise<void> => {
    if (!deleteField) return;
    const origin = locateField(latest.current.tree, field.id);
    if (!origin) {
      // Nothing to put back into — delete, offer no Undo.
      await deleteField(field.id);
      return;
    }
    const undoStep = await deleteStep(latest, field, origin).apply();
    if (undoStep) history.push(undoStep);
  };

  return {moveFieldWithUndo, deleteFieldWithUndo};
}

// Module scope on purpose: a step sits in the slot for the whole editing
// session, and a factory declared in the hook body would close over that
// render's scope — pinning the entire `GridSection[]` tree long after the
// invalidation that followed the edit replaced it. These take `latest`, so
// they read the CURRENT tree and retain only their own arguments.

/** One leg of a move, and its own mirror. Re-resolving the field BY ID from
 * the latest tree is what lets the pair be bounced repeatedly: ids survive
 * moves, the projection object does not. */
function moveStep(
  latest: React.RefObject<LatestRef>,
  fieldId: string,
  label: string,
  target: FieldSlot,
  origin: FieldSlot,
): StructuralStep {
  return {
    label: t('templateConfig', 'undoMoveToast').replace('{{field}}', label),
    apply: async () => {
      const current = findField(latest.current.tree, fieldId);
      if (!current) {
        toast.info(t('templateConfig', 'undoFieldMissing'));
        return null;
      }
      const record = latest.current.moveFieldTo(current, target.sectionId, target.index, {
        exactIndex: true,
      });
      if (!record || !(await record.settled)) return null;
      return moveStep(latest, fieldId, label, origin, target);
    },
  };
}

function restoreStep(
  latest: React.RefObject<LatestRef>,
  field: GridField,
  origin: FieldSlot,
): StructuralStep {
  return {
    label: t('templateConfig', 'undoDeleteToast').replace('{{field}}', field.label),
    apply: async () => {
      const restoredId = await latest.current.restoreField?.(
        field,
        origin.sectionId,
        origin.index,
      );
      if (!restoredId) return null;
      // Redo addresses the RE-CREATED row, never the id the manager
      // deleted — that one no longer exists anywhere.
      return deleteStep(latest, {...field, id: restoredId}, origin);
    },
  };
}

function deleteStep(
  latest: React.RefObject<LatestRef>,
  field: GridField,
  origin: FieldSlot,
): StructuralStep {
  return {
    label: t('templateConfig', 'undoDeleteToast').replace('{{field}}', field.label),
    apply: async () => {
      const ok = await latest.current.deleteField?.(field.id);
      if (!ok) return null;
      return restoreStep(latest, field, origin);
    },
  };
}

/** Where a field sits right now — captured BEFORE the delete removes it. */
function locateField(tree: GridSection[], fieldId: string): FieldSlot | null {
  const walk = (sections: GridSection[]): FieldSlot | null => {
    for (const section of sections) {
      const index = section.fields.findIndex((candidate) => candidate.id === fieldId);
      if (index >= 0) return {sectionId: section.id, index};
      const nested = walk(section.children);
      if (nested) return nested;
    }
    return null;
  };
  return walk(tree);
}
