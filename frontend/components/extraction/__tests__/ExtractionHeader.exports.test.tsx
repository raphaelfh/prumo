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
  hasOtherExtractions: false, isComplete: false, onFinalize: vi.fn(),
  templateId: 'tpl-1',
};

describe('ExtractionHeader (post legacy-cascade)', () => {
  it('renders the More menu without an Export Data item', async () => {
    render(<MemoryRouter><ExtractionHeader {...base} /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /more/i }));
    expect(screen.queryByText(/Export Data/i)).not.toBeInTheDocument();
  });
});
