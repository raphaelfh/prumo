/**
 * gridCellModel — the pure, table-driven cell state machine behind the
 * B-5 Airtable cell contract (spec §2). Every keyboard/mouse rule is a
 * transition here, unit-tested BEFORE any DOM work:
 *
 *   - click focuses/selects, never edits — except CONTROL cells, which
 *     act on first click
 *   - second click / Enter / F2 / typing edits (typing replaces)
 *   - Enter commits and moves down, chaining into the ghost row;
 *     Enter on an EMPTY ghost exits the chain
 *   - Esc ladder rung 1 (cancel edit) lives here; rungs 2-3 are the
 *     dispatcher's (inspector/focus) and are signalled via 'escalate'
 *   - Tab EXITS the grid (APG grid semantics); arrows are the in-grid
 *     movement
 *   - focus recovery: when the focused coordinate unmounts (filter
 *     change, delete), focus lands on the nearest surviving cell
 *   - ⌘⇧↑/↓ (meta-or-ctrl + shift) MOVES the focused FIELD row (B-6):
 *     boundary-aware landing slots; disabled in edit mode, on
 *     section/ghost rows, and while filtering — never a rove fallback
 */
import {describe, expect, it} from 'vitest';

import {
  type CellCoord,
  type CellKind,
  type GridModelState,
  type GridRowShape,
  gridReducer,
  initialGridState,
  nextMoveSlot,
  recoverFocus,
} from '@/components/extraction/template-config/gridCellModel';

const ROWS: GridRowShape[] = [
  {rowId: 'f-1', kind: 'field', sectionId: 's-1'},
  {rowId: 'f-2', kind: 'field', sectionId: 's-1'},
  {rowId: 'ghost:s-1', kind: 'ghost', sectionId: 's-1'},
  {rowId: 'f-3', kind: 'field', sectionId: 's-2'},
  {rowId: 'ghost:s-2', kind: 'ghost', sectionId: 's-2'},
];

/** The real grid's row order: section headers, then their fields, then
 * the section's ghost — two sections, two fields each. */
const MOVE_ROWS: GridRowShape[] = [
  {rowId: 'sec:s-1', kind: 'section', sectionId: 's-1'},
  {rowId: 'f-1', kind: 'field', sectionId: 's-1'},
  {rowId: 'f-2', kind: 'field', sectionId: 's-1'},
  {rowId: 'ghost:s-1', kind: 'ghost', sectionId: 's-1'},
  {rowId: 'sec:s-2', kind: 'section', sectionId: 's-2'},
  {rowId: 'f-3', kind: 'field', sectionId: 's-2'},
  {rowId: 'f-4', kind: 'field', sectionId: 's-2'},
  {rowId: 'ghost:s-2', kind: 'ghost', sectionId: 's-2'},
];

const at = (rowId: string, column: string): CellCoord => ({rowId, column});

function focused(state: GridModelState, rowId: string, column: string) {
  expect(state.focus).toEqual(at(rowId, column));
}

