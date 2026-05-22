/**
 * Tests for the ``useExtractionSession`` hook — confirms that opening
 * a Data-Extraction surface POSTs to the unified
 * ``/api/v1/hitl/sessions`` endpoint with ``kind=extraction`` and
 * surfaces the run / template / instance map the form needs.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/api', () => ({
  apiClient: vi.fn(),
}));

import { apiClient } from '@/integrations/api';
import { useExtractionSession } from '@/hooks/extraction/useExtractionSession';

const apiClientMock = apiClient as unknown as ReturnType<typeof vi.fn>;

const OPEN_RESPONSE = {
  run_id: 'run-1',
  kind: 'extraction',
  project_template_id: 'tpl-1',
  instances_by_entity_type: {
    'et-aaa': 'inst-aaa',
    'et-bbb': 'inst-bbb',
  },
};

beforeEach(() => {
  apiClientMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useExtractionSession', () => {
  it('POSTs to /api/v1/hitl/sessions with kind=extraction and project_template_id', async () => {
    apiClientMock.mockResolvedValueOnce(OPEN_RESPONSE);

    const { result } = renderHook(() =>
      useExtractionSession({
        projectId: 'proj-1',
        articleId: 'art-1',
        projectTemplateId: 'tpl-1',
      }),
    );

    await waitFor(() => expect(result.current.session).not.toBeNull());

    expect(apiClientMock).toHaveBeenCalledTimes(1);
    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/hitl/sessions', {
      method: 'POST',
      body: {
        kind: 'extraction',
        project_id: 'proj-1',
        article_id: 'art-1',
        project_template_id: 'tpl-1',
      },
    });
    expect(result.current.session).toEqual({
      runId: 'run-1',
      projectTemplateId: 'tpl-1',
      instancesByEntityType: { 'et-aaa': 'inst-aaa', 'et-bbb': 'inst-bbb' },
    });
    expect(result.current.error).toBeNull();
  });

  it('does not call the API while inputs are missing', async () => {
    const { result } = renderHook(() =>
      useExtractionSession({
        projectId: 'proj-1',
        articleId: undefined,
        projectTemplateId: 'tpl-1',
      }),
    );

    // Give the effect a tick to run
    await new Promise((r) => setTimeout(r, 0));
    expect(apiClientMock).not.toHaveBeenCalled();
    expect(result.current.session).toBeNull();
  });

  it('respects enabled=false', async () => {
    renderHook(() =>
      useExtractionSession({
        projectId: 'proj-1',
        articleId: 'art-1',
        projectTemplateId: 'tpl-1',
        enabled: false,
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(apiClientMock).not.toHaveBeenCalled();
  });

  it('surfaces error message when the open call fails', async () => {
    apiClientMock.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() =>
      useExtractionSession({
        projectId: 'proj-1',
        articleId: 'art-1',
        projectTemplateId: 'tpl-1',
      }),
    );

    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.session).toBeNull();
  });

  it('refetch re-opens the session on demand', async () => {
    apiClientMock.mockResolvedValue(OPEN_RESPONSE);

    const { result } = renderHook(() =>
      useExtractionSession({
        projectId: 'proj-1',
        articleId: 'art-1',
        projectTemplateId: 'tpl-1',
      }),
    );

    await waitFor(() => expect(result.current.session).not.toBeNull());
    await result.current.refetch();
    expect(apiClientMock).toHaveBeenCalledTimes(2);
  });

  it('discards a stale in-flight response when the article changes mid-fetch (#23)', async () => {
    // Article A's open() will hang until we release it. Article B fires
    // straight away and resolves with its own response. Without the
    // generation guard, A's later-resolving response would overwrite
    // B's session and route subsequent autosave to A's run.
    let releaseA!: (v: typeof OPEN_RESPONSE) => void;
    apiClientMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseA = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ...OPEN_RESPONSE,
        run_id: 'run-B',
        project_template_id: 'tpl-B',
      });

    const { result, rerender } = renderHook(
      ({ articleId, projectTemplateId }) =>
        useExtractionSession({
          projectId: 'proj-1',
          articleId,
          projectTemplateId,
        }),
      {
        initialProps: { articleId: 'art-A', projectTemplateId: 'tpl-A' },
      },
    );

    // Switch to article B while A is still pending.
    rerender({ articleId: 'art-B', projectTemplateId: 'tpl-B' });

    // Now release A's response — it should be silently discarded.
    releaseA({
      ...OPEN_RESPONSE,
      run_id: 'run-A',
      project_template_id: 'tpl-A',
    });

    await waitFor(() => expect(result.current.session?.runId).toBe('run-B'));
    // Allow a microtask flush so A's stale handler has a chance to run.
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.session?.runId).toBe('run-B');
    expect(result.current.session?.projectTemplateId).toBe('tpl-B');
  });
});
