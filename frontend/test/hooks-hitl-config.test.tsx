/**
 * Tests for the HITL config TanStack Query hooks.
 *
 * The HTTP transport (`apiClient`) is mocked so each test asserts on
 * the URL + body the hooks issue and the resolved data flowing back
 * through React Query.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useClearProjectHitlConfig,
  useClearTemplateHitlConfig,
  useProjectHitlConfig,
  useTemplateHitlConfig,
  useUpsertProjectHitlConfig,
  useUpsertTemplateHitlConfig,
} from '@/hooks/hitl/useHitlConfig';

vi.mock('@/integrations/api', () => ({
  apiClient: vi.fn(),
}));

import { apiClient } from '@/integrations/api';

const apiClientMock = apiClient as unknown as ReturnType<typeof vi.fn>;

function createWrapper() {
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

const SAMPLE_RESPONSE = {
  scope_kind: 'project' as const,
  scope_id: 'proj-1',
  reviewer_count: 2,
  consensus_rule: 'majority' as const,
  arbitrator_id: null,
  inherited: false,
};

beforeEach(() => {
  apiClientMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useProjectHitlConfig', () => {
  it('issues GET /api/v1/projects/{id}/hitl-config and exposes the config', async () => {
    apiClientMock.mockResolvedValueOnce(SAMPLE_RESPONSE);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useProjectHitlConfig('proj-1'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/proj-1/hitl-config',
    );
    expect(result.current.data?.reviewer_count).toBe(2);
  });

  it('stays disabled when projectId is falsy', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useProjectHitlConfig(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(apiClientMock).not.toHaveBeenCalled();
  });
});

describe('useTemplateHitlConfig', () => {
  it('issues GET /api/v1/projects/{p}/templates/{t}/hitl-config', async () => {
    apiClientMock.mockResolvedValueOnce({
      ...SAMPLE_RESPONSE,
      scope_kind: 'template',
      inherited: false,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useTemplateHitlConfig('proj-1', 'tpl-9'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/proj-1/templates/tpl-9/hitl-config',
    );
  });
});

describe('upsert mutations', () => {
  it('PUT /api/v1/projects/{id}/hitl-config with body', async () => {
    apiClientMock.mockResolvedValueOnce(SAMPLE_RESPONSE);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpsertProjectHitlConfig('proj-1'), {
      wrapper,
    });
    await result.current.mutateAsync({
      reviewer_count: 2,
      consensus_rule: 'majority',
      arbitrator_id: null,
    });
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/proj-1/hitl-config',
      {
        method: 'PUT',
        body: {
          reviewer_count: 2,
          consensus_rule: 'majority',
          arbitrator_id: null,
        },
      },
    );
  });

  it('PUT /api/v1/projects/{p}/templates/{t}/hitl-config', async () => {
    apiClientMock.mockResolvedValueOnce(SAMPLE_RESPONSE);
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useUpsertTemplateHitlConfig('proj-1', 'tpl-9'),
      { wrapper },
    );
    await result.current.mutateAsync({
      reviewer_count: 3,
      consensus_rule: 'arbitrator',
      arbitrator_id: 'user-x',
    });
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/proj-1/templates/tpl-9/hitl-config',
      {
        method: 'PUT',
        body: {
          reviewer_count: 3,
          consensus_rule: 'arbitrator',
          arbitrator_id: 'user-x',
        },
      },
    );
  });
});

describe('clear mutations', () => {
  it('DELETE /api/v1/projects/{id}/hitl-config', async () => {
    apiClientMock.mockResolvedValueOnce({
      ...SAMPLE_RESPONSE,
      scope_kind: 'system_default',
      inherited: true,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useClearProjectHitlConfig('proj-1'), {
      wrapper,
    });
    await result.current.mutateAsync();
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/proj-1/hitl-config',
      { method: 'DELETE' },
    );
  });

  it('DELETE /api/v1/projects/{p}/templates/{t}/hitl-config', async () => {
    apiClientMock.mockResolvedValueOnce({
      ...SAMPLE_RESPONSE,
      scope_kind: 'project',
      inherited: true,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useClearTemplateHitlConfig('proj-1', 'tpl-9'),
      { wrapper },
    );
    await result.current.mutateAsync();
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/proj-1/templates/tpl-9/hitl-config',
      { method: 'DELETE' },
    );
  });
});