describe('gridCellModel — focus vs edit', () => {
  it('click on a text cell focuses and selects, never edits', () => {
    const s = gridReducer(initialGridState, {
      type: 'click',
      coord: at('f-1', 'label'),
      cellKind: 'text',
      rows: ROWS,
    });
    focused(s, 'f-1', 'label');
    expect(s.mode).toBe('focus');
  });

  it('second click on the focused text cell edits', () => {
    let s = gridReducer(initialGridState, {
      type: 'click',
      coord: at('f-1', 'label'),
      cellKind: 'text',
      rows: ROWS,
    });
    s = gridReducer(s, {
      type: 'click',
      coord: at('f-1', 'label'),
      cellKind: 'text',
      rows: ROWS,
    });
    expect(s.mode).toBe('edit');
    expect(s.editSeed).toBeNull();
  });

  it('Enter and F2 edit the focused text cell', () => {
    for (const key of ['Enter', 'F2'] as const) {
      let s = gridReducer(initialGridState, {
        type: 'click',
        coord: at('f-1', 'label'),
        cellKind: 'text',
        rows: ROWS,
      });
      s = gridReducer(s, {type: 'key', key, cellKind: 'text', rows: ROWS});
      expect(s.mode).toBe('edit');
    }
  });

  it('typing on a focused text cell edits AND seeds the draft (typing replaces)', () => {
    let s = gridReducer(initialGridState, {
      type: 'click',
      coord: at('f-1', 'label'),
      cellKind: 'text',
      rows: ROWS,
    });
    s = gridReducer(s, {
      type: 'key',
      key: 'a',
      printable: true,
      cellKind: 'text',
      rows: ROWS,
    });
    expect(s.mode).toBe('edit');
    expect(s.editSeed).toBe('a');
  });

  it('IME/dead keys open the editor WITHOUT seeding', () => {
    let s = gridReducer(initialGridState, {
      type: 'click',
      coord: at('f-1', 'label'),
      cellKind: 'text',
      rows: ROWS,
    });
    s = gridReducer(s, {
      type: 'key',
      key: 'Dead',
      printable: true,
      composing: true,
      cellKind: 'text',
      rows: ROWS,
    });
    expect(s.mode).toBe('edit');
    expect(s.editSeed).toBeNull();
  });

  it('control cells act on FIRST click (no edit mode)', () => {
    const s = gridReducer(initialGridState, {
      type: 'click',
      coord: at('f-1', 'required'),
      cellKind: 'control',
      rows: ROWS,
    });
    focused(s, 'f-1', 'required');
    expect(s.mode).toBe('focus');
    expect(s.effects).toContainEqual({kind: 'activateControl', coord: at('f-1', 'required')});
  });
});

describe('gridCellModel — commit and movement', () => {
  it('Enter in edit mode commits and moves focus DOWN', () => {
    let s = gridReducer(initialGridState, {
      type: 'click',
      coord: at('f-1', 'label'),
      cellKind: 'text',
      rows: ROWS,
    });
    s = gridReducer(s, {type: 'key', key: 'Enter', cellKind: 'text', rows: ROWS});
    s = gridReducer(s, {type: 'key', key: 'Enter', cellKind: 'text', rows: ROWS});
    expect(s.effects).toContainEqual({kind: 'commit', coord: at('f-1', 'label')});
    expect(s.mode).toBe('focus');
    focused(s, 'f-2', 'label');
  });

  it('Enter chains THROUGH the ghost row: committing the last field lands on the ghost in edit mode', () => {
    let s = gridReducer(initialGridState, {
      type: 'click',
      coord: at('f-2', 'label'),
      cellKind: 'text',
      rows: ROWS,
    });
    s = gridReducer(s, {type: 'key', key: 'Enter', cellKind: 'text', rows: ROWS});
    s = gridReducer(s, {type: 'key', key: 'Enter', cellKind: 'text', rows: ROWS});
    focused(s, 'ghost:s-1', 'label');
    expect(s.mode).toBe('edit');
  });

  it('Enter on an EMPTY ghost exits the chain (focus mode, no commit effect)', () => {
    let s: GridModelState = {
      ...initialGridState,
      focus: at('ghost:s-1', 'label'),
      mode: 'edit',
      ghostDraftEmpty: true,
    };
    s = gridReducer(s, {type: 'key', key: 'Enter', cellKind: 'ghost', rows: ROWS});
    expect(s.mode).toBe('focus');
    expect(s.effects.filter((e) => e.kind === 'commit')).toHaveLength(0);
  });

  it('arrows rove in focus mode', () => {
    let s = gridReducer(initialGridState, {
      type: 'click',
      coord: at('f-1', 'label'),
      cellKind: 'text',
      rows: ROWS,
    });
    s = gridReducer(s, {type: 'key', key: 'ArrowDown', cellKind: 'text', rows: ROWS});
    focused(s, 'f-2', 'label');
    s = gridReducer(s, {type: 'key', key: 'ArrowRight', cellKind: 'text', rows: ROWS});
    focused(s, 'f-2', 'type');
    s = gridReducer(s, {type: 'key', key: 'ArrowLeft', cellKind: 'text', rows: ROWS});
    focused(s, 'f-2', 'label');
    s = gridReducer(s, {type: 'key', key: 'ArrowUp', cellKind: 'text', rows: ROWS});
    focused(s, 'f-1', 'label');
  });

  it('Tab EXITS the grid (APG): signals exit, does not move horizontally', () => {
    let s = gridReducer(initialGridState, {
      type: 'click',
      coord: at('f-1', 'label'),
      cellKind: 'text',
      rows: ROWS,
    });
    s = gridReducer(s, {type: 'key', key: 'Tab', cellKind: 'text', rows: ROWS});
    expect(s.effects).toContainEqual({kind: 'exitGrid'});
  });
});

