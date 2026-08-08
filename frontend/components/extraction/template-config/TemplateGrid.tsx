import {Fragment, useRef, useState} from 'react';
import {SortableContext, verticalListSortingStrategy} from '@dnd-kit/sortable';

import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

import type {CellFocus} from './gridCellFocus';
import {
  gridReducer,
  initialGridState,
  recoverFocus,
  type CellCoord,
  type CellKind,
  type GridRowShape,
} from './gridCellModel';
import {FieldRow, type TextCellColumn} from './TemplateGridFieldRow';
import {GhostRow} from './TemplateGridGhostRow';
import {
  SectionHeaderRow,
  type TemplateSectionActions,
} from './TemplateGridSectionHeaderRow';
import {findField, type GridField, type GridSection} from './templateTree';

// Re-exported (B-6 T0 split) so existing import sites keep working.
export type {TextCellColumn} from './TemplateGridFieldRow';
export type {TemplateSectionActions} from './TemplateGridSectionHeaderRow';

/**
 * The template configuration grid (spec §2, mock `manager-grid-v3-polish`).
 *
 * B-5 Task 2: an ARIA grid with roving tabIndex — EXACTLY ONE tab stop at
 * all times (defaulting to the first cell), arrows rove between cells via
 * the pure `gridCellModel` reducer, Tab exits (APG), and a grid-level
 * focusin listener keeps the roving coordinate in sync when focus moves by
 * other means (e.g. a Radix menu close refocusing its trigger). The focus
 * ring is painted on the whole <td> from MODEL state via className —
 * `:focus-visible` misses mouse clicks and `:focus-within` drops during
 * portals.
 *
 * B-5 Task 3: TEXT cells (Label; Key when shown) edit inline per the
 * Airtable contract — second-click/Enter/F2 open the editor on the current
 * value (selected), typing opens it seeded with the typed key (typing
 * replaces), Enter commits and advances DOWN, blur commits in place, Esc
 * reverts with focus staying on the cell. Commits surface through
 * `onCommitField`; every other field property edits in the inspector
 * (Task 5), so the row menu only deletes.
 *
 * B-5 Task 4: GHOST rows (every section, child sections included) edit
 * inline — click/Enter/typing opens the ghost editor, Enter commits the
 * drafted field through `onInsertField` and REOPENS the same editor (the
 * Enter-chain), Enter on an empty draft exits, a never-typed ghost
 * auto-discards on blur, a typed one commits. The `＋ ▾` New-field item
 * focuses the section's ghost editor — adds never leave the grid. The
 * panel owns the optimistic pending rows; `rowIdRemaps` keeps the focus
 * coordinate alive when a confirmed pending row swaps its client key for
 * the server id.
 *
 * B-5 Task 5: CONTROL cells act on the FIRST click. The Type cell is a
 * menu trigger (the pick routes through `onChangeType`, probed by the
 * panel), Required is a real checkbox (`onToggleRequired` — the panel
 * routes real rows vs pending rows; the grid stays write-free), and the
 * ✨/Options cells deep-link the inspector to the right group
 * (`onDeepLink`). Mouse/Space activation is native on each control;
 * keyboard Enter/F2 routes through the cell model and the effects loop
 * interprets `activateControl` — a native checkbox ignores Enter, and
 * preventDefault keeps button cells from double-firing.
 *
 * B-5 Task 6: the section RENAME is row-local — SectionHeaderRow owns
 * rename mode, the mounted editor owns the draft, and both exits leave
 * rename mode synchronously so the editor unmounts while focused (no
 * blur-commit can follow an Enter commit or an Esc cancel — the Task-3
 * exactly-once pattern). The parent receives ONE commit per rename;
 * Esc cancels locally (ladder rung 1) with focus staying on the cell.
 */

export interface TemplateGridSelection {
  kind: 'field' | 'section';
  id: string;
}

