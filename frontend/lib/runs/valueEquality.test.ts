import {describe, expect, it} from 'vitest';

import {decisionMatchesVersion, stableStringify} from '@/lib/runs/valueEquality';

describe('stableStringify', () => {
  it('is key-order independent', () => {
    expect(stableStringify({a: 1, b: 2})).toBe(stableStringify({b: 2, a: 1}));
  });

  it('keeps the undefined-leaf guard: undefined stringifies like null', () => {
    expect(stableStringify({a: undefined})).toBe(stableStringify({a: null}));
  });
});

describe('decisionMatchesVersion', () => {
  it('matches a plain decision envelope against the raw version value', () => {
    expect(
      decisionMatchesVersion({value: 'Retrospective cohort'}, 'Retrospective cohort'),
    ).toBe(true);
    expect(decisionMatchesVersion({value: 'edited text'}, 'Retrospective cohort')).toBe(false);
  });

  it('matches a unit envelope against the raw unit object', () => {
    expect(
      decisionMatchesVersion({value: {value: 5, unit: 'mg'}}, {value: 5, unit: 'mg'}),
    ).toBe(true);
  });

  it('matches an absent_reason marker on both sides', () => {
    const marker = {value: null, absent_reason: 'no_information'};
    expect(decisionMatchesVersion(marker, marker)).toBe(true);
    expect(decisionMatchesVersion({value: 'x'}, marker)).toBe(false);
  });

  it('never matches a null decision envelope', () => {
    expect(decisionMatchesVersion(null, 'x')).toBe(false);
  });

  it("treats a legacy '' version as the written null (verbatim adoption stays Adopted)", () => {
    // The suggestion read path coerces a legacy bare-null proposal to '',
    // while the write path normalizes '' → null before enveloping.
    expect(decisionMatchesVersion({value: null}, '')).toBe(true);
  });
});