describe('gridCellModel — Esc ladder rung 1 + escalation', () => {
  it('Esc in edit mode cancels the edit (rung 1), keeping focus', () => {
    let s = gridReducer(initialGridState, {
      type: 'click',
      coord: at('f-1', 'label'),
      cellKind: 'text',
      rows: ROWS,
    });
    s = gridReducer(s, {type: 'key', key: 'Enter', cellKind: 'text', rows: ROWS});
    s = gridReducer(s, {type: 'key', key: 'Escape', cellKind: 'text', rows: ROWS});
    expect(s.mode).toBe('focus');
    focused(s, 'f-1', 'label');
    expect(s.effects).toContainEqual({kind: 'cancelEdit', coord: at('f-1', 'label')});
  });

  it('Esc in focus mode escalates to the dispatcher (rungs 2-3)', () => {
    let s = gridReducer(initialGridState, {
      type: 'click',
      coord: at('f-1', 'label'),
      cellKind: 'text',
      rows: ROWS,
    });
    s = gridReducer(s, {type: 'key', key: 'Escape', cellKind: 'text', rows: ROWS});
    expect(s.effects).toContainEqual({kind: 'escalateEsc'});
  });
});

describe('gridCellModel — ghost transitions (Task 4: the Enter-chain)', () => {
  it('click on a field ghost opens its editor IMMEDIATELY (an affordance, not a data cell)', () => {
    const s = gridReducer(initialGridState, {
      type: 'click',
      coord: at('ghost:s-1', 'label'),
      cellKind: 'ghost',
      rows: ROWS,
    });
    focused(s, 'ghost:s-1', 'label');
    expect(s.mode).toBe('edit');
    expect(s.editSeed).toBeNull();
    expect(s.ghostDraftEmpty).toBe(true);
  });

  it('Enter on a NON-empty ghost commits and REOPENS the same ghost empty (the chain)', () => {
    let s: GridModelState = {
      ...initialGridState,
      focus: at('ghost:s-1', 'label'),
      mode: 'edit',
      ghostDraftEmpty: false,
    };
    s = gridReducer(s, {type: 'key', key: 'Enter', cellKind: 'ghost', rows: ROWS});
    expect(s.effects).toContainEqual({kind: 'commit', coord: at('ghost:s-1', 'label')});
    focused(s, 'ghost:s-1', 'label');
    expect(s.mode).toBe('edit');
    expect(s.ghostDraftEmpty).toBe(true);
  });

  it('typing on a focused ghost seeds the editor and marks the draft NON-empty', () => {
    let s = gridReducer(initialGridState, {
      type: 'focusSync',
      coord: at('ghost:s-1', 'label'),
    });
    s = gridReducer(s, {
      type: 'key',
      key: 'p',
      printable: true,
      cellKind: 'ghost',
      rows: ROWS,
    });
    expect(s.mode).toBe('edit');
    expect(s.editSeed).toBe('p');
    expect(s.ghostDraftEmpty).toBe(false);
  });

  it('Enter on a focused ghost opens the editor with an EMPTY draft', () => {
    let s = gridReducer(initialGridState, {
      type: 'focusSync',
      coord: at('ghost:s-1', 'label'),
    });
    // A previous chain may have left ghostDraftEmpty false.
    s = {...s, ghostDraftEmpty: false};
    s = gridReducer(s, {type: 'key', key: 'Enter', cellKind: 'ghost', rows: ROWS});
    expect(s.mode).toBe('edit');
    expect(s.editSeed).toBeNull();
    expect(s.ghostDraftEmpty).toBe(true);
  });

  it('a field commit landing on the ADD-SECTION ghost does NOT open an editor', () => {
    const rows: GridRowShape[] = [
      {rowId: 'f-9', kind: 'field', sectionId: 's-9'},
      {rowId: 'ghost:template', kind: 'ghost', sectionId: ''},
    ];
    let s: GridModelState = {
      ...initialGridState,
      focus: at('f-9', 'label'),
      mode: 'edit',
    };
    s = gridReducer(s, {type: 'key', key: 'Enter', cellKind: 'text', rows});
    focused(s, 'ghost:template', 'label');
    expect(s.mode).toBe('focus');
  });

  it('setGhostDraftEmpty is identity when the flag is unchanged (no per-keystroke churn)', () => {
    const s = gridReducer(initialGridState, {
      type: 'setGhostDraftEmpty',
      empty: true,
    });
    expect(s).toBe(initialGridState);
  });
});

