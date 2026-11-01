/**
 * PrismaCountsPanel — the PRISMA tab's numbers. Blind review: the payload has
 * no pending or in-conflict count, and the panel never shows one.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {describe, expect, it, vi} from 'vitest';

// A session token: apiClient refuses to send a request without one.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));

import {PrismaCountsPanel} from '@/components/prisma/PrismaCountsPanel';
import {screeningKeys} from '@/lib/query-keys/screening';
import {server} from '@/test/mocks/server';

const PRISMA_URL = '*/api/v1/projects/:projectId/prisma';

const ok = (data: unknown) => HttpResponse.json({ok: true, data});
const fail = (status: number, code: string) =>
  HttpResponse.json({ok: false, error: {code, message: code}}, {status});

const FT_OFF = {
  ta_included: 1,
  ta_maybe: 2,
  reports_assessed: null,
  reports_excluded_by_reason: null,
  reports_included: null,
  reports_not_retrieved: null,
  full_text_in_progress: null,
};

const COUNTS = {
  identified: [
    {source: 'pubmed', count: 3},
    {source: 'ris', count: 1},
  ],
  identified_total: 4,
  duplicates_removed: 1,
  records_not_found: 1,
  imported_not_enrolled: 2,
  screened: 3,
  excluded: 2,
  excluded_by_reason: [{reason: 'Not ML', count: 1}],
  excluded_reasons_differ: 1,
  excluded_without_reason: 0,
  sought_for_retrieval: 1,
  ...FT_OFF,
};

const FT_ON = {
  ta_included: 4,
  ta_maybe: 1,
  reports_not_retrieved: 1,
  reports_assessed: 3,
  reports_excluded_by_reason: [{reason: 'Wrong design', count: 1}],
  reports_included: 2,
  full_text_in_progress: false,
};

const CONFIG_URL = '*/api/v1/projects/:projectId/screening/config';

const CONFIG = {
  can_arbitrate: true,
  can_manage: true,
  can_review: true,
  enrolled: 3,
  exclusion_reasons: [],
  not_enrolled: 0,
  reviewer_capable: 3,
  reviewer_count: 2,
  reviewer_count_locked: true,
  full_text_reviewer_count: 3,
  full_text_count_locked: true,
  full_text_ready: 0,
  full_text_enrolled: 3,
};

const EMPTY = {
  identified: [],
  identified_total: 0,
  duplicates_removed: 0,
  records_not_found: 0,
  imported_not_enrolled: 3,
  screened: 0,
  excluded: 0,
  excluded_by_reason: [],
  excluded_reasons_differ: 0,
  excluded_without_reason: 0,
  sought_for_retrieval: 0,
  ...FT_OFF,
};

function renderPanel() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  return render(
    <QueryClientProvider client={client}>
      <PrismaCountsPanel projectId="p1" />
    </QueryClientProvider>,
  );
}

