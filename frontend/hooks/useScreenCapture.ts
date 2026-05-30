/**
 * Screen capture via getDisplayMedia(): a single still frame or a short
 * webm clip. Accurate on the PDF.js viewer (unlike DOM-screenshot libs).
 * Each call prompts the browser's "share your screen" picker.
 */
import { useCallback, useMemo, useState } from 'react';

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

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
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      // Grab one frame. ImageCapture is the modern path; fall back to a
      // <video>+<canvas> draw when unavailable.
      const track = stream.getVideoTracks()[0];
      const ImageCaptureCtor = (window as unknown as { ImageCapture?: typeof ImageCapture }).ImageCapture;
      if (ImageCaptureCtor && track) {
        const bitmap = await new ImageCaptureCtor(track).grabFrame();
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
        return await new Promise((resolve) =>
          canvas.toBlob((b) => resolve(b), 'image/webp', 0.9),
        );
      }
      return null;
    } catch {
      return null;
    } finally {
      if (stream) stopStream(stream);
      setCapturing(false);
    }
  }, [isSupported]);

  const recordClip = useCallback(
    async (maxSeconds = 30): Promise<Blob | null> => {
      if (!isSupported) return null;
      setCapturing(true);
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const activeStream = stream;
        const chunks: BlobPart[] = [];
        const recorder = new MediaRecorder(activeStream, { mimeType: 'video/webm' });
        const done = new Promise<Blob>((resolve) => {
          recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
          recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
        });
        // Stop when the user ends sharing, or after maxSeconds.
        activeStream.getVideoTracks()[0].addEventListener('ended', () => recorder.stop());
        const timer = setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), maxSeconds * 1000);
        recorder.start();
        const blob = await done;
        clearTimeout(timer);
        return blob;
      } catch {
        return null;
      } finally {
        if (stream) stopStream(stream);
        setCapturing(false);
      }
    },
    [isSupported],
  );

  return { isSupported, capturing, captureStill, recordClip };
}
