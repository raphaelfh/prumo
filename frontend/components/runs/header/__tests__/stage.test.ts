import { describe, expect, it } from 'vitest';
import { stageNodeStates } from '@/components/runs/header/stage';

describe('stageNodeStates', () => {
  it('marks earlier nodes done, the current node current, and later nodes future', () => {
    const nodes = stageNodeStates('consensus');
    expect(nodes.map((n) => [n.key, n.state])).toEqual([
      ['proposal', 'done'],
      ['review', 'done'],
      ['consensus', 'current'],
      ['finalized', 'future'],
    ]);
  });
  it('treats pending/null as before proposal (all future, proposal current-ish)', () => {
    expect(stageNodeStates('pending').map((n) => n.state)).toEqual(['current', 'future', 'future', 'future']);
    expect(stageNodeStates(null).map((n) => n.state)).toEqual(['current', 'future', 'future', 'future']);
  });
  it('marks every node cancelled when the run is cancelled', () => {
    expect(stageNodeStates('cancelled').every((n) => n.state === 'cancelled')).toBe(true);
  });
  it('marks all four done when finalized', () => {
    expect(stageNodeStates('finalized').map((n) => n.state)).toEqual(['done', 'done', 'done', 'current']);
  });
});
