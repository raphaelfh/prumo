import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {renderHook} from '@testing-library/react';
import {useKeyboardShortcuts, type Binding} from './useKeyboardShortcuts';

function fireKeydown(key: string, opts: {meta?: boolean; ctrl?: boolean; target?: HTMLElement} = {}) {
  const target = opts.target ?? document.body;
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: opts.meta ?? false,
    ctrlKey: opts.ctrl ?? false,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Macintosh)'});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('triggers chord handler with mod key', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'chord', key: 'b', mod: true, handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    fireKeydown('b', {meta: true});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not trigger when disabled', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'chord', key: 'b', mod: true, handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: false}));

    fireKeydown('b', {meta: true});
    expect(handler).not.toHaveBeenCalled();
  });

  it('triggers sequence after prefix within timeout', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'sequence', prefix: 'g', key: 'a', handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    fireKeydown('g');
    fireKeydown('a');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('cancels sequence after timeout', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'sequence', prefix: 'g', key: 'a', handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    fireKeydown('g');
    vi.advanceTimersByTime(1600);
    fireKeydown('a');
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores keydown when target is an input', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'sequence', prefix: 'g', key: 'a', handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireKeydown('g', {target: input});
    fireKeydown('a', {target: input});
    expect(handler).not.toHaveBeenCalled();
  });

  it('still triggers chord with mod even inside input', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'chord', key: 'b', mod: true, handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireKeydown('b', {meta: true, target: input});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignores when an open dialog is present', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'sequence', prefix: 'g', key: 'a', handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'open');
    document.body.appendChild(dialog);

    fireKeydown('g');
    fireKeydown('a');
    expect(handler).not.toHaveBeenCalled();
  });

  it('is case-insensitive on letter keys', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'sequence', prefix: 'g', key: 'a', handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    fireKeydown('G');
    fireKeydown('A');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