describe('gridCellModel — blurCommit (editor lost focus to the world)', () => {
  it('commits in edit mode WITHOUT moving focus — the blur already decided where focus goes', () => {
    let s = gridReducer(initialGridState, {
      type: 'click',
      coord: at('f-1', 'label'),
      cellKind: 'text',
      rows: ROWS,
    });
    s = gridReducer(s, {type: 'key', key: 'Enter', cellKind: 'text', rows: ROWS});
    expect(s.mode).toBe('edit');
    s = gridReducer(s, {type: 'blurCommit'});
    expect(s.mode).toBe('focus');
    focused(s, 'f-1', 'label');
    expect(s.effects).toContainEqual({kind: 'commit', coord: at('f-1', 'label')});
  });

  it('is a no-op in focus mode (no stray commit)', () => {
    let s = gridReducer(initialGridState, {
      type: 'click',
      coord: at('f-1', 'label'),
      cellKind: 'text',
      rows: ROWS,
    });
    s = gridReducer(s, {type: 'blurCommit'});
    expect(s.mode).toBe('focus');
    expect(s.effects).toEqual([]);
  });
});

describe('gridCellModel — focusSync (focus moved by other means)', () => {
  it('adopts the coordinate without emitting effects', () => {
    const s = gridReducer(initialGridState, {
      type: 'focusSync',
      coord: at('f-2', 'actions'),
    });
    focused(s, 'f-2', 'actions');
    expect(s.mode).toBe('focus');
    expect(s.effects).toEqual([]);
  });

  it('is identity on the already-focused coordinate (no re-render churn)', () => {
    const one = gridReducer(initialGridState, {
      type: 'focusSync',
      coord: at('f-1', 'label'),
    });
    const two = gridReducer(one, {type: 'focusSync', coord: at('f-1', 'label')});
    expect(two).toBe(one);
  });

  it('lands in focus mode when focus moves to ANOTHER cell mid-edit (blur must commit first — Task 3 contract)', () => {
    let s = gridReducer(initialGridState, {
      type: 'click',
      coord: at('f-1', 'label'),
      cellKind: 'text',
      rows: ROWS,
    });
    s = gridReducer(s, {type: 'key', key: 'Enter', cellKind: 'text', rows: ROWS});
    expect(s.mode).toBe('edit');
    s = gridReducer(s, {type: 'focusSync', coord: at('f-2', 'label')});
    expect(s.mode).toBe('focus');
    focused(s, 'f-2', 'label');
  });
});

