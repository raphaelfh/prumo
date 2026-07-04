/**
 * Consensus resolution panel — the consensus-stage surface for BOTH the
 * extraction and QA screens. A thin container that derives the resolution
 * state (`deriveConsensusResolution`) from the run aggregate and renders the
 * shared compare table in resolve mode, plus an optional finalize bar (QA owns
 * it; extraction's header owns "Approve & finalize").
 *
 * Replaces the former card-based ConsensusPanel. Presentational-by-composition:
 * the only IO is the caller's mutation callbacks.
 */
import { Button } from '@/components/ui/button';
import {
  RunReviewerComparison,
  type ComparisonEntityType,
  type ComparisonInstance,
} from '@/components/runs/RunReviewerComparison';
import { deriveConsensusResolution } from '@/lib/runs/reconciliation';
import { t } from '@/lib/copy';

import type { RunDetailResponse } from '@/hooks/runs/types';
import type { ReviewerSummary } from '@/hooks/runs/useReviewerSummary';

export interface ConsensusResolutionPanelProps {
  runDetail: RunDetailResponse;
  summary: ReviewerSummary;
  entityTypes: ComparisonEntityType[];
  instances: ComparisonInstance[];
  /** Form values keyed `${instanceId}_${fieldId}` — the read-only fallback's "You" column. */
  ownValues: Record<string, unknown>;
  reviewerLabelById: Record<string, string>;
  reviewerAvatarById: Record<string, string | null | undefined>;
  /** Every required template coordKey (`${instance}::${field}`) — drives required gaps + finalize gate. */
  requiredCoords: string[];
  isResolving: boolean;
  isFinalizing: boolean;
  peersRevealed: boolean;
  /** Whether this caller may resolve (arbitrator for extraction; reviewer for QA). */
  canResolve: boolean;
  onSelectExisting: (p: {
    instanceId: string;
    fieldId: string;
    decisionId: string;
  }) => Promise<void> | void;
  onManualOverride: (p: {
    instanceId: string;
    fieldId: string;
    value: unknown;
    rationale: string;
  }) => Promise<void> | void;
  onFinalize: () => Promise<void> | void;
  /** Render the in-panel finalize bar (QA=true; extraction header owns it, false). */
  showFinalize?: boolean;
}

export function ConsensusResolutionPanel({
  runDetail,
  summary,
  entityTypes,
  instances,
  ownValues,
  reviewerLabelById,
  reviewerAvatarById,
  requiredCoords,
  isResolving,
  isFinalizing,
  peersRevealed,
  canResolve,
  onSelectExisting,
  onManualOverride,
  onFinalize,
  showFinalize = false,
}: ConsensusResolutionPanelProps) {
  const view = deriveConsensusResolution({
    consensusDecisions: runDetail.consensus_decisions,
    publishedCoords: new Set(
      runDetail.published_states.map((p) => `${p.instance_id}::${p.field_id}`),
    ),
    divergentCoords: summary.divergentCoords,
    decisionCountByCoord: new Map(
      [...summary.decisionsByCoord].map(([k, v]) => [k, v.length]),
    ),
    participantCount: summary.reviewers.length,
    requiredCoords,
  });

  return (
    <div className="space-y-4 p-4" data-testid="consensus-panel">
      {showFinalize ? (
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{t('consensus', 'panelResolveTitle')}</h2>
          <Button
            size="sm"
            onClick={() => void onFinalize()}
            disabled={!view.canFinalize || isFinalizing}
            data-testid="consensus-finalize-button"
          >
            {isFinalizing ? t('consensus', 'panelFinalizing') : t('consensus', 'panelFinalize')}
          </Button>
        </div>
      ) : null}

      <RunReviewerComparison
        decisionsByCoord={summary.decisionsByCoord}
        entityTypes={entityTypes}
        instances={instances}
        ownValues={ownValues}
        reviewerLabelById={reviewerLabelById}
        reviewerAvatarById={reviewerAvatarById}
        resolution={
          canResolve
            ? {
                statusByCoord: view.statusByCoord,
                resolvedByCoord: view.resolvedByCoord,
                needsAttentionCount: view.needsAttentionCount,
                resolvedCount: view.resolvedCount,
                disabled: isResolving,
                peersRevealed,
                onSelectExisting,
                onManualOverride,
              }
            : undefined
        }
      />
    </div>
  );
}
