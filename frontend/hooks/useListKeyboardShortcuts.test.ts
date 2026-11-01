/**
 * useListKeyboardShortcuts' Escape branch yields to an Escape another handler
 * already took (the split shell's capture-phase chain marks it handled).
 */
import {createEvent, fireEvent, renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {useListKeyboardShortcuts, type UseListKeyboardShortcutsOptions} from '@/hooks/useListKeyboardShortcuts';

function setup(overrides: Partial<UseListKeyboardShortcutsOptions> = {}) {
  const options: UseListKeyboardShortcutsOptions = {
    searchInputRef: {current: null},
    setFilterPopoverOpen: vi.fn(),
    filterPopoverOpen: false,
    ...overrides,
  };
  renderHook(() => useListKeyboardShortcuts(options));
  return options;
}

function handledEscape() {
  const ev = createEvent.keyDown(window, {key: 'Escape'});
  ev.preventDefault();
  fireEvent(window, ev);
}

describe('useListKeyboardShortcuts Escape', () => {
  it('ignores an Escape another handler already handled', () => {
    const popover = setup({filterPopoverOpen: true});
    handledEscape();
    expect(popover.setFilterPopoverOpen).not.toHaveBeenCalled();
  });

  it('ignores an already-handled Escape with rows selected', () => {
    const deselectAll = vi.fn();
    setup({selectedCount: 2, deselectAll});
    handledEscape();
    expect(deselectAll).not.toHaveBeenCalled();
  });

  it('closes the filter popover on a fresh Escape', () => {
    const popover = setup({filterPopoverOpen: true});
    fireEvent.keyDown(window, {key: 'Escape'});
    expect(popover.setFilterPopoverOpen).toHaveBeenCalledWith(false);
  });
});

describe('useListKeyboardShortcuts enabled', () => {
  it('registers nothing when disabled', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const popover = setup({searchInputRef: {current: input}, enabled: false});
    fireEvent.keyDown(window, {key: 'f', metaKey: true});
    fireEvent.keyDown(window, {key: 'f'});
    expect(input).not.toHaveFocus();
    expect(popover.setFilterPopoverOpen).not.toHaveBeenCalled();
    input.remove();
  });

  it('still handles keys by default', () => {
    const popover = setup();
    fireEvent.keyDown(window, {key: 'f'});
    expect(popover.setFilterPopoverOpen).toHaveBeenCalledTimes(1);
  });
});
