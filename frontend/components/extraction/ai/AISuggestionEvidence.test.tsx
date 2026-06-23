/**
 * Tests for AISuggestionEvidence (presentational component).
 *
 * Scenarios:
 *  (a) onLocate provided → a "Locate in document" button renders and calls it
 *  (b) no onLocate → no locate button (backward compatible; quote + page badge)
 *  (c) handleCopy — setCopied(true) only fires on clipboard success
 *
 * The component is purely presentational: no viewer-store access. (Tooltip
 * still needs TooltipProvider — a Radix requirement, not a viewer requirement.)
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

function Wrapper({children}: {children: ReactNode}) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

const evidence = {text: 'some evidence text', pageNumber: 3};

describe('AISuggestionEvidence', () => {
  describe('(a) onLocate provided', () => {
    it('renders a locate button', () => {
      render(<AISuggestionEvidence evidence={evidence} onLocate={vi.fn()} />, {
        wrapper: Wrapper,
      });
      expect(
        screen.getByRole('button', {name: 'evidenceLocate'}),
      ).toBeInTheDocument();
    });

    it('calls onLocate when the locate button is clicked', async () => {
      const user = userEvent.setup();
      const onLocate = vi.fn();
      render(<AISuggestionEvidence evidence={evidence} onLocate={onLocate} />, {
        wrapper: Wrapper,
      });
      await user.click(screen.getByRole('button', {name: 'evidenceLocate'}));
      expect(onLocate).toHaveBeenCalledOnce();
    });
  });

  describe('(b) no onLocate — backward compat', () => {
    it('renders the quote text', () => {
      render(<AISuggestionEvidence evidence={evidence} />, {wrapper: Wrapper});
      expect(screen.getByText(/some evidence text/)).toBeInTheDocument();
    });

    it('renders the page badge', () => {
      render(<AISuggestionEvidence evidence={evidence} />, {wrapper: Wrapper});
      expect(screen.getByText('pageLabel')).toBeInTheDocument();
    });

    it('does NOT render a locate button', () => {
      render(<AISuggestionEvidence evidence={evidence} />, {wrapper: Wrapper});
      expect(
        screen.queryByRole('button', {name: 'evidenceLocate'}),
      ).not.toBeInTheDocument();
    });

    it('renders without crashing when no locate (no viewer state needed)', () => {
      const {unmount} = render(<AISuggestionEvidence evidence={{text: 'safe'}} />, {
        wrapper: Wrapper,
      });
      expect(screen.getByText(/safe/)).toBeInTheDocument();
      unmount();
    });
  });

  describe('(c) handleCopy — only shows success on clipboard success', () => {
    it('sets copied=true when clipboard write succeeds', async () => {
      const spy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<AISuggestionEvidence evidence={evidence} />, {wrapper: Wrapper});
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
      render(<AISuggestionEvidence evidence={evidence} />, {wrapper: Wrapper});
      const copyBtn = screen.getByRole('button', {name: 'copySnippet'});

      await user.click(copyBtn);
      expect(screen.queryByRole('button', {name: 'copyCopied'})).not.toBeInTheDocument();
      expect(screen.getByRole('button', {name: 'copySnippet'})).toBeInTheDocument();
      spy.mockRestore();
    });
  });
});
