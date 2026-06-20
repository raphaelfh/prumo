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
    onSubmit: noop,
    onReconcile: noop,
    onFinalize: noop,
    onGuide: noop,
    ...overrides,
  };
}

describe('buildExtractionTransition', () => {
  it('review + canResolveConflicts + isComplete=false → gate blocked, onAdvance===onGuide', () => {
    const onGuide = vi.fn();
    const onReconcile = vi.fn();
    const result = buildExtractionTransition(
      makeArgs({
        stage: 'review',
        canResolveConflicts: true,
        isComplete: false,
        completed: 3,
        total: 30,
        onGuide,
        onReconcile,
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.to).toBe('consensus');
    expect(result!.label).toBe('runHeaderReconcile');
    expect(result!.gate.ok).toBe(false);
    expect((result!.gate as { ok: false; remaining: number }).remaining).toBe(27);
    expect(result!.onAdvance).toBe(onGuide);
  });

  it('review + canResolveConflicts + isComplete=true → gate ok, onAdvance===onReconcile', () => {
    const onGuide = vi.fn();
    const onReconcile = vi.fn();
    const result = buildExtractionTransition(
      makeArgs({
        stage: 'review',
        canResolveConflicts: true,
        isComplete: true,
        completed: 30,
        total: 30,
        onGuide,
        onReconcile,
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.gate.ok).toBe(true);
    expect(result!.onAdvance).toBe(onReconcile);
  });

  it('stage=proposal + isComplete=true → submit for review, onAdvance===onSubmit', () => {
    const onSubmit = vi.fn();
    const result = buildExtractionTransition(
      makeArgs({
        stage: 'proposal',
        isComplete: true,
        completed: 10,
        total: 10,
        onSubmit,
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.label).toBe('runHeaderSubmitForReview');
    expect(result!.to).toBe('review');
    expect(result!.gate.ok).toBe(true);
    expect(result!.onAdvance).toBe(onSubmit);
  });

  it('stage=review + canResolveConflicts=false → null', () => {
    const result = buildExtractionTransition(
      makeArgs({ stage: 'review', canResolveConflicts: false }),
    );
    expect(result).toBeNull();
  });

  it('stage=finalized → null', () => {
    const result = buildExtractionTransition(makeArgs({ stage: 'finalized' }));
    expect(result).toBeNull();
  });

  it('stage=consensus + isComplete=false → gate blocked, onAdvance===onGuide', () => {
    const onGuide = vi.fn();
    const onFinalize = vi.fn();
    const result = buildExtractionTransition(
      makeArgs({
        stage: 'consensus',
        isComplete: false,
        completed: 5,
        total: 20,
        onGuide,
        onFinalize,
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.to).toBe('finalized');
    expect(result!.label).toBe('runHeaderFinalize');
    expect(result!.gate.ok).toBe(false);
    expect((result!.gate as { ok: false; remaining: number }).remaining).toBe(15);
    expect(result!.onAdvance).toBe(onGuide);
  });

  it('stage=consensus + isComplete=true → gate ok, onAdvance===onFinalize', () => {
    const onFinalize = vi.fn();
    const result = buildExtractionTransition(
      makeArgs({ stage: 'consensus', isComplete: true, onFinalize }),
    );
    expect(result).not.toBeNull();
    expect(result!.gate.ok).toBe(true);
    expect(result!.onAdvance).toBe(onFinalize);
  });

  it('stage=null → null', () => {
    expect(buildExtractionTransition(makeArgs({ stage: null }))).toBeNull();
  });

  it('remaining is clamped to 0 when completed > total', () => {
    const result = buildExtractionTransition(
      makeArgs({ stage: 'proposal', isComplete: false, completed: 35, total: 30 }),
    );
    expect(result).not.toBeNull();
    expect((result!.gate as { ok: false; remaining: number }).remaining).toBe(0);
  });
});