describe('gridCellModel — keyboard move chord (B-6 T2)', () => {
  const focusOn = (rowId: string): GridModelState =>
    gridReducer(initialGridState, {type: 'focusSync', coord: at(rowId, 'label')});

  const chord = (
    s: GridModelState,
    key: 'ArrowUp' | 'ArrowDown',
    extra?: {filtering?: boolean; cellKind?: CellKind},
  ): GridModelState =>
    gridReducer(s, {
      type: 'key',
      key,
      meta: true,
      shift: true,
      filtering: extra?.filtering,
      cellKind: extra?.cellKind ?? 'text',
      rows: MOVE_ROWS,
    });

  it('⌘⇧↓ within a section swaps with the next field sibling', () => {
    const s = chord(focusOn('f-1'), 'ArrowDown');
    expect(s.effects).toEqual([
      {kind: 'moveRow', fieldRowId: 'f-1', toSectionId: 's-1', toIndex: 1},
    ]);
    // Focus follows the moved row: same coordinate, the DOM re-renders it.
    focused(s, 'f-1', 'label');
    expect(s.mode).toBe('focus');
  });

  it('⌘⇧↑ within a section swaps with the previous field sibling', () => {
    const s = chord(focusOn('f-2'), 'ArrowUp');
    expect(s.effects).toEqual([
      {kind: 'moveRow', fieldRowId: 'f-2', toSectionId: 's-1', toIndex: 0},
    ]);
    focused(s, 'f-2', 'label');
  });

  it("⌘⇧↓ from a section's LAST field targets the NEXT section's FIRST slot (ghost skipped)", () => {
    const s = chord(focusOn('f-2'), 'ArrowDown');
    expect(s.effects).toEqual([
      {kind: 'moveRow', fieldRowId: 'f-2', toSectionId: 's-2', toIndex: 0},
    ]);
    focused(s, 'f-2', 'label');
  });

  it("⌘⇧↑ from a section's FIRST field targets the END of the previous section (header + ghost skipped)", () => {
    const s = chord(focusOn('f-3'), 'ArrowUp');
    expect(s.effects).toEqual([
      {kind: 'moveRow', fieldRowId: 'f-3', toSectionId: 's-1', toIndex: 2},
    ]);
    focused(s, 'f-3', 'label');
  });

  it("⌘⇧↑ on the template's first field is a NO-OP (no effect, focus kept)", () => {
    const s = chord(focusOn('f-1'), 'ArrowUp');
    expect(s.effects).toEqual([]);
    focused(s, 'f-1', 'label');
  });

  it("⌘⇧↓ on the template's last field is a NO-OP", () => {
    const s = chord(focusOn('f-4'), 'ArrowDown');
    expect(s.effects).toEqual([]);
    focused(s, 'f-4', 'label');
  });

  it('never fires in EDIT mode (the editor owns the keys)', () => {
    let s = focusOn('f-1');
    s = gridReducer(s, {type: 'key', key: 'Enter', cellKind: 'text', rows: MOVE_ROWS});
    expect(s.mode).toBe('edit');
    s = gridReducer(s, {
      type: 'key',
      key: 'ArrowDown',
      meta: true,
      shift: true,
      cellKind: 'text',
      rows: MOVE_ROWS,
    });
    expect(s.effects).toEqual([]);
    expect(s.mode).toBe('edit');
    focused(s, 'f-1', 'label');
  });

  it('on a SECTION row it neither moves nor roves', () => {
    const s = chord(focusOn('sec:s-2'), 'ArrowDown');
    expect(s.effects).toEqual([]);
    focused(s, 'sec:s-2', 'label');
  });

  it('on a GHOST row it neither moves nor roves', () => {
    const s = chord(focusOn('ghost:s-1'), 'ArrowDown', {cellKind: 'ghost'});
    expect(s.effects).toEqual([]);
    focused(s, 'ghost:s-1', 'label');
  });

  it('is disabled while FILTERING (visible indices ≠ true indices — panel decision 4)', () => {
    const s = chord(focusOn('f-1'), 'ArrowDown', {filtering: true});
    expect(s.effects).toEqual([]);
    focused(s, 'f-1', 'label');
  });

  it('plain arrows (no modifiers) still rove, never move', () => {
    const s = gridReducer(focusOn('f-1'), {
      type: 'key',
      key: 'ArrowDown',
      cellKind: 'text',
      rows: MOVE_ROWS,
    });
    expect(s.effects).toEqual([]);
    focused(s, 'f-2', 'label');
  });

  it('a single-modifier arrow (shift only / meta only) roves, never moves', () => {
    const shiftOnly = gridReducer(focusOn('f-1'), {
      type: 'key',
      key: 'ArrowDown',
      shift: true,
      cellKind: 'text',
      rows: MOVE_ROWS,
    });
    expect(shiftOnly.effects).toEqual([]);
    focused(shiftOnly, 'f-2', 'label');
    const metaOnly = gridReducer(focusOn('f-1'), {
      type: 'key',
      key: 'ArrowDown',
      meta: true,
      cellKind: 'text',
      rows: MOVE_ROWS,
    });
    expect(metaOnly.effects).toEqual([]);
    focused(metaOnly, 'f-2', 'label');
  });
});

