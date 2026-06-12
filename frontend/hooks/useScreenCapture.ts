/**
 * Screen capture via getDisplayMedia(): a single still frame or a short
 * webm clip. Accurate on the PDF.js viewer (unlike DOM-screenshot libs).
 * Each call prompts the browser's "share your screen" picker.
 */
import { useCallback, useMemo, useState } from 'react';
import {captureScreenStill, recordScreenClip} from '@/lib/screen-capture';

export interface ScreenCapture {
  isSupported: boolean;
  capturing: boolean;
  captureStill: () => Promise<Blob | null>;
  recordClip: (maxSeconds?: number) => Promise<Blob | null>;
}

export function useScreenCapture(): ScreenCapture {
  const [capturing, setCapturing] = useState(false);

  const isSupported = useMemo(
    () =>
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getDisplayMedia === 'function',
    [],
  );

  const captureStill = useCallback(async (): Promise<Blob | null> => {
    if (!isSupported) return null;
    setCapturing(true);
    // IO + try/catch/finally lives in lib/screen-capture.captureScreenStill
    const result = await captureScreenStill();
    setCapturing(false);
    return result;
  }, [isSupported]);

  const recordClip = useCallback(
    async (maxSeconds = 30): Promise<Blob | null> => {
      if (!isSupported) return null;
      setCapturing(true);
      // IO + try/catch/finally lives in lib/screen-capture.recordScreenClip
      const result = await recordScreenClip(maxSeconds);
      setCapturing(false);
      return result;
    },
    [isSupported],
  );

  return { isSupported, capturing, captureStill, recordClip };
}
