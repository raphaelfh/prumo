/**
 * Tests for AISuggestionEvidence (presentational component).
 *
 * Scenarios:
 *  (a) onLocate provided → a "Locate in document" button renders and calls it with the rank
 *  (b) no onLocate → no locate button (backward compatible; quote + page badge)
 *  (c) handleCopy — setCopied(true) only fires on clipboard success
 *  (d) multi-citation list → primary shown, "also cited (n)" toggle present
 *  (e) amber / green attribution badges render with correct copy key
 *  (f) legacy length-1 list with null attributionLabel → old single-block layout
 *  (g) empty list → renders nothing
 */

import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import type {ReactNode} from 'react';

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

import {AISuggestionEvidence} from './AISuggestionEvidence';
import {TooltipProvider} from '@/components/ui/tooltip';
import type {EvidenceCitation} from '@/types/ai-extraction';

function Wrapper({children}: {children: ReactNode}) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

const singleCitation: EvidenceCitation[] = [
  {text: 'some evidence text', pageNumber: 3, blockIds: [], attributionLabel: null, rank: 0},
];

const twoCitations: EvidenceCitation[] = [
  {text: 'primary evidence', pageNumber: 2, blockIds: [1], attributionLabel: 'entailed', rank: 0},
  {text: 'secondary evidence', pageNumber: 5, blockIds: [10], attributionLabel: 'weak', rank: 1},
];

