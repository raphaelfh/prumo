/**
 * Manager reveal threading through the run header (RunStatus popover).
 *
 * Strategy: test at ExtractionHeader level, passing canReveal/onReveal explicitly,
 * asserting the click flow (chip → popover → Reveal) calls onReveal. Separately
 * unit-tests the page's onReveal handler logic (service + refresh wiring).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Mock copy so t() returns the key (avoids needing the full copy registry).
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

// The header now mounts NotificationCenter (via Utility), whose service import
// graph reaches the supabase client — which throws at module load in the
// env-less Frontend Tests CI job. Stub the client; rendering makes no supabase
// calls here.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) } },
}));

// ---- Test 1: ExtractionHeader threads canReveal/onReveal to the popover ----

import { ExtractionHeader } from '@/components/extraction/ExtractionHeader';

const baseHeaderProps = {
  articleTitle: 'Test Article',
  stage: 'extract' as const,
  onBack: vi.fn(),
  articles: [{ id: 'art-1', title: 'Test Article' }],
  currentArticleId: 'art-1',
  onNavigateToArticle: vi.fn(),
  completedFields: 0,
  totalFields: 10,
  completionPercentage: 0,
  showPDF: false,
  onTogglePDF: vi.fn(),
  viewMode: 'extract' as const,
  onViewModeChange: vi.fn(),
  hasComparison: false,
  isComplete: false,
  onFinalize: vi.fn(),
};

describe('ExtractionHeader reveal threading (RunStatus popover)', () => {
  it('shows no Reveal action in the status popover when canReveal is false', async () => {
    render(
      <MemoryRouter>
        <ExtractionHeader
          {...baseHeaderProps}
          userRole="manager"
          isBlindMode={true}
          canReveal={false}
        />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByTestId('run-stage-current'));
    await screen.findByTestId('run-status-popover');
    expect(screen.queryByRole('button', { name: 'reveal' })).toBeNull();
  });

  it('opens the status popover and calls onReveal when manager clicks Reveal', async () => {
    const onReveal = vi.fn();
    render(
      <MemoryRouter>
        <ExtractionHeader
          {...baseHeaderProps}
          userRole="manager"
          isBlindMode={true}
          canReveal={true}
          onReveal={onReveal}
        />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByTestId('run-stage-current'));
    const revealButton = await screen.findByRole('button', { name: 'reveal' });
    await userEvent.click(revealButton);
    expect(onReveal).toHaveBeenCalledOnce();
  });
});

// ---- Test 2: page-level onReveal handler logic ----
// Tests the handler inline (extracted to a factory so we don't need full
// page render). Verifies setManagerReviewVisibility + refresh + toast wiring.

import { setManagerReviewVisibility } from '@/services/hitlConfigService';
import { toast } from 'sonner';

vi.mock('@/services/hitlConfigService', () => ({
  setManagerReviewVisibility: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Cast the mocked function to a vi.Mock so we can configure it
const mockSetVisibility = setManagerReviewVisibility as unknown as ReturnType<typeof vi.fn>;

/**
 * Recreate the page's onReveal closure (same logic as ExtractionFullScreen).
 * This avoids a full page render and tests the handler in isolation.
 */
function buildOnReveal(
  projectId: string,
  refresh: () => Promise<void>,
): () => void {
  return () => {
    void setManagerReviewVisibility(projectId, 'extraction', true)
      .then(() => refresh())
      .catch((e: unknown) =>
        toast.error(e instanceof Error ? e.message : String(e)),
      );
  };
}

describe('page-level onReveal handler', () => {
  const mockToastError = toast.error as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls setManagerReviewVisibility with (projectId, extraction, true) then refresh', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    mockSetVisibility.mockResolvedValue({ extraction: true, quality_assessment: false });

    const onReveal = buildOnReveal('proj-1', refresh);
    onReveal();

    // Allow promises to resolve
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(mockSetVisibility).toHaveBeenCalledWith('proj-1', 'extraction', true);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('shows toast.error when setManagerReviewVisibility rejects', async () => {
    const refresh = vi.fn();
    mockSetVisibility.mockRejectedValue(new Error('Network error'));

    const onReveal = buildOnReveal('proj-1', refresh);
    onReveal();

    await vi.waitFor(() => expect(mockToastError).toHaveBeenCalledOnce());
    expect(mockToastError).toHaveBeenCalledWith('Network error');
    expect(refresh).not.toHaveBeenCalled();
  });
});
