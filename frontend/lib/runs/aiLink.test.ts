import {describe, expect, it} from 'vitest';

import {deriveAiLinkByKey} from '@/lib/runs/aiLink';
import type {ReviewerDecisionResponse} from '@/hooks/runs/types';

const dec = (over: Partial<ReviewerDecisionResponse>): ReviewerDecisionResponse => ({
  id: 'd1',
  run_id: 'r',
  instance_id: 'i1',
  field_id: 'f1',
  reviewer_id: 'me',
  decision: 'edit',
  proposal_record_id: null,
  value: {value: 'x'},
  rationale: null,
  created_at: '2026-07-04T00:00:00Z',
  ...over,
});

describe('deriveAiLinkByKey', () => {
  it('layer 1: my own newest linked decision contributes the link', () => {
    const out = deriveAiLinkByKey({
      decisions: [
        dec({id: 'old', proposal_record_id: 'p1', created_at: '2026-07-01T00:00:00Z'}),
        dec({id: 'new', proposal_record_id: 'p2', created_at: '2026-07-02T00:00:00Z'}),
      ],
      currentUserId: 'me',
      sessionAdoption: {},
    });
    expect(out).toEqual({i1_f1: 'p2'});
  });

  it('a newer UNLINKED own decision clears the coord (no resurrection)', () => {
    const out = deriveAiLinkByKey({
      decisions: [
        dec({id: 'old', proposal_record_id: 'p1', created_at: '2026-07-01T00:00:00Z'}),
        dec({id: 'new', proposal_record_id: null, created_at: '2026-07-02T00:00:00Z'}),
      ],
      currentUserId: 'me',
      sessionAdoption: {},
    });
    expect(out).toEqual({});
  });

  it('ignores peers’ decisions and a null user', () => {
    expect(
      deriveAiLinkByKey({
        decisions: [dec({reviewer_id: 'peer', proposal_record_id: 'p1'})],
        currentUserId: 'me',
        sessionAdoption: {},
      }),
    ).toEqual({});
    expect(
      deriveAiLinkByKey({
        decisions: [dec({proposal_record_id: 'p1'})],
        currentUserId: null,
        sessionAdoption: {},
      }),
    ).toEqual({});
  });

  it('layer 2: session adopt sets, session reject tombstones layer 1', () => {
    const decisions = [dec({proposal_record_id: 'p1'})];
    expect(
      deriveAiLinkByKey({decisions, currentUserId: 'me', sessionAdoption: {i1_f1: 'p9'}}),
    ).toEqual({i1_f1: 'p9'});
    expect(
      deriveAiLinkByKey({decisions, currentUserId: 'me', sessionAdoption: {i1_f1: null}}),
    ).toEqual({});
  });
});
