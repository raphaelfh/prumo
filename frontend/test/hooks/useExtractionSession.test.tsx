/**
 * Tests for the ``useExtractionSession`` hook — confirms that opening
 * a Data-Extraction surface POSTs to the unified
 * ``/api/v1/hitl/sessions`` endpoint with ``kind=extraction`` and
 * surfaces the run / template / instance map the form needs.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/api', () => ({
  apiClient: vi.fn(),
}));

import { apiClient } from '@/integrations/api';
import { useExtractionSession } from '@/hooks/extraction/useExtractionSession';
import { runsKeys, type RunViewResponse } from '@/hooks/runs/types';

const apiClientMock = apiClient as unknown as ReturnType<typeof vi.fn>;

function createWrapper(): {
  wrapper: (props: { children: ReactNode }) => ReactElement;
  queryClient: QueryClient;
} {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, queryClient };
}

const OPEN_RESPONSE = {
  run_id: 'run-1',
  kind: 'extraction',
  project_template_id: 'tpl-1',
  instances_by_entity_type: {
    'et-aaa': 'inst-aaa',
    'et-bbb': 'inst-bbb',
  },
  run_view: null,
};

/** Minimal RunViewResponse fixture that satisfies the TS type. */
const RUN_VIEW_FIXTURE: RunViewResponse = {
  run: {
    id: 'run-1',
    project_id: 'proj-1',
    article_id: 'art-1',
    template_id: 'tpl-1',
    kind: 'extraction',
    version_id: 'ver-1',
    stage: 'proposal',
    status: 'active',
    hitl_config_snapshot: {},
    parameters: {},
    results: {},
    created_at: '2026-01-01T00:00:00Z',
    created_by: 'user-1',
  },
  proposals: [],
  decisions: [],
  consensus_decisions: [],
  published_states: [],
  entity_types: [],
  current_values: [],
  instances: [],
};

beforeEach(() => {
  apiClientMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useExtractionSession', () => {
  it('POSTs to /api/v1/hitl/sessions with kind=extraction and project_template_id', async () => {
    const { wrapper } = createWrapper();
    apiClientMock.mockResolvedValueOnce(OPEN_RESPONSE);

    const { result } = renderHook(
      () =>
        useExtractionSession({
          projectId: 'proj-1',
          articleId: 'art-1',
          projectTemplateId: 'tpl-1',
        }),
      { wrapper },
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
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        useExtractionSession({
          projectId: 'proj-1',
          articleId: undefined,
          projectTemplateId: 'tpl-1',
        }),
      { wrapper },
    );

    // Give the effect a tick to run
    await new Promise((r) => setTimeout(r, 0));
    expect(apiClientMock).not.toHaveBeenCalled();
    expect(result.current.session).toBeNull();
  });

  it('respects enabled=false', async () => {
    const { wrapper } = createWrapper();

    renderHook(
      () =>
        useExtractionSession({
          projectId: 'proj-1',
          articleId: 'art-1',
          projectTemplateId: 'tpl-1',
          enabled: false,
        }),
      { wrapper },
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(apiClientMock).not.toHaveBeenCalled();
  });

  it('surfaces error message when the open call fails', async () => {
    const { wrapper } = createWrapper();
    apiClientMock.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(
      () =>
        useExtractionSession({
          projectId: 'proj-1',
          articleId: 'art-1',
          projectTemplateId: 'tpl-1',
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.session).toBeNull();
  });

  it('refetch re-opens the session on demand', async () => {
    const { wrapper } = createWrapper();
    apiClientMock.mockResolvedValue(OPEN_RESPONSE);

    const { result } = renderHook(
      () =>
        useExtractionSession({
          projectId: 'proj-1',
          articleId: 'art-1',
          projectTemplateId: 'tpl-1',
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.session).not.toBeNull());
    await result.current.refetch();
    expect(apiClientMock).toHaveBeenCalledTimes(2);
  });

  it('discards a stale in-flight response when the article changes mid-fetch (#23)', async () => {
    const { wrapper } = createWrapper();
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
        wrapper,
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

  it('seeds the TanStack Query run-detail cache when run_view is present', async () => {
    const { wrapper, queryClient } = createWrapper();
    apiClientMock.mockResolvedValueOnce({
      ...OPEN_RESPONSE,
      run_view: RUN_VIEW_FIXTURE,
    });

    const { result } = renderHook(
      () =>
        useExtractionSession({
          projectId: 'proj-1',
          articleId: 'art-1',
          projectTemplateId: 'tpl-1',
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.session).not.toBeNull());

    // The hook should have pre-seeded the run-detail cache entry so that
    // useRun can serve it without a network GET on first paint.
    expect(queryClient.getQueryData(runsKeys.detail('run-1'))).toEqual(
      RUN_VIEW_FIXTURE,
    );
  });

  it('does NOT seed the cache when run_view is null (QA-style response)', async () => {
    const { wrapper, queryClient } = createWrapper();
    apiClientMock.mockResolvedValueOnce({
      ...OPEN_RESPONSE,
      run_view: null,
    });

    const { result } = renderHook(
      () =>
        useExtractionSession({
          projectId: 'proj-1',
          articleId: 'art-1',
          projectTemplateId: 'tpl-1',
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.session).not.toBeNull());

    // session should still be set (runId present)
    expect(result.current.session?.runId).toBe('run-1');
    // but no cache entry should have been written
    expect(queryClient.getQueryData(runsKeys.detail('run-1'))).toBeUndefined();
  });
});
