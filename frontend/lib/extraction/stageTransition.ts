import { t } from '@/lib/copy';
import type { ExtractionRunStage } from '@/types/ai-extraction';
import type { StageTransition } from '@/components/runs/header/RunHeaderContext';

export interface BuildTransitionArgs {
  stage: ExtractionRunStage | null;
  canResolveConflicts: boolean;
  isComplete: boolean;
  completed: number;
  total: number;
  /** Every diverging coord has a consensus decision (reviewerSummary-derived). */
  divergencesResolved: boolean;
  /** The caller is in reviewers_ready (reflects the Mark-ready button label). */
  isReady: boolean;
  /** Extract phase, reviewer: flag this reviewer ready (no stage move) + next article. */
  onMarkReady: () => void | Promise<void>;
  /** Extract phase, manager/consensus: advance extract → consensus. */
  onOpenConsensus: () => void | Promise<void>;
  /** Consensus, manager/consensus: publish-all then finalize (one action). */
  onApproveFinalize: () => void | Promise<void>;
  onGuide: () => void;
}

function makeTransition(
  to: ExtractionRunStage,
  label: string,
  tooltip: string,
  isComplete: boolean,
  completed: number,
  total: number,
  advance: () => void | Promise<void>,
  onGuide: () => void,
): StageTransition {
  if (isComplete) {
    return { to, label, tooltip, gate: { ok: true }, onAdvance: advance };
  }
  return {
    to,
    label,
    tooltip,
    gate: {
      ok: false,
      reason: t('extraction', 'runHeaderGateBlocked'),
      remaining: Math.max(0, total - completed),
    },
    onAdvance: onGuide,
  };
}

export function buildExtractionTransition(args: BuildTransitionArgs): StageTransition | null {
  const {
    stage,
    canResolveConflicts,
    isComplete,
    completed,
    total,
    divergencesResolved,
    isReady,
    onMarkReady,
    onOpenConsensus,
    onApproveFinalize,
    onGuide,
  } = args;

  // Extract phase: the single editable stage.
  if (stage === 'extract') {
    // Manager / consensus: open consensus at will (the N/M-ready hint guides timing).
    if (canResolveConflicts) {
      return {
        to: 'consensus',
        label: t('extraction', 'runHeaderOpenConsensus'),
        tooltip: t('extraction', 'runHeaderOpenConsensusTooltip'),
        gate: { ok: true },
        onAdvance: onOpenConsensus,
      };
    }
    // Reviewer: per-reviewer ready signal — does NOT advance the run; gated on the
    // reviewer's own completeness. The label reflects the current ready state.
    return makeTransition(
      'consensus', // display target node only; onMarkReady does not advance
      isReady ? t('extraction', 'runHeaderMarkedReady') : t('extraction', 'runHeaderMarkReady'),
      t('extraction', 'runHeaderMarkReadyTooltip'),
      isComplete,
      completed,
      total,
      onMarkReady,
      onGuide,
    );
  }

  // Consensus → Approve & finalize (publish-all then advance), manager/consensus only.
  // Spec §4.3: enabled only when every diverging field is resolved AND all required
  // fields are filled. A complete no-divergence run is enabled (divergencesResolved is
  // trivially true), so this is NOT the I2 dead-end; an incomplete run is correctly
  // disabled (reopen to fill required fields).
  if (stage === 'consensus' && canResolveConflicts) {
    const label = t('extraction', 'runHeaderApproveFinalize');
    const tooltip = t('extraction', 'runHeaderApproveFinalizeTooltip');
    if (isComplete && divergencesResolved) {
      return { to: 'finalized', label, tooltip, gate: { ok: true }, onAdvance: onApproveFinalize };
    }
    return {
      to: 'finalized',
      label,
      tooltip,
      gate: {
        ok: false,
        reason: t('extraction', 'runHeaderApproveBlocked'),
        remaining: Math.max(0, total - completed),
      },
      onAdvance: onGuide,
    };
  }

  // consensus-without-permission, finalized, pending, cancelled, null → none.
  return null;
}
