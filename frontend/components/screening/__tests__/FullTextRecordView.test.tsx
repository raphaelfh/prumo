/**
 * The full-text record panel (spec §7.3): the Abstract | PDF strip docked,
 * the nested split maximized on desktop, the reader below `lg` without the
 * split, the missing-PDF state with attach, and the TA provenance line.
 * Driven through `ScreeningRecordPanel` at `full_text`, the way the workspace
 * mounts it. `RunPdfContent` is a stub: it pulls pdfjs.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn(), warning: vi.fn()}}));
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

import {ScreeningRecordPanel} from '@/components/screening/ScreeningRecordPanel';
import {fetchMainFileInfo, uploadArticleFile} from '@/services/articlesService';
import type {ScreeningAssignmentRead, ScreeningConfigRead, ScreeningRecordRow} from '@/services/screeningService';
import {server} from '@/test/mocks/server';

const ASSIGNMENT_URL = '*/api/v1/screening/assignments/:assignmentId';
const DECIDE_URL = '*/api/v1/screening/assignments/:assignmentId/decisions';
const FILES_URL = '*/api/v1/articles/:articleId/files';
const TEXT_BLOCKS_URL = '*/api/v1/article-files/:fileId/text-blocks';

const ok = (data: unknown) => HttpResponse.json({ok: true, data});

const MAIN_FILE = {
  id: 'f1',
  fileRole: 'MAIN',
  fileType: 'application/pdf',
  storageKey: 'p1/art1/main.pdf',
  createdAt: '2026-10-01T00:00:00Z',
  extractionStatus: 'completed',
  originalFilename: 'main.pdf',
};

function row(overrides: Partial<ScreeningRecordRow> = {}): ScreeningRecordRow {
  return {
    article_id: 'art1',
    assignment_id: 'a1',
    doi: null,
    first_author: 'Smith J',
    has_pdf: false,
    ingestion_source: 'pubmed',
    journal_title: 'Lancet',
    my_decision: null,
    my_exclusion_reason: null,
    outcome: null,
    outcome_exclusion_reason: null,
    outcome_kind: null,
    ta_outcome: 'include',
    ta_outcome_kind: 'consensus',
    ta_reviewer_count: 2,
    pmid: null,
    publication_year: 2021,
    queue_rank: 1,
    status: 'to_screen',
    title: 'Deep learning for sepsis',
    ...overrides,
  };
}

function config(overrides: Partial<ScreeningConfigRead> = {}): ScreeningConfigRead {
  return {
    can_arbitrate: false,
    can_manage: false,
    can_review: true,
    enrolled: 3,
    exclusion_reasons: ['Wrong population'],
    not_enrolled: 0,
    reviewer_capable: 2,
    reviewer_count: 2,
    reviewer_count_locked: true,
    full_text_reviewer_count: 2,
    full_text_count_locked: true,
    full_text_ready: 1,
    full_text_enrolled: 1,
    ...overrides,
  };
}

function assignment(overrides: Partial<ScreeningAssignmentRead> = {}): ScreeningAssignmentRead {
  return {
    id: 'a1',
    project_id: 'p1',
    status: 'awaiting_me',
    exclusion_reasons: ['Wrong population'],
    article: {
      id: 'art1',
      title: 'Deep learning for sepsis',
      abstract: 'An abstract about sepsis.',
      authors: ['Smith J'],
      doi: null,
      journal_title: 'Lancet',
      pmid: null,
      publication_year: 2021,
    },
    my_decision: null,
    outcome: null,
    peer_decisions: [],
    ...overrides,
  };
}

/** `files` is read on every request, so a test can flip it after an upload. */
function serve(read: ScreeningAssignmentRead, files: {current: unknown[]}) {
  server.use(
    http.get(ASSIGNMENT_URL, () => ok(read)),
    http.get(FILES_URL, () => ok(files.current)),
    http.get(TEXT_BLOCKS_URL, () => ok([])),
  );
}

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

const originalMatchMedia = window.matchMedia;

interface RenderOptions {
  row?: ScreeningRecordRow;
  config?: ScreeningConfigRead;
  maximized?: boolean;
}

function renderPanel({row: r = row(), config: c = config(), maximized = false}: RenderOptions = {}) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  const ui = (next: ScreeningRecordRow) => (
    <QueryClientProvider client={client}>
      <ScreeningRecordPanel
        projectId="p1"
        phase="full_text"
        maximized={maximized}
        row={next}
        config={c}
        onDecided={vi.fn()}
        onNotInPhase={vi.fn()}
      />
    </QueryClientProvider>
  );
  const view = render(ui(r));
  return {rerender: (next: ScreeningRecordRow) => view.rerender(ui(next))};
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchMainFileInfo).mockResolvedValue({ok: true, data: null} as never);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

async function attachAPdf(user: ReturnType<typeof userEvent.setup>, files: {current: unknown[]}) {
  vi.mocked(uploadArticleFile).mockImplementation(async () => {
    files.current = [MAIN_FILE];
    return {ok: true, data: undefined} as never;
  });
  await user.click(await screen.findByRole('button', {name: 'Add file'}));
  await user.upload(await screen.findByLabelText(/Select Files/), new File(['%PDF'], 'a.pdf', {type: 'application/pdf'}));
  await user.click(screen.getByRole('button', {name: /Upload 1 file/}));
  await waitFor(() => expect(uploadArticleFile).toHaveBeenCalledTimes(1));
}

