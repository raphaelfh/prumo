/**
 * ScreeningTab — the sub-view router: the config read gates everything
 * (loading, error), then the managerOnly redirect and the first-run landing
 * on Settings, the "not set up" states under an always-present toolbar, and
 * the workspace once configured. Real English copy.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {MemoryRouter, useLocation} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));
vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), {success: vi.fn(), error: vi.fn()});
  return {toast};
});

import {toast} from 'sonner';

import {ScreeningTab} from '@/components/screening/ScreeningTab';
import {TooltipProvider} from '@/components/ui/tooltip';
import type {components} from '@/types/api/schema';
import {server} from '@/test/mocks/server';

type ConfigRead = components['schemas']['ScreeningConfigRead'];
type Row = components['schemas']['ScreeningRecordRow'];

const CONFIG_URL = '*/api/v1/projects/:projectId/screening/config';
const RECORDS_URL = '*/api/v1/projects/:projectId/screening/records';
const ASSIGNMENT_URL = '*/api/v1/screening/assignments/:assignmentId';

function config(overrides: Partial<ConfigRead> = {}): ConfigRead {
  return {
    can_arbitrate: false,
    can_manage: false,
    can_review: true,
    enrolled: 0,
    exclusion_reasons: [],
    not_enrolled: 0,
    reviewer_capable: 2,
    reviewer_count: null,
    reviewer_count_locked: false,
    ...overrides,
  };
}

const MANAGER = {can_manage: true, can_review: true, can_arbitrate: true};
const VIEWER = {can_manage: false, can_review: false, can_arbitrate: false};

const ROW: Row = {
  article_id: 'art1',
  assignment_id: 'as1',
  doi: null,
  first_author: null,
  has_pdf: false,
  ingestion_source: null,
  journal_title: null,
  my_decision: null,
  my_exclusion_reason: null,
  outcome: null,
  outcome_exclusion_reason: null,
  outcome_kind: null,
  pmid: null,
  publication_year: null,
  queue_rank: 1,
  status: 'to_screen',
  title: 'Deep learning for sepsis',
};

const ok = (data: unknown) => HttpResponse.json({ok: true, data});
const fail = (status: number, code: string) =>
  HttpResponse.json({ok: false, error: {code, message: code}}, {status});

function serveConfig(read: ConfigRead) {
  server.use(http.get(CONFIG_URL, () => ok(read)));
}

