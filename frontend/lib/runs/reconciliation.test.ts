import { describe, expect, it } from 'vitest';

import { deriveConsensusResolution } from './reconciliation';

const dec = (coord: string, created_at: string, mode = 'select_existing') => {
  const [instance_id, field_id] = coord.split('::');
  return { instance_id, field_id, created_at, mode, value: { value: 'x' } };
};

const baseParams = {
  consensusDecisions: [] as ReturnType<typeof dec>[],
  publishedCoords: new Set<string>(),
  divergentCoords: new Set<string>(),
  decisionCountByCoord: new Map<string, number>(),
  participantCount: 2,
  requiredCoords: [] as string[],
  isComplete: true,
};

describe('deriveConsensusResolution', () => {
  it('a resolved conflict reports status=resolved (resolution wins over bucket)', () => {
    const v = deriveConsensusResolution({
      ...baseParams,
      divergentCoords: new Set(['i1::f1']),
      decisionCountByCoord: new Map([['i1::f1', 2]]),
      consensusDecisions: [dec('i1::f1', '2026-01-01T00:00:00Z')],
    });
    expect(v.statusByCoord.get('i1::f1')).toBe('resolved');
    expect(v.resolvedCount).toBe(1);
    expect(v.needsAttentionCount).toBe(0);
  });

  it('newest consensus decision wins per coord', () => {
    const v = deriveConsensusResolution({
      ...baseParams,
      divergentCoords: new Set(['i1::f1']),
      decisionCountByCoord: new Map([['i1::f1', 2]]),
      consensusDecisions: [
        dec('i1::f1', '2026-01-01T00:00:00Z', 'select_existing'),
        dec('i1::f1', '2026-01-02T00:00:00Z', 'manual_override'),
      ],
    });
    expect(v.resolvedByCoord.get('i1::f1')!.mode).toBe('manual_override');
  });

  it('unresolved conflict + required gap + single filler count as needs-attention', () => {
    const v = deriveConsensusResolution({
      ...baseParams,
      divergentCoords: new Set(['i1::f1']),
      decisionCountByCoord: new Map([
        ['i1::f1', 2],
        ['i1::f3', 1],
      ]),
      requiredCoords: ['i1::f2'],
    });
    expect(v.statusByCoord.get('i1::f1')).toBe('conflict');
    expect(v.statusByCoord.get('i1::f2')).toBe('required_gap');
    expect(v.statusByCoord.get('i1::f3')).toBe('single_filler');
    expect(v.needsAttentionCount).toBe(3);
    expect(v.canFinalize).toBe(false);
  });

  it('canFinalize: conflicts resolved + no required gap + complete + >=1 decision', () => {
    const v = deriveConsensusResolution({
      ...baseParams,
      divergentCoords: new Set(['i1::f1']),
      decisionCountByCoord: new Map([['i1::f1', 2]]),
      consensusDecisions: [dec('i1::f1', '2026-01-01T00:00:00Z')],
    });
    expect(v.canFinalize).toBe(true);
  });

  it('canFinalize false when isComplete=false or no consensus decision exists', () => {
    expect(deriveConsensusResolution({ ...baseParams }).canFinalize).toBe(false);
    expect(
      deriveConsensusResolution({
        ...baseParams,
        isComplete: false,
        consensusDecisions: [dec('i1::f9', '2026-01-01T00:00:00Z')],
        decisionCountByCoord: new Map([['i1::f9', 2]]),
      }).canFinalize,
    ).toBe(false);
  });

  it('a required gap blocks finalize even with a consensus decision elsewhere', () => {
    const v = deriveConsensusResolution({
      ...baseParams,
      requiredCoords: ['i1::f2'],
      decisionCountByCoord: new Map([['i1::f1', 2]]),
      consensusDecisions: [dec('i1::f1', '2026-01-01T00:00:00Z')],
    });
    expect(v.canFinalize).toBe(false);
  });

  it('full agreement is status=agreed and not needs-attention', () => {
    const v = deriveConsensusResolution({
      ...baseParams,
      decisionCountByCoord: new Map([['i1::f1', 2]]),
    });
    expect(v.statusByCoord.get('i1::f1')).toBe('agreed');
    expect(v.needsAttentionCount).toBe(0);
  });
});
