/**
 * Locating the required fields a reviewer has not answered yet.
 *
 * A field row stamps `data-pending-required` when the field is required AND its
 * value is empty by the shared oracle (`isValueEmpty` — see `valueSemantics`),
 * which is the same predicate `computeRequiredFieldProgress` counts with. That
 * shared oracle is the whole point: the per-field accent and the
 * "N required left" counter are derived from one definition of "unanswered", so
 * they cannot drift apart, and a resolved ADR-0016 `absent_reason` marker is
 * treated as answered by both instead of nagging forever.
 *
 * The attribute is also the contract between the accent (`FieldInput`) and the
 * "go to next unfilled" affordance (`SectionNavRail` → `useJumpToNextPendingField`):
 * the jump walks the *rendered* rows in document order rather than re-deriving
 * the coordinate list, so it can never point at a row that is not on screen.
 */

export const PENDING_REQUIRED_ATTR = 'data-pending-required';
export const PENDING_REQUIRED_SELECTOR = `[${PENDING_REQUIRED_ATTR}]`;

/**
 * Ordered by how a field row is built: the value control comes before the
 * History icon and the disposition buttons, so a plain document-order query
 * lands on the input the user actually needs to type into.
 */
const FOCUSABLE_SELECTOR = [
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'button:not([disabled])',
].join(',');

/**
 * The next pending row after `anchor` in document order, wrapping to the first.
 *
 * `rows` is the *current* pending set, so a row the user just filled has already
 * dropped out of it — passing that now-filled row as the anchor still advances
 * correctly, which is what makes repeated clicks walk the form instead of
 * bouncing between two fields. A detached anchor (its row was unmounted) is
 * ignored and the walk restarts from the top.
 */
export function pickNextPending(rows: HTMLElement[], anchor: Node | null): HTMLElement | null {
  if (rows.length === 0) return null;
  if (anchor?.isConnected) {
    for (const row of rows) {
      // Bit set ⇔ `anchor` precedes `row`. A row that *contains* the anchor
      // reports CONTAINED_BY|FOLLOWING instead, so the current row is skipped
      // rather than returned to itself.
      if (row.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_PRECEDING) return row;
    }
  }
  return rows[0];
}

/** The first enabled control inside a field row, or null when the row has none. */
export function firstFocusableControl(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
}