function serveRecords(rows: Row[] = [ROW]) {
  server.use(
    http.get(RECORDS_URL, () =>
      ok({exclusion_reasons: [], inclusion_criteria: [], phase: 'title_abstract', reviewer_count: 2, rows}),
    ),
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}
const params = () => new URLSearchParams(screen.getByTestId('location').textContent ?? '');

function renderTab(path = '/projects/p1?tab=screening') {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <MemoryRouter initialEntries={[path]}>
          <ScreeningTab projectId="p1" />
          <LocationProbe />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(toast).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('ScreeningTab', () => {
  it('shows the loading state while the config loads', async () => {
    server.use(http.get(CONFIG_URL, () => new Promise<never>(() => {})));
    renderTab();
    const region = await screen.findByRole('region', {name: 'Loading screening…'});
    expect(region).toHaveAttribute('aria-busy', 'true');
  });

  it('never redirects while the config read is pending', async () => {
    let reads = 0;
    server.use(
      http.get(CONFIG_URL, () => {
        reads += 1;
        return new Promise<never>(() => {});
      }),
    );
    renderTab('/projects/p1?tab=screening&screeningTab=settings');
    await screen.findByRole('region', {name: 'Loading screening…'});
    await waitFor(() => expect(reads).toBe(1));
    expect(params().get('screeningTab')).toBe('settings');
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('redirects a member deep-linked to settings only after the config resolves', async () => {
    serveConfig(config({reviewer_count: 2, enrolled: 1}));
    serveRecords();
    renderTab('/projects/p1?tab=screening&screeningTab=settings');
    await waitFor(() => expect(params().get('screeningTab')).toBe('title_abstract'));
    expect(params().get('tab')).toBe('screening');
    expect(await screen.findByText('Deep learning for sepsis')).toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("never bounces a manager's settings deep link", async () => {
    serveConfig(config({...MANAGER, reviewer_count: 2, enrolled: 1}));
    renderTab('/projects/p1?tab=screening&screeningTab=settings');
    expect(
      await screen.findByRole('radiogroup', {name: 'Reviewers per article — title/abstract'}),
    ).toBeInTheDocument();
    expect(params().get('screeningTab')).toBe('settings');
  });

  it('lands a manager with no config on Settings', async () => {
    serveConfig(config({...MANAGER, reviewer_count: null}));
    renderTab();
    await waitFor(() => expect(params().get('screeningTab')).toBe('settings'));
    expect(
      await screen.findByRole('radiogroup', {name: 'Reviewers per article — title/abstract'}),
    ).toBeInTheDocument();
  });

  it('shows "not set up" with Open Settings to a manager on Title/abstract', async () => {
    serveConfig(config({...MANAGER, reviewer_count: null}));
    const user = userEvent.setup();
    renderTab('/projects/p1?tab=screening&screeningTab=title_abstract');
    expect(await screen.findByText('Screening is not set up')).toBeInTheDocument();
    expect(params().get('screeningTab')).toBe('title_abstract');

    await user.click(screen.getByRole('button', {name: 'Open Settings'}));
    await waitFor(() => expect(params().get('screeningTab')).toBe('settings'));
    expect(
      await screen.findByRole('radiogroup', {name: 'Reviewers per article — title/abstract'}),
    ).toBeInTheDocument();
  });

  it('shows the member "not set up" notice', async () => {
    serveConfig(config({reviewer_count: null}));
    renderTab();
    expect(await screen.findByText('Screening is not set up yet')).toBeInTheDocument();
    expect(
      screen.getByText('A project manager chooses how many reviewers screen each record.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Open Settings'})).toBeNull();
    expect(params().get('screeningTab')).toBeNull();
  });

  it('shows the config error with retry', async () => {
    let calls = 0;
    server.use(
      http.get(CONFIG_URL, () => {
        calls += 1;
        return fail(500, 'INTERNAL_ERROR');
      }),
    );
    const user = userEvent.setup();
    renderTab();
    expect(await screen.findByText('Could not load screening')).toBeInTheDocument();
    expect(calls).toBe(1);

    await user.click(screen.getByRole('button', {name: 'Try again'}));
    await waitFor(() => expect(calls).toBe(2));
  });

  it('never redirects or lands on Settings after the config read errors', async () => {
    server.use(http.get(CONFIG_URL, () => fail(500, 'INTERNAL_ERROR')));
    const member = renderTab('/projects/p1?tab=screening&screeningTab=settings');
    expect(await screen.findByText('Could not load screening')).toBeInTheDocument();
    expect(params().get('screeningTab')).toBe('settings');
    member.unmount();

    renderTab();
    expect(await screen.findByText('Could not load screening')).toBeInTheDocument();
    expect(params().has('screeningTab')).toBe(false);
  });

  it.each([
    ['reviewer', {}],
    ['manager', MANAGER],
  ])('shows the toolbar with Import from PubMed above the "not set up" notice (%s)', async (_who, roles) => {
    serveConfig(config({...roles, reviewer_count: null}));
    renderTab('/projects/p1?tab=screening&screeningTab=title_abstract');
    const heading = await screen.findByRole('heading', {name: /Screening is not set up/});
    const importButton = screen.getByRole('button', {name: 'Import from PubMed'});
    expect(importButton.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no Import from PubMed to a viewer above the "not set up" notice', async () => {
    serveConfig(config({...VIEWER, reviewer_count: null}));
    renderTab();
    expect(await screen.findByText('Screening is not set up yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Import from PubMed'})).toBeNull();
  });

  it('renders the workspace once configured', async () => {
    serveConfig(config({reviewer_count: 2, enrolled: 1}));
    serveRecords();
    renderTab();
    expect(await screen.findByText('Deep learning for sepsis')).toBeInTheDocument();
    expect(screen.getByRole('tablist', {name: 'Status views'})).toBeInTheDocument();
  });

  it('ignores and strips ?assignment=', async () => {
    serveConfig(config({reviewer_count: 2, enrolled: 1}));
    serveRecords();
    let assignmentReads = 0;
    server.use(
      http.get(ASSIGNMENT_URL, () => {
        assignmentReads += 1;
        return ok({});
      }),
    );
    renderTab('/projects/p1?tab=screening&assignment=as1');
    expect(await screen.findByText('Deep learning for sepsis')).toBeInTheDocument();
    await waitFor(() => expect(params().has('assignment')).toBe(false));
    expect(params().has('article')).toBe(false);
    expect(assignmentReads).toBe(0);
  });
});
