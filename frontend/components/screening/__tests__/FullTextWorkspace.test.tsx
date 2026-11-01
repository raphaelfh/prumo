/**
 * ScreeningWorkspace at `full_text` (spec §7): the list-level states, the
 * full-text status views, the PDF column and filter, the Reason column on by
 * default, "Start screening", the list shortcuts standing down while
 * maximized, the outer shell winning ⇧⌘\ and Escape over the nested PDF
 * split, the unknown `?status=` rewrite, "Export excluded reports" and "Send
 * to full text". `RunPdfContent` is a stub: it pulls pdfjs.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http} from 'msw';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));
vi.mock('sonner', () => ({toast: Object.assign(vi.fn(), {success: vi.fn(), error: vi.fn(), warning: vi.fn()})}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({user: {id: 'u1'}, session: null, loading: false, signOut: vi.fn()}),
}));
vi.mock('@/services/articlesService', () => ({
  uploadArticleFile: vi.fn(),
  fetchMainFileInfo: vi.fn(),
}));
vi.mock('@/components/runs/RunPdfContent', () => ({
  RunPdfContent: () => <div data-testid="pdf" />,
}));

import {toast} from 'sonner';

import {SendToFullTextButton} from '@/components/screening/ScreeningToolbarActions';
import {TooltipProvider} from '@/components/ui/tooltip';
import {screeningKeys} from '@/lib/query-keys/screening';
import {fetchMainFileInfo} from '@/services/articlesService';
import type {ScreeningConfigRead, ScreeningRecordRow} from '@/services/screeningService';
import {server} from '@/test/mocks/server';

import {
  config,
  ENROLL_URL,
  fail,
  MANAGER,
  ok,
  panel,
  RECORDS_URL,
  renderWorkspace,
  REVIEWER,
  row,
  search,
  serveAssignments,
  serveRecords,
  VIEWER,
} from './screeningWorkspace.fixtures';

const FILES_URL = '*/api/v1/articles/:articleId/files';
const TEXT_BLOCKS_URL = '*/api/v1/article-files/:fileId/text-blocks';

const MAIN_FILE = {
  id: 'f1',
  fileRole: 'MAIN',
  fileType: 'application/pdf',
  storageKey: 'p1/art1/main.pdf',
  createdAt: '2026-10-01T00:00:00Z',
  extractionStatus: 'completed',
  originalFilename: 'main.pdf',
};

const FT = {phase: 'full_text', ta_outcome: 'include', ta_outcome_kind: 'consensus', ta_reviewer_count: 2} as const;
const WITH_PDF = row({...FT, title: 'Sepsis bundles', has_pdf: true});
const NO_PDF = row({...FT, article_id: 'art2', assignment_id: 'a2', queue_rank: 2, title: 'Asthma cohort'});
const EXCLUDED = row({
  ...FT,
  article_id: 'art3',
  assignment_id: 'a3',
  queue_rank: 3,
  title: '=Excluded trial',
  status: 'excluded',
  my_decision: 'exclude',
  my_exclusion_reason: 'Wrong population',
  outcome: 'exclude',
  outcome_exclusion_reason: 'Wrong population',
  has_pdf: true,
});
const GONE = row({
  ...FT,
  article_id: 'art4',
  assignment_id: 'a4',
  queue_rank: 4,
  title: 'Lost report',
  status: 'not_retrieved',
  my_decision: 'not_retrieved',
  outcome: 'not_retrieved',
});
const FT_ROWS = [WITH_PDF, NO_PDF, EXCLUDED, GONE];

/** Full text on, with reports enrolled. */
function ftConfig(overrides: Partial<ScreeningConfigRead> = {}): ScreeningConfigRead {
  return config({
    exclusion_reasons: ['Wrong population'],
    full_text_reviewer_count: 2,
    full_text_count_locked: true,
    full_text_enrolled: 4,
    full_text_ready: 0,
    ...overrides,
  });
}

