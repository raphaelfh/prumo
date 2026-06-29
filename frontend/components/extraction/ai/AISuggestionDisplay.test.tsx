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
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { AISuggestionDisplay } from './AISuggestionDisplay';
import type { AISuggestion } from '@/types/ai-extraction';

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
