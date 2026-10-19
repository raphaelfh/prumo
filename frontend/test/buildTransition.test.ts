import { describe, it, expect, vi } from 'vitest';
import { buildTransition, type BuildTransitionArgs, type TransitionGate } from '@/lib/runs/buildTransition';

vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const noop = () => {};

type ExtractionGate = Extract<TransitionGate, { kind: 'extraction' }>;
type QaGate = Extract<TransitionGate, { kind: 'qa' }>;

const extraction = (gate: Partial<ExtractionGate> = {}): ExtractionGate => ({
  kind: 'extraction',
  isComplete: false,
  completed: 0,
  total: 30,
  consensusComplete: false,
  ...gate,
});
const qa = (gate: Partial<QaGate> = {}): QaGate => ({ kind: 'qa', nothingRecorded: false, ...gate });

function makeArgs(gate: TransitionGate, overrides: Partial<BuildTransitionArgs> = {}): BuildTransitionArgs {
  return {
    stage: null,
    canResolveConflicts: false,
    divergencesResolved: true,
    isReady: false,
    gate,
    onMarkReady: noop,
    onOpenConsensus: noop,
    onApproveFinalize: noop,
    onGuide: noop,
    ...overrides,
  };
}

describe.each([
  ['extraction', extraction()],
  ['qa', qa()],
] as const)('buildTransition — the shared machine (%s)', (_kind, gate) => {
  it('finalized / pending / cancelled / null → null', () => {
    for (const stage of ['finalized', 'pending', 'cancelled', null] as const) {
      expect(buildTransition(makeArgs(gate, { stage, canResolveConflicts: true }))).toBeNull();
    }
  });

  it('extract + manager → Start consensus, ungated, onAdvance===onOpenConsensus', () => {
    const onOpenConsensus = vi.fn();
    const r = buildTransition(makeArgs(gate, { stage: 'extract', canResolveConflicts: true, onOpenConsensus }));
    expect(r!.to).toBe('consensus');
    expect(r!.label).toBe('runHeaderStartConsensus');
    expect(r!.tooltip).toBe('runHeaderStartConsensusTooltip');
    expect(r!.gate.ok).toBe(true); // the manager opens consensus at will
    expect(r!.onAdvance).toBe(onOpenConsensus);
  });

  it('consensus + manager + resolved → Approve & finalize, onAdvance===onApproveFinalize', () => {
    const onApproveFinalize = vi.fn();
    const complete = gate.kind === 'extraction' ? { ...gate, consensusComplete: true } : gate;
    const r = buildTransition(
      makeArgs(complete, { stage: 'consensus', canResolveConflicts: true, onApproveFinalize }),
    );
    expect(r!.to).toBe('finalized');
    expect(r!.label).toBe('runHeaderApproveFinalize');
    expect(r!.tooltip).toBe('runHeaderApproveFinalizeTooltip');
    expect(r!.gate.ok).toBe(true);
    expect(r!.onAdvance).toBe(onApproveFinalize);
  });

  it('consensus + manager + unresolved divergence → gated, the click toasts the gate reason', () => {
    const onGuide = vi.fn();
    const onApproveFinalize = vi.fn();
    const complete = gate.kind === 'extraction' ? { ...gate, consensusComplete: true } : gate;
    const r = buildTransition(
      makeArgs(complete, {
        stage: 'consensus',
        canResolveConflicts: true,
        divergencesResolved: false,
        onGuide,
        onApproveFinalize,
      }),
    );
    expect(r!.gate.ok).toBe(false);
    expect((r!.gate as { ok: false; reason: string }).reason).toBe('runHeaderApproveBlocked');
    // The blocked click toasts the SAME copy as the tooltip, not the extract-stage default.
    void r!.onAdvance();
    expect(onGuide).toHaveBeenCalledWith('runHeaderApproveBlocked');
    expect(onApproveFinalize).not.toHaveBeenCalled();
  });

  it('consensus without canResolveConflicts → null (the arbitrator finalizes)', () => {
    expect(buildTransition(makeArgs(gate, { stage: 'consensus', canResolveConflicts: false }))).toBeNull();
  });
});

