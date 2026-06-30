/**
 * AISuggestionDisplay — the inline glance below a field.
 *
 * Since the backend now records "no information" outcomes as first-class
 * proposals ({value: null} → unwrapped to ''), the inline strip must render a
 * QUIET "No information found" indicator for them — never the loud
 * "(empty) · 0%" + Accept/Reject that a real low-confidence suggestion gets
 * (spec R8). A real value keeps its value + actions.
 */

import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { AISuggestionDisplay } from './AISuggestionDisplay';
import type { AISuggestion, AISuggestionHistoryItem } from '@/types/ai-extraction';

// AISuggestionConfidence renders a Tooltip; the real app has a root provider.
const render = (ui: React.ReactElement) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>);

function makeSuggestion(over: Partial<AISuggestion>): AISuggestion {
  return {
    id: 'p1',
    runId: 'run-A',
    value: 'Retrospective cohort',
    confidence: 0.9,
    reasoning: '',
    status: 'pending',
    timestamp: new Date('2026-04-28T10:00:00Z'),
    ...over,
  };
}

describe('AISuggestionDisplay — no-information handling', () => {
  it('renders a quiet "No information found" for an empty (no-info) value, not "(empty) · 0%"', () => {
    render(<AISuggestionDisplay suggestion={makeSuggestion({ value: '', confidence: 0 })} />);
    expect(screen.getByText('reviewNoInformation')).toBeInTheDocument();
    expect(screen.queryByText('(empty)')).not.toBeInTheDocument();
    // No misleading 0% confidence badge on a no-info card.
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('treats a null value as no-info too', () => {
    render(<AISuggestionDisplay suggestion={makeSuggestion({ value: null, confidence: 0 })} />);
    expect(screen.getByText('reviewNoInformation')).toBeInTheDocument();
    expect(screen.queryByText('(empty)')).not.toBeInTheDocument();
  });

  it('renders a real value with its confidence (regression)', () => {
    render(<AISuggestionDisplay suggestion={makeSuggestion({ value: 'Retrospective cohort', confidence: 0.9 })} />);
    expect(screen.getByText('Retrospective cohort')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.queryByText('reviewNoInformation')).not.toBeInTheDocument();
  });
});

describe('AISuggestionDisplay — review popover entry point', () => {
  const historyItem = (over: Partial<AISuggestionHistoryItem>): AISuggestionHistoryItem => ({
    id: 'p1',
    runId: 'run-A',
    value: 'Retrospective cohort',
    confidence: 0.9,
    reasoning: '',
    status: 'pending',
    timestamp: new Date('2026-04-28T10:00:00Z'),
    evidence: [],
    ...over,
  });

  it('opens the review popover from the inline value when a review binding is supplied', async () => {
    const getHistory = vi.fn(async () => [historyItem({})]);
    const user = userEvent.setup();
    render(
      <AISuggestionDisplay
        suggestion={makeSuggestion({ value: 'Retrospective cohort', confidence: 0.9 })}
        review={{ instanceId: 'i', fieldId: 'f', getHistory, selectedProposalId: 'p1', onSelect: vi.fn() }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'reviewOpenFromValue' }));
    expect(getHistory).toHaveBeenCalledWith('i', 'f');
  });

  it('opens the review popover from the no-information indicator too', async () => {
    const getHistory = vi.fn(async () => [] as AISuggestionHistoryItem[]);
    const user = userEvent.setup();
    render(
      <AISuggestionDisplay
        suggestion={makeSuggestion({ value: null, confidence: 0 })}
        review={{ instanceId: 'i', fieldId: 'f', getHistory, onSelect: vi.fn() }}
      />,
    );
    expect(screen.getByText('reviewNoInformation')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'reviewOpenFromValue' }));
    expect(getHistory).toHaveBeenCalledWith('i', 'f');
  });

  it('renders no review trigger when no binding is supplied (backward compat)', () => {
    render(<AISuggestionDisplay suggestion={makeSuggestion({ value: 'X', confidence: 0.5 })} />);
    expect(screen.queryByRole('button', { name: 'reviewOpenFromValue' })).not.toBeInTheDocument();
  });
});

describe('AISuggestionDisplay — select option code → label', () => {
  const YES_NO = [
    { value: 'Y', label: 'Yes' },
    { value: 'N', label: 'No' },
  ];

  it('renders the human label for a coded select value', () => {
    render(
      <AISuggestionDisplay
        suggestion={makeSuggestion({ value: 'Y', confidence: 0.9 })}
        fieldType="select"
        allowedValues={YES_NO}
      />,
    );
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.queryByText('Y')).not.toBeInTheDocument();
  });

  it('falls back to the raw code when no field context is supplied', () => {
    render(<AISuggestionDisplay suggestion={makeSuggestion({ value: 'Y', confidence: 0.9 })} />);
    expect(screen.getByText('Y')).toBeInTheDocument();
  });
});
