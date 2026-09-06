import { describe, expect, it } from 'vitest';

import { checkFeedbackMedia, FEEDBACK_MEDIA_ACCEPT } from '@/lib/feedback-media';

/** A File whose reported size is `size`, without allocating that many bytes. */
function fileOf(name: string, type: string, size = 1024): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('checkFeedbackMedia', () => {
  it('classifies each accepted type by kind and storage extension', () => {
    expect(checkFeedbackMedia(fileOf('a.png', 'image/png'))).toEqual({
      ok: true, spec: { kind: 'image', extension: 'png' },
    });
    expect(checkFeedbackMedia(fileOf('a.jpg', 'image/jpeg'))).toEqual({
      ok: true, spec: { kind: 'image', extension: 'jpg' },
    });
    expect(checkFeedbackMedia(fileOf('a.mp4', 'video/mp4'))).toEqual({
      ok: true, spec: { kind: 'video', extension: 'mp4' },
    });
    expect(checkFeedbackMedia(fileOf('a.mov', 'video/quicktime'))).toEqual({
      ok: true, spec: { kind: 'video', extension: 'mov' },
    });
  });

  it('rejects a type the storage bucket and the backend would refuse', () => {
    expect(checkFeedbackMedia(fileOf('a.pdf', 'application/pdf'))).toEqual({ ok: false, reason: 'type' });
    // A file the OS could not type at all still has to be refused, not
    // uploaded with an empty content_type.
    expect(checkFeedbackMedia(fileOf('a.bin', ''))).toEqual({ ok: false, reason: 'type' });
  });

  it('caps images at 10 MB and videos at 50 MB', () => {
    const mb = 1024 * 1024;
    expect(checkFeedbackMedia(fileOf('a.png', 'image/png', 10 * mb)).ok).toBe(true);
    expect(checkFeedbackMedia(fileOf('a.png', 'image/png', 10 * mb + 1))).toEqual({ ok: false, reason: 'size' });
    // The video cap is the looser one — a 20 MB clip passes where a 20 MB
    // image would not.
    expect(checkFeedbackMedia(fileOf('a.mp4', 'video/mp4', 20 * mb)).ok).toBe(true);
    expect(checkFeedbackMedia(fileOf('a.mp4', 'video/mp4', 50 * mb + 1))).toEqual({ ok: false, reason: 'size' });
  });

  it('offers the same set to the file picker, with no wildcard', () => {
    expect(FEEDBACK_MEDIA_ACCEPT.split(',')).toEqual([
      'image/png', 'image/jpeg', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm', 'video/quicktime',
    ]);
    expect(FEEDBACK_MEDIA_ACCEPT).not.toContain('*');
  });
});
