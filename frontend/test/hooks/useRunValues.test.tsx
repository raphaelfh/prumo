/**
 * `useRunValues` — the one values module both run screens use: hydrate by
 * stage, local edits win mid-save, the guarded decision writer, and the one
 * accept path (with local undo/redo) for extraction AND quality assessment.
 * The network is MSW; the run view is the shared RunView fixture.
 */
import { type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { server } from '@/test/mocks/server';
import { runsKeys, type ReviewerDecisionResponse, type RunViewResponse } from '@/hooks/runs/types';
import { useRunValues } from '@/hooks/runs/useRunValues';
import { extraction } from '@/lib/copy/extraction';
import type { components } from '@/types/api/schema';

import { makeRunView } from '../helpers/runScreenFixtures';

type CreateDecisionRequest = components['schemas']['CreateDecisionRequest'];

vi.mock('@/integrations/supabase/client', () => ({supabase: {auth: {getSession: vi.fn(async () => ({data: {session: {access_token: 'test'}}}))}}}));
vi.mock('sonner', () => ({toast: {error: vi.fn()}}));

const KINDS = ['extraction', 'quality_assessment'] as const;
type Kind = typeof KINDS[number];

let history: ReviewerDecisionResponse[];
let requests: CreateDecisionRequest[];
let postedRuns: string[];
let fail: boolean;
let offline: boolean;
let gate: Promise<void> | null;
let viewReads: number;
const proposal = {id: 'p1', instanceId: 'i', fieldId: 'a', value: 'AI'};
const row = (id: string, field: string, value: Record<string, unknown>): ReviewerDecisionResponse => ({
  id, run_id: 'run', instance_id: 'i', field_id: field, reviewer_id: 'me', value,
  decision: 'edit', proposal_record_id: null, rationale: null, created_at: `2026-09-15T00:00:${id.padStart(2, '0')}Z`,
});
beforeEach(() => {
  history = []; requests = []; postedRuns = []; fail = false; offline = false; gate = null; viewReads = 0;
  server.use(
    http.get('*/api/v1/runs/:run/view', () => {viewReads += 1; return HttpResponse.json({ok: true, data: {run: {id: 'run', stage: 'extract'}, decisions: history}});}),
    http.post('*/api/v1/runs/:run/decisions', async ({request, params}) => {
      const body = await request.json() as CreateDecisionRequest;
      requests.push(body);
      postedRuns.push(String(params.run));
      if (gate) await gate;
      if (offline) return HttpResponse.error();
      if (fail) return HttpResponse.json({ok: false, error: {code: 'FAILED', message: 'Save failed'}}, {status: 500});
      const latest = history.filter(item => item.reviewer_id === 'me' && item.instance_id === body.instance_id && item.field_id === body.field_id).at(-1);
      if (body.expected_current_decision_id && body.expected_current_decision_id !== latest?.id) {
        return HttpResponse.json({ok: false, error: {code: 'DECISION_CONFLICT', message: 'Decision changed'}}, {status: 409});
      }
      const decision = {...row(String(Math.max(0, ...history.map(item => Number(item.id))) + 1), body.field_id, body.value!), run_id: String(params.run), ...body};
      history.push(decision as ReviewerDecisionResponse);
      return HttpResponse.json({ok: true, data: decision});
    }),
  );
});

/** A current value as `current_values` serves it, on instance `i`. */
const current = (field: string, value: unknown, decision = 'edit') => ({instance_id: 'i', field_id: field, value: {value}, decision});

function wrapperFor() {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  const wrapper = ({children}: {children: ReactNode}) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return {queryClient, wrapper};
}

/** The hook over one run view; rerender with a new view to model a refetch or a run switch. */
function renderValues(initial: RunViewResponse | undefined, {user = 'me' as string | null, enabled = true, debounceMs = 60000} = {}) {
  const {queryClient, wrapper} = wrapperFor();
  const hook = renderHook(({runDetail, currentUserId}) => useRunValues({runDetail, currentUserId, enabled, debounceMs}),
    {wrapper, initialProps: {runDetail: initial, currentUserId: user}});
  return Object.assign(hook, {queryClient});
}

/** The decision harness: run `run` in extract for caller `me`, its `current_values` from `hydrated` (field → value). */
function setup(hydrated: Record<string, unknown> = {}, {kind = 'extraction' as Kind} = {}) {
  const viewFor = (id: string) => makeRunView({run: {id, kind}, decisions: history,
    current_values: Object.entries(hydrated).map(([field, value]) => current(field, value))});
  const runs: Record<string, RunViewResponse> = {run: viewFor('run'), run2: viewFor('run2'), 'other-run': viewFor('other-run')};
  const {queryClient, wrapper} = wrapperFor();
  const hook = renderHook(({user, run}) => {
    const values = useRunValues({runDetail: runs[run], currentUserId: user, enabled: true, debounceMs: 60000});
    return {...values, edit: (field: string, value: unknown) => values.updateValue('i', field, value)};
  }, {wrapper, initialProps: {user: 'me', run: 'run'}});
  return Object.assign(hook, {queryClient});
}

describe('hydrate by stage', () => {
  it.each(KINDS)('%s in extract: the caller-scoped current values, rejects skipped, markers and units kept', kind => {
    const view = renderValues(makeRunView({run: {kind}, current_values: [
      current('f1', 'X'),
      current('f2', 'gone', 'reject'),
      {instance_id: 'i', field_id: 'f3', value: {value: null, absent_reason: 'no_information'}, decision: 'edit'},
      {instance_id: 'i', field_id: 'f4', value: {value: {value: 5, unit: 'mg'}}, decision: 'human_proposal'},
    ]}));
    expect(view.result.current.values).toEqual({
      i_f1: 'X',
      i_f3: {value: null, absent_reason: 'no_information'},
      i_f4: {value: 5, unit: 'mg'},
    });
  });

  it('consensus hydrates the same current values', () => {
    const view = renderValues(makeRunView({run: {stage: 'consensus'}, current_values: [current('f1', 'X')]}));
    expect(view.result.current.values).toEqual({i_f1: 'X'});
  });

  it.each(KINDS)('%s finalized: published truth only, never the current values or proposals', kind => {
    const view = renderValues(makeRunView({run: {kind, stage: 'finalized'},
      current_values: [current('f1', 'PY')],
      proposals: [{id: 'p-stale', run_id: 'run-1', instance_id: 'i', field_id: 'f1', source: 'human', source_user_id: 'me', proposed_value: {value: 'PY'}, confidence_score: null, rationale: null, created_at: '2026-01-01T00:00:00Z'}],
      published_states: [{id: 'ps-1', run_id: 'run-1', instance_id: 'i', field_id: 'f1', value: {value: 'Y'}, published_at: '2026-01-01T00:00:00Z', published_by: 'u-1', version: 1}],
    }));
    expect(view.result.current.values).toEqual({i_f1: 'Y'});
  });

  it('replaces local values when the same run flips to finalized in-session', () => {
    const view = renderValues(makeRunView({current_values: [current('f1', 'draft-era')]}));
    act(() => view.result.current.updateValue('i', 'f2', 'typed'));
    view.rerender({currentUserId: 'me', runDetail: makeRunView({run: {stage: 'finalized'},
      published_states: [{id: 'ps-1', run_id: 'run-1', instance_id: 'i', field_id: 'f1', value: {value: 'Y'}, published_at: '2026-01-01T00:00:00Z', published_by: 'u-1', version: 1}]})});
    expect(view.result.current.values).toEqual({i_f1: 'Y'});
  });

  it.each([
    ['no run view yet', undefined, 'me'],
    ['a pending run', makeRunView({run: {stage: 'pending'}, current_values: [current('f1', 'X')]}), 'me'],
    ['no signed-in caller', makeRunView({current_values: [current('f1', 'X')]}), null],
  ] as const)('%s: an empty form', (_label, runDetail, user) => {
    const view = renderValues(runDetail, {user});
    expect(view.result.current.values).toEqual({});
  });

  it('updateValue patches the form at once', () => {
    const view = renderValues(makeRunView());
    act(() => view.result.current.updateValue('i', 'f1', 'typed'));
    expect(view.result.current.values).toEqual({i_f1: 'typed'});
  });
});

describe('local edits win mid-save', () => {
  it('a refetch of the same run keeps a local edit and adopts only new coordinates', () => {
    const view = renderValues(makeRunView({current_values: [current('f1', 'server')]}));
    act(() => view.result.current.updateValue('i', 'f1', 'local'));
    view.rerender({currentUserId: 'me', runDetail: makeRunView({current_values: [current('f1', 'server'), current('f2', 'AI-era')]})});
    expect(view.result.current.values).toEqual({i_f1: 'local', i_f2: 'AI-era'});
  });

  it('a refetch landing while the save is in flight keeps the newer typing, and it is written once afterwards', async () => {
    const first = makeRunView({run: {id: 'run'}, decisions: history, current_values: [current('a', 'old')]});
    const view = renderValues(first);
    let release!: () => void;
    gate = new Promise(resolve => {release = resolve;});
    act(() => view.result.current.updateValue('i', 'a', 'typed'));
    let saving!: Promise<void>;
    act(() => {saving = view.result.current.saveNow();});
    await waitFor(() => expect(requests).toHaveLength(1));
    act(() => view.result.current.updateValue('i', 'a', 'typed again'));
    // The refetch predates the in-flight write, so it still carries the old value.
    view.rerender({currentUserId: 'me', runDetail: makeRunView({run: {id: 'run'}, decisions: history, current_values: [current('a', 'old')]})});
    expect(view.result.current.values.i_a).toBe('typed again');
    await act(async () => {release(); await saving;});
    gate = null;
    await act(async () => {await view.result.current.saveNow();});
    expect(requests.map(r => r.value)).toEqual([{value: 'typed'}, {value: 'typed again'}]);
    expect(view.result.current.values.i_a).toBe('typed again');
  });
});

describe('another run or caller replaces the form', () => {
  it('a run switch replaces the form and flushes the pending edit against the run it was typed on', async () => {
    const view = renderValues(makeRunView({run: {id: 'run'}, current_values: [current('a', 'old')]}));
    act(() => view.result.current.updateValue('i', 'a', 'pending edit'));
    // A reopened revision: a NEW run seeded with its own values.
    await act(async () => {
      view.rerender({currentUserId: 'me', runDetail: makeRunView({run: {id: 'revision'}, current_values: [current('a', 'seed')]})});
    });
    expect(view.result.current.values).toEqual({i_a: 'seed'});
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(postedRuns).toEqual(['run']);
    expect(requests[0]).toMatchObject({field_id: 'a', value: {value: 'pending edit'}});
  });

  it('a caller change in the same run replaces the previous caller\'s draft', () => {
    const runDetail = makeRunView({current_values: [current('f1', 'server')]});
    const view = renderValues(runDetail);
    act(() => view.result.current.updateValue('i', 'f1', 'draft of me'));
    view.rerender({currentUserId: 'other', runDetail});
    expect(view.result.current.values).toEqual({i_f1: 'server'});
  });
});

describe('the baseline: hydrated values are never re-written', () => {
  it.each(KINDS)('%s: a decision-backed coordinate and an accepted linked one post nothing on mount', async kind => {
    history = [row('1', 'a', {value: 'Y'}), {...row('2', 'b', {value: 'AI'}), proposal_record_id: 'p1'}];
    renderValues(makeRunView({run: {id: 'run', kind}, decisions: history,
      current_values: [current('a', 'Y'), current('b', 'AI')]}), {debounceMs: 20});
    // Past the debounce window, or the assertion is vacuous.
    await act(async () => {await new Promise(resolve => setTimeout(resolve, 120));});
    expect(requests).toHaveLength(0);
  });

  it('an edit after mount is written by the debounce', async () => {
    const view = renderValues(makeRunView({run: {id: 'run'}, current_values: [current('a', 'Y')]}), {debounceMs: 20});
    act(() => view.result.current.updateValue('i', 'a', 'N'));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({decision: 'edit', value: {value: 'N'}});
  });
});

describe('read-only stages and callers never write', () => {
  it.each(['consensus', 'finalized'] as const)('%s: edits, flushes and accepts write nothing', async stage => {
    const view = renderValues(makeRunView({run: {id: 'run', stage}}));
    act(() => view.result.current.updateValue('i', 'a', 'typed'));
    await act(async () => {await view.result.current.saveNow();});
    await act(async () => {expect(await view.result.current.acceptProposal(proposal)).toBe(false);});
    await act(async () => {view.unmount();});
    expect(requests).toHaveLength(0);
  });

  it('a caller without write access (viewer) writes nothing', async () => {
    const view = renderValues(makeRunView({run: {id: 'run'}}), {enabled: false});
    act(() => view.result.current.updateValue('i', 'a', 'typed'));
    await act(async () => {await view.result.current.saveNow();});
    await act(async () => {expect(await view.result.current.acceptProposal(proposal)).toBe(false);});
    expect(requests).toHaveLength(0);
  });
});

describe('one accept path for both kinds', () => {
  it.each(KINDS)('%s: accepting a same-value proposal posts the linked decision', async kind => {
    history = [row('1', 'a', {value: 'AI'})];
    const view = setup({a: 'AI'}, {kind});
    await act(async () => {expect(await view.result.current.acceptProposal(proposal)).toBe(true);});
    expect(requests).toEqual([expect.objectContaining({decision: 'edit', proposal_record_id: 'p1', value: {value: 'AI'}, expected_current_decision_id: '1'})]);
    expect(view.result.current.isAccepted(proposal)).toBe(true);
  });

  it.each(KINDS)('%s: rejecting clears the coordinate and the next write carries no link', async kind => {
    const view = setup({}, {kind});
    await act(async () => {await view.result.current.acceptProposal(proposal);});
    act(() => view.result.current.rejectProposal('i', 'a'));
    expect(view.result.current.values.i_a).toBeNull();
    await act(async () => {await view.result.current.saveNow();});
    expect(requests.at(-1)).toMatchObject({value: {value: null}, proposal_record_id: null});
    expect(view.result.current.acceptedProposalIdFor('i', 'a')).toBeNull();
  });
});

describe('confirmed proposal decisions and local undo', () => {
  it('waits for pending autosave, ignores repeated checks, and does not autosave the accepted value twice', async () => {
    const view = setup();
    act(() => view.result.current.edit('a', 'draft'));
    let release!: () => void;
    gate = new Promise(resolve => {release = resolve;});
    let pending!: Promise<boolean>;
    act(() => {pending = view.result.current.acceptProposal(proposal);});
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(view.result.current.values.i_a).toBe('draft');
    await act(async () => {expect(await view.result.current.acceptProposal(proposal)).toBe(false);});
    await act(async () => {release(); await pending;});
    expect(requests.map(r => r.value)).toEqual([{value: 'draft'}, {value: 'AI'}]);
    await act(async () => {await view.result.current.saveNow();});
    expect(requests).toHaveLength(2);
    expect(view.result.current.acceptedProposalIdFor('i', 'a')).toBe('p1');
  });
  it('failed flush prevents acceptance and preserves draft for retry', async () => {
    const view = setup();
    act(() => view.result.current.edit('a', 'draft'));
    fail = true;
    await act(async () => {expect(await view.result.current.acceptProposal(proposal)).toBe(false);});
    expect(requests.every(r => r.proposal_record_id === null)).toBe(true);
    expect(view.result.current.values.i_a).toBe('draft');
    expect(view.result.current.canUndo).toBe(false);
    fail = false;
    await act(async () => {expect(await view.result.current.acceptProposal(proposal)).toBe(true);});
    expect(view.result.current.values.i_a).toBe('AI');
  });
  it('undo targets a previously visited question and restores a full typed predecessor without a link', async () => {
    history = [row('1', 'a', {value: {value: 4, unit: 'mg'}})];
    const view = setup({a: {value: 4, unit: 'mg'}});
    await act(async () => {await view.result.current.acceptProposal(proposal);});
    act(() => view.result.current.edit('b', ['A', 'B']));
    await act(async () => {await view.result.current.undoLatestLocalDecision();});
    expect(requests.at(-1)).toMatchObject({field_id: 'b', expected_current_decision_id: '3', value: {value: null}, decision: 'edit', proposal_record_id: null});
    await act(async () => {await view.result.current.undoLatestLocalDecision();});
    expect(requests.at(-1)).toMatchObject({field_id: 'a', expected_current_decision_id: '2', value: {value: {value: 4, unit: 'mg'}}, decision: 'edit', proposal_record_id: null});
    expect(view.result.current.values.i_a).toEqual({value: 4, unit: 'mg'});
    expect(view.result.current.canUndo).toBe(false);
  });
  it('keeps failed undo retryable and refuses newer external decisions', async () => {
    const view = setup();
    await act(async () => {await view.result.current.acceptProposal(proposal);});
    fail = true;
    await act(async () => {expect(await view.result.current.undoLatestLocalDecision()).toBe(false);});
    expect(view.result.current.canUndo).toBe(true);
    fail = false;
    history.push(row('9', 'a', {value: 'external'}));
    const count = requests.length;
    await act(async () => {expect(await view.result.current.undoLatestLocalDecision()).toBe(false);});
    // The server guard is the check: the guarded POST is sent, 409s, and appends nothing.
    expect(requests).toHaveLength(count + 1);
    expect(requests.at(-1)).toMatchObject({expected_current_decision_id: '1'});
    expect(history.at(-1)?.id).toBe('9');
    expect(view.result.current.error).toBeTruthy();
  });
  it('resets undo on user/run change and suppresses late confirmed repaint', async () => {
    const view = setup(); let release!: () => void;
    gate = new Promise(resolve => {release = resolve;});
    let pending!: Promise<boolean>;
    act(() => {pending = view.result.current.acceptProposal(proposal);});
    await waitFor(() => expect(requests).toHaveLength(1));
    view.rerender({user: 'other', run: 'run2'});
    await act(async () => {release(); await pending;});
    expect(view.result.current.canUndo).toBe(false);
    expect(view.result.current.values.i_a).toBeUndefined();
  });
  it('reverses B to A without reaccepting A, then undoes multiple local actions at one coordinate', async () => {
    const view = setup();
    await act(async () => {await view.result.current.acceptProposal(proposal);});
    const second = {...proposal, id: 'p2', value: ['B', 'C']};
    await act(async () => {await view.result.current.acceptProposal(second);});
    await act(async () => {await view.result.current.acceptProposal(second);});
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
  it('redo re-applies an undone acceptance with its link, guarded on the compensating head, and can be undone again', async () => {
    const view = setup();
    await act(async () => {await view.result.current.acceptProposal(proposal);});
    await act(async () => {await view.result.current.undoLatestLocalDecision();});
    expect(view.result.current.canRedo).toBe(true);
    await act(async () => {expect(await view.result.current.redoLatestLocalDecision()).toBe(true);});
    expect(requests.at(-1)).toMatchObject({field_id: 'a', expected_current_decision_id: '2', value: {value: 'AI'}, proposal_record_id: 'p1'});
    expect(view.result.current.values.i_a).toBe('AI');
    expect(view.result.current.acceptedProposalIdFor('i', 'a')).toBe('p1');
    expect(view.result.current.canRedo).toBe(false);
    await act(async () => {expect(await view.result.current.undoLatestLocalDecision()).toBe(true);});
    expect(requests.at(-1)).toMatchObject({expected_current_decision_id: '3', proposal_record_id: null});
    expect(view.result.current.values.i_a).toBeNull();
  });
  it('a new decision clears redo, and an external head refuses it', async () => {
    const view = setup();
    await act(async () => {await view.result.current.acceptProposal(proposal);});
    await act(async () => {await view.result.current.undoLatestLocalDecision();});
    await act(async () => {await view.result.current.acceptProposal({...proposal, id: 'p2', value: 'Other'});});
    expect(view.result.current.canRedo).toBe(false);
    await act(async () => {await view.result.current.undoLatestLocalDecision();});
    history.push(row('9', 'a', {value: 'external'}));
    const count = requests.length;
    await act(async () => {expect(await view.result.current.redoLatestLocalDecision()).toBe(false);});
    expect(requests).toHaveLength(count + 1);
    expect(history.at(-1)?.id).toBe('9');
    expect(view.result.current.conflicted).toBe(true);
  });
  it('preserves typing during acceptance and writes it once after the confirmation', async () => {
    const view = setup(); let release!: () => void;
    gate = new Promise(resolve => {release = resolve;});
    let pending!: Promise<boolean>;
    act(() => {pending = view.result.current.acceptProposal(proposal);});
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
    const view = setup({a: 'AI'});
    expect(view.result.current.isAccepted(proposal)).toBe(true);
    expect(view.result.current.isAccepted({...proposal, id: 'newer'})).toBe(false);
    expect(view.result.current.isAccepted({...proposal, value: 'different typed value'})).toBe(false);
    expect(view.result.current.canUndo).toBe(false);
    await act(async () => {expect(await view.result.current.acceptProposal({...proposal,
      value: {value: null, absent_reason: 'no_information'}, allowsNoInformation: false})).toBe(false);});
    expect(requests).toHaveLength(0);
  });
  it('does not restore a prior session when switching away and back during an in-flight write', async () => {
    const view = setup(); let release!: () => void;
    gate = new Promise(resolve => {release = resolve;});
    let pending!: Promise<boolean>;
    act(() => {pending = view.result.current.acceptProposal(proposal);});
    await waitFor(() => expect(requests).toHaveLength(1));
    view.rerender({user: 'other', run: 'run2'});
    view.rerender({user: 'me', run: 'run'});
    await act(async () => {release(); await pending;});
    expect(view.result.current.canUndo).toBe(false);
    expect(view.result.current.values.i_a).toBeUndefined();
  });

  it('freezes saveNow and unmount flush after an observed conflict while retaining the draft and undo target', async () => {
    const view = setup();
    await act(async () => {await view.result.current.acceptProposal(proposal);});
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
    await act(async () => {await view.result.current.acceptProposal(proposal);});
    history.push(row('9', 'a', {value: 'external'}));
    await act(async () => {await view.result.current.undoLatestLocalDecision();});
    const count = requests.length;
    await act(async () => {expect(await view.result.current.acceptProposal({...proposal, id: 'p2'})).toBe(false);});
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
    const restoredCount = history.length;
    await act(async () => {expect(await view.result.current.undoLatestLocalDecision()).toBe(false);});
    expect(requests.at(-1)).toMatchObject({expected_current_decision_id: '1'});
    expect(history).toHaveLength(restoredCount);
  });
  it('keeps the outgoing conflicted session frozen during run navigation', async () => {
    const view = setup();
    await act(async () => {await view.result.current.acceptProposal(proposal);});
    history.push(row('9', 'a', {value: 'external'}));
    await act(async () => {await view.result.current.undoLatestLocalDecision();});
    const count = requests.length;
    await act(async () => {view.rerender({user: 'me', run: 'other-run'}); view.unmount();});
    expect(requests).toHaveLength(count);
  });
});

describe('atomic undo precondition', () => {
  it.each([false, true])('freezes a POST conflict after a matching GET and retains the draft and expected id (refresh fails: %s)', async refreshFails => {
    const view = setup();
    await act(async () => {expect(await view.result.current.acceptProposal(proposal)).toBe(true);});
    let refreshed = 0;
    let postStarted!: () => void;
    const started = new Promise<void>(resolve => {postStarted = resolve;});
    let release!: () => void;
    const responseGate = new Promise<void>(resolve => {release = resolve;});
    server.use(http.post('*/api/v1/runs/:run/decisions', async ({request}) => {
      requests.push(await request.json() as CreateDecisionRequest);
      // The early GET saw d1; the other tab commits d2 before POST checks it.
      history.push(row('9', 'a', {value: 'external'}));
      server.use(http.get('*/api/v1/runs/:run/view', () => {
        refreshed += 1;
        return refreshFails
          ? HttpResponse.json({ok: false, error: {code: 'FAILED', message: 'Refresh failed'}}, {status: 500})
          : HttpResponse.json({ok: true, data: {run: {id: 'run', stage: 'extract'}, decisions: history}});
      }));
      postStarted();
      await responseGate;
      return HttpResponse.json({ok: false, error: {code: 'DECISION_CONFLICT', message: 'Decision changed'}}, {status: 409});
    }));
    let pending!: Promise<boolean>;
    act(() => {pending = view.result.current.undoLatestLocalDecision();});
    await started;
    act(() => view.result.current.edit('a', 'typing during undo'));
    await act(async () => {release(); expect(await pending).toBe(false);});
    expect(requests.at(-1)).toMatchObject({expected_current_decision_id: '1', value: {value: null}});
    expect(refreshed).toBeGreaterThan(0);
    expect(view.result.current.conflicted).toBe(true);
    expect(view.result.current.error).toBe(extraction.reviewDecisionConflict);
    expect(view.result.current.values.i_a).toBe('typing during undo');
    expect(view.result.current.undoTarget?.expectedId).toBe('1');
    expect(view.result.current.canUndo).toBe(true);
    const count = requests.length;
    await act(async () => {await expect(view.result.current.saveNow()).rejects.toThrow();});
    await act(async () => {expect(await view.result.current.undoLatestLocalDecision()).toBe(false);});
    await act(async () => {view.unmount();});
    expect(requests).toHaveLength(count);
  });
});

it('freezes the captured session when undo conflicts after navigation, before its queued lifecycle flush', async () => {
  const view = setup();
  await act(async () => {await view.result.current.acceptProposal(proposal);});
  let started!: () => void;
  const postStarted = new Promise<void>(resolve => {started = resolve;});
  let release!: () => void;
  const responseGate = new Promise<void>(resolve => {release = resolve;});
  server.use(http.post('*/api/v1/runs/:run/decisions', async ({request}) => {
    requests.push(await request.json() as CreateDecisionRequest);
    started();
    await responseGate;
    return HttpResponse.json({ok: false, error: {code: 'DECISION_CONFLICT', message: 'Decision changed'}}, {status: 409});
  }));
  let pending!: Promise<boolean>;
  act(() => {pending = view.result.current.undoLatestLocalDecision();});
  await postStarted;
  act(() => view.result.current.edit('a', 'retained input'));
  act(() => view.rerender({user: 'me', run: 'other-run'}));
  await act(async () => {release(); expect(await pending).toBe(false);});
  expect(requests).toHaveLength(2);
  expect(view.result.current.conflicted).toBe(false);
});

describe('writes guard on the local head instead of re-reading the run view', () => {
  it('an accept reads no view and sends the local head as its expected id', async () => {
    history = [row('1', 'a', {value: 'kept'})];
    const view = setup({a: 'kept'});
    await act(async () => {expect(await view.result.current.acceptProposal(proposal)).toBe(true);});
    expect(viewReads).toBe(0);
    expect(requests).toEqual([expect.objectContaining({proposal_record_id: 'p1', expected_current_decision_id: '1'})]);
  });
  it('an accept with no local head stays unconditional', async () => {
    const view = setup();
    await act(async () => {expect(await view.result.current.acceptProposal(proposal)).toBe(true);});
    expect(viewReads).toBe(0);
    expect(requests[0]).not.toHaveProperty('expected_current_decision_id');
  });
  it('an autosave write reads no view and guards on the local head', async () => {
    history = [row('1', 'a', {value: 'kept'})];
    const view = setup({a: 'kept'});
    act(() => view.result.current.edit('a', 'typed'));
    await act(async () => {await view.result.current.saveNow();});
    expect(viewReads).toBe(0);
    expect(requests).toEqual([expect.objectContaining({value: {value: 'typed'}, expected_current_decision_id: '1'})]);
    expect(view.result.current.canUndo).toBe(true);
  });
  it('a 409 on accept freezes the session, keeps the draft, and refreshes history', async () => {
    const view = setup({a: 'draft'});
    server.use(http.post('*/api/v1/runs/:run/decisions', async ({request}) => {
      requests.push(await request.json() as CreateDecisionRequest);
      return HttpResponse.json({ok: false, error: {code: 'DECISION_CONFLICT', message: 'Decision changed'}}, {status: 409});
    }));
    await act(async () => {expect(await view.result.current.acceptProposal(proposal)).toBe(false);});
    expect(requests).toHaveLength(1);
    expect(viewReads).toBe(1);
    expect(view.result.current.conflicted).toBe(true);
    expect(view.result.current.error).toBe(extraction.reviewDecisionConflict);
    expect(view.result.current.values.i_a).toBe('draft');
  });
  it.each([['finalized', 'conflict'], ['extract', 'failed']] as const)('a 400 while the run is %s classifies as %s', async (stage, outcome) => {
    const view = setup();
    server.use(
      http.post('*/api/v1/runs/:run/decisions', () => HttpResponse.json({ok: false, error: {code: 'VALIDATION_ERROR', message: 'Rejected'}}, {status: 400})),
      http.get('*/api/v1/runs/:run/view', () => {viewReads += 1; return HttpResponse.json({ok: true, data: {run: {id: 'run', stage}, decisions: history}});}),
    );
    await act(async () => {expect(await view.result.current.acceptProposal(proposal)).toBe(false);});
    expect(viewReads).toBe(1);
    expect(view.result.current.conflicted).toBe(outcome === 'conflict');
    expect(view.result.current.error).toBe(outcome === 'conflict' ? extraction.reviewDecisionConflict : extraction.reviewDecisionSaveFailed);
  });
  it('a confirmed decision does not invalidate run detail; a failed one does', async () => {
    const view = setup();
    const invalidate = vi.spyOn(view.queryClient, 'invalidateQueries');
    await act(async () => {expect(await view.result.current.acceptProposal(proposal)).toBe(true);});
    expect(invalidate).not.toHaveBeenCalled();
    fail = true;
    await act(async () => {expect(await view.result.current.acceptProposal({...proposal, id: 'p2', value: 'Other'})).toBe(false);});
    expect(invalidate).toHaveBeenCalledWith({queryKey: runsKeys.detail('run')});
  });
  it('exposes the in-flight decision target only while it is pending', async () => {
    const view = setup(); let release!: () => void;
    gate = new Promise(resolve => {release = resolve;});
    let pending!: Promise<boolean>;
    act(() => {pending = view.result.current.acceptProposal(proposal);});
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(view.result.current.pendingDecision).toEqual({instanceId: 'i', fieldId: 'a', proposalId: 'p1'});
    await act(async () => {release(); await pending;});
    expect(view.result.current.pendingDecision).toBeNull();
    gate = new Promise(resolve => {release = resolve;});
    act(() => {pending = view.result.current.undoLatestLocalDecision();});
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(view.result.current.pendingDecision).toEqual({instanceId: 'i', fieldId: 'a', proposalId: null});
    await act(async () => {release(); await pending;});
    expect(view.result.current.pendingDecision).toBeNull();
  });
});

describe('decision save failures that are not conflicts', () => {
  it.each([
    ['a 500', () => {fail = true;}],
    ['a network error', () => {offline = true;}],
  ])('an accept that fails with %s shows save-failed copy, does not freeze, and stays retryable', async (_label, failWith) => {
    const view = setup();
    failWith();
    await act(async () => {expect(await view.result.current.acceptProposal(proposal)).toBe(false);});
    expect(requests).toHaveLength(1);
    expect(view.result.current.error).toBe(extraction.reviewDecisionSaveFailed);
    expect(view.result.current.conflicted).toBe(false);
    fail = false; offline = false;
    await act(async () => {expect(await view.result.current.acceptProposal(proposal)).toBe(true);});
    expect(view.result.current.error).toBeNull();
  });
  it('an undo that fails with a 500 shows save-failed copy and keeps its entry', async () => {
    const view = setup();
    await act(async () => {await view.result.current.acceptProposal(proposal);});
    fail = true;
    await act(async () => {expect(await view.result.current.undoLatestLocalDecision()).toBe(false);});
    expect(view.result.current.error).toBe(extraction.reviewDecisionSaveFailed);
    expect(view.result.current.conflicted).toBe(false);
    expect(view.result.current.canUndo).toBe(true);
  });
});

