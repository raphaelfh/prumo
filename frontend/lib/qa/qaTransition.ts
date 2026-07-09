import { t } from '@/lib/copy';
import type { ExtractionRunStage } from '@/types/ai-extraction';
import type { StageTransition } from '@/components/runs/header/RunHeaderContext';

export interface BuildQaTransitionArgs {
  stage: ExtractionRunStage | null;
  /** Whether the current user can resolve conflicts (canResolveConflicts from useComparisonPermissions). */
  canResolveConflicts: boolean;
  /** The caller already flagged themselves ready (run.reviewers_ready). */
  isReady: boolean;
  /** Every diverging coord carries a consensus decision (reviewerSummary-derived). */
  divergencesResolved: boolean;
  /** Extract, reviewer: flag this reviewer ready (advisory — no stage move). */
  onMarkReady: () => void | Promise<void>;
  /** Extract, manager/consensus: advance extract → consensus. */
  onOpenConsensus: () => void | Promise<void>;
  /** Consensus, manager/consensus: publish agreed values then finalize (one action). */
  onApproveFinalize: () => void | Promise<void>;
  /** Blocked-click affordance — toasts the gate's own reason. */
  onGuide: (message?: string) => void;
}

/**
 * Builds a StageTransition for the QA PrimaryAction slot — the same staged
 * machine as buildExtractionTransition (extraction-HITL parity): reviewers
 * signal readiness during EXTRACT, an arbitrator opens CONSENSUS (a real,
 * visitable stage — never skipped), and finalize only happens from inside
 * consensus via approve-finalize (which publishes every agreed value).
 *
 * Differences from extraction, both deliberate: QA has no required-field
 * completeness metric (signaling questions are all optional), so the
 * reviewer's Mark-ready gate is always ok; and the consensus gate has no
 * `consensusComplete` term (requiredCoords is empty for QA), leaving
 * divergence resolution as the only finalize precondition.
 */
export function buildQaTransition(args: BuildQaTransitionArgs): StageTransition | null {
  const {
    stage,
    canResolveConflicts,
    isReady,
    divergencesResolved,
    onMarkReady,
    onOpenConsensus,
    onApproveFinalize,
    onGuide,
  } = args;

  if (stage === 'extract') {
    // Manager / consensus: open consensus at will (the N/M-ready hint guides timing).
    if (canResolveConflicts) {
      return {
        to: 'consensus',
        label: t('extraction', 'runHeaderStartConsensus'),
        tooltip: t('extraction', 'runHeaderStartConsensusTooltip'),
        gate: { ok: true },
        onAdvance: onOpenConsensus,
      };
    }
    // Reviewer: per-reviewer ready signal — does NOT advance the run.
    return {
      to: 'consensus', // display target node only; onMarkReady does not advance
      label: isReady
        ? t('qa', 'runHeaderAssessmentFinished')
        : t('qa', 'runHeaderFinishAssessment'),
      tooltip: t('qa', 'runHeaderFinishAssessmentTooltip'),
      gate: { ok: true },
      onAdvance: onMarkReady,
    };
  }

  // Consensus → Approve & finalize (publish-agreed then advance), manager only.
  if (stage === 'consensus' && canResolveConflicts) {
    const label = t('extraction', 'runHeaderApproveFinalize');
    const tooltip = t('extraction', 'runHeaderApproveFinalizeTooltip');
    if (divergencesResolved) {
      return { to: 'finalized', label, tooltip, gate: { ok: true }, onAdvance: onApproveFinalize };
    }
    const reason = t('qa', 'runHeaderApproveBlocked');
    return {
      to: 'finalized',
      label,
      tooltip,
      gate: { ok: false, reason, remaining: 0 },
      onAdvance: () => onGuide(reason),
    };
  }

  // consensus-without-permission, finalized, pending, cancelled, null → none.
  return null;
}
