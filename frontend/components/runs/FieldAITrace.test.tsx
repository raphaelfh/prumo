import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

// Only the field-level aria/title needs a real string; everything else echoes.
vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) =>
    key === 'fieldTraceAria' ? 'AI suggestions for this field' : key,
}));

import { FieldAITrace } from './FieldAITrace';
import { RunEditabilityProvider } from '@/components/runs/RunEditabilityContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { AISuggestionHistoryItem } from '@/types/ai-extraction';

const field = { id: 'f1', field_type: 'text' };
const version = (over: Partial<AISuggestionHistoryItem>): AISuggestionHistoryItem => ({
  id: 'p1',
  runId: 'run-A',
  value: 'Retrospective cohort',
  confidence: 0.9,
  reasoning: '',
  status: 'pending',
  timestamp: new Date('2026-07-09T10:00:00Z'),
  evidence: [],
  ...over,
});

// jsdom-safe: RunEditabilityProvider + TooltipProvider only. NO ViewerProvider
// (would arm useReaderLocate/pdf) and the test never clicks into the details
// dialog (which lazy-loads the apiClient/Supabase chain).
const renderTrace = (ui: React.ReactElement) =>
  render(
    <TooltipProvider>
      <RunEditabilityProvider stage="consensus" showPeerIdentity>
        {ui}
      </RunEditabilityProvider>
    </TooltipProvider>,
  );

const baseProps = {
  instanceId: 'i1',
  fieldId: 'f1',
  field,
  articleId: 'a',
  getHistory: async () => [version({})],
  adoptionByProposalId: {},
};

describe('FieldAITrace', () => {
  it('renders the AI icon when the coord has a suggestion', () => {
    renderTrace(<FieldAITrace {...baseProps} hasAISuggestion />);
    expect(
      screen.getByRole('button', { name: 'AI suggestions for this field' }),
    ).toBeInTheDocument();
  });

  it('renders nothing when the coord has no AI suggestion', () => {
    const { container } = renderTrace(<FieldAITrace {...baseProps} hasAISuggestion={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the AI-existence signal is unavailable (null)', () => {
    const { container } = renderTrace(<FieldAITrace {...baseProps} hasAISuggestion={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the popover read-only, no "Use this version", no false "Selected" chip (D8)', async () => {
    const user = userEvent.setup();
    renderTrace(
      <FieldAITrace
        {...baseProps}
        getHistory={async () => [version({ id: 'p2' }), version({ id: 'p1' })]}
        hasAISuggestion
      />,
    );
    await user.click(screen.getByRole('button', { name: 'AI suggestions for this field' }));
    await screen.findAllByText('Retrospective cohort');
    expect(
      screen.queryByRole('button', { name: /reviewUseThisVersion/ }),
    ).not.toBeInTheDocument();
    // pinNewestWhenNoSelection={false} + no selection → nothing painted "Selected".
    expect(screen.queryByText('reviewSelected')).not.toBeInTheDocument();
  });
});
