import { describe, expect, it } from 'vitest';
import { chipState, stageNodeStates } from '@/components/runs/header/stage';

describe('stageNodeStates (3-node user-facing model)', () => {
  it('maps extract to the current Extract node', () => {
    for (const s of ['extract'] as const) {
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
  it('renders no current node for pending/null — the run is not editable yet', () => {
    for (const s of ['pending', null] as const) {
      const nodes = stageNodeStates(s);
      expect(nodes.every((n) => n.state === 'future')).toBe(true);
    }
  });
  it('marks every node cancelled when the run is cancelled', () => {
    expect(stageNodeStates('cancelled').every((n) => n.state === 'cancelled')).toBe(true);
    expect(stageNodeStates('cancelled').map((n) => n.key)).toEqual([
      'extract', 'consensus', 'finalized',
    ]);
  });
});

describe('chipState', () => {
  it('maps stages to chip states, pending-truthful', () => {
    expect(chipState(null)).toBe('pending');
    expect(chipState('pending')).toBe('pending');
    expect(chipState('extract')).toBe('extract');
    expect(chipState('consensus')).toBe('consensus');
    expect(chipState('finalized')).toBe('finalized');
    expect(chipState('cancelled')).toBe('cancelled');
  });
});
