/**
 * Pure planning layer for field move/reorder writes (B-6 T3).
 *
 * A landing slot (`toSectionId` + `toIndex` from the cell model's
 * `moveRow` effect, the T4 combobox, or a T5 undo) becomes the exact
 * write set: a WHOLE-section renumber batch (sort_order is a per-section
 * rendering convention with no DB invariant — renumbering the full
 * section is what keeps gaps/dupes from accumulating), plus the moved
 * row's `moveField` args when the move crosses sections.
 *
 * `toIndex` semantics match `nextMoveSlot`: a slot among the
 * destination's field rows with the moved row REMOVED first, so the
 * same number works for within-section swaps, cross-section landings,
 * and the inverse move (re-dispatching the captured `fromIndex`
 * restores the original arrangement).
 *
 * The `order` in / `nextOrder` out pair is the dispatcher's working
 * order: each dispatch in a burst plans from the order the previous one
 * produced — never from a stale tree — which is what makes rapid
 * repeats coalesce to `null` instead of duplicating writes (panel
 * decision 3).
 */
import type {FieldSortOrderUpdate} from '@/services/extractionFieldService';

import type {GridSection} from './templateTree';

/** Per-section field ids in visible order (pending rows included). */
export type SectionFieldOrder = ReadonlyMap<string, readonly string[]>;

export function deriveSectionOrder(sections: GridSection[]): SectionFieldOrder {
  const order = new Map<string, string[]>();
  for (const section of sections) {
    order.set(section.id, section.fields.map((f) => f.id));
    for (const child of section.children) {
      order.set(child.id, child.fields.map((f) => f.id));
    }
  }
  return order;
}

export interface FieldMovePlan {
  /** Where the field sat when the plan was made — the T5 inverse slot. */
  fromSectionId: string;
  fromIndex: number;
  toSectionId: string;
  /** Final landing index (clamped; collapsed destinations append). */
  toIndex: number;
  /** Destination field count AFTER the move — the announcement's "of N". */
  destCount: number;
  crossSection: boolean;
  /** 1-based sort_order for the moved row — `moveField`'s arg on a
   * cross-section move; already inside `updates` otherwise. */
  movedSortOrder: number;
  /** Whole-section renumber batch (both sections when crossing),
   * excluding the moved row when it travels via `moveField` and
   * excluding pending client-key rows (no server id to write). */
  updates: FieldSortOrderUpdate[];
  /** The working order after this move — input for the next dispatch. */
  nextOrder: SectionFieldOrder;
}

export function planFieldMove(args: {
  order: SectionFieldOrder;
  fieldId: string;
  toSectionId: string;
  toIndex: number;
  /** Collapsed destination: the cell model only saw its (zero) visible
   * field rows — land at the section's true END (panel decision 4). */
  appendToEnd: boolean;
  pendingIds: ReadonlySet<string>;
}): FieldMovePlan | null {
  const {order, fieldId, toSectionId, toIndex, appendToEnd, pendingIds} = args;

  let fromSectionId: string | null = null;
  for (const [sectionId, ids] of order) {
    if (ids.includes(fieldId)) {
      fromSectionId = sectionId;
      break;
    }
  }
  const destBase = order.get(toSectionId);
  if (fromSectionId === null || destBase === undefined) return null;

  const source = order.get(fromSectionId) ?? [];
  const fromIndex = source.indexOf(fieldId);
  const crossSection = fromSectionId !== toSectionId;

  const destWithout = (crossSection ? destBase : source).filter((id) => id !== fieldId);
  const insertIndex = appendToEnd
    ? destWithout.length
    : Math.max(0, Math.min(toIndex, destWithout.length));
  if (!crossSection && insertIndex === fromIndex) return null;

  const dest = [
    ...destWithout.slice(0, insertIndex),
    fieldId,
    ...destWithout.slice(insertIndex),
  ];
  const sourceAfter = crossSection ? source.filter((id) => id !== fieldId) : dest;

  const renumber = (ids: readonly string[], skipMoved: boolean) =>
    ids.flatMap((id, index): FieldSortOrderUpdate[] =>
      pendingIds.has(id) || (skipMoved && id === fieldId)
        ? []
        : [{id, sort_order: index + 1}],
    );

  const nextOrder = new Map(order);
  nextOrder.set(toSectionId, dest);
  if (crossSection) nextOrder.set(fromSectionId, sourceAfter);

  return {
    fromSectionId,
    fromIndex,
    toSectionId,
    toIndex: insertIndex,
    destCount: dest.length,
    crossSection,
    movedSortOrder: insertIndex + 1,
    updates: crossSection
      ? [...renumber(sourceAfter, false), ...renumber(dest, true)]
      : renumber(dest, false),
    nextOrder,
  };
}
