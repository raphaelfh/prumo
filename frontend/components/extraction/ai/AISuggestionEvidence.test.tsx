/**
 * Tests for AISuggestionEvidence (presentational component).
 *
 * Three scenarios:
 *  (a) citation verified + anchor + onHighlight spy → clicking calls onHighlight
 *  (b) citation present but unverified / no anchor → "couldn't locate" affordance,
 *      no onHighlight call, no dead jump
 *  (c) no citation / no onHighlight → renders as before (quote + page badge),
 *      no crash, no click handler
 *  (d) handleCopy fix — setCopied(true) only fires on clipboard success
 *
 * The component is purely presentational: no hooks, safe outside ViewerProvider.
 * (Tooltip still needs TooltipProvider — that is a Radix requirement, not
 *  a viewer-store requirement; we wrap all renders with TooltipProvider.)
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
import type {ArticleCitationItem} from '@/services/citationsService';
import type {CitationAnchor} from '@/pdf-viewer/core/citation';

function Wrapper({children}: {children: ReactNode}) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

const anchor: CitationAnchor = {
  kind: 'text',
  range: {page: 3, charStart: 10, charEnd: 50},
  quote: 'some evidence text',
};

const verifiedCitation: ArticleCitationItem = {
  id: 'cit-1',
  verified: true,
  anchorKind: 'text',
  anchor,
  metadata: {pageNumber: 3, textContent: 'some evidence text', source: 'pdf'},
};

const unverifiedCitation: ArticleCitationItem = {
  id: 'cit-2',
  verified: false,
  anchorKind: null,
  anchor: null,
  metadata: {pageNumber: null, textContent: null, source: 'pdf'},
};

const evidence = {text: 'some evidence text', pageNumber: 3};

describe('AISuggestionEvidence', () => {
  describe('(a) verified citation + anchor + onHighlight', () => {
    it('renders a jump-to-source button', () => {
      const onHighlight = vi.fn();
      render(
        <AISuggestionEvidence
          evidence={evidence}
          citation={verifiedCitation}
          onHighlight={onHighlight}
        />,
        {wrapper: Wrapper},
      );
      expect(
        screen.getByRole('button', {name: 'evidenceJumpToSource'}),
      ).toBeInTheDocument();
    });

    it('calls onHighlight with the anchor when the jump button is clicked', async () => {
      const user = userEvent.setup();
      const onHighlight = vi.fn();
      render(
        <AISuggestionEvidence
          evidence={evidence}
          citation={verifiedCitation}
          onHighlight={onHighlight}
        />,
        {wrapper: Wrapper},
      );
      await user.click(screen.getByRole('button', {name: 'evidenceJumpToSource'}));
      expect(onHighlight).toHaveBeenCalledOnce();
      expect(onHighlight).toHaveBeenCalledWith(anchor);
    });

    it('does NOT show the evidenceNotLocated affordance', () => {
      const onHighlight = vi.fn();
      render(
        <AISuggestionEvidence
          evidence={evidence}
          citation={verifiedCitation}
          onHighlight={onHighlight}
        />,
        {wrapper: Wrapper},
      );
      expect(screen.queryByText('evidenceNotLocated')).not.toBeInTheDocument();
    });
  });

  describe('(b) citation present but unverified / no anchor', () => {
    it('renders the evidenceNotLocated affordance', () => {
      render(
        <AISuggestionEvidence
          evidence={evidence}
          citation={unverifiedCitation}
          onHighlight={vi.fn()}
        />,
        {wrapper: Wrapper},
      );
      expect(screen.getByText('evidenceNotLocated')).toBeInTheDocument();
    });

    it('does NOT render a jump-to-source button', () => {
      render(
        <AISuggestionEvidence
          evidence={evidence}
          citation={unverifiedCitation}
          onHighlight={vi.fn()}
        />,
        {wrapper: Wrapper},
      );
      expect(
        screen.queryByRole('button', {name: 'evidenceJumpToSource'}),
      ).not.toBeInTheDocument();
    });

    it('does NOT call onHighlight even if provided', () => {
      const onHighlight = vi.fn();
      render(
        <AISuggestionEvidence
          evidence={evidence}
          citation={unverifiedCitation}
          onHighlight={onHighlight}
        />,
        {wrapper: Wrapper},
      );
      // No jump button exists — onHighlight is never invoked on render
      expect(onHighlight).not.toHaveBeenCalled();
    });

    it('also shows "not located" when citation has no anchor (verified=true but anchor=null)', () => {
      const noAnchorCitation: ArticleCitationItem = {
        ...verifiedCitation,
        anchor: null,
        anchorKind: null,
      };
      render(
        <AISuggestionEvidence
          evidence={evidence}
          citation={noAnchorCitation}
          onHighlight={vi.fn()}
        />,
        {wrapper: Wrapper},
      );
      expect(screen.getByText('evidenceNotLocated')).toBeInTheDocument();
    });
  });

  describe('(c) no citation / no onHighlight — backward compat', () => {
    it('renders the quote text', () => {
      render(<AISuggestionEvidence evidence={evidence} />, {wrapper: Wrapper});
      expect(screen.getByText(/some evidence text/)).toBeInTheDocument();
    });

    it('renders the page badge', () => {
      render(<AISuggestionEvidence evidence={evidence} />, {wrapper: Wrapper});
      // t() mock returns key as-is; component replaces {{n}} → "pageLabel3" effectively
      // The component does: t('extraction', 'pageLabel').replace('{{n}}', '3')
      // Mock returns 'pageLabel', then .replace → 'pageLabel' (no {{n}} in key string itself)
      // Actually the key is 'pageLabel', mock returns 'pageLabel', replace is no-op → 'pageLabel'
      expect(screen.getByText('pageLabel')).toBeInTheDocument();
    });

    it('does NOT render a jump button', () => {
      render(<AISuggestionEvidence evidence={evidence} />, {wrapper: Wrapper});
      expect(
        screen.queryByRole('button', {name: 'evidenceJumpToSource'}),
      ).not.toBeInTheDocument();
    });

    it('does NOT render evidenceNotLocated', () => {
      render(<AISuggestionEvidence evidence={evidence} />, {wrapper: Wrapper});
      expect(screen.queryByText('evidenceNotLocated')).not.toBeInTheDocument();
    });

    it('renders without crashing when no citation/onHighlight (no viewer state needed)', () => {
      // Component must not access viewer store — purely presentational path
      const {unmount} = render(
        <AISuggestionEvidence evidence={{text: 'safe'}} />,
        {wrapper: Wrapper},
      );
      expect(screen.getByText(/safe/)).toBeInTheDocument();
      unmount();
    });
  });

  describe('(d) handleCopy — only shows success on clipboard success', () => {
    // jsdom provides navigator.clipboard but its writeText always rejects with
    // a DOMException ("not implemented"). We spy on it per-test instead of
    // trying to redefine the whole clipboard object, which is non-configurable
    // in some jsdom versions.

    it('sets copied=true when clipboard write succeeds', async () => {
      const spy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<AISuggestionEvidence evidence={evidence} />, {wrapper: Wrapper});
      const copyBtn = screen.getByRole('button', {name: 'copySnippet'});

      await user.click(copyBtn);
      // After success the button label should change to "copyCopied"
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
      // Button label must NOT switch to "copyCopied" on failure
      expect(screen.queryByRole('button', {name: 'copyCopied'})).not.toBeInTheDocument();
      expect(screen.getByRole('button', {name: 'copySnippet'})).toBeInTheDocument();
      spy.mockRestore();
    });
  });
});
