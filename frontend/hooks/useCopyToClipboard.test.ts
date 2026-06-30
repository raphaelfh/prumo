import {act, renderHook, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {useCopyToClipboard} from './useCopyToClipboard';

// jsdom does not provide navigator.clipboard (only @testing-library/user-event
// installs a stub). renderHook tests don't use user-event, so define it here.
function mockWriteText(impl: () => Promise<void>): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, 'clipboard', {
    value: {writeText},
    configurable: true,
    writable: true,
  });
  return writeText;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useCopyToClipboard', () => {
  it('starts not copied', () => {
    const {result} = renderHook(() => useCopyToClipboard());
    expect(result.current.copied).toBe(false);
  });

  it('writes the text and flips copied=true on success', async () => {
    const writeText = mockWriteText(() => Promise.resolve());
    const {result} = renderHook(() => useCopyToClipboard());

    act(() => result.current.copy('hello'));

    expect(writeText).toHaveBeenCalledWith('hello');
    await waitFor(() => expect(result.current.copied).toBe(true));
  });

  it('does NOT flip copied when the clipboard write rejects', async () => {
    const writeText = mockWriteText(() => Promise.reject(new Error('denied')));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const {result} = renderHook(() => useCopyToClipboard());

    await act(async () => {
      result.current.copy('hello');
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledOnce();
    expect(result.current.copied).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });

  it('reverts copied to false after resetMs', async () => {
    vi.useFakeTimers();
    mockWriteText(() => Promise.resolve());
    const {result} = renderHook(() => useCopyToClipboard(1000));

    await act(async () => {
      result.current.copy('hello');
      await Promise.resolve();
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.copied).toBe(false);
  });
});
