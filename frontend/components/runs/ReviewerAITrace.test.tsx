import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// Template-preserving echo for the trace title so the reviewer-name
// substitution (the trace's aria-label) is actually exercised.
vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) =>
    key === 'traceTitle' ? 'AI used by {{name}}' : key,
}));

import { ReviewerAITrace } from './ReviewerAITrace';
import { RunEditabilityProvider } from '@/components/runs/RunEditabilityContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ReviewerDecisionResponse } from '@/hooks/runs/types';

const base: ReviewerDecisionResponse = {
  id: 'd1',
  run_id: 'r',
  instance_id: 'i1',
  field_id: 'f1',
  reviewer_id: 'rA',
  decision: 'edit',
  proposal_record_id: 'p1',
  value: { value: 'x' },
  rationale: null,
  created_at: '2026-07-04T00:00:00Z',
};
const field = { id: 'f1', field_type: 'text' };
const noop = async () => [];

// Radix Tooltip requires a provider; the consensus table renders inside one
// in production (RunReviewerComparison wraps in TooltipProvider).
const renderTrace = (ui: React.ReactElement) =>
  render(
    <TooltipProvider>
      <RunEditabilityProvider stage="consensus" showPeerIdentity>
        {ui}
      </RunEditabilityProvider>
    </TooltipProvider>,
  );

describe('ReviewerAITrace', () => {
  it('renders the trace icon for a linked non-reject decision and opens the popover', async () => {
    const user = userEvent.setup();
    renderTrace(
      <ReviewerAITrace
        decision={base}
        field={field}
        articleId="a"
        getHistory={noop}
        reviewerLabel="Ana"
        adoptionByProposalId={{}}
        hasAISuggestion
      />,
    );
    const btn = screen.getByRole('button', { name: 'AI used by Ana' });
    await user.click(btn);
    // Popover opened read-only: empty history renders the no-versions state.
    expect(await screen.findByText('reviewNoVersions')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /reviewUseThisVersion/ }),
    ).not.toBeInTheDocument();
  });

  it('renders nothing for a reject decision — even a linked one', () => {
    const { container } = renderTrace(
      <ReviewerAITrace
        decision={{ ...base, decision: 'reject' }}
        field={field}
        articleId="a"
        getHistory={noop}
        reviewerLabel="Ana"
        adoptionByProposalId={{}}
        hasAISuggestion
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the Manual chip only when unlinked AND the coord has no AI suggestion', () => {
    renderTrace(
      <ReviewerAITrace
        decision={{ ...base, proposal_record_id: null }}
        field={field}
        articleId="a"
        getHistory={noop}
        reviewerLabel="Ana"
        adoptionByProposalId={{}}
        hasAISuggestion={false}
      />,
    );
    expect(screen.getByText('traceManualChip')).toBeInTheDocument();
  });

  it('renders nothing when unlinked but an AI suggestion exists (pre-D0 ambiguity)', () => {
    const { container } = renderTrace(
      <ReviewerAITrace
        decision={{ ...base, proposal_record_id: null }}
        field={field}
        articleId="a"
        getHistory={noop}
        reviewerLabel="Ana"
        adoptionByProposalId={{}}
        hasAISuggestion
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when unlinked and the AI-existence signal is unavailable (null)', () => {
    const { container } = renderTrace(
      <ReviewerAITrace
        decision={{ ...base, proposal_record_id: null }}
        field={field}
        articleId="a"
        getHistory={noop}
        reviewerLabel="Ana"
        adoptionByProposalId={{}}
        hasAISuggestion={null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
