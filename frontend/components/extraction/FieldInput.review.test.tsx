/**
 * FieldInput now hosts the unified AISuggestionReviewPopover as its single AI
 * trigger (the old history + details popovers are gone). These specs pin the
 * wiring: the popover is handed the active proposal id as `selectedProposalId`,
 * its `onSelect(proposalId, value)` routes to the drilled `selectSuggestion`
 * bound to this field's coord, and `onClear` routes to `onRejectAI`.
 */

import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

// FieldInput wraps the AI trigger in a Tooltip; the real app provides a global
// TooltipProvider at the root.
const render = (ui: React.ReactElement) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>);

// Probe: surfaces the props FieldInput hands the review popover.
vi.mock('@/components/extraction/ai/AISuggestionReviewPopover', () => ({
  AISuggestionReviewPopover: (props: any) => (
    <div data-testid="review-popover" data-selected={props.selectedProposalId}>
      <button data-testid="do-select" onClick={() => props.onSelect('p2', 'v2')} />
      <button data-testid="do-clear" onClick={() => props.onClear?.()} />
    </div>
  ),
}));

vi.mock('@/components/extraction/ai/AISuggestionDisplay', () => ({
  AISuggestionDisplay: () => <div data-testid="ai-display" />,
}));
vi.mock('@/components/extraction/ai/AISuggestionBadge', () => ({
  AISuggestionBadge: () => null,
}));
vi.mock('@/hooks/extraction/useJustUpdatedValue', () => ({
  useJustUpdatedValue: () => false,
}));

import FieldInput from '@/components/extraction/FieldInput';

const FIELD = {
  id: 'field-1',
  name: 'source',
  label: 'Source of Data',
  field_type: 'text',
  is_required: true,
  entity_type_id: 'et-1',
} as any;

const ACCEPTED_SUGGESTION = {
  id: 'cur',
  status: 'accepted',
  value: 'Retrospective cohort',
  confidence: 0.95,
} as any;

function props(overrides: Record<string, unknown> = {}) {
  return {
    field: FIELD,
    instanceId: 'inst-1',
    value: 'Retrospective cohort',
    onChange: vi.fn(),
    projectId: 'p1',
    aiSuggestion: ACCEPTED_SUGGESTION,
    onAcceptAI: vi.fn(),
    onRejectAI: vi.fn(),
    getSuggestionsHistory: vi.fn(async () => []),
    isActionLoading: () => null,
    ...overrides,
  };
}

describe('FieldInput — unified review popover wiring', () => {
  it('hands the review popover the active proposal id', () => {
    render(<FieldInput {...props()} />);
    expect(screen.getByTestId('review-popover').getAttribute('data-selected')).toBe('cur');
  });

  it('routes onSelect to selectSuggestion bound to this coord', () => {
    const selectSuggestion = vi.fn();
    render(<FieldInput {...props({ selectSuggestion })} />);
    fireEvent.click(screen.getByTestId('do-select'));
    expect(selectSuggestion).toHaveBeenCalledWith('inst-1', 'field-1', 'p2', 'v2');
  });

  it('routes onClear to onRejectAI', () => {
    const onRejectAI = vi.fn();
    render(<FieldInput {...props({ onRejectAI })} />);
    fireEvent.click(screen.getByTestId('do-clear'));
    expect(onRejectAI).toHaveBeenCalled();
  });
});
