import { describe, expect, it } from 'vitest';

import type { ProposalRecordResponse } from '@/hooks/runs/types';

import { pickLatestProposalPerCoord } from './proposalValues';

const ME = 'user-me';
const OTHER = 'user-other';

function prop(over: Partial<ProposalRecordResponse>): ProposalRecordResponse {
  return {
    id: 'p-default',
    run_id: 'run-1',
    instance_id: 'inst-1',
    field_id: 'field-1',
    source: 'human',
    source_user_id: ME,
    proposed_value: { value: 'x' },
    confidence_score: null,
    rationale: null,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function valueAt(
  map: Map<string, ProposalRecordResponse>,
  key = 'inst-1_field-1',
): unknown {
  return (map.get(key)?.proposed_value as { value: unknown } | undefined)?.value;
}

describe('pickLatestProposalPerCoord', () => {
  const v1 = prop({ id: 'p1', proposed_value: { value: 'V1-old' }, created_at: '2026-06-07T15:00:00Z' });
  const v2 = prop({ id: 'p2', proposed_value: { value: 'V2-new' }, created_at: '2026-06-07T19:00:00Z' });

  it('picks the newest proposal per coord when input is oldest-first (extraction API order)', () => {
    // Reproduces the reported bug: oldest-first input must NOT win.
    const result = pickLatestProposalPerCoord([v1, v2], { currentUserId: ME });
    expect(valueAt(result)).toBe('V2-new');
  });

  it('picks the newest proposal per coord when input is newest-first', () => {
    const result = pickLatestProposalPerCoord([v2, v1], { currentUserId: ME });
    expect(valueAt(result)).toBe('V2-new');
  });

  it('is independent of array order (selection by created_at, not position)', () => {
    const a = pickLatestProposalPerCoord([v1, v2], { currentUserId: ME });
    const b = pickLatestProposalPerCoord([v2, v1], { currentUserId: ME });
    expect(valueAt(a)).toBe(valueAt(b));
  });

  it("hides another reviewer's human proposal (blind-review contract)", () => {
    const mine = prop({ id: 'p1', source_user_id: ME, proposed_value: { value: 'mine' }, created_at: '2026-06-07T15:00:00Z' });
    const theirsNewer = prop({ id: 'p2', source_user_id: OTHER, proposed_value: { value: 'theirs' }, created_at: '2026-06-07T19:00:00Z' });
    const result = pickLatestProposalPerCoord([mine, theirsNewer], { currentUserId: ME });
    expect(valueAt(result)).toBe('mine');
  });

  it('keeps AI/system proposals regardless of author and signed-out state', () => {
    const ai = prop({ id: 'p-ai', source: 'ai', source_user_id: null, proposed_value: { value: 'ai-value' }, created_at: '2026-06-07T19:00:00Z' });
    const result = pickLatestProposalPerCoord([ai], { currentUserId: null });
    expect(valueAt(result)).toBe('ai-value');
  });

  it('fails closed: signed-out user sees no human proposals', () => {
    const mine = prop({ source: 'human', source_user_id: ME });
    const result = pickLatestProposalPerCoord([mine], { currentUserId: null });
    expect(result.size).toBe(0);
  });
});
