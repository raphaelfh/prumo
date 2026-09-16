/**
 * RunAIBatchDialog — confirm payload and the F1/F3/F4 error branches
 * (spec 2026-09-15 §10, §11.3).
 */
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: null}})}},
}));

const mutate = vi.fn();
vi.mock('@/hooks/extraction/useExtractionBatches', () => ({
  useStartBatch: () => ({mutate, isPending: false}),
}));

vi.mock('@/hooks/extraction/useLlmEngine', () => ({
  useLlmEngine: () => ({data: undefined, isPending: false, isError: false}),
}));

vi.mock('sonner', () => ({
  toast: {success: vi.fn(), error: vi.fn()},
}));

import {toast} from 'sonner';

import {ApiError} from '@/integrations/api/client';
import {RunAIBatchDialog} from '@/components/extraction/batch/RunAIBatchDialog';

const base = {
  open: true,
  onOpenChange: vi.fn(),
  projectId: 'p1',
  templateId: 't1',
  articleIds: ['a1', 'a2'],
  onStarted: vi.fn(),
};

describe('RunAIBatchDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    base.onOpenChange = vi.fn();
    base.onStarted = vi.fn();
  });

  it('sends the exact start payload with skip=true by default', async () => {
    const user = userEvent.setup();
    render(<RunAIBatchDialog {...base} />);
    await user.click(screen.getByRole('button', {name: 'Run AI'}));
    expect(mutate).toHaveBeenCalledWith(
      {
        project_id: 'p1',
        template_id: 't1',
        article_ids: ['a1', 'a2'],
        skip_articles_with_ai_suggestions: true,
      },
      expect.any(Object),
    );
  });

  it('sends skip=false when defaultSkipExisting is false', async () => {
    const user = userEvent.setup();
    render(<RunAIBatchDialog {...base} defaultSkipExisting={false} />);
    await user.click(screen.getByRole('button', {name: 'Run AI'}));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({skip_articles_with_ai_suggestions: false}),
      expect.any(Object),
    );
  });

  it.each([
    ['LLM_ENGINE_RETIRED', 'AI is not configured'],
    ['MISSING_API_KEY', 'AI is not configured'],
    ['LLM_ENDPOINT_UNAVAILABLE', 'AI is not configured'],
  ])('shows the engine-problem toast for %s', async (code, title) => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars, opts) => {
      opts.onError(new ApiError(code, 'boom', 500));
    });
    render(<RunAIBatchDialog {...base} />);
    await user.click(screen.getByRole('button', {name: 'Run AI'}));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(title));
    expect(base.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('shows the queue-down toast on SERVICE_UNAVAILABLE', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars, opts) => {
      opts.onError(new ApiError('SERVICE_UNAVAILABLE', 'boom', 503));
    });
    render(<RunAIBatchDialog {...base} />);
    await user.click(screen.getByRole('button', {name: 'Run AI'}));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('The AI queue is unavailable', expect.anything()),
    );
  });

  it('shows the already-active toast on AI_BATCH_ALREADY_ACTIVE', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars, opts) => {
      opts.onError(new ApiError('AI_BATCH_ALREADY_ACTIVE', 'boom', 409, undefined, {batch_id: 'b1'}));
    });
    render(<RunAIBatchDialog {...base} />);
    await user.click(screen.getByRole('button', {name: 'Run AI'}));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('An AI batch is already running for this tool'),
    );
  });

  it('closes and calls onStarted on success', async () => {
    const user = userEvent.setup();
    const batch = {id: 'b1'};
    mutate.mockImplementation((_vars, opts) => {
      opts.onSuccess(batch);
    });
    render(<RunAIBatchDialog {...base} />);
    await user.click(screen.getByRole('button', {name: 'Run AI'}));
    await waitFor(() => expect(base.onOpenChange).toHaveBeenCalledWith(false));
    expect(base.onStarted).toHaveBeenCalledWith(batch);
    expect(toast.success).toHaveBeenCalled();
  });
});
