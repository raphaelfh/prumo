import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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

vi.mock('@/integrations/api', () => ({
  apiClient: vi.fn(async () => ({ project_template_id: 'tpl-probast-project' })),
}));

vi.mock('@/integrations/supabase/client', () => {
  function makeBuilder(rows: unknown, count: number | null = null) {
    const result = { data: rows, error: null, count };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      order: () => b,
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
  return render(
    <MemoryRouter initialEntries={['/projects/p1']}>
      <Routes>
        <Route
          path="/projects/:projectId"
          element={<QualityAssessmentInterface projectId="p1" />}
        />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
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
});
