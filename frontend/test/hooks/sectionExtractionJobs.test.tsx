import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {http, HttpResponse} from 'msw';
import {server} from '@/test/mocks/server';
import {useSectionExtraction} from '@/hooks/extraction/useSectionExtraction';
import {sectionJobKey, useSectionExtractionJobs} from '@/stores/sectionExtractionJobs';
import {extractionKeys} from '@/lib/query-keys';
import {runsKeys} from '@/hooks/runs/types';
import {toast} from 'sonner';

vi.mock('@/contexts/AuthContext', () => ({useAuth: () => ({user: {id: 'user-a'}})}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: vi.fn(async () => ({data: {session: {access_token: 'token'}}}))}},
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn(), info: vi.fn()}}));

const A = {projectId: 'project', articleId: 'article', templateId: 'template', runId: 'run', entityTypeId: 'a'};
const B = {...A, entityTypeId: 'b'};
const posts: Array<Record<string, unknown>> = [];
const statuses = new Map<string, string>();
const gets: string[] = [];
let kickoffFailure: 'network' | 'denied' | null = null;
let pollDenied = false;
let suggestions = 2;

function setup() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}}});
  const wrapper = ({children}: {children: ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return {client, wrapper};
}

beforeEach(() => {
  vi.clearAllMocks();
  useSectionExtractionJobs.setState({ownerId: 'user-a', records: {}});
  posts.length = 0;
  gets.length = 0;
  statuses.clear();
  kickoffFailure = null;
  pollDenied = false;
  suggestions = 2;
  server.use(
    http.post('*/api/v1/extraction/sections', async ({request}) => {
      const body = await request.json() as Record<string, unknown>;
      posts.push(body);
      if (kickoffFailure === 'network') return HttpResponse.error();
      if (kickoffFailure === 'denied') return HttpResponse.json({ok: false, error: {code: 'FORBIDDEN', message: 'Access denied'}}, {status: 403});
      const job = String(body.requestId);
      if (!statuses.has(job)) statuses.set(job, 'running');
      return HttpResponse.json({ok: true, data: {job_id: job}}, {status: 202});
    }),
    http.get('*/api/v1/extraction/sections/status/:id', ({params}) => {
      const id = String(params.id);
      gets.push(id);
      if (pollDenied) return HttpResponse.json({ok: false, error: {code: 'FORBIDDEN', message: 'Access denied'}}, {status: 403});
      return HttpResponse.json({ok: true, data: {
        jobId: id, status: statuses.get(id), error: statuses.get(id) === 'failed' ? 'Missing key' : null,
        errorCode: statuses.get(id) === 'failed' ? 'MISSING_API_KEY' : null,
        result: statuses.get(id) === 'completed' ? {mode: 'section', extractionRunId: A.runId, suggestionsCreated: suggestions} : null,
      }});
    }),
  );
});

afterEach(() => { vi.useRealTimers(); });

describe('session section jobs', () => {
  it('stops polling on unmount without cancelling the server job', async () => {
    const {wrapper} = setup();
    const hook = renderHook(() => useSectionExtraction({params: A}), {wrapper});
    await act(() => hook.result.current.extractSection(A));
    await waitFor(() => expect(gets).toHaveLength(1));
    vi.useFakeTimers();
    hook.unmount();
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(gets).toHaveLength(1);
    expect(statuses.get(String(posts[0].requestId))).toBe('running');
    expect(Object.values(useSectionExtractionJobs.getState().records)[0].jobId).toBe(posts[0].requestId);
  });

  it('the legacy API retains both kickoffs and handles both completions', async () => {
    const {wrapper, client} = setup();
    const onSuccess = vi.fn();
    const hook = renderHook(() => useSectionExtraction({onSuccess}), {wrapper});
    await act(async () => { await Promise.all([hook.result.current.extractSection(A), hook.result.current.extractSection(B)]); });
    expect(posts).toHaveLength(2);
    const first = String(posts[0].requestId);
    const second = String(posts[1].requestId);
    statuses.set(first, 'completed');
    statuses.set(second, 'completed');
    await act(() => client.refetchQueries({queryKey: extractionKeys.job(first)}));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(2));
    expect(hook.result.current.getSectionState(A).status).toBe('completed');
    expect(hook.result.current.getSectionState(B).status).toBe('completed');
    expect(hook.result.current.loading).toBe(false);
  });

  it('deduplicates concurrent kickoff for the same coordinate', async () => {
    const {wrapper} = setup();
    const hook = renderHook(() => useSectionExtraction({params: A}), {wrapper});
    await act(async () => { await Promise.all([hook.result.current.extractSection(A), hook.result.current.extractSection(A)]); });
    expect(posts).toHaveLength(1);
  });

  it('does not restore old records when kickoff resolves after sign-out', async () => {
    let release!: () => void;
    const responseReady = new Promise<void>(resolve => {release = resolve;});
    server.use(http.post('*/api/v1/extraction/sections', async () => {
      await responseReady;
      return HttpResponse.json({ok: true, data: {job_id: 'late-job'}}, {status: 202});
    }));
    const {wrapper} = setup();
    const hook = renderHook(() => useSectionExtraction({params: A}), {wrapper});
    let pending!: Promise<void>;
    act(() => {pending = hook.result.current.extractSection(A);});
    act(() => useSectionExtractionJobs.getState().adoptOwner(null));
    release();
    await act(() => pending);
    expect(useSectionExtractionJobs.getState().records).toEqual({});
    expect(gets).toHaveLength(0);
  });
  it('keys every coordinate and authenticated owner without delimiter collisions', () => {
    const scoped = {...A, userId: 'user-a'};
    for (const field of ['projectId', 'articleId', 'templateId', 'runId', 'entityTypeId', 'parentInstanceId', 'userId'] as const) {
      expect(sectionJobKey({...scoped, [field]: 'other'})).not.toBe(sectionJobKey(scoped));
    }
  });

  it('runs A and B independently and a remount resumes without another POST', async () => {
    const {wrapper, client} = setup();
    const a = renderHook(() => useSectionExtraction({params: A}), {wrapper});
    const b = renderHook(() => useSectionExtraction({params: B}), {wrapper});
    await act(() => a.result.current.extractSection(A));
    expect(a.result.current.loading).toBe(true);
    expect(b.result.current.loading).toBe(false);
    expect(a.result.current.getSectionState(B).status).toBe('idle');
    await act(() => b.result.current.extractSection(B));
    await waitFor(() => expect(gets).toHaveLength(2));
    expect(a.result.current.loading).toBe(true);
    expect(b.result.current.loading).toBe(true);
    a.unmount();
    expect(client.getQueryCache().find({queryKey: extractionKeys.job(String(posts[0].requestId))})?.getObserversCount() ?? 0).toBe(0);
    const remount = renderHook(() => useSectionExtraction({params: A}), {wrapper});
    await waitFor(() => expect(gets.filter(id => id === posts[0].requestId)).toHaveLength(2));
    expect(remount.result.current.loading).toBe(true);
    expect(posts).toHaveLength(2);
  });

  it.each(['articleId', 'templateId', 'runId', 'parentInstanceId'] as const)('switching %s shows only the selected coordinate', async field => {
    const {wrapper} = setup();
    const hook = renderHook(({params}) => useSectionExtraction({params}), {wrapper, initialProps: {params: A}});
    await act(() => hook.result.current.extractSection(A));
    hook.rerender({params: {...A, [field]: 'other'}});
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.error).toBeNull();
    hook.rerender({params: A});
    expect(hook.result.current.loading).toBe(true);
  });

  it('reuses the original request and payload only after uncertain POST transport', async () => {
    const {wrapper} = setup();
    const hook = renderHook(() => useSectionExtraction({params: A}), {wrapper});
    kickoffFailure = 'network';
    await act(() => hook.result.current.extractSection(A));
    expect(hook.result.current.getSectionState(A).uncertainTransport).toBe(true);
    kickoffFailure = null;
    await act(() => hook.result.current.extractSection({...A, autoAdvanceToReview: true}));
    expect(posts[0].requestId).toBe(posts[1].requestId);
    expect(posts[1]).toEqual(posts[0]);
  });

  it.each(['failed', 'cancelled'])('creates a fresh request after confirmed %s', async terminal => {
    const {wrapper, client} = setup();
    const hook = renderHook(() => useSectionExtraction({params: A}), {wrapper});
    await act(() => hook.result.current.extractSection(A));
    const first = String(posts[0].requestId);
    statuses.set(first, terminal);
    await act(() => client.refetchQueries({queryKey: extractionKeys.job(first)}));
    await waitFor(() => expect(hook.result.current.getSectionState(A).status).toBe(terminal));
    expect(hook.result.current.loading).toBe(false);
    await act(() => hook.result.current.extractSection(A));
    expect(posts[1].requestId).not.toBe(first);
  });

  it.each([0, 2])('handles %s suggestions once across duplicate subscribers and remounts; invalidates owning reads', async count => {
    suggestions = count;
    const {wrapper, client} = setup();
    const success = vi.fn();
    const hook = renderHook(() => useSectionExtraction({params: A, onSuccess: success}), {wrapper});
    const duplicate = renderHook(() => useSectionExtraction({params: A, onSuccess: success}), {wrapper});
    client.setQueryData(runsKeys.detail(A.runId), {before: true});
    client.setQueryData(runsKeys.detail('foreign-run'), {before: true});
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await act(() => hook.result.current.extractSection(A));
    const job = String(posts[0].requestId);
    statuses.set(job, 'completed');
    await act(() => client.refetchQueries({queryKey: extractionKeys.job(job)}));
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(client.getQueryState(runsKeys.detail(A.runId))?.isInvalidated).toBe(true);
    expect(client.getQueryState(runsKeys.detail('foreign-run'))?.isInvalidated).toBe(false);
    expect(invalidate).not.toHaveBeenCalledWith({queryKey: extractionKeys.all});
    expect(count === 0 ? toast.info : toast.success).toHaveBeenCalledTimes(1);
    hook.unmount();
    duplicate.unmount();
    renderHook(() => useSectionExtraction({params: A, onSuccess: success}), {wrapper});
    expect(success).toHaveBeenCalledTimes(1);
  });

  it.each(['kickoff', 'poll'])('clears sensitive records after %s access denial', async phase => {
    const {wrapper, client} = setup();
    const hook = renderHook(() => useSectionExtraction({params: A}), {wrapper});
    if (phase === 'kickoff') kickoffFailure = 'denied';
    await act(() => hook.result.current.extractSection(A));
    if (phase === 'poll') {
      pollDenied = true;
      await act(() => client.refetchQueries({queryKey: extractionKeys.job(String(posts[0].requestId))}));
    }
    await waitFor(() => expect(useSectionExtractionJobs.getState().records).toEqual({}));
    expect(hook.result.current.loading).toBe(false);
  });

  it('clears on identity changes while unmounted', async () => {
    const {wrapper} = setup();
    const hook = renderHook(() => useSectionExtraction({params: A}), {wrapper});
    await act(() => hook.result.current.extractSection(A));
    hook.unmount();
    useSectionExtractionJobs.getState().adoptOwner(null);
    expect(useSectionExtractionJobs.getState().records).toEqual({});
    useSectionExtractionJobs.getState().adoptOwner('user-b');
    expect(useSectionExtractionJobs.getState().records).toEqual({});
  });
});
