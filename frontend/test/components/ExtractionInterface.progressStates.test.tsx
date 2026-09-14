/** R18: the dashboard gate, first match wins. Each test starts from the all-resolved state and changes only its step's inputs. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {t} from '@/lib/copy';
import {articleKeys} from '@/lib/query-keys';
const m = vi.hoisted(() => ({
  useAuthMock: vi.fn(), fetchArticlesMock: vi.fn(), templatesMock: vi.fn(), valuesMock: vi.fn(), structureMock: vi.fn(),
}));
// Envless CI has no VITE_SUPABASE_* — the real client module throws at import.
vi.mock('@/integrations/supabase/client', () => ({supabase: {auth: {getUser: vi.fn()}}}));
vi.mock('@/hooks/hitl/useProjectTemplates', () => ({
  useProjectTemplates: () => m.templatesMock(), useInvalidateProjectTemplates: () => vi.fn(),
}));
// The REAL shared gate (useCallerArticleProgress) runs: it composes the mocked useAuth with this mocked read.
vi.mock('@/hooks/extraction/useArticleExtractionValues', () => ({useArticleExtractionValues: () => m.valuesMock()}));
vi.mock('@/hooks/extraction/useActiveTemplateStructure', () => ({useActiveTemplateStructure: () => m.structureMock()}));
vi.mock('@/hooks/extraction/useTemplateRepublish', () => ({useTemplateConfigCaches: () => ({invalidateAfterImport: vi.fn()})}));
vi.mock('@/hooks/useProjectMemberRole', () => ({useProjectMemberRole: () => ({isManager: true, role: 'manager', loading: false})}));
vi.mock('@/contexts/AuthContext', () => ({useAuth: () => m.useAuthMock()}));
vi.mock('@/services/articlesService', () => ({fetchProjectArticles: (...a: unknown[]) => m.fetchArticlesMock(...a)}));
vi.mock('@/components/extraction/ArticleExtractionTable', () => ({ArticleExtractionTable: () => null}));
vi.mock('@/components/hitl/HITLExportDialog', () => ({HITLExportDialog: () => null}));
vi.mock('@/lib/extraction/progress', () => ({computeRowProgress: () => 50}));
import {ExtractionInterface} from '@/components/extraction/ExtractionInterface';
const ARTICLES = t('extraction', 'dashboardArticles'), AVG = t('extraction', 'dashboardStatAvgCompleteness');
const DISTRIBUTION = t('extraction', 'dashboardDistributionTitle'), CONFIGURE = t('extraction', 'dashboardConfigureTitle');
const TEMPLATES_ERROR = t('extraction', 'errorLoadTemplates'), PROGRESS_ERROR = t('extraction', 'errorLoadProgress');
const UNAVAILABLE = t('extraction', 'progressUnavailable'), TRY_AGAIN = t('patterns', 'errorTryAgain');
const TEMPLATE = {id: 'tpl-1', name: 'T', kind: 'extraction', is_active: true}, PROGRESS = {instances: [], values: []};
type Over = Record<string, unknown>;
const templates = (over: Over = {}) => ({data: [TEMPLATE], isLoading: false, isError: false, error: null, refetch: vi.fn(), ...over});
const values = (over: Over = {}) => ({valuesByArticle: new Map([['a1', PROGRESS], ['a2', PROGRESS]]),
  isLoading: false, isError: false, isUnavailable: false, refetch: vi.fn(), ...over});
const structure = (over: Over = {}) => ({entityTypes: [], isLoading: false, isError: false, error: null, refetch: vi.fn(), ...over});
function renderInterface() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const ui = () => ( // a fresh element per call, so a rerender re-reads the mocked hooks
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/?extractionTab=dashboard']}><ExtractionInterface projectId="p1" /></MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(ui()); return {client, rerender: () => view.rerender(ui())};
}
const stat = (label: string) => screen.getByText(label).previousElementSibling?.textContent;
async function renderResolved() { // precondition: real figures rendered before one input flips
  const view = renderInterface();
  expect(await screen.findByText(ARTICLES)).toBeInTheDocument();
  await waitFor(() => expect(stat(ARTICLES)).toBe('2'));
  return view;
}
const expectNoFigures = () => [screen.queryByText(ARTICLES), screen.queryByRole('img', {name: DISTRIBUTION})]
  .forEach((el) => expect(el).toBeNull());
beforeEach(() => {
  vi.clearAllMocks(); m.useAuthMock.mockReturnValue({user: {id: 'user-1'}, loading: false});
  m.fetchArticlesMock.mockResolvedValue({ok: true, data: [{id: 'a1'}, {id: 'a2'}]});
  m.templatesMock.mockReturnValue(templates());
  m.valuesMock.mockReturnValue(values());
  m.structureMock.mockReturnValue(structure());
});
describe('ExtractionInterface dashboard progress states', () => {
  it('shows the page-level templates skeleton, not the dashboard, while templates load', async () => {
    m.templatesMock.mockReturnValue(templates({data: undefined, isLoading: true}));
    const {client} = renderInterface();
    // The article read settled, so only the templates load can be what hides the dashboard.
    await waitFor(() => expect(client.getQueryState(articleKeys.byProject('p1'))?.status).toBe('success'));
    expect(screen.getByLabelText(t('extraction', 'loadingTemplates'))).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-skeleton')).toBeNull();
    expectNoFigures();
  });
  it('shows the templates error once, with a retry that refetches templates', async () => {
    const q = templates({data: undefined, isError: true, error: new Error('boom')});
    m.templatesMock.mockReturnValue(q);
    renderInterface();
    expect(await screen.findAllByText(TEMPLATES_ERROR)).toHaveLength(1);
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.queryByText(CONFIGURE)).toBeNull();
    expectNoFigures();
    await userEvent.click(screen.getByRole('button', {name: TRY_AGAIN}));
    expect(q.refetch).toHaveBeenCalledTimes(1);
  });
  it('keeps the dashboard figures when a template refetch fails with cached data', async () => {
    const view = await renderResolved();
    m.templatesMock.mockReturnValue(templates({isError: true, error: new Error('boom')})); // v5 refetch error: data kept
    view.rerender();
    expect(stat(ARTICLES)).toBe('2');
    expect(stat(AVG)).toBe('50%');
    expect(screen.getAllByText(TEMPLATES_ERROR)).toHaveLength(1);
  });
  it('shows only the configure card when no template is active', async () => {
    m.templatesMock.mockReturnValue(templates({data: []}));
    m.structureMock.mockReturnValue(structure({isLoading: true}));
    renderInterface();
    expect(await screen.findByText(CONFIGURE)).toBeInTheDocument();
    expectNoFigures();
    expect(screen.queryByTestId('dashboard-skeleton')).toBeNull();
  });
  it('shows the skeleton while the article list is loading', async () => {
    m.fetchArticlesMock.mockReturnValue(new Promise(() => {}));
    renderInterface();
    await waitFor(() => expect(m.fetchArticlesMock).toHaveBeenCalledWith('p1'));
    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument();
    expectNoFigures();
  });
  it('renders the error state when the article list fails to load', async () => {
    m.fetchArticlesMock.mockResolvedValue({ok: false, error: new Error('down')});
    renderInterface();
    expect(await screen.findByText(PROGRESS_ERROR)).toBeInTheDocument();
    expectNoFigures();
    m.fetchArticlesMock.mockClear();
    await userEvent.click(screen.getByRole('button', {name: TRY_AGAIN}));
    await waitFor(() => expect(m.fetchArticlesMock).toHaveBeenCalledWith('p1'));
  });
  it.each([
    ['shows the skeleton while the user lookup is resolving', () => m.useAuthMock.mockReturnValue({user: null, loading: true})],
    ['shows the skeleton while progress loads', () => m.valuesMock.mockReturnValue(values({isLoading: true}))],
  ])('%s', async (_name, flip) => {
    const view = await renderResolved();
    flip();
    view.rerender();
    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument();
    expectNoFigures();
  });
  it('renders progress unavailable once the lookup resolves with no user', async () => {
    const view = await renderResolved();
    m.useAuthMock.mockReturnValue({user: null, loading: false});
    m.valuesMock.mockReturnValue(values({isUnavailable: true}));
    view.rerender();
    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument();
    expectNoFigures();
    expect(screen.queryByRole('button', {name: TRY_AGAIN})).toBeNull();
  });
  it.each([
    ['shows an error with retry when progress fails', 'values'],
    ['shows an error with retry when the template structure fails', 'structure'],
  ] as const)('%s', async (_name, failed) => {
    const view = await renderResolved();
    const v = values({isError: failed === 'values'}), s = structure({isError: failed === 'structure'});
    m.valuesMock.mockReturnValue(v);
    m.structureMock.mockReturnValue(s);
    view.rerender();
    expect(screen.getByText(PROGRESS_ERROR)).toBeInTheDocument();
    expectNoFigures();
    await userEvent.click(screen.getByRole('button', {name: TRY_AGAIN}));
    expect((failed === 'values' ? v : s).refetch).toHaveBeenCalledTimes(1);
    expect((failed === 'values' ? s : v).refetch).not.toHaveBeenCalled();
  });
  it('renders the dashboard figures once progress has loaded', async () => {
    renderInterface();
    expect(await screen.findByText(ARTICLES)).toBeInTheDocument();
    await waitFor(() => expect(stat(ARTICLES)).toBe('2'));
    expect(stat(AVG)).toBe('50%');
    expect(screen.queryByTestId('dashboard-skeleton')).toBeNull();
  });
});
