import { describe, expect, it } from 'vitest';
import { stageNodeStates } from '@/components/runs/header/stage';

describe('stageNodeStates (3-node user-facing model)', () => {
  it('maps proposal AND review to the current Extract node', () => {
    for (const s of ['proposal', 'review'] as const) {
      const nodes = stageNodeStates(s);
      expect(nodes.map((n) => [n.key, n.state])).toEqual([
        ['extract', 'current'],
        ['consensus', 'future'],
        ['finalized', 'future'],
      ]);
    }
  });
  it('marks Extract done and Consensus current at consensus', () => {
    expect(stageNodeStates('consensus').map((n) => n.state)).toEqual([
      'done', 'current', 'future',
    ]);
  });
  it('marks Extract + Consensus done and Finalized current at finalized', () => {
    expect(stageNodeStates('finalized').map((n) => n.state)).toEqual([
      'done', 'done', 'current',
    ]);
  });
  it('treats pending/null as Extract current', () => {
    expect(stageNodeStates('pending').map((n) => n.state)).toEqual([
      'current', 'future', 'future',
    ]);
    expect(stageNodeStates(null).map((n) => n.state)).toEqual([
      'current', 'future', 'future',
    ]);
  });
  it('marks every node cancelled when the run is cancelled', () => {
    expect(stageNodeStates('cancelled').every((n) => n.state === 'cancelled')).toBe(true);
    expect(stageNodeStates('cancelled').map((n) => n.key)).toEqual([
      'extract', 'consensus', 'finalized',
    ]);
  });
});
