import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ReviewerDecisionResponse } from '@/hooks/runs/types';
import { RunReviewerComparison } from '@/components/runs/RunReviewerComparison';

const entityTypes = [
  { id: 'e1', label: 'Source of Data', fields: [{ id: 'f1', label: 'Source' }] },
];
const instances = [
  { id: 'i1', entity_type_id: 'e1', parent_instance_id: null, label: 'Source of Data' },
];

function decision(over: Partial<ReviewerDecisionResponse>): ReviewerDecisionResponse {
  return {
    id: 'd',
    run_id: 'r',
    instance_id: 'i1',
    field_id: 'f1',
    reviewer_id: 'rA',
    decision: 'edit',
    proposal_record_id: null,
    value: { value: 'x' },
    rationale: null,
    created_at: '2026-06-19T00:00:00Z',
    ...over,
  };
}

describe('RunReviewerComparison', () => {
  it('renders one column per reviewer with their (divergent) values', () => {
    const decisionsByCoord = new Map([
      [
        'i1::f1',
        [
          decision({ reviewer_id: 'rA', value: { value: 'Retrospective cohort' } }),
          decision({ reviewer_id: 'rB', value: { value: 'Prospective cohort' } }),
        ],
      ],
    ]);
    render(
      <RunReviewerComparison
        decisionsByCoord={decisionsByCoord}
        entityTypes={entityTypes}
        instances={instances}
        ownValues={{ i1_f1: 'Retrospective cohort' }}
        reviewerLabelById={{ rA: 'Alice', rB: 'Bob' }}
        reviewerAvatarById={{}}
      />,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Prospective cohort')).toBeInTheDocument();
    expect(screen.getAllByText('Retrospective cohort').length).toBeGreaterThan(0);
  });

  it('renders a reject decision as a muted "rejected" cell', () => {
    const decisionsByCoord = new Map([
      ['i1::f1', [decision({ reviewer_id: 'rA', decision: 'reject', value: null })]],
    ]);
    render(
      <RunReviewerComparison
        decisionsByCoord={decisionsByCoord}
        entityTypes={entityTypes}
        instances={instances}
        ownValues={{}}
        reviewerLabelById={{ rA: 'Alice' }}
        reviewerAvatarById={{}}
      />,
    );
    expect(screen.getByText(/rejected/i)).toBeInTheDocument();
  });

  it('shows the empty state when there are no peers (blind)', () => {
    render(
      <RunReviewerComparison
        decisionsByCoord={new Map()}
        entityTypes={entityTypes}
        instances={instances}
        ownValues={{}}
        reviewerLabelById={{}}
        reviewerAvatarById={{}}
      />,
    );
    expect(screen.getByTestId('run-reviewer-comparison-empty')).toBeInTheDocument();
    expect(screen.getByText(/no other reviewers/i)).toBeInTheDocument();
  });
});
