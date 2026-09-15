import { useState, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '@/test/mocks/server';
import type { CreateDecisionRequest, ReviewerDecisionResponse } from '@/hooks/runs/types';
import { useProposalDecision } from '@/hooks/extraction/useProposalDecision';

vi.mock('@/integrations/supabase/client', () => ({supabase: {auth: {getSession: vi.fn(async () => ({data: {session: {access_token: 'test'}}}))}}}));
vi.mock('sonner', () => ({toast: {error: vi.fn()}}));
let history: ReviewerDecisionResponse[];
let requests: CreateDecisionRequest[];
let fail: boolean;
let gate: Promise<void> | null;
const proposal = {id: 'p1', instanceId: 'i', fieldId: 'a', value: 'AI'};
const row = (id: string, field: string, value: Record<string, unknown>): ReviewerDecisionResponse => ({
  id, run_id: 'run', instance_id: 'i', field_id: field, reviewer_id: 'me', value,
  decision: 'edit', proposal_record_id: null, rationale: null, created_at: `2026-09-15T00:00:${id.padStart(2, '0')}Z`,
});
beforeEach(() => {
  history = []; requests = []; fail = false; gate = null;
  server.use(
    http.get('*/api/v1/runs/:run/view', () => HttpResponse.json({ok: true, data: {run: {id: 'run', stage: 'extract'}, decisions: history}})),
    http.post('*/api/v1/runs/:run/decisions', async ({request}) => {
      const body = await request.json() as CreateDecisionRequest;
      requests.push(body);
      if (gate) await gate;
      if (fail) return HttpResponse.json({ok: false, error: {code: 'FAILED', message: 'Save failed'}}, {status: 500});
      const decision = {...row(String(Math.max(0, ...history.map(item => Number(item.id))) + 1), body.field_id, body.value!), ...body};
      history.push(decision as ReviewerDecisionResponse);
      return HttpResponse.json({ok: true, data: decision});
    }),
  );
});
function setup(initial: Record<string, unknown> = {}, baseline = initial) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  const wrapper = ({children}: {children: ReactNode}) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return renderHook(({user, run}) => {
    const [values, setValues] = useState(initial);
    const writer = useProposalDecision({runId: run, reviewerId: user, stage: 'extract', enabled: true,
      values, baselineValues: baseline, decisions: history, debounceMs: 60000,
      onConfirmed: (coordinate, value) => setValues(prev => ({...prev, [`${coordinate.instanceId}_${coordinate.fieldId}`]: value})),
    });
    return {...writer, values, edit: (field: string, value: unknown) => setValues(prev => ({...prev, [`i_${field}`]: value}))};
  }, {wrapper, initialProps: {user: 'me', run: 'run'}});
}
describe('confirmed proposal decisions and local undo', () => {
  it('waits for pending autosave, ignores repeated checks, and does not autosave the accepted value twice', async () => {
    const view = setup({'i_a': 'draft'}, {});
    let release!: () => void;
    gate = new Promise(resolve => {release = resolve;});
    let pending!: Promise<boolean>;
    act(() => {pending = view.result.current.toggle(proposal);});
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(view.result.current.values.i_a).toBe('draft');
    await act(async () => {expect(await view.result.current.toggle(proposal)).toBe(false);});
    await act(async () => {release(); await pending;});
    expect(requests.map(r => r.value)).toEqual([{value: 'draft'}, {value: 'AI'}]);
    await act(async () => {await view.result.current.saveNow();});
    expect(requests).toHaveLength(2);
    expect(view.result.current.acceptedProposalIdFor('i', 'a')).toBe('p1');
  });
  it('failed flush prevents acceptance and preserves draft for retry', async () => {
    const view = setup({'i_a': 'draft'}, {}); fail = true;
    await act(async () => {expect(await view.result.current.toggle(proposal)).toBe(false);});
    expect(requests.every(r => r.proposal_record_id === null)).toBe(true);
    expect(view.result.current.values.i_a).toBe('draft');
    expect(view.result.current.canUndo).toBe(false);
    fail = false;
    await act(async () => {expect(await view.result.current.toggle(proposal)).toBe(true);});
    expect(view.result.current.values.i_a).toBe('AI');
  });
  it('undo targets a previously visited question and restores a full typed predecessor without a link', async () => {
    history = [row('1', 'a', {value: {value: 4, unit: 'mg'}})];
    const view = setup({'i_a': {value: 4, unit: 'mg'}});
    await act(async () => {await view.result.current.toggle(proposal);});
    act(() => view.result.current.edit('b', ['A', 'B']));
    await act(async () => {await view.result.current.undoLatestLocalDecision();});
    expect(requests.at(-1)).toMatchObject({field_id: 'b', value: {value: null}, decision: 'edit', proposal_record_id: null});
    await act(async () => {await view.result.current.undoLatestLocalDecision();});
    expect(requests.at(-1)).toMatchObject({field_id: 'a', value: {value: {value: 4, unit: 'mg'}}, decision: 'edit', proposal_record_id: null});
    expect(view.result.current.values.i_a).toEqual({value: 4, unit: 'mg'});
    expect(view.result.current.canUndo).toBe(false);
  });
  it('keeps failed undo retryable and refuses newer external decisions', async () => {
    const view = setup();
    await act(async () => {await view.result.current.toggle(proposal);});
    fail = true;
    await act(async () => {expect(await view.result.current.undoLatestLocalDecision()).toBe(false);});
    expect(view.result.current.canUndo).toBe(true);
    fail = false;
    history.push(row('9', 'a', {value: 'external'}));
    const count = requests.length;
    await act(async () => {expect(await view.result.current.undoLatestLocalDecision()).toBe(false);});
    expect(requests).toHaveLength(count);
    expect(view.result.current.error).toBeTruthy();
  });
  it('resets undo on user/run change and suppresses late confirmed repaint', async () => {
    const view = setup(); let release!: () => void;
    gate = new Promise(resolve => {release = resolve;});
    let pending!: Promise<boolean>;
    act(() => {pending = view.result.current.toggle(proposal);});
    await waitFor(() => expect(requests).toHaveLength(1));
    view.rerender({user: 'other', run: 'run2'});
    await act(async () => {release(); await pending;});
    expect(view.result.current.canUndo).toBe(false);
    expect(view.result.current.values.i_a).toBeUndefined();
  });
  it('reverses B to A without reaccepting A, then undoes multiple local actions at one coordinate', async () => {
    const view = setup();
    await act(async () => {await view.result.current.toggle(proposal);});
    const second = {...proposal, id: 'p2', value: ['B', 'C']};
    await act(async () => {await view.result.current.toggle(second);});
    await act(async () => {await view.result.current.toggle(second);});
    expect(requests.at(-1)).toMatchObject({value: {value: 'AI'}, proposal_record_id: null});
    expect(view.result.current.acceptedProposalIdFor('i', 'a')).toBeNull();
    await act(async () => {expect(await view.result.current.undoLatestLocalDecision()).toBe(true);});
    expect(view.result.current.values.i_a).toEqual(['B', 'C']);
    await act(async () => {expect(await view.result.current.undoLatestLocalDecision()).toBe(true);});
    expect(view.result.current.values.i_a).toBe('AI');
    await act(async () => {expect(await view.result.current.undoLatestLocalDecision()).toBe(true);});
    expect(view.result.current.values.i_a).toBeNull();
    expect(view.result.current.canUndo).toBe(false);
  });
  it('preserves typing during acceptance and writes it once after the confirmation', async () => {
    const view = setup(); let release!: () => void;
    gate = new Promise(resolve => {release = resolve;});
    let pending!: Promise<boolean>;
    act(() => {pending = view.result.current.toggle(proposal);});
    await waitFor(() => expect(requests).toHaveLength(1));
    act(() => view.result.current.edit('a', 'new input'));
    await act(async () => {release(); await pending;});
    expect(view.result.current.values.i_a).toBe('new input');
    await act(async () => {await view.result.current.saveNow();});
    expect(requests.map(r => r.value)).toEqual([{value: 'AI'}, {value: 'new input'}]);
    expect(requests.at(-1)?.proposal_record_id).toBeNull();
  });
  it('hydrates older acceptance, excludes foreign decisions, and respects no-information restrictions', async () => {
    history = [{...row('1', 'a', {value: 'AI'}), proposal_record_id: 'p1'},
      {...row('9', 'a', {value: 'foreign'}), reviewer_id: 'other', proposal_record_id: 'foreign'}];
    const view = setup({'i_a': 'AI'});
    expect(view.result.current.isAccepted(proposal)).toBe(true);
    expect(view.result.current.isAccepted({...proposal, id: 'newer'})).toBe(false);
    expect(view.result.current.isAccepted({...proposal, value: 'different typed value'})).toBe(false);
    expect(view.result.current.canUndo).toBe(false);
    await act(async () => {expect(await view.result.current.toggle({...proposal,
      value: {value: null, absent_reason: 'no_information'}, allowsNoInformation: false})).toBe(false);});
    expect(requests).toHaveLength(0);
  });
  it('does not restore a prior session when switching away and back during an in-flight write', async () => {
    const view = setup(); let release!: () => void;
    gate = new Promise(resolve => {release = resolve;});
    let pending!: Promise<boolean>;
    act(() => {pending = view.result.current.toggle(proposal);});
    await waitFor(() => expect(requests).toHaveLength(1));
    view.rerender({user: 'other', run: 'run2'});
    view.rerender({user: 'me', run: 'run'});
    await act(async () => {release(); await pending;});
    expect(view.result.current.canUndo).toBe(false);
    expect(view.result.current.values.i_a).toBeUndefined();
  });

  it('freezes saveNow and unmount flush after an observed conflict while retaining the draft and undo target', async () => {
    const view = setup();
    await act(async () => {await view.result.current.toggle(proposal);});
    history.push(row('9', 'a', {value: 'external'}));
    await act(async () => {expect(await view.result.current.undoLatestLocalDecision()).toBe(false);});
    const count = requests.length;
    await act(async () => {await expect(view.result.current.saveNow()).rejects.toThrow();});
    expect(requests).toHaveLength(count);
    expect(view.result.current.values.i_a).toBe('AI');
    expect(view.result.current.canUndo).toBe(true);
    expect(view.result.current.undoTarget?.expectedId).toBe('1');
    await act(async () => {view.unmount();});
    expect(requests).toHaveLength(count);
    expect(history.at(-1)?.value).toEqual({value: 'external'});
  });

  it('requires explicit fresh-authority recovery and never rebases the blocked undo target', async () => {
    const view = setup();
    await act(async () => {await view.result.current.toggle(proposal);});
    history.push(row('9', 'a', {value: 'external'}));
    await act(async () => {await view.result.current.undoLatestLocalDecision();});
    const count = requests.length;
    await act(async () => {expect(await view.result.current.toggle({...proposal, id: 'p2'})).toBe(false);});
    expect(requests).toHaveLength(count);
    server.use(http.get('*/api/v1/runs/:run/view', () => HttpResponse.json({ok: true, data: {run: {id: 'run', stage: 'finalized'}, decisions: history}})));
    await act(async () => {expect(await view.result.current.resumeDraftAfterConflict()).toBe(false);});
    expect(view.result.current.conflicted).toBe(true);
    server.use(http.get('*/api/v1/runs/:run/view', () => HttpResponse.json({ok: true, data: {run: {id: 'run', stage: 'extract'}, decisions: history}})));
    await act(async () => {expect(await view.result.current.resumeDraftAfterConflict()).toBe(true);});
    expect(view.result.current.undoTarget?.expectedId).toBe('1');
    expect(view.result.current.values.i_a).toBe('AI');
    await act(async () => {await view.result.current.saveNow();});
    expect(requests).toHaveLength(count + 1);
    expect(requests.at(-1)).toMatchObject({value: {value: 'AI'}, proposal_record_id: null});
    await act(async () => {expect(await view.result.current.undoLatestLocalDecision()).toBe(true);});
    expect(history.at(-1)?.value).toEqual({value: 'external'});
    expect(view.result.current.undoTarget?.expectedId).toBe('1');
    const restoredCount = requests.length;
    await act(async () => {expect(await view.result.current.undoLatestLocalDecision()).toBe(false);});
    expect(requests).toHaveLength(restoredCount);
  });
  it('keeps the outgoing conflicted session frozen during run navigation', async () => {
    const view = setup();
    await act(async () => {await view.result.current.toggle(proposal);});
    history.push(row('9', 'a', {value: 'external'}));
    await act(async () => {await view.result.current.undoLatestLocalDecision();});
    const count = requests.length;
    await act(async () => {view.rerender({user: 'me', run: 'other-run'}); view.unmount();});
    expect(requests).toHaveLength(count);
  });

});
