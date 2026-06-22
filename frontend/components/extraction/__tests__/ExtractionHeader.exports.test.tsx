import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('hides the More menu entirely when it would have no items', () => {
    // base has hasComparison:false and no canReopen, so the only two menu
    // items are both gated off. An empty kebab is a dead affordance — it must
    // not render at all (regression: it used to open to an empty dropdown).
    render(<MemoryRouter><ExtractionHeader {...base} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /more/i })).not.toBeInTheDocument();
  });

  it('renders the More menu (without an Export Data item) when it has items', async () => {
    render(<MemoryRouter><ExtractionHeader {...base} hasComparison /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /more/i }));
    expect(screen.queryByText(/Export Data/i)).not.toBeInTheDocument();
  });

  // TDD: Task 9 — re-skin onto RunHeader compound
  it('renders a StageRail navigation landmark', () => {
    render(<MemoryRouter><ExtractionHeader {...base} stage="extract" /></MemoryRouter>);
    expect(screen.getByRole('navigation', { name: 'Run stage' })).toBeInTheDocument();
  });

  it('primary button label has no parenthetical like "(advance to consensus)"', () => {
    render(
      <MemoryRouter>
        <ExtractionHeader
          {...base}
          stage="extract"
          isComplete={true}
          completedFields={5}
          totalFields={5}
          transition={{
            to: 'consensus',
            label: 'Mark ready',
            gate: { ok: true },
            onAdvance: vi.fn(),
          }}
        />
      </MemoryRouter>,
    );
    const btn = screen.getByRole('button', { name: /mark ready/i });
    expect(btn.textContent).not.toMatch(/\(.*\)/);
  });

  it('does NOT render extraction-hitl-banner when rendered in isolation', () => {
    render(<MemoryRouter><ExtractionHeader {...base} /></MemoryRouter>);
    expect(screen.queryByTestId('extraction-hitl-banner')).not.toBeInTheDocument();
  });

  // TDD: Task 9 regression — article prev/next pager restored in re-skinned header
  describe('article pager', () => {
    const art1 = { id: 'art-1', title: 'Article 1' };
    const art2 = { id: 'art-2', title: 'Article 2' };
    const art3 = { id: 'art-3', title: 'Article 3' };
    const articles = [art1, art2, art3];
    const onNavigate = vi.fn();

    afterEach(() => { onNavigate.mockReset(); });

    it('prev navigates to the first article when on the middle one', async () => {
      render(
        <MemoryRouter>
          <ExtractionHeader {...base} articles={articles} currentArticleId="art-2" onNavigateToArticle={onNavigate} />
        </MemoryRouter>,
      );
      await userEvent.click(screen.getByRole('button', { name: /previous article/i }));
      expect(onNavigate).toHaveBeenCalledWith('art-1');
    });

    it('next navigates to the third article when on the middle one', async () => {
      render(
        <MemoryRouter>
          <ExtractionHeader {...base} articles={articles} currentArticleId="art-2" onNavigateToArticle={onNavigate} />
        </MemoryRouter>,
      );
      await userEvent.click(screen.getByRole('button', { name: /next article/i }));
      expect(onNavigate).toHaveBeenCalledWith('art-3');
    });

    it('prev button is disabled on the first article', () => {
      render(
        <MemoryRouter>
          <ExtractionHeader {...base} articles={articles} currentArticleId="art-1" onNavigateToArticle={onNavigate} />
        </MemoryRouter>,
      );
      expect(screen.getByRole('button', { name: /previous article/i })).toBeDisabled();
    });

    it('next button is disabled on the last article', () => {
      render(
        <MemoryRouter>
          <ExtractionHeader {...base} articles={articles} currentArticleId="art-3" onNavigateToArticle={onNavigate} />
        </MemoryRouter>,
      );
      expect(screen.getByRole('button', { name: /next article/i })).toBeDisabled();
    });

    it('does not render pager when there is only one article', () => {
      render(
        <MemoryRouter>
          <ExtractionHeader {...base} articles={[art1]} currentArticleId="art-1" onNavigateToArticle={onNavigate} />
        </MemoryRouter>,
      );
      expect(screen.queryByRole('button', { name: /previous article/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /next article/i })).not.toBeInTheDocument();
    });
  });
});
