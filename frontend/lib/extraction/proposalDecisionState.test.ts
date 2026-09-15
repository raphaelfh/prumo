import { describe, expect, it } from 'vitest';
import type { ReviewerDecisionResponse } from '@/hooks/runs/types';
import { reviewerCoordinateHistory, reversalPayload, acceptedProposal } from './proposalDecisionState';

const row = (id: string, value: Record<string, unknown>, extra = {}): ReviewerDecisionResponse => ({
  id, value, run_id: 'run', instance_id: 'instance', field_id: 'field', reviewer_id: 'me',
  created_at: '2026-09-15T00:00:00Z', decision: 'edit', proposal_record_id: id, rationale: null, ...extra,
});
describe('durable proposal decisions', () => {
  it('filters all authority coordinates and sorts ties by id without mutating input', () => {
    const mixed = [row('b', {value: 'B'}), row('a', {value: 'A'}),
      row('peer', {}, {reviewer_id: 'other'}), row('run2', {}, {run_id: 'other'}),
      row('instance2', {}, {instance_id: 'other'}), row('field2', {}, {field_id: 'other'})];
    expect(reviewerCoordinateHistory(mixed, 'me', 'run', 'instance', 'field').map(d => d.id)).toEqual(['a', 'b']);
    expect(mixed[0].id).toBe('b');
    expect(reviewerCoordinateHistory(mixed, null, 'run', 'instance', 'field')).toEqual([]);
  });
  it.each([{value: {value: 4, unit: 'mg'}}, {value: ['A', 'B']},
    {value: null, absent_reason: 'no_information'}, {value: false}])('restores the full typed predecessor %j', value => {
    expect(reversalPayload([row('a', value), row('b', {value: 'B'})])).toEqual(value);
  });
  it('first acceptance reverses to unresolved', () => {
    expect(reversalPayload([row('a', {value: 'A'})])).toEqual({value: null});
  });
  it('requires latest reviewer link and typed equality, including units', () => {
    const latest = row('older-proposal', {value: {value: 4, unit: 'mg'}});
    expect(acceptedProposal([latest], {value: 4, unit: 'mg'})).toBe('older-proposal');
    expect(acceptedProposal([latest], {value: 4, unit: 'g'})).toBeNull();
    expect(acceptedProposal([latest, row('manual', latest.value!, {proposal_record_id: null})], {value: 4, unit: 'mg'})).toBeNull();
  });
});