describe('PrismaCountsPanel', () => {
  it('shows a busy region while loading', async () => {
    server.use(http.get(PRISMA_URL, () => new Promise<never>(() => {})));
    renderPanel();
    const region = await screen.findByRole('region', {name: 'Loading screening…'});
    expect(region).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the load error and retries', async () => {
    let calls = 0;
    server.use(
      http.get(PRISMA_URL, () => {
        calls += 1;
        return fail(500, 'INTERNAL_ERROR');
      }),
    );
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByText('Could not load screening')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(calls).toBe(1);

    await user.click(screen.getByRole('button', {name: 'Try again'}));
    await waitFor(() => expect(calls).toBe(2));
  });

  it('says forbidden for a non-member', async () => {
    server.use(http.get(PRISMA_URL, () => fail(403, 'FORBIDDEN')));
    renderPanel();
    expect(await screen.findByText('You do not have permission to do this.')).toBeInTheDocument();
  });

  it('shows the empty state with the not-enrolled count', async () => {
    server.use(http.get(PRISMA_URL, () => ok(EMPTY)));
    renderPanel();

    expect(await screen.findByText('No records screened yet')).toBeInTheDocument();
    expect(screen.getByText('Counts appear once articles are enrolled for screening.')).toBeInTheDocument();
    expect(screen.getByText('Imported but not enrolled').closest('p')).toHaveTextContent(
      /^Imported but not enrolled\s*3$/,
    );
    expect(screen.queryByText('Records screened')).toBeNull();
  });

  it('renders identification and screening numbers', async () => {
    server.use(http.get(PRISMA_URL, () => ok(COUNTS)));
    renderPanel();

    expect(await screen.findByRole('heading', {name: 'PRISMA counts'})).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Identification'})).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Title and abstract screening'})).toBeInTheDocument();
    for (const name of [
      'PubMed 3',
      'RIS 1',
      'Records identified 4',
      'Duplicates removed 1',
      'Records not retrieved from the source 1',
      'Imported but not enrolled 2',
      'Records screened 3',
      'Records excluded 2',
      'Not ML 1',
      'Reasons differ 1',
    ]) {
      expect(screen.getByRole('row', {name})).toBeInTheDocument();
    }
    // A zero breakdown line adds nothing to the excluded count.
    expect(screen.queryByText('No reason given')).toBeNull();
    expect(screen.queryByText(/conflict/i)).toBeNull();
    expect(screen.queryByText(/awaiting/i)).toBeNull();
  });

  it('full text off: records included at title/abstract and maybe, no reports box', async () => {
    server.use(http.get(PRISMA_URL, () => ok(COUNTS)));
    renderPanel();

    expect(await screen.findByRole('row', {name: 'Records included at title/abstract 1'})).toBeInTheDocument();
    expect(screen.getByRole('row', {name: 'Maybe (not assessed) 2'})).toBeInTheDocument();
    expect(screen.queryByRole('heading', {name: 'Full-text screening'})).toBeNull();
    expect(screen.queryByText('Reports included')).toBeNull();
  });

  it('full text on: the reports box ends in Reports included', async () => {
    server.use(http.get(PRISMA_URL, () => ok({...COUNTS, ...FT_ON})));
    renderPanel();

    expect(await screen.findByRole('heading', {name: 'Full-text screening'})).toBeInTheDocument();
    for (const name of [
      'Records included at title/abstract 4',
      'Reports sought for retrieval 1',
      'Reports not retrieved 1',
      'Reports assessed for eligibility 3',
      'Wrong design 1',
      'Reports included 2',
    ]) {
      expect(screen.getByRole('row', {name})).toBeInTheDocument();
    }
    expect(screen.queryByText('Maybe (not assessed)')).toBeNull();
  });

  it('shows "In progress" for the reports box while full text is in progress', async () => {
    server.use(http.get(PRISMA_URL, () => ok({...COUNTS, ...FT_ON, full_text_in_progress: true})));
    renderPanel();

    expect(await screen.findByRole('row', {name: 'Reports assessed for eligibility In progress'})).toBeInTheDocument();
    expect(screen.getByRole('row', {name: 'Reports included In progress'})).toBeInTheDocument();
    expect(screen.queryByRole('row', {name: 'Reports included 2'})).toBeNull();
  });

  it('shows the method line from the config and omits it while the config loads', async () => {
    server.use(http.get(PRISMA_URL, () => ok({...COUNTS, ...FT_ON})), http.get(CONFIG_URL, () => new Promise<never>(() => {})));
    const loading = renderPanel();
    await screen.findByRole('heading', {name: 'PRISMA counts'});
    expect(screen.queryByText(/independent reviewers/)).toBeNull();
    loading.unmount();

    server.use(http.get(CONFIG_URL, () => ok(CONFIG)));
    renderPanel();
    expect(
      await screen.findByText(
        '2 independent reviewers at title/abstract, 3 at full text; conflicts resolved by an arbitrator',
      ),
    ).toBeInTheDocument();
  });

  it('uses singular and title/abstract-only method wording', async () => {
    server.use(
      http.get(PRISMA_URL, () => ok(COUNTS)),
      http.get(CONFIG_URL, () => ok({...CONFIG, reviewer_count: 1, full_text_reviewer_count: null})),
    );
    renderPanel();
    expect(
      await screen.findByText('1 independent reviewer at title/abstract; conflicts resolved by an arbitrator'),
    ).toBeInTheDocument();
  });

  it('names known sources and shows an unknown one as sent', async () => {
    server.use(
      http.get(PRISMA_URL, () =>
        ok({
          ...COUNTS,
          identified: [
            {source: 'zotero', count: 2},
            {source: 'manual', count: 1},
            {source: 'scopus', count: 4},
          ],
          excluded_without_reason: 1,
        }),
      ),
    );
    renderPanel();

    expect(await screen.findByRole('row', {name: 'Zotero 2'})).toBeInTheDocument();
    expect(screen.getByRole('row', {name: 'Manual 1'})).toBeInTheDocument();
    expect(screen.getByRole('row', {name: 'scopus 4'})).toBeInTheDocument();
    expect(screen.getByRole('row', {name: 'No reason given 1'})).toBeInTheDocument();
  });

  it('lives under the family a PubMed import refreshes', () => {
    const family = screeningKeys.project('p1');
    expect(screeningKeys.prisma('p1').slice(0, family.length)).toEqual(family);
  });
});
