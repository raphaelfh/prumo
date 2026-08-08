/**
 * dnd-kit plumbing for the template grid drag (B-6 T6).
 *
 * `GridDndContext` wraps the panel's grid host: sensors, closest-center
 * collision detection, a hand-rolled vertical-axis lock
 * (@dnd-kit/modifiers is not installed and a modifier is a one-line pure
 * fn — not worth a dependency), and the onDragEnd → `resolveDropSlot` →
 * `onMoveField` translation. The panel passes its `moveFieldWithUndo`
 * chokepoint, so a completed drag arms the same single-slot Undo toast
 * and inherits the serialized dispatcher, its optimistic order overlay
 * and its live-region announcement.
 *
 * Keyboard: dnd-kit's KeyboardSensor is deliberately NOT registered — it
 * would fight the grid's roving-focus handler; the accessible move paths
 * are the ⌘⇧ chords + the inspector Section combobox (WCAG 2.5.7). The
 * drag lifecycle still announces pick-up/cancel through dnd-kit's own
 * live region (field labels, not ids), portaled to document.body so the
 * grid's DOM stays clean; the LANDED move announces through the
 * dispatcher, so onDragEnd stays silent here. `restoreFocus` is off: the
 * roving model owns focus and the activator is a non-focusable td by
 * design (see TemplateGridFieldRow). Edge auto-scroll is the DndContext
 * default, driven against the panel's overflow container.
 */
import type {ReactNode} from 'react';
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';

import {t} from '@/lib/copy';

import {resolveDropSlot} from './dropSlot';
import {findField, type GridField, type GridSection} from './templateTree';

const restrictToVerticalAxis: Modifier = ({transform}) => ({...transform, x: 0});

export interface GridDragArgs {
  /** The RENDERED sections (the panel's visibleSections) — drop targets
   * must mirror what is on screen. */
  sections: GridSection[];
  collapsed: ReadonlySet<string>;
  isFiltering: boolean;
  pendingRowIds: ReadonlySet<string>;
  /** The panel's `moveFieldWithUndo` chokepoint. */
  onMoveField: (field: GridField, toSectionId: string, toIndex: number) => unknown;
}

export function useGridDrag(args: GridDragArgs) {
  const {sections, collapsed, isFiltering, pendingRowIds, onMoveField} = args;
  // Fine pointers activate after 6px of travel (precedent
  // ArticleAuthorsField.tsx) so plain clicks stay clicks; coarse pointers
  // long-press so touch scrolling stays scrolling. The Mouse+Touch pair
  // (not PointerSensor) is what lets the two input classes carry
  // different activation constraints.
  const sensors = useSensors(
    useSensor(MouseSensor, {activationConstraint: {distance: 6}}),
    useSensor(TouchSensor, {activationConstraint: {delay: 250, tolerance: 8}}),
  );

  const labelOf = (id: unknown) => findField(sections, String(id))?.label ?? '';

  const onDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const slot = resolveDropSlot({
      sections,
      activeId,
      overId: event.over === null ? null : String(event.over.id),
      collapsed,
      isFiltering,
      pendingIds: pendingRowIds,
    });
    if (slot === null) return;
    const field = findField(sections, activeId);
    if (field) onMoveField(field, slot.toSectionId, slot.toIndex);
  };

  return {
    sensors,
    collisionDetection: closestCenter,
    modifiers: [restrictToVerticalAxis],
    accessibility: {
      container: document.body,
      restoreFocus: false,
      // The aria-describedby instructions never surface — useSortable's
      // `attributes` is suppressed on the handle (roving invariant).
      screenReaderInstructions: {draggable: ''},
      announcements: {
        onDragStart: ({active}: {active: {id: unknown}}) =>
          t('templateConfig', 'dragPickedUp').replace('{{field}}', labelOf(active.id)),
        onDragOver: () => undefined,
        onDragEnd: () => undefined, // the landed move announces via the dispatcher
        onDragCancel: ({active}: {active: {id: unknown}}) =>
          t('templateConfig', 'dragCancelled').replace('{{field}}', labelOf(active.id)),
      },
    },
    onDragEnd,
  };
}

export function GridDndContext({
  children,
  ...args
}: GridDragArgs & {children: ReactNode}) {
  const dnd = useGridDrag(args);
  return <DndContext {...dnd}>{children}</DndContext>;
}
