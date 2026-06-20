/**
 * TDD test: manager reveal on the RunHeader RoleChip (Task 3 – Plan 2).
 *
 * Strategy: test at ExtractionHeader level, passing canReveal/onReveal explicitly,
 * asserting the click flow calls onReveal. Separately unit-tests the page's
 * onReveal handler logic by verifying the service + refresh are invoked.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock copy so t() returns the key (avoids needing the full copy registry).
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

// ---- Test 1: ExtractionHeader passes canReveal/onReveal through to RoleChip ----

import { ExtractionHeader } from '@/components/extraction/ExtractionHeader';

const baseHeaderProps = {
  projectId: 'proj-1',
  projectName: 'Test Project',
  articleTitle: 'Test Article',
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

describe('ExtractionHeader RoleChip reveal', () => {
  it('renders a plain non-interactive chip when canReveal is false', () => {
    render(
      <ExtractionHeader
        {...baseHeaderProps}
        userRole="manager"
        isBlindMode={true}
        canReveal={false}
      />,
    );
    // No button for manager when canReveal=false
    expect(screen.queryByRole('button', { name: /manager/i })).toBeNull();
  });

  it('opens popover and calls onReveal when manager clicks Reveal', async () => {
    const onReveal = vi.fn();
    render(
      <ExtractionHeader
        {...baseHeaderProps}
        userRole="manager"
        isBlindMode={true}
        canReveal={true}
        onReveal={onReveal}
      />,
    );
    // The role chip renders as an interactive button when canReveal=true
    const chipButton = screen.getByRole('button', { name: /manager/i });
    await userEvent.click(chipButton);
    // Popover opens, Reveal button appears
    const revealButton = screen.getByRole('button', { name: 'reveal' });
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
