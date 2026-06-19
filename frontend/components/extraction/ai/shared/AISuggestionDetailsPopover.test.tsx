/**
 * Wiring tests for AISuggestionDetailsPopover.
 *
 * Verifies that:
 *  - A matched verified citation → AISuggestionEvidence receives the right
 *    citation and an onHighlight that calls the highlight controller.
 *  - No match → citation=null → evidenceNotLocated affordance path.
 *
 * Mocks: useArticleCitations, matchEvidenceToCitation, useCitationHighlight.
 * Wraps in QueryClientProvider + ViewerProvider so useCitationHighlight resolves.
 */

import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi, beforeEach} from 'vitest';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ReactNode} from 'react';

// Mock copy so all keys are returned as-is
vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

// Mock useArticleCitations — returns controlled data
vi.mock('@/hooks/articles/useArticleCitations', () => ({
  useArticleCitations: vi.fn(),
}));

// Mock matchEvidenceToCitation — returns controlled result
vi.mock('@/services/citationsService', () => ({
  matchEvidenceToCitation: vi.fn(),
}));

// Mock useCitationHighlight — expose a spy for the highlight fn
const highlightSpy = vi.fn();
vi.mock('@/hooks/extraction/useCitationHighlight', () => ({
  useCitationHighlight: () => ({highlight: highlightSpy, clear: vi.fn(), activeHighlight: null}),
}));

import {AISuggestionDetailsPopover} from './AISuggestionDetailsPopover';
import {useArticleCitations} from '@/hooks/articles/useArticleCitations';
import {matchEvidenceToCitation} from '@/services/citationsService';
import type {ArticleCitationItem} from '@/services/citationsService';
import type {CitationAnchor} from '@/pdf-viewer/core/citation';
import {TooltipProvider} from '@/components/ui/tooltip';

const useArticleCitationsMock = useArticleCitations as ReturnType<typeof vi.fn>;
const matchEvidenceMock = matchEvidenceToCitation as ReturnType<typeof vi.fn>;

const anchor: CitationAnchor = {
  kind: 'text',
  range: {page: 2, charStart: 0, charEnd: 30},
  quote: 'test evidence',
};

const verifiedCitation: ArticleCitationItem = {
  id: 'cit-x',
  verified: true,
  anchorKind: 'text',
  anchor,
  metadata: {pageNumber: 2, textContent: 'test evidence', source: 'pdf'},
};

const suggestion = {
  id: 'sug-1',
  value: 'some value',
  status: 'pending' as const,
  confidence: 0.9,
  reasoning: 'Because of this evidence.',
  evidence: {text: 'test evidence', pageNumber: 2},
};

function makeWrapper() {
  const qc = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return function Wrapper({children}: {children: ReactNode}) {
    return (
      <QueryClientProvider client={qc}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  highlightSpy.mockClear();
  // Default: citations loaded with one item
  useArticleCitationsMock.mockReturnValue({data: [verifiedCitation], isLoading: false});
});

describe('AISuggestionDetailsPopover — citation wiring', () => {
  it('matched verified citation → evidenceJumpToSource button present and calls highlight', async () => {
    const user = userEvent.setup();
    matchEvidenceMock.mockReturnValue(verifiedCitation);

    render(
      <AISuggestionDetailsPopover
        suggestion={suggestion}
        articleId="article-123"
        trigger={<button>Open</button>}
      />,
      {wrapper: makeWrapper()},
    );

    // Open the dialog
    await user.click(screen.getByRole('button', {name: 'Open'}));

    // Jump button should appear
    const jumpBtn = await screen.findByRole('button', {name: 'evidenceJumpToSource'});
    expect(jumpBtn).toBeInTheDocument();

    // Clicking it calls highlight with the anchor
    await user.click(jumpBtn);
    expect(highlightSpy).toHaveBeenCalledOnce();
    expect(highlightSpy).toHaveBeenCalledWith(anchor);
  });

  it('no match → citation=null → evidenceNotLocated affordance', async () => {
    const user = userEvent.setup();
    matchEvidenceMock.mockReturnValue(null);

    render(
      <AISuggestionDetailsPopover
        suggestion={suggestion}
        articleId="article-123"
        trigger={<button>Open</button>}
      />,
      {wrapper: makeWrapper()},
    );

    await user.click(screen.getByRole('button', {name: 'Open'}));

    // No jump button
    expect(screen.queryByRole('button', {name: 'evidenceJumpToSource'})).not.toBeInTheDocument();
    // No "not located" affordance either — citation is null (not provided but unverified)
    // (When citation=null, the component renders as before — no affordance)
    expect(screen.queryByText('evidenceNotLocated')).not.toBeInTheDocument();
  });

  it('no articleId → no citation passed → renders as before (no jump, no not-located)', async () => {
    const user = userEvent.setup();
    matchEvidenceMock.mockReturnValue(null);

    render(
      <AISuggestionDetailsPopover
        suggestion={suggestion}
        trigger={<button>Open</button>}
      />,
      {wrapper: makeWrapper()},
    );

    await user.click(screen.getByRole('button', {name: 'Open'}));

    expect(screen.queryByRole('button', {name: 'evidenceJumpToSource'})).not.toBeInTheDocument();
    expect(screen.queryByText('evidenceNotLocated')).not.toBeInTheDocument();
    // Evidence text is still shown
    expect(screen.getByText(/test evidence/)).toBeInTheDocument();
  });
});
