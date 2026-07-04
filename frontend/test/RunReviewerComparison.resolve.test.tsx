/**
 * RunReviewerComparison — resolve mode (consensus stage). Read-only mode stays
 * covered by its usage in the extract/assess screens; here we exercise the
 * resolution surface: filter chips, adopt, typed override, resolved summary,
 * provenance gating, and the disabled state.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import {
  RunReviewerComparison,
  type ComparisonResolution,
} from '@/components/runs/RunReviewerComparison';
import { deriveConsensusResolution } from '@/lib/runs/reconciliation';
import type { ReviewerDecisionResponse } from '@/hooks/runs/types';

const dec = (over: Partial<ReviewerDecisionResponse>): ReviewerDecisionResponse => ({
  id: over.id ?? 'dec-x',
  run_id: 'run-1',
  instance_id: over.instance_id ?? 'inst-1',
  field_id: over.field_id ?? 'field-1',
  reviewer_id: over.reviewer_id ?? 'user-a',
  decision: over.decision ?? 'edit',
  proposal_record_id: null,
  value: over.value ?? null,
  rationale: null,
  created_at: over.created_at ?? '2026-04-28T10:00:00Z',
});

const entityTypes = [
  {
    id: 'et1',
    label: 'Section',
    fields: [{ id: 'field-1', label: 'Outcome', field_type: 'text' }],
  },
];
const instances = [{ id: 'inst-1', entity_type_id: 'et1' }];

// A conflict on inst-1::field-1 (two distinct reviewer values).
const conflictDecisions = [
  dec({ id: 'dec-a', reviewer_id: 'user-a', value: { value: 'Yes' } }),
  dec({ id: 'dec-b', reviewer_id: 'user-b', value: { value: 'No' } }),
];
const decisionsByCoord = new Map<string, ReviewerDecisionResponse[]>([
  ['inst-1::field-1', conflictDecisions],
]);
const reviewerLabelById = { 'user-a': 'Alice', 'user-b': 'Bob' };
const reviewerAvatarById = { 'user-a': null, 'user-b': null };

function buildResolution(
  over: Partial<ComparisonResolution> & {
    consensusDecisions?: Parameters<typeof deriveConsensusResolution>[0]['consensusDecisions'];
  } = {},
): ComparisonResolution {
  const view = deriveConsensusResolution({
    consensusDecisions: over.consensusDecisions ?? [],
    publishedCoords: new Set(),
    divergentCoords: new Set(['inst-1::field-1']),
    decisionCountByCoord: new Map([['inst-1::field-1', 2]]),
    participantCount: 2,
    requiredCoords: [],
  });
  return {
    statusByCoord: view.statusByCoord,
    resolvedByCoord: view.resolvedByCoord,
    needsAttentionCount: view.needsAttentionCount,
    resolvedCount: view.resolvedCount,
    disabled: over.disabled ?? false,
    peersRevealed: over.peersRevealed ?? true,
    onSelectExisting: over.onSelectExisting ?? vi.fn(),
    onManualOverride: over.onManualOverride ?? vi.fn(),
  };
}

const renderResolve = (resolution: ComparisonResolution) =>
  render(
    <RunReviewerComparison
      decisionsByCoord={decisionsByCoord}
      entityTypes={entityTypes}
      instances={instances}
      ownValues={{}}
      reviewerLabelById={reviewerLabelById}
      reviewerAvatarById={reviewerAvatarById}
      resolution={resolution}
    />,
  );

describe('RunReviewerComparison — read-only mode (regression)', () => {
  it('renders the You column and no filter chips', () => {
    render(
      <RunReviewerComparison
        decisionsByCoord={decisionsByCoord}
        entityTypes={entityTypes}
        instances={instances}
        ownValues={{ 'inst-1_field-1': { value: 'Maybe' } }}
        reviewerLabelById={reviewerLabelById}
        reviewerAvatarById={reviewerAvatarById}
      />,
    );
    expect(screen.getByText('youLabel')).toBeInTheDocument();
    expect(screen.queryByTestId('consensus-filters')).not.toBeInTheDocument();
  });
});

describe('RunReviewerComparison — resolve mode', () => {
  it('hides You, shows the Consensus column and defaults to Needs attention', () => {
    renderResolve(buildResolution());
    expect(screen.queryByText('youLabel')).not.toBeInTheDocument();
    expect(screen.getByText('consensusColumnLabel')).toBeInTheDocument();
    expect(screen.getByTestId('consensus-filter-attention')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // The conflict row is visible under the default attention filter.
    expect(screen.getByTestId('consensus-coord-inst-1::field-1')).toBeInTheDocument();
  });

  it('adopt calls onSelectExisting with the chosen decision id', () => {
    const onSelectExisting = vi.fn();
    renderResolve(buildResolution({ onSelectExisting }));
    fireEvent.click(screen.getByTestId('consensus-accept-dec-a'));
    expect(onSelectExisting).toHaveBeenCalledWith({
      instanceId: 'inst-1',
      fieldId: 'field-1',
      decisionId: 'dec-a',
    });
  });

  it('override expands the typed editor and publishes value + rationale', () => {
    const onManualOverride = vi.fn();
    renderResolve(buildResolution({ onManualOverride }));
    fireEvent.click(screen.getByTestId('consensus-override-toggle-inst-1::field-1'));
    const editor = screen.getByTestId('consensus-override-inst-1::field-1');
    expect(editor).toBeInTheDocument();
    // First textbox = value editor, second = rationale.
    const textboxes = screen.getAllByRole('textbox');
    fireEvent.change(textboxes[0], { target: { value: 'Maybe' } });
    fireEvent.change(textboxes[1], { target: { value: 'tie-break' } });
    fireEvent.click(screen.getByTestId('consensus-override-submit-inst-1::field-1'));
    expect(onManualOverride).toHaveBeenCalledWith({
      instanceId: 'inst-1',
      fieldId: 'field-1',
      value: 'Maybe',
      rationale: 'tie-break',
    });
  });

  it('a resolved row shows the published value + reviewer provenance when peersRevealed', () => {
    renderResolve(
      buildResolution({
        peersRevealed: true,
        consensusDecisions: [
          {
            instance_id: 'inst-1',
            field_id: 'field-1',
            created_at: '2026-04-28T11:00:00Z',
            mode: 'select_existing',
            selected_decision_id: 'dec-a',
            value: { value: 'Yes' },
            rationale: null,
          },
        ],
      }),
    );
    // Switch to the resolved filter to see it.
    fireEvent.click(screen.getByTestId('consensus-filter-resolved'));
    const cell = screen.getByTestId('consensus-resolved-inst-1::field-1');
    expect(cell).toHaveTextContent('Yes');
    expect(cell).toHaveTextContent('resolvedFromReviewer');
  });

  it('resolved provenance falls back to custom when peers are not revealed', () => {
    renderResolve(
      buildResolution({
        peersRevealed: false,
        consensusDecisions: [
          {
            instance_id: 'inst-1',
            field_id: 'field-1',
            created_at: '2026-04-28T11:00:00Z',
            mode: 'select_existing',
            selected_decision_id: 'dec-a',
            value: { value: 'Yes' },
            rationale: null,
          },
        ],
      }),
    );
    fireEvent.click(screen.getByTestId('consensus-filter-resolved'));
    const cell = screen.getByTestId('consensus-resolved-inst-1::field-1');
    expect(cell).toHaveTextContent('resolvedCustom');
    expect(cell).not.toHaveTextContent('resolvedFromReviewer');
  });

  it('filter chips switch the row set; empty attention shows nothingToReconcile', () => {
    renderResolve(
      buildResolution({
        consensusDecisions: [
          {
            instance_id: 'inst-1',
            field_id: 'field-1',
            created_at: '2026-04-28T11:00:00Z',
            mode: 'manual_override',
            value: { value: 'Yes' },
            rationale: null,
          },
        ],
      }),
    );
    // The only coord is resolved ⇒ attention is empty.
    expect(screen.getByTestId('consensus-nothing')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('consensus-filter-resolved'));
    expect(screen.getByTestId('consensus-resolved-inst-1::field-1')).toBeInTheDocument();
  });

  it('an untouched optional field is neutral under All — never mislabeled Agreed', () => {
    // Add a second field with no decision and not required ⇒ no status entry.
    const entityTypesTwoFields = [
      {
        id: 'et1',
        label: 'Section',
        fields: [
          { id: 'field-1', label: 'Outcome', field_type: 'text' },
          { id: 'field-2', label: 'Optional note', field_type: 'text' },
        ],
      },
    ];
    render(
      <RunReviewerComparison
        decisionsByCoord={decisionsByCoord}
        entityTypes={entityTypesTwoFields}
        instances={instances}
        ownValues={{}}
        reviewerLabelById={reviewerLabelById}
        reviewerAvatarById={reviewerAvatarById}
        resolution={buildResolution()}
      />,
    );
    fireEvent.click(screen.getByTestId('consensus-filter-all'));
    const optionalRow = screen.getByTestId('consensus-coord-inst-1::field-2');
    // Neutral dash, not the "Agreed" status label, and no override affordance.
    expect(optionalRow).toHaveTextContent('—');
    expect(optionalRow).not.toHaveTextContent('statusAgreed');
    expect(
      screen.queryByTestId('consensus-override-toggle-inst-1::field-2'),
    ).not.toBeInTheDocument();
  });

  it('disabled=true disables adopt and override affordances', () => {
    renderResolve(buildResolution({ disabled: true }));
    expect(screen.getByTestId('consensus-accept-dec-a')).toBeDisabled();
    expect(
      screen.getByTestId('consensus-override-toggle-inst-1::field-1'),
    ).toBeDisabled();
  });
});