function renderFullText(cfg: ScreeningConfigRead = ftConfig(), path = '/projects/p1?tab=screening&screeningTab=full_text') {
  return renderWorkspace({cfg, path, phase: 'full_text'});
}

const originalMatchMedia = window.matchMedia;

/** jsdom's stub answers every query false, which reads as below `lg`. */
function setDesktop() {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('min-width: 1024px'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

beforeEach(() => {
  vi.mocked(toast).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(fetchMainFileInfo).mockResolvedValue({ok: true, data: null} as never);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('Full-text workspace — list-level states', () => {
  it('shows skeleton rows', async () => {
    server.use(http.get(RECORDS_URL, () => new Promise(() => {})));
    renderFullText();
    const busy = await screen.findByRole('region', {name: 'Loading screening…'});
    expect(busy.querySelectorAll('[data-slot="skeleton-row"]').length).toBeGreaterThan(0);
  });

  it('shows an error with retry', async () => {
    let calls = 0;
    server.use(
      http.get(RECORDS_URL, () => {
        calls += 1;
        return fail(500, 'INTERNAL_ERROR');
      }),
    );
    const user = userEvent.setup();
    renderFullText();
    expect(await screen.findByText('Could not load screening')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Try again'}));
    await waitFor(() => expect(calls).toBe(2));
  });

  it('shows the 403 error state', async () => {
    server.use(http.get(RECORDS_URL, () => fail(403, 'FORBIDDEN')));
    renderFullText();
    expect(await screen.findByText('You do not have permission to do this.')).toBeInTheDocument();
  });

  it('reads the full-text phase', async () => {
    let phase: string | null = null;
    server.use(
      http.get(RECORDS_URL, ({request}) => {
        phase = new URL(request.url).searchParams.get('phase');
        return ok({exclusion_reasons: [], inclusion_criteria: [], phase: 'full_text', removed_duplicate_ids: [], reviewer_count: 2, rows: FT_ROWS});
      }),
    );
    renderFullText();
    expect(await screen.findByRole('button', {name: 'Sepsis bundles'})).toBeInTheDocument();
    expect(phase).toBe('full_text');
  });

  it('shows "No records in full text yet" with Send for a manager', async () => {
    serveRecords([], 'full_text');
    renderFullText(ftConfig({...MANAGER, full_text_enrolled: 0, full_text_ready: 3}));
    expect(await screen.findByRole('heading', {name: 'No records in full text yet'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Send 3 to full text'})).toBeEnabled();
    expect(screen.queryByText('A manager sends records to full text.')).toBeNull();
  });

  it('shows "No records in full text yet" with the member copy', async () => {
    serveRecords([], 'full_text');
    renderFullText(ftConfig({full_text_enrolled: 0, full_text_ready: 3}));
    expect(await screen.findByRole('heading', {name: 'No records in full text yet'})).toBeInTheDocument();
    expect(screen.getByText('A manager sends records to full text.')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /to full text/})).toBeNull();
  });

  it('offers no PubMed import and no Enroll at full text', async () => {
    serveRecords(FT_ROWS, 'full_text');
    const user = userEvent.setup();
    renderFullText(ftConfig({...MANAGER, enrolled: 4, not_enrolled: 5}));
    expect(await screen.findByRole('button', {name: 'Sepsis bundles'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Import from PubMed'})).toBeNull();
    expect(screen.queryByRole('button', {name: /^Enroll/})).toBeNull();
    await user.click(screen.getByRole('checkbox', {name: 'Select Asthma cohort'}));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Enroll selected'})).toBeNull();
  });
});

describe('Full-text workspace — the list', () => {
  it('lists Not retrieved and hides Maybe and Not enrolled views', async () => {
    serveRecords(FT_ROWS, 'full_text');
    renderFullText(ftConfig(MANAGER));
    expect(await screen.findByRole('tab', {name: /^Not retrieved/})).toBeInTheDocument();
    expect(screen.queryByRole('tab', {name: /^Maybe/})).toBeNull();
    expect(screen.queryByRole('tab', {name: /^Not enrolled/})).toBeNull();
  });

  it('shows the PDF column and filters missing PDFs', async () => {
    serveRecords(FT_ROWS, 'full_text');
    const user = userEvent.setup();
    renderFullText(ftConfig(MANAGER));
    await screen.findByRole('button', {name: 'Sepsis bundles'});
    expect(screen.getByRole('columnheader', {name: 'PDF'})).toBeInTheDocument();
    const withPdf = screen.getByRole('button', {name: 'Sepsis bundles'}).closest('tr')!;
    expect(within(withPdf).getByText('Attached')).toBeInTheDocument();
    const without = screen.getByRole('button', {name: 'Asthma cohort'}).closest('tr')!;
    expect(within(without).getByText('Missing')).toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: 'Filter'}));
    await user.click(screen.getByLabelText('PDF'));
    await user.click(screen.getByRole('checkbox', {name: 'Missing'}));
    await waitFor(() => expect(screen.queryByRole('button', {name: 'Sepsis bundles'})).toBeNull());
    expect(screen.getByRole('button', {name: 'Asthma cohort'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Lost report'})).toBeInTheDocument();
  });

  it('shows the Reason column by default', async () => {
    serveRecords(FT_ROWS, 'full_text');
    renderFullText(ftConfig(MANAGER));
    await screen.findByRole('button', {name: 'Sepsis bundles'});
    expect(screen.getByRole('columnheader', {name: 'Reason'})).toBeInTheDocument();
    const excluded = screen.getByRole('button', {name: '=Excluded trial'}).closest('tr')!;
    expect(within(excluded).getByText('Wrong population')).toBeInTheDocument();
  });

  it('shows the full-text decision in the Mine column', async () => {
    serveRecords(FT_ROWS, 'full_text');
    renderFullText(ftConfig(MANAGER));
    const gone = (await screen.findByRole('button', {name: 'Lost report'})).closest('tr')!;
    expect(within(gone).getAllByText('Not retrieved').length).toBeGreaterThan(0);
  });

  it('Start screening at full text', async () => {
    serveRecords(FT_ROWS, 'full_text');
    serveAssignments(FT_ROWS);
    server.use(http.get(FILES_URL, () => ok([])));
    const user = userEvent.setup();
    renderFullText(ftConfig(REVIEWER));
    await user.click(await screen.findByRole('button', {name: 'Start screening'}));
    await waitFor(() => expect(search().get('article')).toBe('art1'));
    expect(panel()).toHaveAttribute('data-maximized', 'true');
    expect(await screen.findByRole('heading', {name: 'Sepsis bundles'})).toBeInTheDocument();
  });

  it('shows no Start screening to a viewer', async () => {
    serveRecords(FT_ROWS, 'full_text');
    renderFullText(ftConfig(VIEWER));
    await screen.findByRole('button', {name: 'Sepsis bundles'});
    expect(screen.queryByRole('button', {name: 'Start screening'})).toBeNull();
  });

  it('list shortcuts are off while maximized', async () => {
    serveRecords(FT_ROWS, 'full_text');
    serveAssignments(FT_ROWS);
    server.use(http.get(FILES_URL, () => ok([])));
    const user = userEvent.setup();
    renderFullText(ftConfig(REVIEWER));
    const searchBox = await screen.findByPlaceholderText('Search records…');

    // Precondition: ⌘F focuses the list search while the list is showing.
    fireEvent.keyDown(document.body, {key: 'f', ctrlKey: true});
    expect(searchBox).toHaveFocus();
    searchBox.blur();

    await user.click(screen.getByRole('button', {name: 'Start screening'}));
    await waitFor(() => expect(panel()).toHaveAttribute('data-maximized', 'true'));
    fireEvent.keyDown(document.body, {key: 'f', ctrlKey: true});
    expect(searchBox).not.toHaveFocus();
  });

  it('outer ⇧⌘\\ and Escape win over the nested PDF split, one step per press', async () => {
    setDesktop();
    serveRecords(FT_ROWS, 'full_text');
    serveAssignments(FT_ROWS);
    server.use(
      http.get(FILES_URL, () => ok([MAIN_FILE])),
      http.get(TEXT_BLOCKS_URL, () => ok([])),
    );
    const user = userEvent.setup();
    renderFullText(ftConfig(REVIEWER));
    const chord = () => fireEvent.keyDown(window, {key: '|', code: 'Backslash', ctrlKey: true, shiftKey: true});
    const escape = () => fireEvent.keyDown(window, {key: 'Escape'});

    await user.click(await screen.findByRole('button', {name: 'Start screening'}));
    await waitFor(() => expect(panel()).toHaveAttribute('data-maximized', 'true'));
    expect(await screen.findByTestId('assessment-shell-form')).toBeInTheDocument();

    chord();
    await waitFor(() => expect(panel()).not.toHaveAttribute('data-maximized'));
    expect(screen.queryByTestId('assessment-shell-form')).toBeNull();
    expect(panel()).not.toBeNull();

    chord();
    await waitFor(() => expect(panel()).toHaveAttribute('data-maximized', 'true'));
    expect(screen.getByTestId('assessment-shell-form')).toBeInTheDocument();

    escape();
    await waitFor(() => expect(panel()).not.toHaveAttribute('data-maximized'));
    expect(panel()).not.toBeNull();

    escape();
    await waitFor(() => expect(panel()).toBeNull());
    expect(search().get('article')).toBe('art1');

    escape();
    await waitFor(() => expect(search().has('article')).toBe(false));
  });
});

describe('Full-text workspace — ?status=', () => {
  it.each(['maybe', 'not_enrolled', 'bogus'])(
    'falls back to the role default for a status the phase lacks (%s)',
    async (status) => {
      serveRecords(FT_ROWS, 'full_text');
      renderFullText(ftConfig(REVIEWER), `/projects/p1?tab=screening&screeningTab=full_text&status=${status}`);
      await waitFor(() => expect(search().get('status')).toBe('to_screen'));
      expect(screen.getByRole('tab', {name: /^To screen/})).toHaveAttribute('aria-selected', 'true');
      expect(search().get('screeningTab')).toBe('full_text');
    },
  );

  it('keeps a status the phase lists', async () => {
    serveRecords(FT_ROWS, 'full_text');
    renderFullText(ftConfig(REVIEWER), '/projects/p1?tab=screening&screeningTab=full_text&status=not_retrieved');
    expect(await screen.findByRole('tab', {name: /^Not retrieved/})).toHaveAttribute('aria-selected', 'true');
    expect(search().get('status')).toBe('not_retrieved');
  });
});

describe('Export excluded reports', () => {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:excluded');
  const originals = {create: URL.createObjectURL, revoke: URL.revokeObjectURL};
  beforeEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    createObjectURL.mockClear();
  });
  afterEach(() => {
    URL.createObjectURL = originals.create;
    URL.revokeObjectURL = originals.revoke;
  });

  it('Export excluded reports downloads one row per excluded report', async () => {
    const second = row({
      ...FT,
      article_id: 'art5',
      assignment_id: 'a5',
      queue_rank: 5,
      title: 'Second excluded',
      status: 'excluded',
      outcome: 'exclude',
      outcome_exclusion_reason: 'Wrong population',
    });
    serveRecords([...FT_ROWS, second], 'full_text');
    const clicks: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    const user = userEvent.setup();
    // A viewer exports too, and the view (To screen for a reviewer) does not narrow it.
    renderFullText(ftConfig(VIEWER), '/projects/p1?tab=screening&screeningTab=full_text&status=to_screen');
    await user.click(await screen.findByRole('button', {name: 'Export excluded reports'}));

    expect(clicks).toEqual(['excluded-reports.csv']);
    const lines = (await createObjectURL.mock.calls[0][0].text()).split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1].startsWith("'=Excluded trial,")).toBe(true);
    expect(lines[2].startsWith('Second excluded,')).toBe(true);
    click.mockRestore();
  });
});

describe('Send to full text', () => {
  function renderSend(cfg: ScreeningConfigRead) {
    const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={0}>
          <SendToFullTextButton projectId="p1" config={cfg} />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    return {invalidate};
  }
  const sendButton = () => screen.getByRole('button', {name: /to full text/});

  it.each([
    ['full text is off', {full_text_reviewer_count: null}, 'Full-text screening is off'],
    ['the protocol has no reasons', {exclusion_reasons: []}, 'Add exclusion reasons to the protocol first'],
    ['nothing is ready', {full_text_ready: 0}, 'No records are ready for full text'],
  ])('disabled with its tooltip when %s', async (_case, overrides, tooltip) => {
    const user = userEvent.setup();
    renderSend(ftConfig({...MANAGER, full_text_ready: 3, ...overrides}));
    expect(sendButton()).toBeDisabled();
    await user.hover(sendButton().parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(tooltip);
  });

  it('busy while sending', async () => {
    server.use(http.post(ENROLL_URL, () => new Promise<never>(() => {})));
    const user = userEvent.setup();
    renderSend(ftConfig({...MANAGER, full_text_ready: 3}));
    expect(sendButton()).toBeEnabled();
    await user.click(sendButton());
    await waitFor(() => expect(sendButton()).toBeDisabled());
    expect(sendButton()).toHaveAttribute('aria-busy', 'true');
  });

  it('toasts "Sent 3 to full text"', async () => {
    let body: unknown = null;
    server.use(
      http.post(ENROLL_URL, async ({request}) => {
        body = await request.json();
        return ok({enrolled: 3, already_enrolled: 0});
      }),
    );
    const user = userEvent.setup();
    renderSend(ftConfig({...MANAGER, full_text_ready: 3}));
    expect(sendButton()).toHaveTextContent('Send 3 to full text');
    await user.click(sendButton());
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Sent 3 to full text'));
    expect(body).toEqual({phase: 'full_text'});
  });

  it('toasts the enrolled count when a concurrent send got there first', async () => {
    server.use(http.post(ENROLL_URL, () => ok({enrolled: 1, already_enrolled: 2})));
    const user = userEvent.setup();
    renderSend(ftConfig({...MANAGER, full_text_ready: 3}));
    await user.click(sendButton());
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Sent 1 to full text'));
  });

  it('toasts a refused send and refetches the config', async () => {
    server.use(http.post(ENROLL_URL, () => fail(409, 'SCREENING_REASON_REQUIRED')));
    const user = userEvent.setup();
    const {invalidate} = renderSend(ftConfig({...MANAGER, full_text_ready: 3}));
    await user.click(sendButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Pick an exclusion reason.'));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({queryKey: screeningKeys.project('p1')}));
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('Title/abstract progress link', () => {
  it('opens full text and drops status and article', async () => {
    const ta: ScreeningRecordRow[] = [row(), row({article_id: 'art2', assignment_id: 'a2', queue_rank: 2, title: 'Beta'})];
    serveRecords(ta);
    serveAssignments(ta);
    const user = userEvent.setup();
    renderWorkspace({
      cfg: config({full_text_reviewer_count: 2, full_text_ready: 4}),
      path: '/projects/p1?tab=screening&screeningTab=title_abstract&status=all&article=art1',
    });
    await user.click(await screen.findByRole('button', {name: '4 to full text →'}));
    await waitFor(() => expect(search().get('screeningTab')).toBe('full_text'));
    expect(search().has('status')).toBe(false);
    expect(search().has('article')).toBe(false);
    expect(search().get('tab')).toBe('screening');
  });
});