describe('buildTransition — extraction gate term (form completeness)', () => {
  it('extract + reviewer (complete) → Finish extraction (no advance), onAdvance===onMarkReady', () => {
    const onMarkReady = vi.fn();
    const r = buildTransition(
      makeArgs(extraction({ isComplete: true, completed: 10, total: 10 }), { stage: 'extract', onMarkReady }),
    );
    expect(r!.to).toBe('consensus');
    expect(r!.label).toBe('runHeaderFinishExtraction');
    expect(r!.tooltip).toBe('runHeaderFinishExtractionTooltip');
    expect(r!.gate.ok).toBe(true);
    expect(r!.onAdvance).toBe(onMarkReady);
  });

  it('extract + reviewer + isReady → label flips to Extraction finished', () => {
    const r = buildTransition(makeArgs(extraction({ isComplete: true }), { stage: 'extract', isReady: true }));
    expect(r!.label).toBe('runHeaderExtractionFinished');
  });

  it('extract + reviewer gated (isComplete=false) → gate blocked, onAdvance===onGuide', () => {
    const onGuide = vi.fn();
    const r = buildTransition(makeArgs(extraction({ completed: 3, total: 30 }), { stage: 'extract', onGuide }));
    expect(r!.gate.ok).toBe(false);
    expect((r!.gate as { ok: false; remaining: number }).remaining).toBe(27);
    expect(r!.onAdvance).toBe(onGuide);
  });

  it('extract reviewer remaining clamps to 0 when completed > total', () => {
    const r = buildTransition(makeArgs(extraction({ completed: 35, total: 30 }), { stage: 'extract' }));
    expect((r!.gate as { ok: false; remaining: number }).remaining).toBe(0);
  });

  it('consensus finalize uses run-level completeness, not the caller-scoped form (bug: arbitrator adopted peers)', () => {
    // The run is reconciled (consensusComplete) but the arbitrator's own form is
    // empty (isComplete=false). The gate must open.
    const onApproveFinalize = vi.fn();
    const r = buildTransition(
      makeArgs(extraction({ consensusComplete: true, isComplete: false }), {
        stage: 'consensus',
        canResolveConflicts: true,
        onApproveFinalize,
      }),
    );
    expect(r!.gate.ok).toBe(true);
    expect(r!.onAdvance).toBe(onApproveFinalize);
  });

  it('consensus + manager + incomplete run → gated, remaining counts the open fields', () => {
    const onGuide = vi.fn();
    const r = buildTransition(
      makeArgs(extraction({ completed: 5, total: 20 }), { stage: 'consensus', canResolveConflicts: true, onGuide }),
    );
    expect(r!.gate.ok).toBe(false);
    expect((r!.gate as { ok: false; remaining: number }).remaining).toBe(15);
    void r!.onAdvance();
    expect(onGuide).toHaveBeenCalledWith('runHeaderApproveBlocked');
  });
});

describe('buildTransition — qa gate term (nothing recorded)', () => {
  it('extract + reviewer → Finish assessment, always ok (signaling questions are optional)', () => {
    const onMarkReady = vi.fn();
    const r = buildTransition(makeArgs(qa(), { stage: 'extract', onMarkReady }));
    expect(r!.to).toBe('consensus');
    expect(r!.label).toBe('runHeaderFinishAssessment');
    expect(r!.tooltip).toBe('runHeaderFinishAssessmentTooltip');
    expect(r!.gate.ok).toBe(true);
    expect(r!.onAdvance).toBe(onMarkReady);
  });

  it('extract + reviewer already ready → label flips to finished', () => {
    const r = buildTransition(makeArgs(qa(), { stage: 'extract', isReady: true }));
    expect(r!.label).toBe('runHeaderAssessmentFinished');
  });

  it('a blocked consensus gate reports no remaining count (QA has no completeness metric)', () => {
    const r = buildTransition(
      makeArgs(qa(), { stage: 'consensus', canResolveConflicts: true, divergencesResolved: false }),
    );
    expect(r!.gate).toEqual({ ok: false, reason: 'runHeaderApproveBlocked', remaining: 0 });
  });

  it('consensus + manager + nothing recorded → blocked gate names the way out', () => {
    // Nothing to publish and nothing resolved: approve-finalize would 400 with
    // EmptyFinalizeError, so the gate explains instead of letting the click fail.
    const onApproveFinalize = vi.fn();
    const onGuide = vi.fn();
    const r = buildTransition(
      makeArgs(qa({ nothingRecorded: true }), { stage: 'consensus', canResolveConflicts: true, onApproveFinalize, onGuide }),
    );
    expect(r!.gate.ok).toBe(false);
    void r!.onAdvance();
    expect(onApproveFinalize).not.toHaveBeenCalled();
    expect(onGuide).toHaveBeenCalledWith('runHeaderApproveNothingRecorded');
  });
});
