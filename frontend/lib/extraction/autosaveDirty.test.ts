import { describe, expect, it } from 'vitest';

import { selectDirtyEntries } from './autosaveDirty';

// Fingerprint = [value, aiLink] tuple (D0): a coord is dirty when EITHER side
// changed since the last write/baseline.
const s = (v: unknown, link: string | null = null) => JSON.stringify([v ?? null, link]);

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

  // R7 (ADR-0016): a resolved disposition hydrates the form to the FULL marker
  // envelope `{value:null, absent_reason:<code>}` and seeds the baseline from the
  // same shape. current === baseline on mount → NOT dirty (no spurious re-POST
  // that would restripe the marker coord).
  it('does not echo a hydrated full-envelope marker on mount (R7)', () => {
    const marker = { value: null, absent_reason: 'no_information' };
    const values = { i1_f1: marker };
    const baseline = { i1_f1: marker };
    expect(selectDirtyEntries(values, {}, baseline)).toEqual([]);
  });

  it('does not restripe a marker coord when an adjacent field is edited', () => {
    const marker = { value: null, absent_reason: 'no_information' };
    const values = { i1_f1: marker, i2_f2: 'edited' };
    const baseline = { i1_f1: marker, i2_f2: 'original' };
    // Only the adjacent coord is dirty; the untouched marker coord is preserved.
    expect(selectDirtyEntries(values, {}, baseline)).toEqual([['i2_f2', 'edited']]);
  });
});

describe('selectDirtyEntries — AI link awareness (D0)', () => {
  it('a link-only change on a baseline-equal value IS dirty (the adoption must be recorded)', () => {
    // Reviewer accepts an AI version whose value equals what is already
    // persisted: no value delta, but the adoption event must still write.
    const values = { i1_f1: 'hello' };
    const baseline = { i1_f1: 'hello' };
    expect(selectDirtyEntries(values, {}, baseline, { i1_f1: 'p1' }, {})).toEqual([
      ['i1_f1', 'hello'],
    ]);
  });

  it('mount state with the persisted link is NOT dirty', () => {
    // Layer-1 links hydrate baselineLink on mount — same value + same link
    // must not re-post on page load.
    const values = { i1_f1: 'hello' };
    const baseline = { i1_f1: 'hello' };
    expect(
      selectDirtyEntries(values, {}, baseline, { i1_f1: 'p1' }, { i1_f1: 'p1' }),
    ).toEqual([]);
  });

  it('a save acknowledges value+link together; a later link switch re-dirties', () => {
    const lastSaved = { i1_f1: s('x', 'p1') };
    expect(selectDirtyEntries({ i1_f1: 'x' }, lastSaved, {}, { i1_f1: 'p1' }, {})).toEqual([]);
    expect(selectDirtyEntries({ i1_f1: 'x' }, lastSaved, {}, { i1_f1: 'p2' }, {})).toEqual([
      ['i1_f1', 'x'],
    ]);
  });

  it('a session reject that severs the link re-dirties the coord', () => {
    const lastSaved = { i1_f1: s('x', 'p1') };
    expect(selectDirtyEntries({ i1_f1: 'x' }, lastSaved, {}, {}, {})).toEqual([
      ['i1_f1', 'x'],
    ]);
  });
});
