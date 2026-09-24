/**
 * The Settings save goes through PATCH /projects/{id}/details with an
 * optimistic precondition (`expected` = the values the page loaded):
 * only changed keys travel, a 409 STALE_VALUE raises the stale banner
 * instead of an error toast, and a successful save refreshes the two cached
 * reads that show the saved columns (AI context + the caller's project list).
 */
import type {ReactNode} from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

type Reply = {status: number; body: unknown};

const h = vi.hoisted(() => {
  const serverRow: Record<string, unknown> = {};
  const updateMock = vi.fn();
  const fromMock = vi.fn(() => ({
    select: () => ({eq: () => ({single: async () => ({data: {...serverRow}, error: null})})}),
    update: updateMock,
  }));
  return {serverRow, updateMock, fromMock};
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {getSession: vi.fn(async () => ({data: {session: {access_token: 'test'}}}))},
    from: h.fromMock,
  },
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));
vi.mock('@/contexts/AuthContext', () => ({useAuth: () => ({user: {id: 'u1'}})}));

import {toast} from 'sonner';
import {server} from '@/test/mocks/server';
import {t} from '@/lib/copy';
import {projectKeys} from '@/lib/query-keys';
import {projectsListKey} from '@/hooks/useProjectsQuery';
import {useProjectSettings} from '@/hooks/useProjectSettings';

const BASE_ROW = {
  id: 'p1',
  name: 'Old',
  description: 'D',
  review_type: 'interventional',
  review_title: null,
  condition_studied: null,
  review_rationale: null,
  search_strategy: null,
  review_context: null,
  eligibility_criteria: {inclusion: [], exclusion: [], notes: ''},
  study_design: {types: [], notes: ''},
  review_keywords: [],
  settings: {},
};

let requests: unknown[] = [];
let replies: Reply[] = [];

const OK: Reply = {status: 200, body: {ok: true, data: {}}};
const STALE_NAME: Reply = {
  status: 409,
  body: {ok: false, error: {code: 'STALE_VALUE', message: 'stale', details: {current: {name: 'Agent'}}}},
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(h.serverRow)) delete h.serverRow[key];
  Object.assign(h.serverRow, structuredClone(BASE_ROW));
  requests = [];
  replies = [];
  server.use(
    http.patch('*/api/v1/projects/:id/details', async ({request}) => {
      requests.push(await request.json());
      const reply = replies.shift() ?? OK;
      return HttpResponse.json(reply.body as never, {status: reply.status});
    }),
  );
});

afterEach(() => server.resetHandlers());

async function harness() {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const view = renderHook(() => useProjectSettings('p1'), {
    wrapper: ({children}: {children: ReactNode}) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() => expect(view.result.current.project?.name).toBe('Old'));
  return {...view, invalidate};
}

describe('useProjectSettings save', () => {
  it('sends only the changed keys, then refreshes the two cached reads', async () => {
    const {result, invalidate} = await harness();
    const loadsBefore = h.fromMock.mock.calls.length;

    act(() => result.current.updateProject({name: 'New'}));
    await act(() => result.current.saveProject());

    expect(requests).toEqual([{fields: {name: 'New'}, expected: {name: 'Old'}}]);
    expect(h.updateMock).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(t('project', 'settingsSaveSuccess'));
    expect(h.fromMock.mock.calls.length).toBeGreaterThan(loadsBefore);
    expect(invalidate).toHaveBeenCalledWith({queryKey: projectKeys.aiContext('p1')});
    expect(invalidate).toHaveBeenCalledWith({queryKey: projectsListKey('u1')});
    expect(invalidate).not.toHaveBeenCalledWith({queryKey: projectKeys.all});
  });

  it('a 409 STALE_VALUE names the contested fields and keeps the edit, without a toast', async () => {
    const {result, invalidate} = await harness();
    replies.push(STALE_NAME);

    act(() => result.current.updateProject({name: 'New'}));
    await act(() => result.current.saveProject());

    expect(result.current.staleFields).toEqual(['name']);
    expect(result.current.project?.name).toBe('New');
    expect(result.current.hasUnsavedChanges).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('keep mine re-sends the edit against the server values', async () => {
    const {result} = await harness();
    replies.push(STALE_NAME, OK);

    act(() => result.current.updateProject({name: 'New'}));
    await act(() => result.current.saveProject());
    await act(() => result.current.keepMine());

    expect(requests[1]).toEqual({fields: {name: 'New'}, expected: {name: 'Agent'}});
    expect(result.current.staleFields).toEqual([]);
  });

  it('load latest takes the server value for the contested fields and keeps the other edits', async () => {
    const {result} = await harness();
    replies.push(STALE_NAME);

    act(() => result.current.updateProject({name: 'New', description: 'Mine'}));
    await act(() => result.current.saveProject());
    expect(result.current.staleFields).toEqual(['name']);

    h.serverRow.name = 'Agent';
    await act(() => result.current.loadLatest());

    expect(result.current.project?.name).toBe('Agent');
    expect(result.current.project?.description).toBe('Mine');
    expect(result.current.hasUnsavedChanges).toBe(true);
    expect(result.current.staleFields).toEqual([]);
  });

  it('a 403 toasts the save error, keeps the edit and invalidates nothing', async () => {
    const {result, invalidate} = await harness();
    replies.push({status: 403, body: {ok: false, error: {code: 'FORBIDDEN', message: 'Manager role required'}}});

    act(() => result.current.updateProject({name: 'New'}));
    await act(() => result.current.saveProject());

    expect(toast.error).toHaveBeenCalledWith(t('project', 'settingsSaveError'));
    expect(result.current.project?.name).toBe('New');
    expect(result.current.staleFields).toEqual([]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('an edit back to the loaded value sends nothing', async () => {
    const {result} = await harness();

    act(() => result.current.updateProject({name: 'Old'}));
    await act(() => result.current.saveProject());

    expect(requests).toEqual([]);
    expect(result.current.hasUnsavedChanges).toBe(false);
  });

  it('a JSONB value of the wrong shape is refused before any request', async () => {
    const {result} = await harness();

    act(() => result.current.updateProject({review_keywords: 'x' as unknown as string[]}));
    await act(() => result.current.saveProject());

    expect(requests).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(t('project', 'settingsSaveError'));
    expect(result.current.project?.review_keywords).toBe('x');
  });
});
