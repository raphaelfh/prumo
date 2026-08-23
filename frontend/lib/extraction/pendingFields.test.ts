import { describe, expect, it } from 'vitest';

import { firstFocusableControl, pickNextPending } from './pendingFields';

/** Build three sibling rows in document order and return them. */
function makeRows(): { root: HTMLElement; rows: HTMLElement[] } {
  const root = document.createElement('div');
  const rows = ['a', 'b', 'c'].map((id) => {
    const row = document.createElement('div');
    row.dataset.rowId = id;
    root.appendChild(row);
    return row;
  });
  document.body.appendChild(root);
  return { root, rows };
}

describe('pickNextPending', () => {
  it('returns null when there is nothing pending', () => {
    expect(pickNextPending([], null)).toBeNull();
  });

  it('starts at the first row when there is no anchor', () => {
    const { rows } = makeRows();
    expect(pickNextPending(rows, null)?.dataset.rowId).toBe('a');
  });

  it('advances to the row after the anchor', () => {
    const { rows } = makeRows();
    expect(pickNextPending(rows, rows[0])?.dataset.rowId).toBe('b');
  });

  it('treats an anchor INSIDE a row as that row (advances past it, not back to it)', () => {
    const { rows } = makeRows();
    const input = document.createElement('input');
    rows[0].appendChild(input);
    expect(pickNextPending(rows, input)?.dataset.rowId).toBe('b');
  });

  it('wraps to the first row once the anchor is past the last pending row', () => {
    const { rows } = makeRows();
    expect(pickNextPending(rows, rows[2])?.dataset.rowId).toBe('a');
  });

  it('skips rows that are no longer pending (anchor between two survivors)', () => {
    // Caller filters to pending rows only; the anchor may be a row that has
    // since been filled and dropped out of the list. Advancement must still
    // land on the next pending row after it, not restart from the top.
    const { rows } = makeRows();
    const stillPending = [rows[0], rows[2]];
    expect(pickNextPending(stillPending, rows[1])?.dataset.rowId).toBe('c');
  });

  it('ignores an anchor detached from the document', () => {
    const { rows } = makeRows();
    const orphan = document.createElement('div');
    expect(pickNextPending(rows, orphan)?.dataset.rowId).toBe('a');
  });
});

describe('firstFocusableControl', () => {
  it('returns the input, not a later button in the same row', () => {
    const row = document.createElement('div');
    row.innerHTML = '<input /><button type="button">No information</button>';
    expect(firstFocusableControl(row)?.tagName).toBe('INPUT');
  });

  it('falls back to a combobox trigger when the row has no native input', () => {
    const row = document.createElement('div');
    row.innerHTML = '<button type="button" role="combobox">Pick</button>';
    expect(firstFocusableControl(row)?.getAttribute('role')).toBe('combobox');
  });

  it('skips disabled controls', () => {
    const row = document.createElement('div');
    row.innerHTML = '<input disabled /><textarea></textarea>';
    expect(firstFocusableControl(row)?.tagName).toBe('TEXTAREA');
  });

  it('returns null when the row holds nothing focusable', () => {
    const row = document.createElement('div');
    row.innerHTML = '<span>plain</span>';
    expect(firstFocusableControl(row)).toBeNull();
  });
});
