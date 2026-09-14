import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QualityAssessmentInterface } from '@/components/quality/QualityAssessmentInterface';
import { articleKeys } from '@/lib/query-keys';

const PROBAST_GLOBAL = {
  id: 'tpl-probast-global',
  name: 'PROBAST',
  description: 'Risk of bias',
  framework: 'CUSTOM',
  version: '1.0.0',
  kind: 'quality_assessment',
};

const PROBAST_PROJECT = {
  id: 'tpl-probast-project',
  project_id: 'p1',
  global_template_id: 'tpl-probast-global',
  name: 'PROBAST',
  description: 'Risk of bias',
  framework: 'CUSTOM',
  version: '1.0.0',
  kind: 'quality_assessment',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  created_by: 'user-1',
};

const ARTICLE_1 = {
  id: 'article-1',
  title: 'A predictive model for X',
  authors: ['Doe', 'Roe'],
  publication_year: 2024,
  created_at: '2026-01-01T00:00:00Z',
};

// Per-test PostgREST answers: `rows` overrides a table's rows, `errors` makes
// a table's read fail. Reset before every test.
const db = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  errors: {} as Record<string, { message: string }>,
}));

const session = vi.hoisted(() => ({ user: { id: 'user-1' } as { id: string } | null }));

// The per-article progress read is mocked at the hook boundary: the dashboard's
// contract is "progress map + article list → counts or an error state",
// independent of how the hook reads (PostgREST today, the API later).
const progress = vi.hoisted(() => ({
  valuesByArticle: new Map<string, unknown>(),
  isLoading: false,
  error: null as Error | null,
}));

vi.mock('@/hooks/extraction/useArticleExtractionValues', () => ({
  articleExtractionValuesKeys: {
    byTemplate: (...scope: string[]) => ['article-extraction-values', ...scope],
  },
  useArticleExtractionValues: () => ({ ...progress }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: session.user }),
}));

// The worklist toolbar mounts the engine gear (spec §5); its hooks are stubbed
// so this test stays about the mount point, not the engine read.
const ENGINE_READ = {
  default: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    mode: 'fast',
    source: 'project',
    retired: false,
    user_choice_allowed: true,
  },
  effective: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    mode: 'fast',
    source: 'project',
    retired: false,
    connection_id: null,
    connection_label: null,
  },
  source: 'project',
  catalog: [
    {
      provider: 'openai',
      model: 'gpt-4o-mini',
      canonical: 'openai:gpt-4o-mini',
      label: 'GPT-4o mini',
      best_for: 'b',
      context_window: 1000,
      cost_tier: '$',
    },
  ],
  availability: { openai: 'global' },
};

vi.mock('@/hooks/extraction/useLlmEngine', () => ({
  useLlmEngine: () => ({ data: ENGINE_READ, isPending: false, isError: false, refetch: vi.fn() }),
  useSetMyEngine: () => ({ mutate: vi.fn(), isPending: false }),
  useClearMyEngine: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/user/useLlmConnections', () => ({
  useProviders: () => ({ data: [] }),
  useMyConnections: () => ({ data: [] }),
}));

vi.mock('@/integrations/api', () => ({
  apiClient: vi.fn(async (path: string) => {
    // B-3a: the worklist reads the ACTIVE snapshot from the typed endpoint;
    // an error here gates the table behind a placeholder, so the mock must
    // answer with a minimal tree.
    if (path.includes('/active-version')) {
      return { version_id: 'v1', version: 1, entity_types: [] };
    }
    if (path === '/api/v1/projects/p1/templates?kind=quality_assessment') {
      return [PROBAST_PROJECT];
    }
    if (path === '/api/v1/templates/global?kind=quality_assessment') {
      return [PROBAST_GLOBAL];
    }
    return { project_template_id: 'tpl-probast-project' };
  }),
}));

vi.mock('@/integrations/supabase/client', () => {
  function makeBuilder(rows: unknown, error: { message: string } | null = null) {
    const result = { data: error ? null : rows, error, count: null };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      order: () => b,
      then: (cb: (r: typeof result) => unknown) => Promise.resolve(cb(result)),
    };
    return b;
  }

  // Resolved per call: vi.mock is hoisted above the fixture constants.
  const defaultRows = (table: string): unknown[] =>
    ({
      articles: [ARTICLE_1],
    })[table] ?? [];

  return {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: (table: string) => {
        if (db.errors[table]) return makeBuilder(null, db.errors[table]);
        return makeBuilder(db.rows[table] ?? defaultRows(table));
      },
    },
  };
});

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="probe-pathname">{loc.pathname}</div>;
}

