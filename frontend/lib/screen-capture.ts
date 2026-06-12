/**
 * Browser screen-capture helpers — extracted from useScreenCapture so the
 * hook's callbacks contain no try/catch/finally (zero-bailouts spec, 2026-06-12).
 *
 * Module-level functions are not compiled by the React Compiler, so
 * try/catch/finally blocks are fine here.
 */

/** Minimal interface for the ImageCapture Web API (not in all TS DOM lib versions). */
interface ImageCaptureApi {
  grabFrame(): Promise<ImageBitmap>;
}
interface ImageCaptureCtor {
  new (track: MediaStreamTrack): ImageCaptureApi;
}

/** Stop all tracks in a MediaStream. */
export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/**
 * Acquire a display-media stream, grab one still frame as a WebP Blob, then
 * release the stream. Returns null when the user cancels or the API errors.
 */
export async function captureScreenStill(): Promise<Blob | null> {
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: false});
    const track = stream.getVideoTracks()[0];
    const ImageCaptureCtor = (window as unknown as {ImageCapture?: ImageCaptureCtor}).ImageCapture;
    if (ImageCaptureCtor && track) {
      const bitmap = await new ImageCaptureCtor(track).grabFrame();
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
      return await new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/webp', 0.9));
    }
    return null;
  } catch {
    return null;
  } finally {
    if (stream) stopStream(stream);
  }
}

/**
 * Acquire a display-media stream, record a WebM clip for up to maxSeconds or
 * until the user ends sharing, then release the stream. Returns null on error
 * or user cancel.
 */
export async function recordScreenClip(maxSeconds = 30): Promise<Blob | null> {
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: false});
    const activeStream = stream;
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(activeStream, {mimeType: 'video/webm'});
    const done = new Promise<Blob>(resolve => {
      recorder.ondataavailable = e => e.data.size > 0 && chunks.push(e.data);
      recorder.onstop = () => resolve(new Blob(chunks, {type: 'video/webm'}));
    });
    activeStream.getVideoTracks()[0].addEventListener('ended', () => recorder.stop());
    const timer = setTimeout(
      () => recorder.state !== 'inactive' && recorder.stop(),
      maxSeconds * 1000,
    );
    recorder.start();
    const blob = await done;
    clearTimeout(timer);
    return blob;
  } catch {
    return null;
  } finally {
    if (stream) stopStream(stream);
  }
}
