/**
 * ScreeningSettings — the title/abstract part of the Settings sub-view: the
 * reviewer count (save, lock, pending, 409 frozen, 403) and the protocol's
 * exclusion reasons with the way to edit them. Real English copy.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {MemoryRouter} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {toast} from 'sonner';

import {ScreeningSettings} from '@/components/screening/ScreeningSettings';
import {TooltipProvider} from '@/components/ui/tooltip';
import {screeningKeys} from '@/lib/query-keys/screening';
import type {components} from '@/types/api/schema';
import {server} from '@/test/mocks/server';

type ConfigRead = components['schemas']['ScreeningConfigRead'];

const CONFIG_URL = '*/api/v1/projects/:projectId/screening/config';

function config(overrides: Partial<ConfigRead> = {}): ConfigRead {
  return {
    can_arbitrate: true,
    can_manage: true,
    can_review: true,
    enrolled: 0,
    exclusion_reasons: [],
    not_enrolled: 4,
    reviewer_capable: 2,
    reviewer_count: null,
    reviewer_count_locked: false,
    full_text_reviewer_count: null,
    full_text_count_locked: false,
    full_text_ready: 0,
    full_text_enrolled: 0,
    ...overrides,
  };
}

const ok = (data: unknown) => HttpResponse.json({ok: true, data});
const fail = (status: number, code: string) =>
  HttpResponse.json({ok: false, error: {code, message: code}}, {status});

function renderSettings(read: ConfigRead = config()) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}, mutations: {retry: false}}});
  const view = render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <MemoryRouter initialEntries={['/projects/p1?tab=screening&screeningTab=settings']}>
          <ScreeningSettings projectId="p1" config={read} />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return {...view, client};
}

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('ScreeningSettings', () => {
  it('saves the reviewer count', async () => {
    let body: unknown = null;
    server.use(
      http.put(CONFIG_URL, async ({request}) => {
        body = await request.json();
        return ok(config({reviewer_count: 2}));
      }),
    );
    const user = userEvent.setup();
    renderSettings();

    expect(screen.getByRole('radiogroup', {name: 'Reviewers per article — title/abstract'})).toBeInTheDocument();
    expect(screen.getByRole('radio', {name: '3 reviewers'})).toBeDisabled();
    expect(screen.getByText('Needs 3 reviewers in the project')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', {name: '2 reviewers'}));
    await user.click(screen.getByRole('button', {name: 'Save'}));

    await waitFor(() => expect(body).toEqual({reviewer_count: 2}));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Screening is set up'));
  });

  it('disables the count with the lock hint once locked', () => {
    renderSettings(config({reviewer_count: 2, reviewer_count_locked: true}));
    const group = screen.getByRole('radiogroup', {name: 'Reviewers per article — title/abstract'});
    expect(group).toHaveAccessibleDescription(
      expect.stringContaining('Locked after the first title/abstract decision'),
    );
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(screen.getByRole('radio', {name: '2 reviewers'})).toBeChecked();
    expect(screen.getByRole('button', {name: 'Save'})).toBeDisabled();
    expect(
      screen.getByRole('button', {name: 'About Reviewers per article — title/abstract'}),
    ).toBeInTheDocument();
  });

  it('disables the controls while saving', async () => {
    server.use(http.put(CONFIG_URL, () => new Promise<never>(() => {})));
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('button', {name: 'Save'}));

    await waitFor(() => expect(screen.getByRole('button', {name: 'Save'})).toBeDisabled());
    expect(screen.getByRole('radio', {name: '1 reviewer'})).toBeDisabled();
  });

  it('toasts and refetches the config on 409 SCREENING_CONFIG_FROZEN', async () => {
    server.use(http.put(CONFIG_URL, () => fail(409, 'SCREENING_CONFIG_FROZEN')));
    const user = userEvent.setup();
    const {client} = renderSettings(config({reviewer_count: 1}));
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await user.click(screen.getByRole('radio', {name: '2 reviewers'}));
    await user.click(screen.getByRole('button', {name: 'Save'}));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Reviewers per record cannot change after the first decision.'),
    );
    expect(invalidate).toHaveBeenCalledWith({queryKey: screeningKeys.project('p1')});
    expect(screeningKeys.project('p1')).toEqual(['screening', 'project', 'p1']);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("lists the protocol's exclusion reasons with Edit in protocol", () => {
    renderSettings(config({exclusion_reasons: ['Wrong population', 'Wrong design']}));
    const list = screen.getByRole('list', {name: 'Exclusion reasons'});
    expect(list).toHaveTextContent('Wrong population');
    expect(list).toHaveTextContent('Wrong design');
    const link = screen.getByRole('link', {name: 'Edit in protocol'});
    expect(link.getAttribute('href')).toContain('tab=settings&section=review-question');
  });

  it('says when the protocol lists none', () => {
    renderSettings(config({exclusion_reasons: []}));
    expect(screen.getByText('The protocol lists no exclusion reasons')).toBeInTheDocument();
    expect(screen.queryByRole('list', {name: 'Exclusion reasons'})).toBeNull();
    expect(screen.getByRole('link', {name: 'Edit in protocol'})).toBeInTheDocument();
  });

  it('shows "Only project managers can do this" on 403', async () => {
    server.use(http.put(CONFIG_URL, () => fail(403, 'FORBIDDEN')));
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('button', {name: 'Save'}));

    expect(await screen.findByText('Only project managers can do this')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Save'})).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
