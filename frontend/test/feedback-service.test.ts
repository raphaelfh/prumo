import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/api', () => ({ apiClient: vi.fn() }));
import { apiClient } from '@/integrations/api';
import { FeedbackService } from '@/services/feedbackService';

const apiClientMock = apiClient as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => apiClientMock.mockReset());

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