describe('gridCellModel — nextMoveSlot (boundary-aware slot helper)', () => {
  it('down within a section targets the next field slot (currentIndex+1)', () => {
    expect(nextMoveSlot(MOVE_ROWS, 'f-1', 1)).toEqual({toSectionId: 's-1', toIndex: 1});
  });

  it('up within a section targets the previous field slot (currentIndex-1)', () => {
    expect(nextMoveSlot(MOVE_ROWS, 'f-4', -1)).toEqual({toSectionId: 's-2', toIndex: 0});
  });

  it('is null at the template edges (first field up, last field down)', () => {
    expect(nextMoveSlot(MOVE_ROWS, 'f-1', -1)).toBeNull();
    expect(nextMoveSlot(MOVE_ROWS, 'f-4', 1)).toBeNull();
  });

  it('is null for section rows, ghost rows, and unknown ids', () => {
    expect(nextMoveSlot(MOVE_ROWS, 'sec:s-1', 1)).toBeNull();
    expect(nextMoveSlot(MOVE_ROWS, 'ghost:s-1', 1)).toBeNull();
    expect(nextMoveSlot(MOVE_ROWS, 'nope', 1)).toBeNull();
  });

  it('cross-boundary up-then-down is a symmetric inverse (returns to the origin slot)', () => {
    // f-3 is the FIRST field of s-2: up → END of s-1 (2 fields → slot 2).
    expect(nextMoveSlot(MOVE_ROWS, 'f-3', -1)).toEqual({toSectionId: 's-1', toIndex: 2});
    // Rows AFTER that move (f-3 now the LAST field of s-1)…
    const afterUp: GridRowShape[] = [
      {rowId: 'sec:s-1', kind: 'section', sectionId: 's-1'},
      {rowId: 'f-1', kind: 'field', sectionId: 's-1'},
      {rowId: 'f-2', kind: 'field', sectionId: 's-1'},
      {rowId: 'f-3', kind: 'field', sectionId: 's-1'},
      {rowId: 'ghost:s-1', kind: 'ghost', sectionId: 's-1'},
      {rowId: 'sec:s-2', kind: 'section', sectionId: 's-2'},
      {rowId: 'f-4', kind: 'field', sectionId: 's-2'},
      {rowId: 'ghost:s-2', kind: 'ghost', sectionId: 's-2'},
    ];
    // …down: last field of s-1 → FIRST slot of s-2 — back where it began.
    expect(nextMoveSlot(afterUp, 'f-3', 1)).toEqual({toSectionId: 's-2', toIndex: 0});
  });
});

describe('gridCellModel — focus recovery', () => {
  it("recovers to the dead row's section ghost when it survives", () => {
    const surviving = ROWS.filter((r) => r.rowId !== 'f-2');
    const next = recoverFocus(at('f-2', 'label'), 's-1', surviving);
    expect(next).toEqual(at('ghost:s-1', 'label'));
  });

  it('falls back to the first row when the section has no survivors', () => {
    const next = recoverFocus(at('ghost:s-2', 'label'), 's-2', ROWS.slice(0, 1));
    expect(next).toEqual(at('f-1', 'label'));
  });

  it('returns null on an empty grid', () => {
    expect(recoverFocus(at('f-1', 'label'), 's-1', [])).toBeNull();
  });
});