function renderInterface(entry = '/projects/p1') {
  // HITLArticleTable now uses TanStack Query (useTemplateEntityTypes /
  // useArticleExtractionValues), so the tree needs a QueryClientProvider.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/projects/:projectId"
            element={<QualityAssessmentInterface projectId="p1" />}
          />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

beforeEach(() => {
  db.rows = {};
  db.errors = {};
  session.user = { id: 'user-1' };
  progress.valuesByArticle = new Map();
  progress.isLoading = false;
  progress.error = null;
});

describe('QualityAssessmentInterface', () => {
  it('renders the assessment table with the active QA template', async () => {
    renderInterface();

    await waitFor(() =>
      expect(
        screen.getByTestId('hitl-quality_assessment-active-template-bar'),
      ).toBeInTheDocument(),
    );

    expect(
      screen.getByTestId('hitl-quality_assessment-active-template-name'),
    ).toHaveTextContent('PROBAST');
    expect(
      await screen.findByText(/A predictive model for X/),
    ).toBeInTheDocument();
  });

  it('navigates to the QA fullscreen route when the row Action button is clicked', async () => {
    const user = userEvent.setup();
    renderInterface();

    const actionButton = await screen.findByTestId(
      'hitl-quality_assessment-row-action-article-1',
    );
    await user.click(actionButton);

    await waitFor(() =>
      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        '/projects/p1/articles/article-1/quality-assessment/tpl-probast-project',
      ),
    );
  });

  it('offers the export dialog from the article-table toolbar', async () => {
    const user = userEvent.setup();
    renderInterface();

    // The button lives in HITLArticleTable's toolbar via `toolbarActions` —
    // the same slot and placement the extraction table uses.
    const exportButton = await screen.findByTestId('qa-export-button');
    await waitFor(() => expect(exportButton).toBeEnabled());
    await user.click(exportButton);

    expect(
      await screen.findByRole('dialog', { name: /Export to Excel/i }),
    ).toBeInTheDocument();
  });

  it('mounts the engine gear on the QA worklist with the effective engine in its tooltip', async () => {
    const user = userEvent.setup();
    renderInterface();

    const gear = await screen.findByTestId('engine-gear');
    await user.hover(gear);
    expect(
      (await screen.findAllByText(/Your engine for new runs: GPT-4o mini/)).length,
    ).toBeGreaterThan(0);
  });
});

describe('QualityAssessmentInterface dashboard', () => {
  const DASHBOARD = '/projects/p1?qaTab=dashboard';
  const LOAD_ERROR = /Couldn’t load quality-assessment progress/;

  function seedTwoArticlesOneStarted() {
    db.rows.articles = [ARTICLE_1, { ...ARTICLE_1, id: 'article-2', title: 'Second' }];
    progress.valuesByArticle = new Map([
      ['article-1', { instances: [{ id: 'inst-1', entity_type_id: 'et-1' }], values: [] }],
    ]);
  }

  it('counts articles with progress data against the project total', async () => {
    seedTwoArticlesOneStarted();
    renderInterface(DASHBOARD);

    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows the error state, not zero counts, when the progress read fails', async () => {
    seedTwoArticlesOneStarted();
    progress.error = new Error('permission denied');
    renderInterface(DASHBOARD);

    expect(await screen.findByText(LOAD_ERROR)).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByText('50%')).not.toBeInTheDocument();
  });

  it('shows the error state, not zero counts, when the articles read fails', async () => {
    seedTwoArticlesOneStarted();
    db.errors.articles = { message: 'permission denied' };
    renderInterface(DASHBOARD);

    expect(await screen.findByText(LOAD_ERROR)).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('recovers the counts when the user retries after a failed read', async () => {
    const user = userEvent.setup();
    seedTwoArticlesOneStarted();
    db.errors.articles = { message: 'network down' };
    renderInterface(DASHBOARD);

    await screen.findByText(LOAD_ERROR);
    delete db.errors.articles;
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(screen.queryByText(LOAD_ERROR)).not.toBeInTheDocument();
  });

  it('shows the skeleton, not zero counts, while there is no user', async () => {
    session.user = null;
    seedTwoArticlesOneStarted();
    const { queryClient } = renderInterface(DASHBOARD);

    // Precondition: the article read resolved, so only the missing user can hold the skeleton.
    await waitFor(() =>
      expect(queryClient.getQueryState(articleKeys.byProject('p1'))?.status).toBe('success'),
    );
    expect(screen.getByTestId('qa-dashboard-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('50%')).not.toBeInTheDocument();
  });
});
