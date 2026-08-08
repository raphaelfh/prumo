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
 */
import {describe, expect, it} from 'vitest';

import {
  type CellCoord,
  type GridModelState,
  type GridRowShape,
  gridReducer,
  initialGridState,
  recoverFocus,
} from '@/components/extraction/template-config/gridCellModel';

const ROWS: GridRowShape[] = [
  {rowId: 'f-1', kind: 'field', sectionId: 's-1'},
  {rowId: 'f-2', kind: 'field', sectionId: 's-1'},
  {rowId: 'ghost:s-1', kind: 'ghost', sectionId: 's-1'},
  {rowId: 'f-3', kind: 'field', sectionId: 's-2'},
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
