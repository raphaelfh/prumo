import type {CellCoord} from './gridCellModel';

// --- Roving-focus plumbing -------------------------------------------------
//
// Every focusable cell target carries `data-cell-row` + `data-cell-cols`
// (the column positions it covers; '*' = whole row, for ghost rows whose
// single cell spans every column). The target is the cell's PRIMARY
// interactive element when it has one (label button, menu trigger,
// collapse chevron) — native Enter/Space activation then works without any
// synthetic events — and the <td> itself when the cell has none yet
// (type/required/AI cells until Tasks 3-5 make them live).
//
// This module is the shared surface every ROW component paints from:
// the resolved focus shape, the roving tabIndex helper, and the focus
// ring. The container (TemplateGrid) owns the rest of the plumbing —
// resolving coordinates from DOM targets and finding focus targets.

export interface CellFocus {
  /** Resolved roving coordinate — never a dead row (see resolveFocusCoord). */
  coord: CellCoord | null;
  /** Focus is physically inside the grid; the ring only paints then. */
  within: boolean;
}

export type CoveredCols = readonly string[] | '*';

function coversColumn(cols: CoveredCols, column: string): boolean {
  return cols === '*' || cols.includes(column);
}

function isCellAt(focus: CellFocus, rowId: string, cols: CoveredCols): boolean {
  return (
    focus.coord !== null &&
    focus.coord.rowId === rowId &&
    coversColumn(cols, focus.coord.column)
  );
}

export function rovingTabIndex(
  focus: CellFocus,
  rowId: string,
  cols: CoveredCols,
): 0 | -1 {
  return isCellAt(focus, rowId, cols) ? 0 : -1;
}

/** Same outline vocabulary as the selected-state ring, painted on the td. */
export const CELL_RING = 'outline outline-2 -outline-offset-2 outline-ring';

export function ringClass(
  focus: CellFocus,
  rowId: string,
  cols: CoveredCols,
): string | false {
  return focus.within && isCellAt(focus, rowId, cols) && CELL_RING;
}
