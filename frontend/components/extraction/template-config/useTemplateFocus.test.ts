/**
 * useTemplateFocus: the render-phase sequence comparison behind the config
 * bar's ✨ trigger. The guard is the sequence, not the callback — a fresh
 * callback identity on every render must not re-fire it.
 */
import {renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {useTemplateFocus} from './useTemplateFocus';

describe('useTemplateFocus', () => {
  it('does not fire for the mount-time sequence', () => {
    const onFocus = vi.fn();
    renderHook(({seq}) => useTemplateFocus(seq, onFocus), {initialProps: {seq: 0}});
    expect(onFocus).not.toHaveBeenCalled();
  });

  it('fires once per new sequence value and not on a same-value rerender', () => {
    const onFocus = vi.fn();
    const {rerender} = renderHook(
      ({seq}) => useTemplateFocus(seq, () => onFocus(seq)),
      {initialProps: {seq: 0}},
    );

    rerender({seq: 1});
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenLastCalledWith(1);

    rerender({seq: 1});
    rerender({seq: 1});
    expect(onFocus).toHaveBeenCalledTimes(1);

    rerender({seq: 2});
    expect(onFocus).toHaveBeenCalledTimes(2);
    expect(onFocus).toHaveBeenLastCalledWith(2);
  });
});
