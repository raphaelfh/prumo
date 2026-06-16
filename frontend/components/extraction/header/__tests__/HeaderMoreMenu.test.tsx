import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HeaderMoreMenu } from '@/components/extraction/header/HeaderMoreMenu';

vi.mock('@/hooks/extraction/useFullAIExtraction', () => ({
  useFullAIExtraction: () => ({ extractFullAI: vi.fn(), loading: false, progress: null }),
}));
vi.mock('@/hooks/extraction/ai/useRunAIExtraction', () => ({
  useRunAIExtraction: () => ({ extractForRun: vi.fn(), loading: false }),
}));
vi.mock('@/hooks/hitl/useHITLProjectTemplates', () => ({
  useHITLProjectTemplates: () => ({ globalTemplates: [], loading: false }),
}));

function renderMenu() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <HeaderMoreMenu projectId="proj-1" articleId="art-1" templateId="tpl-1" />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe('HeaderMoreMenu (post legacy-cascade)', () => {
  it('opens without an "Export Data" item', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: /more/i }));
    expect(screen.queryByText(/Export Data/i)).not.toBeInTheDocument();
    // Shortcuts + Help survive.
    expect(screen.getByText(/Keyboard Shortcuts/i)).toBeInTheDocument();
  });
});
