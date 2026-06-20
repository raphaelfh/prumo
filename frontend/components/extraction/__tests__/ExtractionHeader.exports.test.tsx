import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ExtractionHeader } from '@/components/extraction/ExtractionHeader';

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/extraction/useFullAIExtraction', () => ({
  useFullAIExtraction: () => ({ extractFullAI: vi.fn(), loading: false, progress: null }),
}));
vi.mock('@/hooks/extraction/ai/useRunAIExtraction', () => ({
  useRunAIExtraction: () => ({ extractForRun: vi.fn(), loading: false }),
}));
vi.mock('@/hooks/hitl/useHITLProjectTemplates', () => ({
  useHITLProjectTemplates: () => ({ globalTemplates: [], loading: false }),
}));

const base = {
  projectId: 'p', projectName: 'P', articleTitle: 'A', onBack: vi.fn(),
  articles: [{ id: 'art-1', title: 'A' }], currentArticleId: 'art-1', onNavigateToArticle: vi.fn(),
  completedFields: 0, totalFields: 0, completionPercentage: 0,
  showPDF: false, onTogglePDF: vi.fn(), viewMode: 'extract' as const, onViewModeChange: vi.fn(),
  hasComparison: false, isComplete: false, onFinalize: vi.fn(),
  templateId: 'tpl-1',
};

describe('ExtractionHeader (post legacy-cascade)', () => {
  it('renders the More menu without an Export Data item', async () => {
    render(<MemoryRouter><ExtractionHeader {...base} /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /more/i }));
    expect(screen.queryByText(/Export Data/i)).not.toBeInTheDocument();
  });

  // TDD: Task 9 — re-skin onto RunHeader compound
  it('renders a StageRail navigation landmark', () => {
    render(<MemoryRouter><ExtractionHeader {...base} stage="proposal" /></MemoryRouter>);
    expect(screen.getByRole('navigation', { name: 'Run stage' })).toBeInTheDocument();
  });

  it('primary button label has no parenthetical like "(advance to consensus)"', () => {
    render(
      <MemoryRouter>
        <ExtractionHeader
          {...base}
          stage="proposal"
          isComplete={true}
          completedFields={5}
          totalFields={5}
          transition={{
            to: 'review',
            label: 'Submit for review',
            gate: { ok: true },
            onAdvance: vi.fn(),
          }}
        />
      </MemoryRouter>,
    );
    const btn = screen.getByRole('button', { name: /submit for review/i });
    expect(btn.textContent).not.toMatch(/\(.*\)/);
  });

  it('does NOT render extraction-hitl-banner when rendered in isolation', () => {
    render(<MemoryRouter><ExtractionHeader {...base} /></MemoryRouter>);
    expect(screen.queryByTestId('extraction-hitl-banner')).not.toBeInTheDocument();
  });
});
