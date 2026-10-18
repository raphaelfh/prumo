/**
 * PicotsPane — the review-question save is a compare-and-swap on the protocol
 * revision. The form sends the revision it was SEEDED with, never the live
 * cache value: a background refetch (a details save invalidates the read,
 * `refetchOnReconnect` is on) must not move the precondition under unsaved
 * edits. A stale save shows a banner with Reload and never overwrites.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: vi.fn(async () => ({data: {session: {access_token: 'test-token'}}}))}},
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {toast} from 'sonner';
import {PicotsPane} from '@/components/project/PicotsPane';
import {runsKeys} from '@/hooks/runs/types';
import {t} from '@/lib/copy';
import {projectKeys} from '@/lib/query-keys';
import {server} from '../mocks/server';

const PID = 'p1';
const EMPTY = {description: '', inclusion: [], exclusion: []};

function readModel(revision: number, population: string) {
  return {
    picots: {
      population: {description: population, inclusion: [], exclusion: []},
      index_models: {...EMPTY},
      comparator_models: {...EMPTY},
      outcomes: {...EMPTY},
      timing: {...EMPTY},
      setting_and_intended_use: {...EMPTY},
    },
    labels: {
      population: 'Population',
      index_models: 'Index model(s)',
      comparator_models: 'Comparator model(s)',
      outcomes: 'Outcome(s)',
      timing: 'Timing',
      setting_and_intended_use: 'Setting and intended use',
    },
    review_type: 'predictive_model',
    picots_enabled: true,
    preview: null,
    revision,
  };
}

const stale = (current: number) =>
  HttpResponse.json(
    {ok: false, error: {code: 'STALE_VALUE', message: 'stale', details: {current_revision: current}}},
    {status: 409},
  );

let read = readModel(3, 'Adults');
let getCalls = 0;
let putBodies: Record<string, unknown>[] = [];
let putReply: (body: Record<string, unknown>) => Response = () => HttpResponse.json({ok: true, data: read});

beforeEach(() => {
  vi.clearAllMocks();
  read = readModel(3, 'Adults');
  getCalls = 0;
  putBodies = [];
  putReply = () => HttpResponse.json({ok: true, data: read});
  server.use(
    http.get(`*/api/v1/projects/${PID}/ai-context`, () => {
      getCalls += 1;
      return HttpResponse.json({ok: true, data: read});
    }),
    http.put(`*/api/v1/projects/${PID}/ai-context`, async ({request}) => {
      const body = (await request.json()) as Record<string, unknown>;
      putBodies.push(body);
      return putReply(body);
    }),
  );
});

afterEach(() => server.resetHandlers());

function renderPane() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false, gcTime: Infinity}, mutations: {retry: false}},
  });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <PicotsPane projectId={PID} />
    </QueryClientProvider>,
  );
  return {queryClient, invalidate};
}

const banner = () => screen.queryByText(t('aiContext', 'conflictBanner'));

describe('PicotsPane — revision compare-and-swap', () => {
  it('a 409 STALE_VALUE shows the banner, disables Save, and Reload re-seeds from the fresh read', async () => {
    const user = userEvent.setup();
    putReply = () => stale(4);
    renderPane();

    const population = await screen.findByLabelText('Population');
    await user.type(population, '!');
    await user.click(screen.getByRole('button', {name: t('aiContext', 'save')}));

    expect(await screen.findByText(t('aiContext', 'conflictBanner'))).toBeInTheDocument();
    expect(putBodies[0].expected_revision).toBe(3);
    expect(screen.getByRole('button', {name: t('aiContext', 'save')})).toBeDisabled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(getCalls).toBe(1);

    read = readModel(4, 'Agent wrote this');
    await user.click(screen.getByRole('button', {name: t('aiContext', 'conflictReload')}));

    await waitFor(() => expect(screen.getByLabelText('Population')).toHaveValue('Agent wrote this'));
    expect(getCalls).toBe(2);
    expect(banner()).toBeNull();

    putReply = () => HttpResponse.json({ok: true, data: read});
    await user.type(screen.getByLabelText('Population'), '?');
    const save = screen.getByRole('button', {name: t('aiContext', 'save')});
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(putBodies).toHaveLength(2));
    expect(putBodies[1].expected_revision).toBe(4);
  });

  it('sends the seeded revision after a background refetch', async () => {
    const user = userEvent.setup();
    putReply = (body) => (body.expected_revision !== 4 ? stale(4) : HttpResponse.json({ok: true, data: read}));
    const {queryClient} = renderPane();

    const population = await screen.findByLabelText('Population');
    await user.type(population, ' mine');

    read = readModel(4, 'Someone else');
    await queryClient.invalidateQueries({queryKey: projectKeys.aiContext(PID)});
    await waitFor(() =>
      expect(queryClient.getQueryData<{revision: number}>(projectKeys.aiContext(PID))?.revision).toBe(4),
    );
    expect(screen.getByLabelText('Population')).toHaveValue('Adults mine');

    await user.click(screen.getByRole('button', {name: t('aiContext', 'save')}));

    expect(await screen.findByText(t('aiContext', 'conflictBanner'))).toBeInTheDocument();
    expect(putBodies).toHaveLength(1);
    expect(putBodies[0].expected_revision).toBe(3);
    expect(screen.getByLabelText('Population')).toHaveValue('Adults mine');
  });

  it('a non-409 failure toasts the save error and shows no banner', async () => {
    const user = userEvent.setup();
    putReply = () => HttpResponse.json({ok: false, error: {code: 'INTERNAL', message: 'boom'}}, {status: 500});
    renderPane();

    await user.type(await screen.findByLabelText('Population'), '!');
    await user.click(screen.getByRole('button', {name: t('aiContext', 'save')}));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t('aiContext', 'saveError')));
    expect(banner()).toBeNull();
    expect(screen.getByRole('button', {name: t('aiContext', 'save')})).toBeEnabled();
  });

  it('a 409 invalidates nothing: the read is fetched again only on Reload', async () => {
    const user = userEvent.setup();
    putReply = () => stale(4);
    const {invalidate} = renderPane();

    await user.type(await screen.findByLabelText('Population'), '!');
    await user.click(screen.getByRole('button', {name: t('aiContext', 'save')}));
    await screen.findByText(t('aiContext', 'conflictBanner'));

    expect(invalidate).not.toHaveBeenCalled();
    expect(getCalls).toBe(1);
  });

  it('a successful save refreshes the run reads so the drift chip is current', async () => {
    const user = userEvent.setup();
    const {invalidate} = renderPane();

    await user.type(await screen.findByLabelText('Population'), '!');
    await user.click(screen.getByRole('button', {name: t('aiContext', 'save')}));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t('aiContext', 'saveSuccess')));
    expect(invalidate).toHaveBeenCalledWith({queryKey: projectKeys.aiContext(PID)});
    expect(invalidate).toHaveBeenCalledWith({queryKey: runsKeys.all});
  });
});
