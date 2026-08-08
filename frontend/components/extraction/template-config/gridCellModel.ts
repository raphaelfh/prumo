/**
 * Pure, table-driven cell state machine for the B-5 Airtable cell
 * contract (spec §2). No React, no DOM: components dispatch events and
 * interpret the returned `effects` (commit/cancel/activate/exit/
 * escalate) — which keeps the whole keyboard/mouse contract
 * unit-testable and the React layer compiler-safe (all imperative focus
 * happens in event handlers reading `state.focus`).
 *
 * Esc ladder: rung 1 (cancel edit) is resolved HERE; rungs 2-3 (close
 * inspector with focus-return, clear focus/search) belong to the
 * panel's central dispatcher, signalled via the `escalateEsc` effect.
 *
 * Tab deliberately EXITS the grid (APG grid semantics — one tab stop);
 * arrows are the in-grid movement.
 */

export interface CellCoord {
  rowId: string;
  column: string;
}

export type CellKind = 'text' | 'control' | 'ghost';

export interface GridRowShape {
  rowId: string;
  /** 'section' rows (headers) rove like field rows; only 'ghost' is
   * special-cased (Enter-chain opens it in edit mode). */
  kind: 'field' | 'ghost' | 'section';
  sectionId: string;
}

export type GridEffect =
  | {kind: 'commit'; coord: CellCoord}
  | {kind: 'cancelEdit'; coord: CellCoord}
  | {kind: 'activateControl'; coord: CellCoord}
  | {kind: 'exitGrid'}
  | {kind: 'escalateEsc'};

export interface GridModelState {
  focus: CellCoord | null;
  mode: 'focus' | 'edit';
  /** Seed for typing-replaces: the printable key that OPENED the editor
   * (null for Enter/F2/second-click and for IME/dead-key openings). */
  editSeed: string | null;
  /** Whether the ghost editor currently holds no typed content — Enter
   * on an empty ghost EXITS the chain instead of committing. Owned by
   * the ghost editor via the `setGhostDraftEmpty` action. */
  ghostDraftEmpty: boolean;
  /** Effects of the LAST transition only (cleared on every dispatch). */
  effects: GridEffect[];
}

export const initialGridState: GridModelState = {
  focus: null,
  mode: 'focus',
  editSeed: null,
  ghostDraftEmpty: true,
  effects: [],
};

/** Always-visible column order for horizontal roving. Optional columns
 * (key/options) are spliced in by the grid when displayed. */
export const GRID_COLUMNS = ['label', 'type', 'required', 'sparkle', 'actions'] as const;

export type GridEvent =
  | {type: 'click'; coord: CellCoord; cellKind: CellKind; rows: GridRowShape[]}
  | {
      type: 'key';
      key: string;
      printable?: boolean;
      composing?: boolean;
      cellKind: CellKind;
      rows: GridRowShape[];
      columns?: readonly string[];
    }
  | {type: 'setGhostDraftEmpty'; empty: boolean}
  /** The editor lost focus to the world (click elsewhere, Tab): commit
   * WITHOUT moving the coordinate — the blur already decided where focus
   * goes, and the commit must land BEFORE any cross-cell focusSync. A
   * no-op in focus mode, so a stray blur can never double-commit. */
  | {type: 'blurCommit'}
  /** Focus moved by OTHER means (mouse click on an inner control, Radix
   * menu close refocusing its trigger): the coordinate must follow. A
   * same-cell sync is identity — the editor input taking focus must not
   * kick the model out of edit mode; a cross-cell sync lands in focus
   * mode (the editor commits on blur BEFORE the sync — Task 3). */
  | {type: 'focusSync'; coord: CellCoord};

function sameCoord(a: CellCoord | null, b: CellCoord): boolean {
  return a !== null && a.rowId === b.rowId && a.column === b.column;
}

function rowIndex(rows: GridRowShape[], rowId: string): number {
  return rows.findIndex((r) => r.rowId === rowId);
}

function moveVertical(
  state: GridModelState,
  rows: GridRowShape[],
  delta: 1 | -1,
): GridModelState {
  if (!state.focus) return state;
  const idx = rowIndex(rows, state.focus.rowId);
  if (idx < 0) return state;
  const next = rows[idx + delta];
  if (!next) return state;
  return {...state, focus: {rowId: next.rowId, column: state.focus.column}};
}

function moveHorizontal(
  state: GridModelState,
  columns: readonly string[],
  delta: 1 | -1,
): GridModelState {
  if (!state.focus) return state;
  const idx = columns.indexOf(state.focus.column);
  if (idx < 0) return state;
  const next = columns[idx + delta];
  if (!next) return state;
  return {...state, focus: {rowId: state.focus.rowId, column: next}};
}

/** Commit the current edit, then advance DOWN in the same column —
 * chaining into a ghost row (which opens in edit mode) when the next
 * row is one. */