interface TemplateGridProps {
  sections: GridSection[];
  selection: TemplateGridSelection | null;
  onSelect: (selection: TemplateGridSelection) => void;
  onDeleteField: (field: GridField) => void;
  /** Inline text-cell commit — label/key writes belong to the panel. Only
   * called with a CHANGED, non-empty, trimmed value. An explicit `false`
   * REFUSES the commit (invalid key): the grid stays in edit mode so the
   * user can fix the draft in place. */
  onCommitField: (
    field: GridField,
    column: TextCellColumn,
    value: string,
  ) => boolean | void;
  /** Ghost-row commit (Task 4): the panel owns the optimistic insert
   * queue. Only called with a non-empty, trimmed label. */
  onInsertField: (sectionId: string, label: string) => void;
  /** Required-cell toggle (Task 5): the panel routes the write (update
   * mutation for real rows, insert queue for pending rows). */
  onToggleRequired: (field: GridField, isRequired: boolean) => void;
  /** Type-menu pick (Task 5): the panel runs the impact probe and the
   * type-dependent clears before writing. */
  onChangeType: (field: GridField, fieldType: string) => void;
  /** ✨/Options cell activation (Task 5): the panel selects the field and
   * opens the inspector on the group (docked or Sheet). */
  onDeepLink: (field: GridField, group: 'ai' | 'options') => void;
  /** ⌘⇧↑/↓ move dispatch (B-6 T3): the panel's serialized `moveFieldTo`
   * chokepoint. Optional so shells without the write layer render
   * unchanged. `settled` resolves after the write + refetch — the grid
   * then nudges DOM focus back onto the row (a React re-parent drops
   * focus to body). */
  onMoveField?: (
    field: GridField,
    toSectionId: string,
    toIndex: number,
  ) => {settled: Promise<boolean>} | null;
  /** Client key → server id for pending rows the panel reconciled: the
   * focus coordinate follows the row identity across the drain refetch. */
  rowIdRemaps?: ReadonlyMap<string, string>;
  /** Rows still living under a client key (Task 7). Their queued insert
   * has no cancel API, so the row menu's Delete DISABLES until the drain
   * swaps the row to its server id — the simpler of the two options
   * (deleting a field right after creating it is rare enough not to buy
   * a queue-cancel path). */
  pendingRowIds?: ReadonlySet<string>;
  sectionActions: TemplateSectionActions;
  onAddSection: () => void;
  /** Esc pressed in focus mode: rungs 2-3 of the ladder belong to the
   * panel's central dispatcher (close inspector with focus-return, then
   * clear search / deselect). Rung 1 (cancel a cell or rename edit)
   * resolves inside the editors, which stopPropagation. */
  onEscapeEscalate: () => void;
  collapsed: ReadonlySet<string>;
  onToggleCollapse: (sectionId: string) => void;
  showKeyColumn: boolean;
  showOptionsColumn: boolean;
  isFiltering: boolean;
}

/** Indentation ladder from the mock: identity 22px, sub-header 14px, child fields 36px. */
const INDENT = {
  rootField: 'pl-2',
  identityField: 'pl-[22px]',
  childHeader: 'pl-[14px]',
  childField: 'pl-[36px]',
} as const;

const ADD_SECTION_ROW_ID = 'ghost:template';

const ghostRowId = (sectionId: string) => `ghost:${sectionId}`;

/** Keys the grid routes through the cell model on EVERY cell. Text and
 * ghost cells additionally route Enter/F2/printables (they open the
 * inline editor); on control cells those stay native — activation
 * happens on the focused inner control itself. */
const ROVING_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Escape',
  'Tab',
]);

/** Which cells edit as free text: the label/key columns of FIELD rows,
 * plus every FIELD ghost row ('ghost' — Task 4's Enter-chain). The
 * template-level add-section ghost (empty sectionId) keeps native button
 * activation until sections go inline (B-8); section rows keep native
 * activation (rename ownership is Task 6). */
function cellKindAt(coord: CellCoord, rows: GridRowShape[]): CellKind {
  const row = rows.find((r) => r.rowId === coord.rowId);
  if (!row) return 'control';
  if (row.kind === 'ghost') return row.sectionId === '' ? 'control' : 'ghost';
  if (row.kind !== 'field') return 'control';
  return coord.column === 'label' || coord.column === 'key' ? 'text' : 'control';
}

