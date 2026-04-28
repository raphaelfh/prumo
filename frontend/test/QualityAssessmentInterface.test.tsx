import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { QualityAssessmentInterface } from '@/components/quality/QualityAssessmentInterface';

const PROBAST_ROW = {
  id: 'tpl-probast',
  name: 'PROBAST',
  description: 'Risk of bias',
  framework: 'CUSTOM',
  version: '1.0.0',
};

const QUADAS_ROW = {
  id: 'tpl-quadas',
  name: 'QUADAS-2',
  description: 'Diagnostic accuracy',
  framework: 'CUSTOM',
  version: '1.0.0',
};

vi.mock('@/integrations/supabase/client', () => {
  function makeBuilder(rows: unknown) {
    const result = { data: rows, error: null };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      order: () => b,
      then: (cb: (r: typeof result) => unknown) => Promise.resolve(cb(result)),
    };
    return b;
  }

  return {
    supabase: {
      from: (table: string) => {
        if (table === 'extraction_templates_global') {
          return makeBuilder([PROBAST_ROW, QUADAS_ROW]);
        }
        if (table === 'articles') {
          return makeBuilder([
            {
              id: 'article-1',
              title: 'A predictive model for X',
              authors: ['Doe', 'Roe'],
              year: 2024,
            },
          ]);
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
  it('lists each article with one button per QA template', async () => {
    renderInterface();

    await waitFor(() =>
      expect(screen.getByTestId('qa-articles-list')).toBeInTheDocument(),
    );

    expect(screen.getByText(/A predictive model for X/)).toBeInTheDocument();
    expect(
      screen.getByTestId('qa-open-article-1-PROBAST'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('qa-open-article-1-QUADAS-2'),
    ).toBeInTheDocument();
  });

  it('navigates to the QA fullscreen route when a template button is clicked', async () => {
    const user = userEvent.setup();
    renderInterface();

    await waitFor(() =>
      expect(screen.getByTestId('qa-open-article-1-PROBAST')).toBeInTheDocument(),
    );

    await user.click(screen.getByTestId('qa-open-article-1-PROBAST'));

    await waitFor(() =>
      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        '/projects/p1/articles/article-1/quality-assessment/tpl-probast',
      ),
    );
  });
});
