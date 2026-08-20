/**
 * Pure DOM-coordinate helpers behind TemplateGrid's roving focus
 * (extracted from TemplateGrid in B-8 T5 to hold the file-size ratchet;
 * no React state — every function maps rows/coordinates/DOM targets).
 * The grid remains the only caller; the invariant they uphold together:
 * EXACTLY ONE cell target renders tabIndex=0 while the grid has rows.
 */
import type {CellCoord, CellKind, GridRowShape} from './gridCellModel';
import {recoverFocus} from './gridCellModel';

/** Which cells edit as free text: the label/key columns of FIELD rows,
 * plus every FIELD ghost row ('ghost' — the Enter-chain). Dialog-opening
 * ghosts — the template-level add row (empty sectionId) and the
 * per-group "New per-model section" row (`inlineEditor: false`, B-8 D9)
 * — keep native button activation; section rows keep native activation
 * (rename ownership is row-local). */
export function cellKindAt(coord: CellCoord, rows: GridRowShape[]): CellKind {
  const row = rows.find((r) => r.rowId === coord.rowId);
  if (!row) return 'control';
  if (row.kind === 'ghost') {
    return row.sectionId === '' || row.inlineEditor === false ? 'control' : 'ghost';
  }
  if (row.kind !== 'field') return 'control';
  return coord.column === 'label' || coord.column === 'key' ? 'text' : 'control';
}

/** Field-row control cells whose keyboard activation the GRID interprets
 * (via the model's `activateControl` effect): the required checkbox
 * ignores a native Enter, and the ✨/Options buttons must not double-fire
 * (interpretation preventDefaults the native Enter-click). The type and
 * actions cells stay fully native — their Radix triggers own Enter. */
const INTERPRETED_CONTROL_COLUMNS = new Set(['required', 'sparkle', 'options']);

export function interpretsActivation(coord: CellCoord, rows: GridRowShape[]): boolean {
  const row = rows.find((r) => r.rowId === coord.rowId);
  return row?.kind === 'field' && INTERPRETED_CONTROL_COLUMNS.has(coord.column);
}

/** A key that types a character. Ctrl/Cmd chords are commands, never
 * seeds; Option-composed characters (pt-BR accents via dead keys are the
 * `isComposing`/'Dead' branch) still count. */
export function isPrintableKey(event: React.KeyboardEvent): boolean {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey;
}

export function targetCovers(el: HTMLElement, column: string): boolean {
  const cols = el.dataset.cellCols ?? '';
  return cols === '*' || cols.split(' ').includes(column);
}

/** Map a focused/keyed DOM element to a model coordinate, preserving the
 * current column when the target covers it (colSpan cells cover several). */
export function coordFromTarget(
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

export function findFocusTarget(
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

/** The invariant lives here: this never returns a coordinate without a
 * live row while the grid has rows, so EXACTLY ONE target renders
 * tabIndex=0 — defaulting to the first cell (the B-1 regression), and
 * recovering to the nearest surviving cell when the focused row unmounts
 * (filter change, delete). */
export function resolveFocusCoord(
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