describe('AISuggestionEvidence', () => {
  describe('(a) onLocate provided', () => {
    it('renders a locate button', () => {
      render(<AISuggestionEvidence evidence={singleCitation} onLocate={vi.fn()} />, {
        wrapper: Wrapper,
      });
      expect(
        screen.getByRole('button', {name: 'evidenceLocate'}),
      ).toBeInTheDocument();
    });

    it('calls onLocate with rank 0 when the locate button is clicked', async () => {
      const user = userEvent.setup();
      const onLocate = vi.fn();
      render(<AISuggestionEvidence evidence={singleCitation} onLocate={onLocate} />, {
        wrapper: Wrapper,
      });
      await user.click(screen.getByRole('button', {name: 'evidenceLocate'}));
      expect(onLocate).toHaveBeenCalledOnce();
      expect(onLocate).toHaveBeenCalledWith(0);
    });
  });

  describe('(b) no onLocate — backward compat', () => {
    it('renders the quote text', () => {
      render(<AISuggestionEvidence evidence={singleCitation} />, {wrapper: Wrapper});
      expect(screen.getByText(/some evidence text/)).toBeInTheDocument();
    });

    it('renders the page badge', () => {
      render(<AISuggestionEvidence evidence={singleCitation} />, {wrapper: Wrapper});
      expect(screen.getByText('pageLabel')).toBeInTheDocument();
    });

    it('does NOT render a locate button', () => {
      render(<AISuggestionEvidence evidence={singleCitation} />, {wrapper: Wrapper});
      expect(
        screen.queryByRole('button', {name: 'evidenceLocate'}),
      ).not.toBeInTheDocument();
    });

    it('renders without crashing when no locate (no viewer state needed)', () => {
      const {unmount} = render(
        <AISuggestionEvidence
          evidence={[{text: 'safe', pageNumber: null, blockIds: [], attributionLabel: null, rank: 0}]}
        />,
        {wrapper: Wrapper},
      );
      expect(screen.getByText(/safe/)).toBeInTheDocument();
      unmount();
    });
  });

  describe('(c) handleCopy — only shows success on clipboard success', () => {
    it('sets copied=true when clipboard write succeeds', async () => {
      const spy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<AISuggestionEvidence evidence={singleCitation} />, {wrapper: Wrapper});
      const copyBtn = screen.getByRole('button', {name: 'copySnippet'});

      await user.click(copyBtn);
      expect(screen.getByRole('button', {name: 'copyCopied'})).toBeInTheDocument();
      spy.mockRestore();
    });

    it('does NOT set copied=true when clipboard write rejects', async () => {
      const spy = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
        new Error('permission denied'),
      );
      const user = userEvent.setup();
      render(<AISuggestionEvidence evidence={singleCitation} />, {wrapper: Wrapper});
      const copyBtn = screen.getByRole('button', {name: 'copySnippet'});

      await user.click(copyBtn);
      expect(screen.queryByRole('button', {name: 'copyCopied'})).not.toBeInTheDocument();
      expect(screen.getByRole('button', {name: 'copySnippet'})).toBeInTheDocument();
      spy.mockRestore();
    });
  });

  describe('(d) multi-citation list — primary + "also cited" toggle', () => {
    it('renders the primary quote immediately', () => {
      render(<AISuggestionEvidence evidence={twoCitations} />, {wrapper: Wrapper});
      expect(screen.getByText(/primary evidence/)).toBeInTheDocument();
    });

    it('renders the "evidenceAlsoCited" toggle button', () => {
      render(<AISuggestionEvidence evidence={twoCitations} />, {wrapper: Wrapper});
      expect(screen.getByText('evidenceAlsoCited')).toBeInTheDocument();
    });

    it('does NOT render the secondary quote before expansion', () => {
      render(<AISuggestionEvidence evidence={twoCitations} />, {wrapper: Wrapper});
      expect(screen.queryByText(/secondary evidence/)).not.toBeInTheDocument();
    });

    it('reveals secondary quote after clicking the toggle', async () => {
      const user = userEvent.setup();
      render(<AISuggestionEvidence evidence={twoCitations} />, {wrapper: Wrapper});
      await user.click(screen.getByText('evidenceAlsoCited'));
      expect(screen.getByText(/secondary evidence/)).toBeInTheDocument();
    });
  });

  describe('(e) attribution badges — green (entailed) vs amber (weak)', () => {
    it('shows green badge for entailed primary citation', () => {
      render(<AISuggestionEvidence evidence={twoCitations} />, {wrapper: Wrapper});
      // 'attributionEntailed' is the copy key for the green badge
      expect(screen.getByText('attributionEntailed')).toBeInTheDocument();
    });

    it('shows amber badge for weak secondary citation after expansion', async () => {
      const user = userEvent.setup();
      render(<AISuggestionEvidence evidence={twoCitations} />, {wrapper: Wrapper});
      await user.click(screen.getByText('evidenceAlsoCited'));
      expect(screen.getByText('attributionWeak')).toBeInTheDocument();
    });

    it('shows amber badge for unsupported citation', () => {
      const unsupportedCitation: EvidenceCitation[] = [
        {
          text: 'unsupported text',
          pageNumber: 1,
          blockIds: [],
          attributionLabel: 'unsupported',
          rank: 0,
        },
      ];
      render(<AISuggestionEvidence evidence={unsupportedCitation} />, {wrapper: Wrapper});
      expect(screen.getByText('attributionUnsupported')).toBeInTheDocument();
    });

    it('does NOT show any badge when attributionLabel is null', () => {
      render(<AISuggestionEvidence evidence={singleCitation} />, {wrapper: Wrapper});
      expect(screen.queryByText('attributionEntailed')).not.toBeInTheDocument();
      expect(screen.queryByText('attributionWeak')).not.toBeInTheDocument();
      expect(screen.queryByText('attributionUnsupported')).not.toBeInTheDocument();
    });
  });

  describe('(e2) attribution badge carries the clarifying explanation', () => {
    it('annotates "Not supported" so it reads as grading the quote, not the value', () => {
      const unsupportedCitation: EvidenceCitation[] = [
        {text: 'x', pageNumber: 1, blockIds: [], attributionLabel: 'unsupported', rank: 0},
      ];
      render(<AISuggestionEvidence evidence={unsupportedCitation} />, {wrapper: Wrapper});
      // The badge exposes the explanation (tooltip body) as its accessible name so
      // reviewers don't read "Not supported" next to a confident rationale as a contradiction.
      expect(screen.getByText('attributionUnsupported')).toHaveAttribute(
        'aria-label',
        'attributionTooltipUnsupported',
      );
    });

    it('annotates the "Verified" badge with its own explanation', () => {
      render(<AISuggestionEvidence evidence={twoCitations} />, {wrapper: Wrapper});
      expect(screen.getByText('attributionEntailed')).toHaveAttribute(
        'aria-label',
        'attributionTooltipEntailed',
      );
    });
  });

  describe('(f) legacy — length-1 list with null attributionLabel', () => {
    it('renders the single citation without any "also cited" toggle', () => {
      render(<AISuggestionEvidence evidence={singleCitation} />, {wrapper: Wrapper});
      expect(screen.getByText(/some evidence text/)).toBeInTheDocument();
      expect(screen.queryByText('evidenceAlsoCited')).not.toBeInTheDocument();
    });
  });

  describe('(g) empty evidence list', () => {
    it('renders nothing when evidence is an empty array', () => {
      const {container} = render(
        <AISuggestionEvidence evidence={[]} />,
        {wrapper: Wrapper},
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe('(h) active citation ring', () => {
    it('marks the cited passage active when activeRank matches its rank', () => {
      const {container} = render(
        <AISuggestionEvidence evidence={singleCitation} onLocate={vi.fn()} activeRank={0} />,
        {wrapper: Wrapper},
      );
      expect(container.querySelector('[data-active-citation="true"]')).not.toBeNull();
    });

    it('does not mark active when activeRank differs', () => {
      const {container} = render(
        <AISuggestionEvidence evidence={singleCitation} onLocate={vi.fn()} activeRank={5} />,
        {wrapper: Wrapper},
      );
      expect(container.querySelector('[data-active-citation="true"]')).toBeNull();
    });
  });
});
