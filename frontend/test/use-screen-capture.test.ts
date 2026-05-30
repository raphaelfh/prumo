import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useScreenCapture } from '@/hooks/useScreenCapture';

function fakeStream() {
  const track = { stop: vi.fn() };
  return { getTracks: () => [track], getVideoTracks: () => [track], _track: track } as unknown as MediaStream;
}

beforeEach(() => {
  // jsdom has no mediaDevices; install a mock.
  (navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
    getDisplayMedia: vi.fn().mockResolvedValue(fakeStream()),
  };
});

afterEach(() => vi.restoreAllMocks());

describe('useScreenCapture', () => {
  it('exposes captureStill and recordClip and reports supported when API present', () => {
    const { result } = renderHook(() => useScreenCapture());
    expect(typeof result.current.captureStill).toBe('function');
    expect(typeof result.current.recordClip).toBe('function');
    expect(result.current.isSupported).toBe(true);
  });

  it('captureStill requests the display media and stops tracks', async () => {
    const stream = fakeStream();
    (navigator.mediaDevices.getDisplayMedia as ReturnType<typeof vi.fn>).mockResolvedValueOnce(stream);
    const { result } = renderHook(() => useScreenCapture());
    // ImageCapture/grabFrame is not in jsdom — capture returns null gracefully
    // but must still request the stream and clean up.
    await act(async () => {
      await result.current.captureStill();
    });
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalled();
    expect((stream as unknown as { _track: { stop: ReturnType<typeof vi.fn> } })._track.stop).toHaveBeenCalled();
  });
});
