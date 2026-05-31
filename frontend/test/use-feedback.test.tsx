import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/feedbackService', () => ({
  FeedbackService: { submit: vi.fn() },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { FeedbackService } from '@/services/feedbackService';
import { useFeedback } from '@/hooks/useFeedback';

const submitMock = FeedbackService.submit as unknown as ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => submitMock.mockReset());

describe('useFeedback', () => {
  it('submits via FeedbackService with captured context + attachments', async () => {
    submitMock.mockResolvedValueOnce({ report_id: 'r1' });
    const { result } = renderHook(() => useFeedback(), { wrapper });

    let ok = false;
    await act(async () => {
      ok = await result.current.submitFeedback(
        { type: 'bug', description: 'PDF viewer is blank on the extraction screen.', severity: 'high' },
        [{ kind: 'image', storage_key: 'u1/x.webp', content_type: 'image/webp', size_bytes: 10 }],
      );
    });

    expect(ok).toBe(true);
    expect(submitMock).toHaveBeenCalledTimes(1);
    const payload = submitMock.mock.calls[0][0];
    expect(payload.type).toBe('bug');
    expect(payload.attachments).toHaveLength(1);
    expect(payload.context).toHaveProperty('url');
    expect(payload.context).toHaveProperty('user_agent');
  });
});
