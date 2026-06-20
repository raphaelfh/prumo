import { describe, it, expect, vi } from 'vitest';
import { buildExtractionTransition } from '@/lib/extraction/stageTransition';

vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const noop = () => {};

function makeArgs(overrides: Partial<Parameters<typeof buildExtractionTransition>[0]> = {}) {
  return {
    stage: null as Parameters<typeof buildExtractionTransition>[0]['stage'],
    canResolveConflicts: false,
    isComplete: false,
    completed: 0,
    total: 30,
    onMarkReady: noop,
    onFinalize: noop,
    onGuide: noop,
    ...overrides,
  };
}

describe('buildExtractionTransition', () => {
  it('Extract phase (proposal) → Mark ready to consensus, available to every extractor', () => {
    const onMarkReady = vi.fn();
    const r = buildExtractionTransition(
      makeArgs({ stage: 'proposal', canResolveConflicts: false, isComplete: true, completed: 10, total: 10, onMarkReady }),
    );
    expect(r).not.toBeNull();
    expect(r!.to).toBe('consensus');
    expect(r!.label).toBe('runHeaderMarkReady');
    expect(r!.tooltip).toBe('runHeaderMarkReadyTooltip');
    expect(r!.gate.ok).toBe(true);
    expect(r!.onAdvance).toBe(onMarkReady);
  });

  it('Extract phase (review) → Mark ready even when canResolveConflicts=false', () => {
    const onMarkReady = vi.fn();
    const r = buildExtractionTransition(
      makeArgs({ stage: 'review', canResolveConflicts: false, isComplete: true, completed: 5, total: 5, onMarkReady }),
    );
    expect(r).not.toBeNull();
    expect(r!.to).toBe('consensus');
    expect(r!.label).toBe('runHeaderMarkReady');
    expect(r!.onAdvance).toBe(onMarkReady);
  });

  it('Extract phase gated (isComplete=false) → gate blocked, onAdvance===onGuide', () => {
    const onGuide = vi.fn();
    const r = buildExtractionTransition(makeArgs({ stage: 'review', isComplete: false, completed: 3, total: 30, onGuide }));
    expect(r!.gate.ok).toBe(false);
    expect((r!.gate as { ok: false; remaining: number }).remaining).toBe(27);
    expect(r!.onAdvance).toBe(onGuide);
  });

  it('Consensus + canResolveConflicts + complete → Finalize, onAdvance===onFinalize', () => {
    const onFinalize = vi.fn();
    const r = buildExtractionTransition(makeArgs({ stage: 'consensus', canResolveConflicts: true, isComplete: true, onFinalize }));
    expect(r!.to).toBe('finalized');
    expect(r!.label).toBe('runHeaderFinalize');
    expect(r!.tooltip).toBe('runHeaderFinalizeTooltip');
    expect(r!.gate.ok).toBe(true);
    expect(r!.onAdvance).toBe(onFinalize);
  });

  it('Consensus + canResolveConflicts + isComplete=false → gated, onAdvance===onGuide', () => {
    const onGuide = vi.fn();
    const onFinalize = vi.fn();
    const r = buildExtractionTransition(
      makeArgs({ stage: 'consensus', canResolveConflicts: true, isComplete: false, completed: 5, total: 20, onGuide, onFinalize }),
    );
    expect(r).not.toBeNull();
    expect(r!.to).toBe('finalized');
    expect(r!.gate.ok).toBe(false);
    expect((r!.gate as { ok: false; remaining: number }).remaining).toBe(15);
    expect(r!.onAdvance).toBe(onGuide);
  });

  it('Consensus without canResolveConflicts → null (reviewer cannot finalize)', () => {
    expect(buildExtractionTransition(makeArgs({ stage: 'consensus', canResolveConflicts: false }))).toBeNull();
  });

  it('finalized / cancelled / null → null', () => {
    expect(buildExtractionTransition(makeArgs({ stage: 'finalized' }))).toBeNull();
    expect(buildExtractionTransition(makeArgs({ stage: 'cancelled' }))).toBeNull();
    expect(buildExtractionTransition(makeArgs({ stage: null }))).toBeNull();
  });

  it('remaining clamps to 0 when completed > total', () => {
    const r = buildExtractionTransition(makeArgs({ stage: 'proposal', isComplete: false, completed: 35, total: 30 }));
    expect((r!.gate as { ok: false; remaining: number }).remaining).toBe(0);
  });
});
