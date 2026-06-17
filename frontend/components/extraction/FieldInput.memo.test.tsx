/**
 * Regression test for the stuck AI-suggestion accept spinner.
 *
 * FieldInput is wrapped in `memo` with a custom comparator. The accept/reject
 * spinner is driven by `isActionLoading(instanceId, fieldId)` — derived state,
 * NOT a tracked prop. When an accept resolves, `clearLoading` flips that signal
 * true → false while every comparator-tracked prop (field.id, instanceId, value,
 * disabled, viewMode, aiSuggestion.id/status) stays identical. If the comparator
 * ignores the loading signal it returns "props equal", React skips the re-render,
 * and the field keeps a stale `loading=true` — the spinner spins forever.
 *
 * These specs pin the comparator: a loading transition with no other prop change
 * MUST re-render the field.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

// Probe: surfaces the `loading` prop FieldInput passes down.
vi.mock('@/components/extraction/ai/AISuggestionDisplay', () => ({
  AISuggestionDisplay: (props: any) => (
    <div data-testid="ai-display" data-loading={String(props.loading)} />
  ),
}));

// Thin out the rest of the AI / collaboration chrome so the field renders
// without extra context.
vi.mock('@/components/extraction/ai/AISuggestionBadge', () => ({
  AISuggestionBadge: () => null,
}));
vi.mock('@/components/extraction/ai/AISuggestionHistoryPopover', () => ({
  AISuggestionHistoryPopover: () => null,
}));
vi.mock('@/components/extraction/colaboracao/OtherExtractionsButton', () => ({
  OtherExtractionsButton: () => null,
}));
vi.mock('@/components/extraction/colaboracao/OtherExtractionsPopover', () => ({
  OtherExtractionsPopover: () => null,
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

const PENDING_SUGGESTION = {
  id: 'sugg-1',
  status: 'pending',
  value: 'Retrospective cohort',
  confidence: 0.95,
} as any;

function baseProps(isActionLoading: () => 'accept' | 'reject' | null) {
  return {
    field: FIELD,
    instanceId: 'inst-1',
    value: '', // empty → suggestion is shown, no manual value
    onChange: vi.fn(),
    projectId: 'p1',
    articleId: 'a1',
    aiSuggestion: PENDING_SUGGESTION,
    onAcceptAI: vi.fn(),
    onRejectAI: vi.fn(),
    isActionLoading,
  };
}

describe('FieldInput memo comparator — accept spinner', () => {
  it('renders loading=true while an accept is in flight', () => {
    render(<FieldInput {...baseProps(() => 'accept')} />);
    expect(screen.getByTestId('ai-display').getAttribute('data-loading')).toBe('true');
  });

  it('re-renders to loading=false when isActionLoading clears (no other prop change)', () => {
    // Same prop references throughout — only the resolved isActionLoading value
    // changes, exactly as it does when clearLoading runs after an accept.
    const { rerender } = render(<FieldInput {...baseProps(() => 'accept')} />);
    expect(screen.getByTestId('ai-display').getAttribute('data-loading')).toBe('true');

    rerender(<FieldInput {...baseProps(() => null)} />);

    // Before the comparator fix this stayed 'true' (memo skipped the re-render).
    expect(screen.getByTestId('ai-display').getAttribute('data-loading')).toBe('false');
  });
});