/** Field-row control cells whose keyboard activation the GRID interprets
 * (via the model's `activateControl` effect): the required checkbox
 * ignores a native Enter, and the ✨/Options buttons must not double-fire
 * (interpretation preventDefaults the native Enter-click). The type and
 * actions cells stay fully native — their Radix triggers own Enter. */
const INTERPRETED_CONTROL_COLUMNS = new Set(['required', 'sparkle', 'options']);

function interpretsActivation(coord: CellCoord, rows: GridRowShape[]): boolean {
  const row = rows.find((r) => r.rowId === coord.rowId);
  return row?.kind === 'field' && INTERPRETED_CONTROL_COLUMNS.has(coord.column);
}

/** A key that types a character. Ctrl/Cmd chords are commands, never
 * seeds; Option-composed characters (pt-BR accents via dead keys are the
 * `isComposing`/'Dead' branch) still count. */
function isPrintableKey(event: React.KeyboardEvent): boolean {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey;
}

function targetCovers(el: HTMLElement, column: string): boolean {
  const cols = el.dataset.cellCols ?? '';
  return cols === '*' || cols.split(' ').includes(column);
}

/** Map a focused/keyed DOM element to a model coordinate, preserving the
 * current column when the target covers it (colSpan cells cover several). */
function coordFromTarget(
  el: HTMLElement,
  current: CellCoord | null,
  columns: readonly string[],
): CellCoord {
  const rowId = el.dataset.cellRow ?? '';
  if (current && targetCovers(el, current.column)) {
    return {rowId, column: current.column};
  }
  const cols = el.dataset.cellCols ?? '';
  return {rowId, column: cols === '*' ? columns[0] : cols.split(' ')[0]};
}

function findFocusTarget(
  table: HTMLTableElement | null,
  coord: CellCoord,
): HTMLElement | null {
  if (!table) return null;
  const candidates = table.querySelectorAll<HTMLElement>(
    `[data-cell-row="${coord.rowId}"]`,
  );
  for (const el of candidates) {
    if (targetCovers(el, coord.column)) return el;
  }
  return null;
}

/** The visible rows in DOM order — the model's vertical axis. Must mirror
 * the JSX exactly (collapse hides fields/children, filtering hides
 * ghosts; every section — child sections included — carries a ghost). */
function buildRowShapes(
  sections: GridSection[],
  collapsed: ReadonlySet<string>,
  isFiltering: boolean,
): GridRowShape[] {
  const rows: GridRowShape[] = [];
  for (const section of sections) {
    rows.push({rowId: section.id, kind: 'section', sectionId: section.id});
    if (collapsed.has(section.id)) continue;
    for (const field of section.fields) {
      rows.push({rowId: field.id, kind: 'field', sectionId: section.id});
    }
    if (!isFiltering) {
      rows.push({rowId: ghostRowId(section.id), kind: 'ghost', sectionId: section.id});
    }
    for (const child of section.children) {
      rows.push({rowId: child.id, kind: 'section', sectionId: child.id});
      if (collapsed.has(child.id)) continue;
      for (const field of child.fields) {
        rows.push({rowId: field.id, kind: 'field', sectionId: child.id});
      }
      if (!isFiltering) {
        rows.push({rowId: ghostRowId(child.id), kind: 'ghost', sectionId: child.id});
      }
    }
  }
  if (!isFiltering) {
    rows.push({rowId: ADD_SECTION_ROW_ID, kind: 'ghost', sectionId: ''});
  }
  return rows;
}

/** The invariant lives here: this never returns a coordinate without a
 * live row while the grid has rows, so EXACTLY ONE target renders
 * tabIndex=0 — defaulting to the first cell (the B-1 regression), and
 * recovering to the nearest surviving cell when the focused row unmounts
 * (filter change, delete). */
