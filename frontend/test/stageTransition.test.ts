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
    consensusComplete: false,
    divergencesResolved: true,
    isReady: false,
    onMarkReady: noop,
    onOpenConsensus: noop,
    onApproveFinalize: noop,
    onGuide: noop,
    ...overrides,
  };
}

describe('buildExtractionTransition', () => {
  it('Extract + reviewer (complete) → Finish extraction (no advance), onAdvance===onMarkReady', () => {
    const onMarkReady = vi.fn();
    const r = buildExtractionTransition(
      makeArgs({ stage: 'extract', canResolveConflicts: false, isComplete: true, completed: 10, total: 10, onMarkReady }),
    );
    expect(r).not.toBeNull();
    expect(r!.label).toBe('runHeaderFinishExtraction');
    expect(r!.tooltip).toBe('runHeaderFinishExtractionTooltip');
    expect(r!.gate.ok).toBe(true);
    expect(r!.onAdvance).toBe(onMarkReady);
  });

  it('Extract + reviewer + isReady → label flips to Extraction finished', () => {
    const r = buildExtractionTransition(
      makeArgs({ stage: 'extract', canResolveConflicts: false, isComplete: true, isReady: true }),
    );
    expect(r!.label).toBe('runHeaderExtractionFinished');
  });

  it('Extract + manager (canResolveConflicts) → Start consensus, gate ok, onAdvance===onOpenConsensus', () => {
    const onOpenConsensus = vi.fn();
    const r = buildExtractionTransition(
      makeArgs({ stage: 'extract', canResolveConflicts: true, isComplete: false, onOpenConsensus }),
    );
    expect(r).not.toBeNull();
    expect(r!.to).toBe('consensus');
    expect(r!.label).toBe('runHeaderStartConsensus');
    expect(r!.tooltip).toBe('runHeaderStartConsensusTooltip');
    expect(r!.gate.ok).toBe(true); // ungated — manager opens at will
    expect(r!.onAdvance).toBe(onOpenConsensus);
  });

  it('Extract + reviewer gated (isComplete=false) → gate blocked, onAdvance===onGuide', () => {
    const onGuide = vi.fn();
    const r = buildExtractionTransition(
      makeArgs({ stage: 'extract', canResolveConflicts: false, isComplete: false, completed: 3, total: 30, onGuide }),
    );
    expect(r!.gate.ok).toBe(false);
    expect((r!.gate as { ok: false; remaining: number }).remaining).toBe(27);
    expect(r!.onAdvance).toBe(onGuide);
  });

  it('Consensus + manager + complete + resolved → Approve & finalize, onAdvance===onApproveFinalize', () => {
    const onApproveFinalize = vi.fn();
    const r = buildExtractionTransition(
      makeArgs({ stage: 'consensus', canResolveConflicts: true, consensusComplete: true, divergencesResolved: true, onApproveFinalize }),
    );
    expect(r!.to).toBe('finalized');
    expect(r!.label).toBe('runHeaderApproveFinalize');
    expect(r!.tooltip).toBe('runHeaderApproveFinalizeTooltip');
    expect(r!.gate.ok).toBe(true);
    expect(r!.onAdvance).toBe(onApproveFinalize);
  });

  it('Consensus finalize uses run-level completeness, not the caller-scoped form (bug: arbitrator adopted peers)', () => {
    // The reported dead end: the run is reconciled (consensusComplete) but the
    // arbitrator's own form is empty (isComplete=false). The gate must open.
    const onApproveFinalize = vi.fn();
    const r = buildExtractionTransition(
      makeArgs({
        stage: 'consensus',
        canResolveConflicts: true,
        consensusComplete: true,
        isComplete: false,
        divergencesResolved: true,
        onApproveFinalize,
      }),
    );
    expect(r!.gate.ok).toBe(true);
    expect(r!.onAdvance).toBe(onApproveFinalize);
  });

  it('Consensus + manager + unresolved divergence → gated, onAdvance toasts the gate reason', () => {
    const onGuide = vi.fn();
    const onApproveFinalize = vi.fn();
    const r = buildExtractionTransition(
      makeArgs({ stage: 'consensus', canResolveConflicts: true, consensusComplete: true, divergencesResolved: false, onGuide, onApproveFinalize }),
    );
    expect(r!.gate.ok).toBe(false);
    expect((r!.gate as { ok: false; reason: string }).reason).toBe('runHeaderApproveBlocked');
    // Blocked click toasts the SAME copy as the tooltip, not the extract-stage default.
    void r!.onAdvance();
    expect(onGuide).toHaveBeenCalledWith('runHeaderApproveBlocked');
    expect(onApproveFinalize).not.toHaveBeenCalled();
  });

  it('Consensus + manager + incomplete → gated, onAdvance toasts the gate reason', () => {
    const onGuide = vi.fn();
    const r = buildExtractionTransition(
      makeArgs({ stage: 'consensus', canResolveConflicts: true, consensusComplete: false, divergencesResolved: true, completed: 5, total: 20, onGuide }),
    );
    expect(r!.gate.ok).toBe(false);
    expect((r!.gate as { ok: false; remaining: number }).remaining).toBe(15);
    void r!.onAdvance();
    expect(onGuide).toHaveBeenCalledWith('runHeaderApproveBlocked');
  });

  it('Consensus without canResolveConflicts → null (reviewer cannot finalize)', () => {
    expect(buildExtractionTransition(makeArgs({ stage: 'consensus', canResolveConflicts: false }))).toBeNull();
  });

  it('finalized / cancelled / null → null', () => {
    expect(buildExtractionTransition(makeArgs({ stage: 'finalized', canResolveConflicts: true }))).toBeNull();
    expect(buildExtractionTransition(makeArgs({ stage: 'cancelled', canResolveConflicts: true }))).toBeNull();
    expect(buildExtractionTransition(makeArgs({ stage: null }))).toBeNull();
  });

  it('Extract reviewer remaining clamps to 0 when completed > total', () => {
    const r = buildExtractionTransition(
      makeArgs({ stage: 'extract', canResolveConflicts: false, isComplete: false, completed: 35, total: 30 }),
    );
    expect((r!.gate as { ok: false; remaining: number }).remaining).toBe(0);
  });
});
