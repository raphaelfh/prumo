import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/api', () => ({ apiClient: vi.fn() }));

const upload = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { storage: { from: (bucket: string) => ({ upload: (...a: unknown[]) => upload(bucket, ...a) }) } },
}));

import { apiClient } from '@/integrations/api';
import { FeedbackService } from '@/services/feedbackService';

const apiClientMock = apiClient as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  apiClientMock.mockReset();
  upload.mockReset();
});

describe('FeedbackService.submit', () => {
  it('POSTs /api/v1/feedback with the payload and returns report_id', async () => {
    apiClientMock.mockResolvedValueOnce({ report_id: 'r1' });
    const payload = {
      type: 'bug' as const,
      description: 'PDF viewer is blank on the extraction screen.',
      severity: 'high' as const,
      context: {
        url: 'https://app/x', route: '/projects/p/extraction', user_agent: 'UA',
        viewport_size: { width: 1, height: 2 }, project_id: null, article_id: null, app_version: 'v1',
      },
      attachments: [],
    };
    const result = await FeedbackService.submit(payload);
    expect(result.report_id).toBe('r1');
    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/feedback', {
      method: 'POST',
      body: payload,
    });
  });
});

describe('FeedbackService.uploadAttachment', () => {
  const file = new File(['x'], 'my report clip.mp4', { type: 'video/mp4' });

  it('stores under the caller\'s own uid prefix with a MIME-derived extension', async () => {
    upload.mockResolvedValueOnce({ error: null });
    const result = await FeedbackService.uploadAttachment(file, 'u1', { kind: 'video', extension: 'mp4' });

    expect(result.ok).toBe(true);
    const [bucket, storageKey, body, options] = upload.mock.calls[0];
    expect(bucket).toBe('feedback-media');
    // The storage RLS policy accepts nothing outside the caller's prefix, and
    // the key must never carry the picked file's untrusted name.
    expect(storageKey).toMatch(/^u1\/[0-9a-f-]{36}\.mp4$/);
    expect(storageKey).not.toContain('my report clip');
    expect(body).toBe(file);
    expect(options).toEqual({ contentType: 'video/mp4' });

    if (!result.ok) throw new Error('expected ok');
    expect(result.data).toEqual({
      kind: 'video',
      storage_key: storageKey,
      content_type: 'video/mp4',
      size_bytes: file.size,
    });
  });

  it('returns an ErrorResult instead of throwing when storage refuses', async () => {
    upload.mockResolvedValueOnce({ error: { message: 'mime type not allowed' } });
    const result = await FeedbackService.uploadAttachment(file, 'u1', { kind: 'video', extension: 'mp4' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.message).toBe('mime type not allowed');
  });
});