function commitAndAdvance(state: GridModelState, rows: GridRowShape[]): GridModelState {
  if (!state.focus) return state;
  const effects: GridEffect[] = [{kind: 'commit', coord: state.focus}];
  const idx = rowIndex(rows, state.focus.rowId);
  const next = idx >= 0 ? rows[idx + 1] : undefined;
  if (!next) {
    return {...state, mode: 'focus', editSeed: null, effects};
  }
  const focus = {rowId: next.rowId, column: state.focus.column};
  if (next.kind === 'ghost') {
    return {...state, focus, mode: 'edit', editSeed: null, ghostDraftEmpty: true, effects};
  }
  return {...state, focus, mode: 'focus', editSeed: null, effects};
}

export function gridReducer(state: GridModelState, event: GridEvent): GridModelState {
  const base: GridModelState = {...state, effects: []};

  if (event.type === 'setGhostDraftEmpty') {
    return {...base, ghostDraftEmpty: event.empty};
  }

  if (event.type === 'blurCommit') {
    if (state.mode !== 'edit' || !state.focus) return base;
    return {
      ...base,
      mode: 'focus',
      editSeed: null,
      effects: [{kind: 'commit', coord: state.focus}],
    };
  }

  if (event.type === 'focusSync') {
    if (sameCoord(state.focus, event.coord)) return state;
    return {...base, focus: event.coord, mode: 'focus', editSeed: null};
  }

  if (event.type === 'click') {
    if (event.cellKind === 'control') {
      return {
        ...base,
        focus: event.coord,
        mode: 'focus',
        editSeed: null,
        effects: [{kind: 'activateControl', coord: event.coord}],
      };
    }
    // Second click on the already-focused text cell edits; first click
    // only focuses/selects.
    if (sameCoord(state.focus, event.coord) && state.mode === 'focus') {
      return {...base, focus: event.coord, mode: 'edit', editSeed: null};
    }
    return {...base, focus: event.coord, mode: 'focus', editSeed: null};
  }

  // event.type === 'key'
  const columns = event.columns ?? GRID_COLUMNS;

  if (state.mode === 'edit') {
    if (event.key === 'Escape') {
      return {
        ...base,
        mode: 'focus',
        editSeed: null,
        effects: state.focus ? [{kind: 'cancelEdit', coord: state.focus}] : [],
      };
    }
    if (event.key === 'Enter') {
      if (event.cellKind === 'ghost' && state.ghostDraftEmpty) {
        // Empty ghost: exit the chain — no commit, stay focused.
        return {...base, mode: 'focus', editSeed: null};
      }
      return commitAndAdvance(base, event.rows);
    }
    // Everything else is the editor's own input.
    return base;
  }

  // mode === 'focus'
  switch (event.key) {
    case 'Enter':
    case 'F2':
      if (event.cellKind === 'control') {
        return {
          ...base,
          effects: state.focus ? [{kind: 'activateControl', coord: state.focus}] : [],
        };
      }
      return {...base, mode: 'edit', editSeed: null};
    case 'Escape':
      return {...base, effects: [{kind: 'escalateEsc'}]};
    case 'Tab':
      return {...base, effects: [{kind: 'exitGrid'}]};
    case 'ArrowDown':
      return moveVertical(base, event.rows, 1);
    case 'ArrowUp':
      return moveVertical(base, event.rows, -1);
    case 'ArrowRight':
      return moveHorizontal(base, columns, 1);
    case 'ArrowLeft':
      return moveHorizontal(base, columns, -1);
    default:
      if (
        event.printable &&
        event.cellKind !== 'control' &&
        !event.composing &&
        event.key !== 'Dead' &&
        event.key.length === 1
      ) {
        // Typing replaces: open the editor seeded with the typed key.
        return {...base, mode: 'edit', editSeed: event.key};
      }
      if (event.printable && event.cellKind !== 'control') {
        // IME/dead-key composition: open WITHOUT seeding (the composed
        // character would be lost — fall back to focus-then-edit).
        return {...base, mode: 'edit', editSeed: null};
      }
      return base;
  }
}

/**
 * Where focus lands when the focused row unmounts (filter change,
 * delete, committed-away): the SAME SECTION's ghost row if it survives
 * (the natural landing — the user can keep adding), else the section's
 * first surviving row, else the first row of the grid, else null.
 */
export function recoverFocus(
  dead: CellCoord,
  deadSectionId: string | null,
  survivingRows: GridRowShape[],
): CellCoord | null {
  if (survivingRows.length === 0) return null;
  if (deadSectionId) {
    const ghost = survivingRows.find(
      (r) => r.sectionId === deadSectionId && r.kind === 'ghost',
    );
    if (ghost) return {rowId: ghost.rowId, column: dead.column};
    const sameSection = survivingRows.find((r) => r.sectionId === deadSectionId);
    if (sameSection) return {rowId: sameSection.rowId, column: dead.column};
  }
  return {rowId: survivingRows[0].rowId, column: dead.column};
}
