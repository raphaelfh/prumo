/**
 * The write side of archive/restore.
 *
 * The endpoint (`PATCH /api/v1/projects/{id}/archive`) is manager-gated by
 * `require_project_manager`, so a reviewer's attempt comes back 403 rather
 * than as a silent zero-row success — that hazard belongs to PostgREST writes
 * and this write is not one. What still has to hold on the client: the
 * response must actually describe the transition that was asked for (a server
 * that answered about a different state would otherwise be rendered as
 * success), and success must invalidate the ONE identity-scoped list entry
 * the hub, the switcher and the breadcrumb all read.
 */
import type {ReactNode} from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const setProjectArchived = vi.fn();
vi.mock('@/services/projectsService', () => ({
  setProjectArchived: (projectId: string, archived: boolean) =>
    setProjectArchived(projectId, archived),
}));

vi.mock('@/contexts/AuthContext', () => ({useAuth: () => ({user: {id: 'u1'}})}));

import {useArchiveProject} from '@/hooks/useArchiveProject';
import {projectsListKey} from '@/hooks/useProjectsQuery';

function harness() {
  const queryClient = new QueryClient({defaultOptions: {mutations: {retry: false}}});
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const {result} = renderHook(() => useArchiveProject(), {
    wrapper: ({children}: {children: ReactNode}) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return {result, invalidate};
}

describe('useArchiveProject', () => {
  beforeEach(() => vi.clearAllMocks());

  it('archives and invalidates the caller\'s list entry — and only that entry', async () => {
    setProjectArchived.mockResolvedValue({ok: true, data: {id: 'p1', is_active: false}});
    const {result, invalidate} = harness();

    result.current.mutate({projectId: 'p1', archived: true});

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(setProjectArchived).toHaveBeenCalledWith('p1', true);
    // Not `projectKeys.all`: that prefix also covers members, templates, HITL
    // config, LLM endpoints and AI context for every project in the app.
    expect(invalidate).toHaveBeenCalledWith({queryKey: projectsListKey('u1')});
  });

  it('restores by asking for is_active true', async () => {
    setProjectArchived.mockResolvedValue({ok: true, data: {id: 'p1', is_active: true}});
    const {result} = harness();

    result.current.mutate({projectId: 'p1', archived: false});

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(setProjectArchived).toHaveBeenCalledWith('p1', false);
  });

  it('treats a response that contradicts the request as an error', async () => {
    // Asked to archive, told the project is still active: never render that
    // as success — the row on screen would disagree with the database.
    setProjectArchived.mockResolvedValue({ok: true, data: {id: 'p1', is_active: true}});
    const {result, invalidate} = harness();

    result.current.mutate({projectId: 'p1', archived: true});

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Could not update the project');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('surfaces a service error (a 403 from the manager gate lands here)', async () => {
    setProjectArchived.mockResolvedValue({ok: false, error: new Error('boom')});
    const {result} = harness();

    result.current.mutate({projectId: 'p1', archived: false});

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('boom');
  });
});
