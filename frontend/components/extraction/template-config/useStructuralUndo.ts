/**
 * Single-slot Undo for structural field moves (B-6 T5, panel decision 1).
 *
 * Wraps the panel's serialized `moveFieldTo` dispatcher: EVERY structural
 * chokepoint (the ⌘⇧ chord via the grid's `onMoveField`, the inspector
 * Section combobox via `moveFieldToSectionEnd`, and T6's drag `onDragEnd`
 * when it lands) dispatches through `moveFieldWithUndo`, so a successful
 * move arms THE one 6s "Moved <field> — Undo" toast. Pushing under the
 * same fixed toast id REPLACES a live toast (Sonner 2.x) — that
 * replacement IS the single-slot dismiss: a new structural mutation
 * retires the prior Undo; never a stack.
 *
 * The toast is armed only when the record's `settled` resolves true —
 * never before the write. A failed write already error-toasts through
 * the T1 mutation hooks; arming Undo first would double-toast a failure.
 *
 * Undo re-enters through the RAW dispatcher, NOT this wrapper: an undo
 * is not a new undoable (decision 1's spirit), so reverting arms no
 * fresh Undo toast while still inheriting the dispatcher's serialization
 * and live-region announcement. A failed undo write is likewise covered
 * by the hooks' error toast. The inverse SLOT is the record's `from`,
 * captured at gesture time and restored EXACTLY (`exactIndex`: a source
 * section collapsed meanwhile must not degrade the restore to
 * append-to-end); the field itself is re-resolved BY ID from the LATEST
 * tree at click time (ids survive moves; the object does not) — a field
 * deleted meanwhile downgrades the click to a gentle info toast instead
 * of dispatching against a ghost.
 */
import {useEffect, useRef} from 'react';
import {toast} from 'sonner';

import {t} from '@/lib/copy';

import {findField, type GridField, type GridSection} from './templateTree';
import type {FieldMoveRecord, MoveFieldOptions} from './useMoveFieldTo';

/** The ONE toast slot for the whole Configuration surface. */
export const STRUCTURAL_UNDO_TOAST_ID = 'template-config-structural-undo';

export type StructuralMoveDispatcher = (
  field: GridField,
  toSectionId: string,
  toIndex: number,
) => FieldMoveRecord | null;

export function useStructuralUndo(args: {
  tree: GridSection[];
  /** The RAW dispatcher — undo passes `exactIndex` so the captured slot
   * is restored even into a meanwhile-collapsed section. */
  moveFieldTo: (
    field: GridField,
    toSectionId: string,
    toIndex: number,
    opts?: MoveFieldOptions,
  ) => FieldMoveRecord | null;
  /** Deletes the field; resolves false when the write was refused. */
  deleteField?: (fieldId: string) => Promise<boolean>;
  /** Re-creates a deleted field in the given slot; resolves false on failure. */
  restoreField?: (
    field: GridField,
    sectionId: string,
    index: number,
  ) => Promise<boolean>;
}): {
  moveFieldWithUndo: StructuralMoveDispatcher;
  deleteFieldWithUndo: (field: GridField) => Promise<void>;
} {
  const {tree, moveFieldTo, deleteField, restoreField} = args;
  // The Undo click lands SECONDS after the gesture: resolve the field and
  // the dispatcher from the LATEST render, never the gesture-time closure
  // (a stale dispatcher would plan from a stale tree).
  const latest = useRef({tree, moveFieldTo, restoreField});
  useEffect(() => {
    latest.current = {tree, moveFieldTo, restoreField};
  });

  const moveFieldWithUndo: StructuralMoveDispatcher = (field, toSectionId, toIndex) => {
    const record = moveFieldTo(field, toSectionId, toIndex);
    if (!record) return record;
    const fieldId = field.id;
    const {from} = record;
    void record.settled.then((ok) => {
      if (!ok) return;
      toast(t('templateConfig', 'undoMoveToast').replace('{{field}}', field.label), {
        id: STRUCTURAL_UNDO_TOAST_ID,
        duration: 6000,
        action: {
          label: t('templateConfig', 'undoAction'),
          // Sonner dismisses the toast on action click by default, so the
          // consumed Undo leaves the slot empty.
          onClick: () => {
            const current = findField(latest.current.tree, fieldId);
            if (!current) {
              toast.info(t('templateConfig', 'undoFieldMissing'));
              return;
            }
            latest.current.moveFieldTo(current, from.sectionId, from.index, {
              exactIndex: true,
            });
          },
        },
      });
    });
    return record;
  };

  /**
   * Delete a field with no confirmation, and arm the Undo (B-9d).
   *
   * The modal is gone because the Publish ☑ ack is the real gate now
   * (B-9b2b): a removed field reaches published data only after a manager
   * ticks it in the diff sheet, and whole-draft Discard rewinds anything
   * else. What is left to protect is the seconds after a misclick, which
   * is what this toast is for.
   *
   * A refused delete arms NOTHING. The six ``field_id`` ON DELETE RESTRICT
   * FKs mean a field holding recorded work cannot be deleted at all, and
   * ``useDeleteTemplateField`` already toasts that 23503 as friendly copy —
   * offering Undo on a delete that never happened would be a lie.
   *
   * The restore re-creates the field from the grid projection, so it comes
   * back with a NEW id. That is sound precisely BECAUSE the delete
   * succeeded: nothing in the review workflow referenced it, or the FKs
   * would have refused.
   */
  const deleteFieldWithUndo = async (field: GridField): Promise<void> => {
    if (!deleteField) return;
    const origin = locateField(latest.current.tree, field.id);
    const ok = await deleteField(field.id);
    if (!ok || !origin) return;

    toast(t('templateConfig', 'undoDeleteToast').replace('{{field}}', field.label), {
      id: STRUCTURAL_UNDO_TOAST_ID,
      duration: 6000,
      action: {
        label: t('templateConfig', 'undoAction'),
        onClick: () => {
          void latest.current.restoreField?.(field, origin.sectionId, origin.index);
        },
      },
    });
  };

  return {moveFieldWithUndo, deleteFieldWithUndo};
}

/** Where a field sits right now — captured BEFORE the delete removes it. */
function locateField(
  tree: GridSection[],
  fieldId: string,
): {sectionId: string; index: number} | null {
  const walk = (sections: GridSection[]): {sectionId: string; index: number} | null => {
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
