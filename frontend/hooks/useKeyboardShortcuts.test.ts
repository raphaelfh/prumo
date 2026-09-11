import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {renderHook} from '@testing-library/react';
import {useKeyboardShortcuts, type Binding} from './useKeyboardShortcuts';

function fireKeydown(
  key: string,
  opts: {meta?: boolean; ctrl?: boolean; alt?: boolean; target?: HTMLElement} = {},
) {
  const target = opts.target ?? document.body;
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: opts.meta ?? false,
    ctrlKey: opts.ctrl ?? false,
    altKey: opts.alt ?? false,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function focusedInput(): HTMLInputElement {
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();
  return input;
}

function openDialog(): HTMLElement {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('data-state', 'open');
  document.body.appendChild(dialog);
  return dialog;
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Macintosh)'});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

    const input = focusedInput();
    fireKeydown('g', {target: input});
    fireKeydown('a', {target: input});
    expect(handler).not.toHaveBeenCalled();
  });

  it('still triggers chord with mod even inside input', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'chord', key: 'b', mod: true, handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    fireKeydown('b', {meta: true, target: focusedInput()});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('claims a mod chord before the focused element handles the key', () => {
    // Radix skips a defaultPrevented key: a focused Select trigger opens on ⌘↵ otherwise.
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'chord', key: 'Enter', mod: true, handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    let claimedBeforeTrigger: boolean | undefined;
    trigger.addEventListener('keydown', (e) => (claimedBeforeTrigger = e.defaultPrevented));

    fireKeydown('Enter', {meta: true, target: trigger});
    expect(handler).toHaveBeenCalledTimes(1);
    expect(claimedBeforeTrigger).toBe(true);
  });

  it('lets the focused element handle a bare key before a binding claims it', () => {
    // Escape closes the innermost Radix layer only while it is not defaultPrevented.
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'chord', key: 'Escape', allowInDialogs: true, handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));
    const option = document.createElement('div');
    document.body.appendChild(option);
    let claimedBeforeOption: boolean | undefined;
    option.addEventListener('keydown', (e) => (claimedBeforeOption = e.defaultPrevented));

    const event = fireKeydown('Escape', {target: option});
    expect(event.defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(claimedBeforeOption).toBe(false);
  });

  it('keeps a bare chord out of inputs', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'chord', key: 'j', handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    fireKeydown('j', {target: focusedInput()});
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps a mod chord out of inputs when allowInInputs is false', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'chord', key: 'k', mod: true, allowInInputs: false, handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    fireKeydown('k', {meta: true, target: focusedInput()});
    expect(handler).not.toHaveBeenCalled();
    fireKeydown('k', {meta: true});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('fires a bare chord only while no modifier is held', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'chord', key: 'j', handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    fireKeydown('j', {alt: true});
    fireKeydown('j', {ctrl: true});
    fireKeydown('j', {meta: true});
    expect(handler).not.toHaveBeenCalled();
    fireKeydown('j');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignores when an open dialog is present', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'sequence', prefix: 'g', key: 'a', handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    openDialog();
    fireKeydown('g');
    fireKeydown('a');
    expect(handler).not.toHaveBeenCalled();
  });

  it('swallows a chord while a dialog is open', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'chord', key: 'b', mod: true, handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    openDialog();
    fireKeydown('b', {meta: true});
    expect(handler).not.toHaveBeenCalled();
  });

  it('fires an allowInDialogs chord while a dialog is open', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'chord', key: 'k', mod: true, allowInDialogs: true, handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    openDialog();
    fireKeydown('k', {meta: true});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not arm a sequence prefix pressed while a dialog is open', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'sequence', prefix: 'g', key: 'a', handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    const dialog = openDialog();
    fireKeydown('g');
    dialog.remove();
    fireKeydown('a');
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not complete a sequence once a dialog has opened', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'sequence', prefix: 'g', key: 'a', handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    fireKeydown('g');
    openDialog();
    fireKeydown('a');
    expect(handler).not.toHaveBeenCalled();
  });

  it('queries the document for an open dialog only once a binding matches', () => {
    const bindings: Binding[] = [
      {type: 'chord', key: 'b', mod: true, handler: vi.fn()},
      {type: 'chord', key: 'j', handler: vi.fn()},
      {type: 'sequence', prefix: 'g', key: 'a', handler: vi.fn()},
    ];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));
    const input = focusedInput();
    const query = vi.spyOn(document, 'querySelector');

    // Typing in a field, even a bound letter, and a key nothing binds.
    for (const key of ['x', 'j', 'g', 'a']) fireKeydown(key, {target: input});
    fireKeydown('x');
    expect(query).not.toHaveBeenCalled();

    // Precondition: a matching chord does query, so the spy sees the guard.
    fireKeydown('b', {meta: true});
    expect(query).toHaveBeenCalled();
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
