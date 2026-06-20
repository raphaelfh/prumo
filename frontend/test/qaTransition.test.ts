import { describe, it, expect, vi } from 'vitest';
import { buildQaTransition } from '@/lib/qa/qaTransition';

vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const noop = () => {};

function makeArgs(overrides: Partial<Parameters<typeof buildQaTransition>[0]> = {}) {
  return {
    stage: null as Parameters<typeof buildQaTransition>[0]['stage'],
    canResolveConflicts: false,
    onPublish: noop,
    onFinalize: noop,
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

  it('stage=proposal → finalize action, gate ok:true, onAdvance===onPublish', () => {
    const onPublish = vi.fn();
    const result = buildQaTransition(makeArgs({ stage: 'proposal', onPublish }));
    expect(result).not.toBeNull();
    expect(result!.to).toBe('finalized');
    expect(result!.label).toBe('finalize');
    expect(result!.gate.ok).toBe(true);
    expect(result!.onAdvance).toBe(onPublish);
  });

  it('stage=review → finalize action, gate ok:true, onAdvance===onPublish', () => {
    const onPublish = vi.fn();
    const result = buildQaTransition(makeArgs({ stage: 'review', onPublish }));
    expect(result).not.toBeNull();
    expect(result!.to).toBe('finalized');
    expect(result!.label).toBe('finalize');
    expect(result!.gate.ok).toBe(true);
    expect(result!.onAdvance).toBe(onPublish);
  });

  it('stage=consensus + canResolveConflicts=true → finalize action, gate ok:true, onAdvance===onFinalize', () => {
    const onFinalize = vi.fn();
    const result = buildQaTransition(
      makeArgs({ stage: 'consensus', canResolveConflicts: true, onFinalize }),
    );
    expect(result).not.toBeNull();
    expect(result!.to).toBe('finalized');
    expect(result!.label).toBe('finalize');
    expect(result!.gate.ok).toBe(true);
    expect(result!.onAdvance).toBe(onFinalize);
  });

  it('stage=consensus + canResolveConflicts=false → null (reviewer cannot finalize)', () => {
    const result = buildQaTransition(
      makeArgs({ stage: 'consensus', canResolveConflicts: false }),
    );
    expect(result).toBeNull();
  });
});
