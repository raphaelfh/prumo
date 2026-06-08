import { describe, expect, it } from 'vitest';

import {
  buildArticleValueMap,
  type RawInstance,
  type RawProposal,
  type RawState,
} from './articleValues';

const inst = (
  id: string,
  article_id: string,
  entity_type_id = 'e1',
  status = 'pending',
): RawInstance => ({ id, article_id, entity_type_id, status });

describe('buildArticleValueMap', () => {
  it('groups instances + values per article', () => {
    const instances = [inst('i1', 'a1'), inst('i2', 'a2')];
    const states: RawState[] = [
      { instance_id: 'i1', field_id: 'f1', value: { value: 'x' }, decision: 'edit' },
    ];
    const map = buildArticleValueMap(instances, states, []);
    expect(map.get('a1')?.instances.map((i) => i.id)).toEqual(['i1']);
    expect(map.get('a1')?.values).toEqual([
      { instance_id: 'i1', field_id: 'f1', value: { value: 'x' } },
    ]);
    expect(map.get('a2')?.values).toEqual([]);
  });

  it('drops reject decisions and dedups state-vs-proposal by coord (state wins)', () => {
    const instances = [inst('i1', 'a1')];
    const states: RawState[] = [
      { instance_id: 'i1', field_id: 'f1', value: { value: 'fromState' }, decision: 'edit' },
      { instance_id: 'i1', field_id: 'f2', value: { value: 'r' }, decision: 'reject' },
    ];
    const proposals: RawProposal[] = [
      { instance_id: 'i1', field_id: 'f1', proposed_value: { value: 'fromProposal' } },
      { instance_id: 'i1', field_id: 'f3', proposed_value: { value: 'p3' } },
    ];
    const map = buildArticleValueMap(instances, states, proposals);
    const byCoord = Object.fromEntries(
      map.get('a1')!.values.map((v) => [`${v.instance_id}_${v.field_id}`, v.value]),
    );
    expect(byCoord['i1_f1']).toEqual({ value: 'fromState' });
    expect('i1_f2' in byCoord).toBe(false);
    expect(byCoord['i1_f3']).toEqual({ value: 'p3' });
  });

  it('skips empty human proposals (typed-then-erased not counted as filled)', () => {
    const instances = [inst('i1', 'a1')];
    const proposals: RawProposal[] = [
      { instance_id: 'i1', field_id: 'f1', proposed_value: { value: '' } },
    ];
    expect(buildArticleValueMap(instances, [], proposals).get('a1')?.values).toEqual([]);
  });
});
