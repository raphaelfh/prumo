import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {dismiss: vi.fn()}),
}));

import {toast} from 'sonner';

import {
  STRUCTURAL_UNDO_TOAST_ID,
  useStructuralHistory,
  type StructuralStep,
} from './useStructuralHistory';

/** A step that records its dispatches and hands back its own mirror, so a
 * test can bounce undo -> redo -> undo without hand-rolling inverses. */
function pingPong(name: string, log: string[]): StructuralStep {
  return {
    label: name,
    apply: async () => {
      log.push(name);
      return pingPong(name === 'undo' ? 'redo' : 'undo', log);
    },
  };
}

/** The options of the LAST `toast(...)` call — the live slot. Reading a
 * fixed index would pick up a previous test's toast, whose action closes
 * over a hook instance that is already unmounted. */
const toastOptions = () => {
  const calls = vi.mocked(toast).mock.calls;
  return calls[calls.length - 1]?.[1] as
    | {id?: string; duration?: number; action?: {label: string; onClick: () => void}}
    | undefined;
};

describe('useStructuralHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('arms undo on push and leaves redo empty', () => {
    const {result} = renderHook(() => useStructuralHistory());
    act(() => result.current.push(pingPong('undo', [])));

    expect(result.current.undoStep?.label).toBe('undo');
    expect(result.current.redoStep).toBeNull();
  });

  it('moves the slot across on undo, and back on redo', async () => {
    const log: string[] = [];
    const {result} = renderHook(() => useStructuralHistory());
    act(() => result.current.push(pingPong('undo', log)));

    act(() => result.current.undo());
    await waitFor(() => expect(result.current.redoStep?.label).toBe('redo'));
    expect(result.current.undoStep).toBeNull();

    act(() => result.current.redo());
    await waitFor(() => expect(result.current.undoStep?.label).toBe('undo'));
    expect(result.current.redoStep).toBeNull();
    expect(log).toEqual(['undo', 'redo']);
  });

  it('empties the slot when the step reports the target is gone', async () => {
    const {result} = renderHook(() => useStructuralHistory());
    act(() => result.current.push({label: 'gone', apply: async () => null}));

    act(() => result.current.undo());

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.undoStep).toBeNull();
    expect(result.current.redoStep).toBeNull();
  });

  it('dispatches once when clicked twice inside one frame', async () => {
    const apply = vi.fn(async () => null);
    const {result} = renderHook(() => useStructuralHistory());
    act(() => result.current.push({label: 'once', apply}));

    act(() => {
      result.current.undo();
      result.current.undo();
    });

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('retires the redo branch when a new edit is pushed', async () => {
    const log: string[] = [];
    const {result} = renderHook(() => useStructuralHistory());
    act(() => result.current.push(pingPong('undo', log)));
    act(() => result.current.undo());
    await waitFor(() => expect(result.current.redoStep).not.toBeNull());

    act(() => result.current.push(pingPong('fresh', log)));

    expect(result.current.undoStep?.label).toBe('fresh');
    expect(result.current.redoStep).toBeNull();
  });

  // The toast lives here rather than at each call site, so these are its
  // tests: one slot id, one duration, one action — and no call site can
  // ship a structural edit that forgets them.
  it('raises the step label under the ONE slot id on push', () => {
    const {result} = renderHook(() => useStructuralHistory());
    act(() => result.current.push(pingPong('Deleted Sample size', [])));

    expect(toast).toHaveBeenCalledWith('Deleted Sample size', expect.anything());
    expect(toastOptions()).toMatchObject({
      id: STRUCTURAL_UNDO_TOAST_ID,
      duration: 6000,
      action: {label: 'undoAction'},
    });
  });

  it('routes the toast action through the same slot the buttons drive', async () => {
    const log: string[] = [];
    const {result} = renderHook(() => useStructuralHistory());
    act(() => result.current.push(pingPong('undo', log)));

    act(() => toastOptions()?.action?.onClick());

    await waitFor(() => expect(result.current.redoStep?.label).toBe('redo'));
    expect(log).toEqual(['undo']);
  });

  it('raises nothing on redo — only a fresh edit announces itself', async () => {
    const {result} = renderHook(() => useStructuralHistory());
    act(() => result.current.push(pingPong('undo', [])));
    act(() => result.current.undo());
    await waitFor(() => expect(result.current.redoStep).not.toBeNull());
    vi.mocked(toast).mockClear();

    act(() => result.current.redo());

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(toast).not.toHaveBeenCalled();
  });

  it('dismisses the shared toast slot so the two surfaces agree', async () => {
    const {result} = renderHook(() => useStructuralHistory());
    act(() => result.current.push({label: 'x', apply: async () => null}));

    act(() => result.current.undo());

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(toast.dismiss).toHaveBeenCalledWith(STRUCTURAL_UNDO_TOAST_ID);
  });
});
