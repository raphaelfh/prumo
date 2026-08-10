/**
 * Pure drop-slot resolution for the grid's dnd-kit drag (B-6 T6, panel
 * decision 6).
 *
 * Maps a drag gesture's endpoints (the dragged field id + whatever the
 * pointer released over) to the dispatcher's landing slot, in the same
 * `toIndex` vocabulary as `planFieldMove`: a slot among the destination
 * section's field rows. The rows register two kinds of targets — every
 * field row (sortable) and every section HEADER row (droppable, keyed by
 * its section id):
 *
 * - over a field row: land at that row's index in its section —
 *   `arrayMove` semantics within a section (the moved row takes the
 *   over-row's position), insert-before-the-over-row across sections.
 * - over a section header: the section's true END when it is collapsed
 *   (its field rows are invisible — panel decision 4; the dispatcher's
 *   own `appendToEnd` re-derives the same landing, the index here keeps
 *   the pure story honest), the TOP slot when expanded (the header sits
 *   directly above the first field).
 * - over the dragged row itself / nothing / an unknown id: null.
 *
 * The filtering/pending guards mirror the drag-source gating (a drag
 * cannot START from a locked handle — this is defense in depth): while
 * filtering, visible indices lie about true positions; a pending row has
 * no server id to write.
 */
import type {GridSection} from './templateTree';

export interface DropSlot {
  toSectionId: string;
  toIndex: number;
}

export function resolveDropSlot(args: {
  sections: GridSection[];
  activeId: string;
  overId: string | null;
  collapsed: ReadonlySet<string>;
  isFiltering: boolean;
  pendingIds: ReadonlySet<string>;
}): DropSlot | null {
  const {sections, activeId, overId, collapsed, isFiltering, pendingIds} = args;
  if (overId === null || overId === activeId) return null;
  if (isFiltering || pendingIds.has(activeId)) return null;
  for (const section of sections.flatMap((s) => [s, ...s.children])) {
    if (section.id === overId) {
      return {
        toSectionId: section.id,
        toIndex: collapsed.has(section.id) ? section.fields.length : 0,
      };
    }
    const index = section.fields.findIndex((field) => field.id === overId);
    if (index !== -1) return {toSectionId: section.id, toIndex: index};
  }
  return null;
}