describe('FullTextRecordView (docked)', () => {
  it('defaults to PDF when a file exists', async () => {
    serve(assignment(), {current: [MAIN_FILE]});
    renderPanel({row: row({has_pdf: true})});
    expect(await screen.findByTestId('pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'PDF'})).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('No PDF attached')).toBeNull();
  });

  it('defaults to Abstract without one', async () => {
    serve(assignment(), {current: []});
    renderPanel();
    expect(await screen.findByText('An abstract about sepsis.')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Abstract'})).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('pdf')).toBeNull();
  });

  it('switches between Abstract and PDF', async () => {
    serve(assignment(), {current: [MAIN_FILE]});
    const user = userEvent.setup();
    renderPanel({row: row({has_pdf: true})});
    await screen.findByTestId('pdf');

    await user.click(screen.getByRole('button', {name: 'Abstract'}));
    expect(screen.getByText('An abstract about sepsis.')).toBeInTheDocument();
    expect(screen.queryByTestId('pdf')).toBeNull();

    await user.click(screen.getByRole('button', {name: 'PDF'}));
    expect(await screen.findByTestId('pdf')).toBeInTheDocument();
  });

  it('shows the missing-PDF state with Attach and keeps deciding allowed', async () => {
    serve(assignment(), {current: []});
    let body: unknown = null;
    server.use(
      http.post(DECIDE_URL, async ({request}) => {
        body = await request.json();
        return ok(assignment({status: 'awaiting_others'}));
      }),
    );
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByText('No PDF attached')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'PDF'}));
    expect(await screen.findByText('No file attached')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Add file'})).toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: /Include/}));
    await waitFor(() => expect(body).toEqual({decision: 'include'}));
  });

  it('hides Attach for a viewer', async () => {
    serve(assignment({status: 'awaiting_others'}), {current: []});
    const user = userEvent.setup();
    renderPanel({config: config({can_review: false, can_manage: false, can_arbitrate: false})});

    await user.click(await screen.findByRole('button', {name: 'PDF'}));
    expect(await screen.findByText('No file attached')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Add file'})).toBeNull();
    expect(screen.queryByRole('button', {name: /Include/})).toBeNull();
  });

  it('attaching a PDF refreshes the row and the panel', async () => {
    const files = {current: [] as unknown[]};
    serve(assignment(), files);
    const user = userEvent.setup();
    const {rerender} = renderPanel();

    await user.click(await screen.findByRole('button', {name: 'PDF'}));
    await attachAPdf(user, files);
    rerender(row({has_pdf: true}));

    expect(await screen.findByTestId('pdf')).toBeInTheDocument();
    expect(screen.queryByText('No PDF attached')).toBeNull();
  });
});

describe('FullTextRecordView (maximized)', () => {
  it('renders RunSplitShell nested when maximized', async () => {
    setDesktop();
    serve(assignment(), {current: [MAIN_FILE]});
    renderPanel({row: row({has_pdf: true}), maximized: true});

    expect(await screen.findByTestId('pdf')).toBeInTheDocument();
    expect(screen.getByTestId('assessment-shell-form')).toBeInTheDocument();
    // The decision pane and the abstract sit in the form pane; no strip.
    expect(screen.getByRole('button', {name: /Include/})).toBeInTheDocument();
    expect(screen.getByText('An abstract about sepsis.')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Abstract'})).toBeNull();

    fireEvent.keyDown(screen.getByTestId('pdf'), {key: '|', code: 'Backslash', ctrlKey: true, shiftKey: true});
    expect(screen.getByTestId('assessment-shell-form')).toBeInTheDocument();
    expect(screen.getByTestId('assessment-shell-pdf')).not.toHaveAttribute('data-expanded');
  });

  it('attaching while maximized shows the PDF in the split', async () => {
    setDesktop();
    const files = {current: [] as unknown[]};
    serve(assignment(), files);
    const user = userEvent.setup();
    const {rerender} = renderPanel({maximized: true});

    expect(await screen.findByText('No file attached')).toBeInTheDocument();
    expect(screen.getByTestId('assessment-shell-form')).toBeInTheDocument();
    await attachAPdf(user, files);
    rerender(row({has_pdf: true}));

    expect(await screen.findByTestId('pdf')).toBeInTheDocument();
    expect(screen.getByTestId('assessment-shell-form')).toBeInTheDocument();
  });

  it('opens the reader below lg without RunSplitShell', async () => {
    serve(assignment(), {current: [MAIN_FILE]});
    renderPanel({row: row({has_pdf: true}), maximized: true});

    expect(await screen.findByTestId('pdf')).toBeInTheDocument();
    expect(screen.queryByTestId('assessment-shell-form')).toBeNull();
    expect(screen.getByRole('button', {name: 'Abstract'})).toBeInTheDocument();
  });
});

describe('FullTextRecordView provenance', () => {
  it.each([
    [{ta_outcome: 'include', ta_outcome_kind: 'consensus', ta_reviewer_count: 2}, 'Included at title/abstract · 2 reviewers, consensus'],
    [{ta_outcome: 'include', ta_outcome_kind: 'solo', ta_reviewer_count: 1}, 'Included at title/abstract · 1 reviewer'],
    [{ta_outcome: 'maybe', ta_outcome_kind: 'arbitrated', ta_reviewer_count: 2}, 'Maybe at title/abstract · 2 reviewers, arbitrated'],
  ] as const)('shows the TA provenance line (%o)', async (ta, line) => {
    serve(assignment(), {current: []});
    renderPanel({row: row(ta)});
    expect(await screen.findByText(line)).toBeInTheDocument();
  });
});
