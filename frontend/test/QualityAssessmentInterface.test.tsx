import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { QualityAssessmentInterface } from '@/components/quality/QualityAssessmentInterface';

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

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
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
    return { project_template_id: 'tpl-probast-project' };
  }),
}));

vi.mock('@/integrations/supabase/client', () => {
  function makeBuilder(rows: unknown, count: number | null = null) {
    const result = { data: rows, error: null, count };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      order: () => b,
      range: () => b,
      then: (cb: (r: typeof result) => unknown) => Promise.resolve(cb(result)),
    };
    return b;
  }

  return {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: (table: string) => {
        if (table === 'extraction_templates_global') {
          return makeBuilder([PROBAST_GLOBAL]);
        }
        if (table === 'project_extraction_templates') {
          return makeBuilder([PROBAST_PROJECT]);
        }
        if (table === 'articles') {
          return makeBuilder(
            [
              {
                id: 'article-1',
                title: 'A predictive model for X',
                authors: ['Doe', 'Roe'],
                publication_year: 2024,
                created_at: '2026-01-01T00:00:00Z',
              },
            ],
            1,
          );
        }
        if (table === 'extraction_instances' || table === 'extraction_reviewer_states') {
          return makeBuilder([]);
        }
        return makeBuilder([]);
      },
    },
  };
});

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="probe-pathname">{loc.pathname}</div>;
}

function renderInterface() {
  // HITLArticleTable now uses TanStack Query (useTemplateEntityTypes /
  // useArticleExtractionValues), so the tree needs a QueryClientProvider.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/projects/p1']}>
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
}

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
