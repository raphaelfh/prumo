import { describe, it, expect, vi } from 'vitest';
import { buildQaTransition } from '@/lib/qa/qaTransition';

vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const noop = () => {};

function makeArgs(overrides: Partial<Parameters<typeof buildQaTransition>[0]> = {}) {
  return {
    stage: null as Parameters<typeof buildQaTransition>[0]['stage'],
    canResolveConflicts: false,
    isReady: false,
    divergencesResolved: true,
    onMarkReady: noop,
    onOpenConsensus: noop,
    onApproveFinalize: noop,
    onGuide: noop,
    ...overrides,
  };
}

describe('buildQaTransition', () => {
  it('stage=null → null', () => {
    expect(buildQaTransition(makeArgs({ stage: null }))).toBeNull();
  });

  it('stage=finalized → null', () => {
    expect(buildQaTransition(makeArgs({ stage: 'finalized' }))).toBeNull();
  });

  it('stage=pending → null', () => {
    expect(buildQaTransition(makeArgs({ stage: 'pending' }))).toBeNull();
  });

  it('stage=cancelled → null', () => {
    expect(buildQaTransition(makeArgs({ stage: 'cancelled' }))).toBeNull();
  });

  it('extract + manager → Start consensus (advance only, never finalize)', () => {
    const onOpenConsensus = vi.fn();
    const result = buildQaTransition(
      makeArgs({ stage: 'extract', canResolveConflicts: true, onOpenConsensus }),
    );
    expect(result).not.toBeNull();
    expect(result!.to).toBe('consensus');
    expect(result!.label).toBe('runHeaderStartConsensus');
    expect(result!.gate.ok).toBe(true);
    expect(result!.onAdvance).toBe(onOpenConsensus);
  });

  it('extract + reviewer → Mark ready (advisory; no stage move)', () => {
    const onMarkReady = vi.fn();
    const result = buildQaTransition(makeArgs({ stage: 'extract', onMarkReady }));
    expect(result).not.toBeNull();
    expect(result!.to).toBe('consensus');
    expect(result!.label).toBe('runHeaderFinishAssessment');
    expect(result!.gate.ok).toBe(true);
    expect(result!.onAdvance).toBe(onMarkReady);
  });

  it('extract + reviewer already ready → label flips to finished', () => {
    const result = buildQaTransition(makeArgs({ stage: 'extract', isReady: true }));
    expect(result!.label).toBe('runHeaderAssessmentFinished');
  });

  it('consensus + manager + divergences resolved → Approve & finalize', () => {
    const onApproveFinalize = vi.fn();
    const result = buildQaTransition(
      makeArgs({ stage: 'consensus', canResolveConflicts: true, onApproveFinalize }),
    );
    expect(result).not.toBeNull();
    expect(result!.to).toBe('finalized');
    expect(result!.label).toBe('runHeaderApproveFinalize');
    expect(result!.gate.ok).toBe(true);
    expect(result!.onAdvance).toBe(onApproveFinalize);
  });

  it('consensus + manager + unresolved divergence → blocked gate routes to onGuide', () => {
    const onApproveFinalize = vi.fn();
    const onGuide = vi.fn();
    const result = buildQaTransition(
      makeArgs({
        stage: 'consensus',
        canResolveConflicts: true,
        divergencesResolved: false,
        onApproveFinalize,
        onGuide,
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.gate.ok).toBe(false);
    void result!.onAdvance();
    expect(onApproveFinalize).not.toHaveBeenCalled();
    expect(onGuide).toHaveBeenCalledWith('runHeaderApproveBlocked');
  });

  it('consensus + reviewer → null (manager finalizes)', () => {
    const result = buildQaTransition(
      makeArgs({ stage: 'consensus', canResolveConflicts: false }),
    );
    expect(result).toBeNull();
  });
});
