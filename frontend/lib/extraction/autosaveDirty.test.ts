import { describe, expect, it } from 'vitest';

import { selectDirtyEntries } from './autosaveDirty';

const s = (v: unknown) => JSON.stringify(v ?? null);

describe('selectDirtyEntries', () => {
  it('skips a value equal to its server baseline (no re-record on mount)', () => {
    const values = { i1_f1: 'hello' };
    const baseline = { i1_f1: 'hello' };
    expect(selectDirtyEntries(values, {}, baseline)).toEqual([]);
  });

  it('marks a value dirty once it differs from the baseline (a real edit)', () => {
    const values = { i1_f1: 'edited' };
    const baseline = { i1_f1: 'hello' };
    expect(selectDirtyEntries(values, {}, baseline)).toEqual([['i1_f1', 'edited']]);
  });

  it('skips a value already acknowledged by a prior save', () => {
    const values = { i1_f1: 'x' };
    const lastSaved = { i1_f1: s('x') };
    expect(selectDirtyEntries(values, lastSaved, {})).toEqual([]);
  });

  it('ignores undefined (never-touched) but keeps null/empty as deliberate clears', () => {
    const values = { a_b: undefined, c_d: null, e_f: '' };
    const dirty = selectDirtyEntries(values, {}, {});
    expect(dirty.map(([k]) => k).sort()).toEqual(['c_d', 'e_f']);
  });

  it('baseline match wins even when lastSaved is empty (the bug case)', () => {
    const values = { i1_f1: { value: 'v' } };
    const baseline = { i1_f1: { value: 'v' } };
    expect(selectDirtyEntries(values, {}, baseline)).toEqual([]);
  });

  // R7: a "no information" AI proposal hydrates the QA form to null for that
  // coord AND seeds the autosave baseline from the same loaded values. On mount,
  // current === baseline === null, so it must NOT echo back a spurious `human`
  // proposal (which would pollute the audit trail + falsely mark the field
  // human-handled). null-in-both is not dirty.
  it('does not echo a hydrated no-info null on mount (R7)', () => {
    const values = { i1_f1: null };
    const baseline = { i1_f1: null };
    expect(selectDirtyEntries(values, {}, baseline)).toEqual([]);
  });

  it('still marks a newer abstention dirty when it blanks a previously-found value', () => {
    // baseline holds a found value; the user (or a newer no-info selection)
    // clears it → null differs from baseline → a deliberate clear is persisted.
    const values = { i1_f1: null };
    const baseline = { i1_f1: 'Retrospective cohort' };
    expect(selectDirtyEntries(values, {}, baseline)).toEqual([['i1_f1', null]]);
  });
});