function resolveFocusCoord(
  focus: CellCoord | null,
  rows: GridRowShape[],
  columns: readonly string[],
  rowIdRemaps: ReadonlyMap<string, string> | undefined,
): CellCoord | null {
  if (rows.length === 0) return null;
  const fallback: CellCoord = {rowId: rows[0].rowId, column: columns[0]};
  if (!focus) return fallback;
  const column = columns.includes(focus.column) ? focus.column : columns[0];
  if (rows.some((row) => row.rowId === focus.rowId)) {
    return {rowId: focus.rowId, column};
  }
  // Rule 5 (focus remap): a confirmed pending row now renders under its
  // server id — follow the row's identity instead of "recovering".
  const remapped = rowIdRemaps?.get(focus.rowId);
  if (remapped && rows.some((row) => row.rowId === remapped)) {
    return {rowId: remapped, column};
  }
  return recoverFocus({rowId: focus.rowId, column}, null, rows) ?? fallback;
}

export function TemplateGrid({
  sections,
  selection,
  onSelect,
  onDeleteField,
  onCommitField,
  onInsertField,
  onToggleRequired,
  onChangeType,
  onDeepLink,
  onMoveField,
  rowIdRemaps,
  pendingRowIds,
  sectionActions,
  onAddSection,
  onEscapeEscalate,
  collapsed,
  onToggleCollapse,
  showKeyColumn,
  showOptionsColumn,
  isFiltering,
}: TemplateGridProps) {
  // grab · label · [key] · type · [options] · required · ai · row actions
  const columnCount = 6 + (showKeyColumn ? 1 : 0) + (showOptionsColumn ? 1 : 0);
  const columns: string[] = [
    'label',
    ...(showKeyColumn ? ['key'] : []),
    'type',
    ...(showOptionsColumn ? ['options'] : []),
    'required',
    'sparkle',
    'actions',
  ];
  const spanCols = columns.filter((c) => c !== 'label' && c !== 'actions').join(' ');
  const rowShapes = buildRowShapes(sections, collapsed, isFiltering);

  const tableRef = useRef<HTMLTableElement>(null);
  // Plain useState (not useReducer) on purpose: handlers run the pure
  // reducer themselves so they can interpret `next.effects` synchronously
  // — imperative .focus() is only ever called inside event handlers, never
  // in effects keyed on the roving coordinate (React Compiler constraint).
  const [gridState, setGridState] = useState(initialGridState);
  const [focusWithin, setFocusWithin] = useState(false);
  const focus: CellFocus = {
    coord: resolveFocusCoord(gridState.focus, rowShapes, columns, rowIdRemaps),
    within: focusWithin,
  };

  const isSelected = (kind: 'field' | 'section', id: string) =>
    selection?.kind === kind && selection.id === id;

  /** Interpret `activateControl` for the columns native activation cannot
   * cover (see INTERPRETED_CONTROL_COLUMNS). */
  const activateControlCell = (coord: CellCoord) => {
    const field = findField(sections, coord.rowId);
    if (!field) return;
    if (coord.column === 'required') onToggleRequired(field, !field.isRequired);
    else if (coord.column === 'sparkle') onDeepLink(field, 'ai');
    else if (coord.column === 'options') onDeepLink(field, 'options');
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTableElement>) => {
    if (event.defaultPrevented) return; // e.g. Radix trigger opened on ArrowDown
    const target = event.target as HTMLElement;
    // Text editors own their keys; the required CHECKBOX is an input too,
    // but not a text editor — its Enter/arrows still route to the model.
    if (target.closest('input:not([type="checkbox"]), textarea, [contenteditable="true"]')) {
      return;
    }
    const holder = target.closest<HTMLElement>('[data-cell-row]');
    if (!holder) return; // portal content (open menus) is not a cell
    const coord = coordFromTarget(holder, gridState.focus, columns);
    const cellKind = cellKindAt(coord, rowShapes);
    const printable = isPrintableKey(event) || event.key === 'Dead';
    const opensEditor =
      (cellKind === 'text' || cellKind === 'ghost') &&
      (event.key === 'Enter' || event.key === 'F2' || printable);
    const activatesControl =
      cellKind === 'control' &&
      (event.key === 'Enter' || event.key === 'F2') &&
      interpretsActivation(coord, rowShapes);
    if (!ROVING_KEYS.has(event.key) && !opensEditor && !activatesControl) return;
    let state = gridState;
    if (!state.focus || state.focus.rowId !== coord.rowId || state.focus.column !== coord.column) {
      state = gridReducer(state, {type: 'focusSync', coord});
    }
    const next = gridReducer(state, {
      type: 'key',
      key: event.key,
      printable,
      composing: event.nativeEvent.isComposing,
      // B-6 move chord: ⌘ and Ctrl fold into one `meta` (Ctrl⇧ is the
      // equal-citizen fallback where the OS claims ⌘⇧-arrows). Arrows
      // pass the ROVING_KEYS gate below regardless — carrying the
      // modifiers is what routes the chord to the model's move branch
      // (which runs BEFORE its rove switch) instead of a plain rove.
      meta: event.metaKey || event.ctrlKey,
      shift: event.shiftKey,
      filtering: isFiltering,
      cellKind,
      rows: rowShapes,
      columns,
    });
    for (const effect of next.effects) {
      if (effect.kind === 'escalateEsc') {
        // The central Esc dispatcher: rung 1 (cancelEdit) resolves in the
        // editor itself; rungs 2-3 are the panel's. stopPropagation keeps
        // the panel's own listener from double-firing.
        event.stopPropagation();
        onEscapeEscalate();
      }
      if (effect.kind === 'activateControl') {
        // Task 5: toggle the required checkbox / deep-link ✨ and Options.
        // preventDefault stops the native Enter-click on button cells so
        // the activation fires exactly once.
        event.preventDefault();
        activateControlCell(effect.coord);
      }
      if (effect.kind === 'moveRow' && !pendingRowIds?.has(effect.fieldRowId)) {
        // B-6 T3: pending rows have no server id yet — the chord no-ops.
        // The Arrow branch below preventDefaults either way (a consumed
        // chord must never scroll). The model keeps the SAME coordinate;
        // once the write + refetch settle, the row's DOM node has been
        // re-parented (focus fell to body), so nudge focus back — via
        // setTimeout, which runs after React's scheduled commit; still
        // handler-originated, never an effect. Skip the nudge when the
        // user moved focus elsewhere meanwhile.
        const moved = findField(sections, effect.fieldRowId);
        const record = moved
          ? onMoveField?.(moved, effect.toSectionId, effect.toIndex)
          : null;
        if (record) {
          const target: CellCoord = {rowId: effect.fieldRowId, column: coord.column};
          void record.settled.then((ok) => {
            if (!ok) return;
            setTimeout(() => {
              const table = tableRef.current;
              const active = document.activeElement;
              if (!table) return;
              if (active && active !== document.body && !table.contains(active)) return;
              const el =
                findFocusTarget(table, target) ??
                table.querySelector<HTMLElement>('[tabindex="0"]');
              el?.focus();
            }, 0);
          });
        }
      }
      // 'exitGrid' (Tab): deliberately NOT preventDefault-ed — the grid has
      // one tab stop, so native Tab already leaves it (APG).
      // 'commit' / 'cancelEdit' surface via the editor's own handlers.
    }
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      if (
        next.focus &&
        (next.focus.rowId !== coord.rowId || next.focus.column !== coord.column)
      ) {
        findFocusTarget(tableRef.current, next.focus)?.focus();
      }
    }
    if (opensEditor && next.mode === 'edit') {
      // The editor mounts with the seed — the typed character must not
      // ALSO land natively, and Enter/Space must not click the button
      // (on a ghost row, Enter would otherwise ALSO fire its button).
      event.preventDefault();
    }
    setGridState(next);
  };

  // Grid-level focusin: the roving coordinate follows focus wherever it
  // lands (mouse click on an inner control, Radix menu close refocusing
  // its trigger, the rename input's autoFocus).
  const handleFocusIn = (event: React.FocusEvent<HTMLTableElement>) => {
    setFocusWithin(true);
    const holder = (event.target as HTMLElement).closest<HTMLElement>('[data-cell-row]');
    if (!holder) return;
    const coord = coordFromTarget(holder, gridState.focus, columns);
    const next = gridReducer(gridState, {type: 'focusSync', coord});
    if (next !== gridState) setGridState(next);
  };

  const handleFocusOut = (event: React.FocusEvent<HTMLTableElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
      setFocusWithin(false);
    }
  };

  // Clicking a cell with no interactive content (type/required/AI) must
  // still focus it — some engines (Safari) never focus a tabindex'd td by
  // themselves. Inner controls keep their native mousedown focus.
  const handleMouseDown = (event: React.MouseEvent<HTMLTableElement>) => {
    const target = event.target as HTMLElement;
    const holder = target.closest<HTMLElement>('[data-cell-row]');
    // Second click on the already-focused text cell edits (the model's
    // second-click transition). Detected at MOUSEDOWN time: by the click
    // event this gesture's own focusin has already synced the coordinate,
    // which would make every first click look like a second one.
    if (holder && document.activeElement === holder && gridState.mode === 'focus') {
      const coord = coordFromTarget(holder, gridState.focus, columns);
      if (cellKindAt(coord, rowShapes) === 'text') {
        event.preventDefault();
        setGridState(
          gridReducer(gridState, {
            type: 'click',
            coord,
            cellKind: 'text',
            rows: rowShapes,
          }),
        );
        return;
      }
    }
    if (target.closest('button, input, textarea, a, [contenteditable="true"]')) return;
    if (!(holder instanceof HTMLTableCellElement)) return;
    event.preventDefault();
    holder.focus();
  };

  /** The target may not exist until React flushes the state just set (the
   * editor unmounts, the cell's control remounts) — a microtask runs after
   * that flush. Still handler-originated: never an effect. */
  const focusCellSoon = (coord: CellCoord) => {
    queueMicrotask(() => findFocusTarget(tableRef.current, coord)?.focus());
  };

  /** What a commit effect writes to: a field's text cell, or a ghost row
   * drafting a NEW field. ONE interpreter for both — the model decides
   * when a commit happens; the target decides what it means. */
  type CommitTarget =
    | {kind: 'field'; field: GridField; column: TextCellColumn}
    | {kind: 'ghost'; sectionId: string};

  const handleEditorCommit = (
    target: CommitTarget,
    draft: string,
    via: 'enter' | 'blur',
  ) => {
    const next =
      via === 'enter'
        ? gridReducer(gridState, {
            type: 'key',
            key: 'Enter',
            cellKind: target.kind === 'ghost' ? 'ghost' : 'text',
            rows: rowShapes,
            columns,
          })
        : gridReducer(gridState, {type: 'blurCommit'});
    let refused = false;
    for (const effect of next.effects) {
      if (effect.kind !== 'commit') continue;
      const value = draft.trim();
      if (target.kind === 'field') {
        const current = target.column === 'label' ? target.field.label : target.field.key;
        // A no-change (or emptied) draft is a revert, never a write.
        if (value !== '' && value !== current) {
          refused = onCommitField(target.field, target.column, value) === false;
        }
      } else if (value !== '') {
        // Ghost commit: the panel enqueues the optimistic insert; the
        // chain keeps this editor mounted (a never-typed blur is a
        // discard — the empty value never reaches here as a write).
        onInsertField(target.sectionId, value);
      }
    }
    if (refused) {
      // The panel refused the write (invalid key): stay in edit mode —
      // the mounted editor keeps the draft for an in-place fix.
      return;
    }
    setGridState(next);
    // On Enter the commit owns where focus goes (down — or back onto the
    // reopened ghost editor); on blur the world already moved it —
    // stealing it back would fight the user.
    if (via === 'enter' && next.focus) focusCellSoon(next.focus);
  };

  const handleEditorCancel = () => {
    const next = gridReducer(gridState, {
      type: 'key',
      key: 'Escape',
      cellKind: 'text',
      rows: rowShapes,
      columns,
    });
    setGridState(next);
    // Esc keeps focus ON the cell: refocus its control once it remounts.
    if (next.focus) focusCellSoon(next.focus);
  };

  /** `＋ ▾` New-field and ghost-button clicks land here: open the
   * section's ghost editor (expanding a collapsed section first — the
   * editor mounts with autoFocus once the ghost row renders). */
  const openGhostEditor = (sectionId: string) => {
    if (collapsed.has(sectionId)) onToggleCollapse(sectionId);
    setGridState(
      gridReducer(gridState, {
        type: 'click',
        coord: {rowId: ghostRowId(sectionId), column: columns[0]},
        cellKind: 'ghost',
        rows: rowShapes,
      }),
    );
  };

  /** The ghost editor reports the empty↔non-empty flip so the model can
   * tell "Enter chains" from "Enter exits" (`setGhostDraftEmpty`). */
  const handleGhostDraftEmpty = (empty: boolean) => {
    const next = gridReducer(gridState, {type: 'setGhostDraftEmpty', empty});
    if (next !== gridState) setGridState(next);
  };

  /** Editor wiring for a section's ghost row (any column — the ghost
   * cell spans them all). */
  const ghostEditorFor = (sectionId: string) => {
    const rowId = ghostRowId(sectionId);
    return {
      editing:
        gridState.mode === 'edit' && focus.coord?.rowId === rowId
          ? {seed: gridState.editSeed}
          : null,
      onCommit: (draft: string, via: 'enter' | 'blur') =>
        handleEditorCommit({kind: 'ghost', sectionId}, draft, via),
      onCancel: handleEditorCancel,
      onDraftEmptyChange: handleGhostDraftEmpty,
    };
  };

  // One SortableContext PER SECTION (B-6 T6): items mirror the rendered rows.
  const renderFields = (fields: GridField[], indent: string) => (
    <SortableContext items={fields} strategy={verticalListSortingStrategy}>
      {fields.map((field) => {
        const editing =
          gridState.mode === 'edit' &&
          focus.coord?.rowId === field.id &&
          (focus.coord.column === 'label' || focus.coord.column === 'key')
            ? {
                column: focus.coord.column as TextCellColumn,
                seed: gridState.editSeed,
              }
            : null;
        return (
          <FieldRow
            key={field.id}
            field={field}
            indent={indent}
            selected={isSelected('field', field.id)}
            focus={focus}
            editing={editing}
            onSelect={() => onSelect({kind: 'field', id: field.id})}
            onDelete={() => onDeleteField(field)}
            deleteDisabled={pendingRowIds?.has(field.id) ?? false}
            dragLocked={isFiltering ? 'filtering' : pendingRowIds?.has(field.id) ? 'pending' : null}
            onEditorCommit={(column, draft, via) =>
              handleEditorCommit({kind: 'field', field, column}, draft, via)
            }
            onEditorCancel={handleEditorCancel}
            onToggleRequired={(isRequired) => onToggleRequired(field, isRequired)}
            onChangeType={(fieldType) => onChangeType(field, fieldType)}
            onDeepLink={(group) => onDeepLink(field, group)}
            showKeyColumn={showKeyColumn}
            showOptionsColumn={showOptionsColumn}
          />
        );
      })}
    </SortableContext>
  );

  return (
    <table
      ref={tableRef}
      role="grid"
      aria-label={t('extraction', 'gridAria')}
      className="w-full table-fixed border-collapse text-xs"
      onKeyDown={handleKeyDown}
      onFocus={handleFocusIn}
      onBlur={handleFocusOut}
      onMouseDown={handleMouseDown}
    >
      <thead>
        <tr className="h-[26px] border-b border-border/50 text-[9.5px] uppercase tracking-[0.04em] text-muted-foreground">
          <th className="w-3.5" />
          <th className="px-2 text-left font-semibold">{t('extraction', 'gridColLabel')}</th>
          {showKeyColumn && (
            <th className="px-2 text-left font-semibold">{t('extraction', 'gridColKey')}</th>
          )}
          <th className="w-[110px] px-2 text-left font-semibold">
            {t('extraction', 'gridColType')}
          </th>
          {showOptionsColumn && (
            <th className="px-2 text-left font-semibold">
              {t('extraction', 'gridColOptions')}
            </th>
          )}
          <th className="w-10 px-2 text-left font-semibold">
            {t('extraction', 'gridColRequired')}
          </th>
          <th className="w-[26px] px-2" aria-label={t('extraction', 'gridColAi')} />
          <th className="w-[34px]" aria-label={t('extraction', 'gridRowActions')} />
        </tr>
      </thead>

      {sections.map((section) => {
        const isCollapsed = collapsed.has(section.id);
        const isGroup = section.kind === 'group';
        return (
          <tbody
            key={section.id}
            // A repeating group is ONE bounded block: a single accent rule on
            // its left edge, never interior verticals (mock v3 polish).
            className={cn(
              isGroup &&
                '[&>tr>td:first-child]:border-l-2 [&>tr>td:first-child]:border-l-primary',
            )}
          >
            <SectionHeaderRow
              section={section}
              columnCount={columnCount}
              indent="pl-0"
              collapsed={isCollapsed}
              selected={isSelected('section', section.id)}
              focus={focus}
              spanCols={spanCols}
              onToggle={() => onToggleCollapse(section.id)}
              onSelect={() => onSelect({kind: 'section', id: section.id})}
              onNewField={() => openGhostEditor(section.id)}
              newFieldDisabled={isFiltering}
              actions={sectionActions}
            />
            {!isCollapsed && (
              <>
                {renderFields(
                  section.fields,
                  isGroup ? INDENT.identityField : INDENT.rootField,
                )}
                {!isFiltering && (
                  <GhostRow
                    rowId={ghostRowId(section.id)}
                    columnCount={columnCount}
                    indent={isGroup ? INDENT.identityField : INDENT.rootField}
                    label={t('extraction', 'gridNewField')}
                    focus={focus}
                    onClick={() => openGhostEditor(section.id)}
                    editor={ghostEditorFor(section.id)}
                    testId={`template-grid-add-field-${section.id}`}
                  />
                )}
                {section.children.map((child) => {
                  const childCollapsed = collapsed.has(child.id);
                  return (
                    <Fragment key={child.id}>
                      <SectionHeaderRow
                        section={child}
                        columnCount={columnCount}
                        indent={INDENT.childHeader}
                        collapsed={childCollapsed}
                        selected={isSelected('section', child.id)}
                        focus={focus}
                        spanCols={spanCols}
                        onToggle={() => onToggleCollapse(child.id)}
                        onSelect={() => onSelect({kind: 'section', id: child.id})}
                        onNewField={() => openGhostEditor(child.id)}
                        newFieldDisabled={isFiltering}
                        actions={sectionActions}
                      />
                      {!childCollapsed && (
                        <>
                          {renderFields(child.fields, INDENT.childField)}
                          {!isFiltering && (
                            <GhostRow
                              rowId={ghostRowId(child.id)}
                              columnCount={columnCount}
                              indent={INDENT.childField}
                              label={t('extraction', 'gridNewField')}
                              focus={focus}
                              onClick={() => openGhostEditor(child.id)}
                              editor={ghostEditorFor(child.id)}
                              testId={`template-grid-add-field-${child.id}`}
                            />
                          )}
                        </>
                      )}
                    </Fragment>
                  );
                })}
              </>
            )}
          </tbody>
        );
      })}

      {!isFiltering && (
        <tbody>
          <GhostRow
            rowId={ADD_SECTION_ROW_ID}
            columnCount={columnCount}
            indent="pl-2"
            label={t('extraction', 'gridNewSection')}
            focus={focus}
            onClick={onAddSection}
            testId="template-grid-add-section"
          />
        </tbody>
      )}
    </table>
  );
}
