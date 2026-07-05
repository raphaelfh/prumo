/**
 * ConsensusResolutionPanel — the thin container that wires the run aggregate
 * into the resolve-mode compare table + the optional finalize bar. The row-level
 * interactions live in RunReviewerComparison.resolve.test; here we cover the
 * container's own logic: the finalize gate and the canResolve fallback.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { ConsensusResolutionPanel } from '@/components/runs/ConsensusResolutionPanel';
import type {
  ReviewerDecisionResponse,
  RunDetailResponse,
} from '@/hooks/runs/types';
import type { ReviewerSummary } from '@/hooks/runs/useReviewerSummary';

const dec = (over: Partial<ReviewerDecisionResponse>): ReviewerDecisionResponse => ({
  id: over.id ?? 'dec-x',
  run_id: 'run-1',
  instance_id: over.instance_id ?? 'inst-1',
  field_id: over.field_id ?? 'field-1',
  reviewer_id: over.reviewer_id ?? 'user-a',
  decision: over.decision ?? 'edit',
  proposal_record_id: over.proposal_record_id ?? null,
  value: over.value ?? null,
  rationale: null,
  created_at: over.created_at ?? '2026-04-28T10:00:00Z',
});

const conflict = [
  dec({ id: 'dec-a', reviewer_id: 'user-a', value: { value: 'Yes' } }),
  dec({ id: 'dec-b', reviewer_id: 'user-b', value: { value: 'No' } }),
];

const summary: ReviewerSummary = {
  reviewers: ['user-a', 'user-b'],
  currentDecisions: new Map([['inst-1::field-1', conflict[1]]]),
  decisionsByCoord: new Map([['inst-1::field-1', conflict]]),
  divergentCoords: new Set(['inst-1::field-1']),
  requiredReviewerCount: 2,
  completionRatio: 1,
  filledCoords: new Set(['inst-1::field-1']),
  touchedCoords: new Set(['inst-1::field-1']),
};

const entityTypes = [
  {
    id: 'et1',
    label: 'Section',
    fields: [{ id: 'field-1', label: 'Outcome', field_type: 'text' }],
  },
];
const instances = [{ id: 'inst-1', entity_type_id: 'et1' }];

const makeRunDetail = (
  consensus_decisions: RunDetailResponse['consensus_decisions'] = [],
): RunDetailResponse => ({
  run: {
    id: 'run-1',
    project_id: 'p1',
    article_id: 'a1',
    template_id: 't1',
    kind: 'extraction',
    version_id: 'v1',
    stage: 'consensus',
    status: 'running',
    hitl_config_snapshot: { reviewer_count: 2 },
    parameters: {},
    results: {},
    created_at: '2026-04-28T09:00:00Z',
    created_by: 'user-a',
  },
  proposals: [],
  decisions: conflict,
  consensus_decisions,
  published_states: [],
});

const baseProps = {
  summary,
  entityTypes,
  instances,
  ownValues: {},
  reviewerLabelById: { 'user-a': 'Alice', 'user-b': 'Bob' },
  reviewerAvatarById: { 'user-a': null, 'user-b': null },
  requiredCoords: [] as string[],
  isResolving: false,
  isFinalizing: false,
  peersRevealed: true,
  onSelectExisting: vi.fn(),
  onManualOverride: vi.fn(),
  onFinalize: vi.fn(),
};

describe('ConsensusResolutionPanel', () => {
  it('finalize bar is disabled while a conflict is unresolved (showFinalize)', () => {
    render(
      <ConsensusResolutionPanel
        {...baseProps}
        runDetail={makeRunDetail([])}
        canResolve
        showFinalize
      />,
    );
    expect(screen.getByTestId('consensus-finalize-button')).toBeDisabled();
  });

  it('finalize enables once the conflict is resolved and fires onFinalize', () => {
    const onFinalize = vi.fn();
    render(
      <ConsensusResolutionPanel
        {...baseProps}
        onFinalize={onFinalize}
        runDetail={makeRunDetail([
          {
            id: 'cons-1',
            run_id: 'run-1',
            instance_id: 'inst-1',
            field_id: 'field-1',
            consensus_user_id: 'arb-1',
            mode: 'select_existing',
            selected_decision_id: 'dec-a',
            value: { value: 'Yes' },
            rationale: null,
            created_at: '2026-04-28T11:00:00Z',
          },
        ])}
        canResolve
        showFinalize
      />,
    );
    const btn = screen.getByTestId('consensus-finalize-button');
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onFinalize).toHaveBeenCalled();
  });

  it('canResolve=true renders the resolve filters and an adopt affordance', () => {
    const onSelectExisting = vi.fn();
    render(
      <ConsensusResolutionPanel
        {...baseProps}
        onSelectExisting={onSelectExisting}
        runDetail={makeRunDetail([])}
        canResolve
      />,
    );
    expect(screen.getByTestId('consensus-filters')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('consensus-accept-dec-a'));
    expect(onSelectExisting).toHaveBeenCalledWith({
      instanceId: 'inst-1',
      fieldId: 'field-1',
      decisionId: 'dec-a',
    });
  });

  it('canResolve=false falls back to the read-only compare (no filters, no finalize bar)', () => {
    render(
      <ConsensusResolutionPanel
        {...baseProps}
        runDetail={makeRunDetail([])}
        canResolve={false}
      />,
    );
    expect(screen.queryByTestId('consensus-filters')).not.toBeInTheDocument();
    expect(screen.queryByTestId('consensus-finalize-button')).not.toBeInTheDocument();
    // Read-only compare surface is present.
    expect(screen.getByText('youLabel')).toBeInTheDocument();
  });

  it('forwards the trace context into the resolve table (icon on linked cells)', () => {
    const linked = [
      dec({ id: 'dec-a', reviewer_id: 'user-a', proposal_record_id: 'p1', value: { value: 'Yes' } }),
      dec({ id: 'dec-b', reviewer_id: 'user-b', value: { value: 'No' } }),
    ];
    render(
      <ConsensusResolutionPanel
        {...baseProps}
        summary={{ ...summary, decisionsByCoord: new Map([['inst-1::field-1', linked]]) }}
        runDetail={makeRunDetail([])}
        canResolve
        trace={{ articleId: 'a1', getHistory: async () => [], aiSuggestions: {} }}
      />,
    );
    // user-a's linked cell gets the trace icon (aria-label = traceTitle key-echo).
    expect(screen.getByRole('button', { name: 'traceTitle' })).toBeInTheDocument();
  });
});
