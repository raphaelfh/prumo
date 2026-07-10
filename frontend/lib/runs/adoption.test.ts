import {describe, expect, it} from 'vitest';

import {adoptionWording, buildPeerAdoptionMap} from '@/lib/runs/adoption';
import type {ReviewerDecisionResponse} from '@/hooks/runs/types';

const dec = (over: Partial<ReviewerDecisionResponse>): ReviewerDecisionResponse => ({
  id: 'd1',
  run_id: 'r',
  instance_id: 'i1',
  field_id: 'f1',
  reviewer_id: 'alice',
  decision: 'edit',
  proposal_record_id: null,
  value: {value: 'x'},
  rationale: null,
  created_at: '2026-07-09T00:00:00Z',
  ...over,
});

describe('adoptionWording', () => {
  it('accept_proposal is always Adopted (value=null by contract)', () => {
    expect(adoptionWording('accept_proposal', null, {value: 'anything'})).toBe('adopted');
  });

  it('a linked edit whose value MATCHES the version reads Adopted', () => {
    expect(adoptionWording('edit', {value: 'blue'}, {value: 'blue'})).toBe('adopted');
  });

  it('a linked edit whose value DIFFERS from the version reads Edited', () => {
    expect(adoptionWording('edit', {value: 'green'}, {value: 'blue'})).toBe('edited');
  });

  it('an adopted abstention (marker == marker) reads Adopted', () => {
    const marker = {value: null, absent_reason: 'no_information'};
    expect(adoptionWording('edit', marker, {value: marker})).toBe('adopted');
  });

  it('fails closed to Adopted when the linked version is outside the loaded window (undefined)', () => {
    // The stale-link case (spec D5): a reopened run whose linked version fell
    // out of the 50-deep history must render link-only "Adopted by", never a
    // fabricated "Edited by" from comparing against an absent value.
    expect(adoptionWording('edit', {value: 'green'}, undefined)).toBe('adopted');
  });
});

describe('buildPeerAdoptionMap', () => {
  const labels = {alice: 'Alice', bruno: 'Bruno', me: 'You'};

  it('keys marks on the append-only link only — value coincidence never mints one', () => {
    const out = buildPeerAdoptionMap(
      [
        // linked → a mark
        dec({reviewer_id: 'alice', proposal_record_id: 'p1', value: {value: 'x'}}),
        // NO link but identical value → must NOT create a mark (fabrication guard)
        dec({reviewer_id: 'bruno', proposal_record_id: null, value: {value: 'x'}}),
      ],
      labels,
    );
    expect(Object.keys(out)).toEqual(['p1']);
    expect(out.p1).toEqual([{reviewerLabel: 'Alice', decisionValue: {value: 'x'}, decisionKind: 'edit'}]);
  });

  it('hard-suppresses an independent no-information marker with no link', () => {
    const marker = {value: null, absent_reason: 'no_information'};
    const out = buildPeerAdoptionMap(
      [dec({reviewer_id: 'bruno', proposal_record_id: null, value: marker})],
      labels,
    );
    expect(out).toEqual({});
  });

  it('drops rejects and null-links', () => {
    const out = buildPeerAdoptionMap(
      [
        dec({reviewer_id: 'alice', proposal_record_id: 'p1', decision: 'reject'}),
        dec({reviewer_id: 'bruno', proposal_record_id: null}),
      ],
      labels,
    );
    expect(out).toEqual({});
  });

  it('excludeReviewerId drops that reviewer (per-cell: own mark is the pinned chip)', () => {
    const out = buildPeerAdoptionMap(
      [
        dec({reviewer_id: 'alice', proposal_record_id: 'p1'}),
        dec({reviewer_id: 'bruno', proposal_record_id: 'p1'}),
      ],
      labels,
      {excludeReviewerId: 'alice'},
    );
    expect(out.p1.map((m) => m.reviewerLabel)).toEqual(['Bruno']);
  });

  it('onlyReviewerId keeps just self and drops peers (blind defense-in-depth)', () => {
    const out = buildPeerAdoptionMap(
      [
        dec({reviewer_id: 'me', proposal_record_id: 'p1'}),
        dec({reviewer_id: 'alice', proposal_record_id: 'p1'}),
      ],
      labels,
      {onlyReviewerId: 'me'},
    );
    expect(out.p1.map((m) => m.reviewerLabel)).toEqual(['You']);
  });

  it('onlyReviewerId=null keeps nobody (fail closed when self is unknown)', () => {
    const out = buildPeerAdoptionMap(
      [dec({reviewer_id: 'alice', proposal_record_id: 'p1'})],
      labels,
      {onlyReviewerId: null},
    );
    expect(out).toEqual({});
  });

  it('groups multiple linked reviewers under one proposal id', () => {
    const out = buildPeerAdoptionMap(
      [
        dec({reviewer_id: 'alice', proposal_record_id: 'p1'}),
        dec({reviewer_id: 'bruno', proposal_record_id: 'p1', decision: 'accept_proposal', value: null}),
      ],
      labels,
    );
    expect(out.p1).toHaveLength(2);
    expect(out.p1.map((m) => m.decisionKind)).toEqual(['edit', 'accept_proposal']);
  });
});
