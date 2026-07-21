import { t } from '@/lib/copy';
import type { ExtractionRunStage } from '@/types/ai-extraction';
import type { StageTransition } from '@/components/runs/header/RunHeaderContext';

export interface BuildTransitionArgs {
  stage: ExtractionRunStage | null;
  canResolveConflicts: boolean;
  /** Caller-scoped form completeness — drives the EXTRACT-stage reviewer gate. */
  isComplete: boolean;
  completed: number;
  total: number;
  /**
   * Run-level required-field completeness (published ∪ every reviewer's
   * decision) — drives the CONSENSUS finalize gate. Distinct from `isComplete`:
   * an arbitrator who resolved required fields by adopting peers has an
   * incomplete personal form yet a complete run. Mirrors the backend gate.
   */
  consensusComplete: boolean;
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
  /**
   * Blocked-click affordance. The optional message lets each gate surface the
   * copy that matches its own tooltip (extract vs consensus), so the toast never
   * contradicts the reason shown on hover.
   */
  onGuide: (message?: string) => void;
}

function makeTransition(
  to: ExtractionRunStage,
  label: string,
  tooltip: string,
  isComplete: boolean,
  completed: number,
  total: number,
  advance: () => void | Promise<void>,
  onGuide: (message?: string) => void,
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
    consensusComplete,
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
        label: t('extraction', 'runHeaderStartConsensus'),
        tooltip: t('extraction', 'runHeaderStartConsensusTooltip'),
        gate: { ok: true },
        onAdvance: onOpenConsensus,
      };
    }
    // Reviewer: per-reviewer ready signal — does NOT advance the run; gated on the
    // reviewer's own completeness. The label reflects the current ready state.
    return makeTransition(
      'consensus', // display target node only; onMarkReady does not advance
      isReady ? t('extraction', 'runHeaderExtractionFinished') : t('extraction', 'runHeaderFinishExtraction'),
      t('extraction', 'runHeaderFinishExtractionTooltip'),
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
    // Run-level completeness (consensusComplete), NOT the caller-scoped
    // isComplete: the run is finalizable once every required coord is resolved
    // run-wide, even if this arbitrator's own form is sparse.
    if (consensusComplete && divergencesResolved) {
      return { to: 'finalized', label, tooltip, gate: { ok: true }, onAdvance: onApproveFinalize };
    }
    const reason = t('extraction', 'runHeaderApproveBlocked');
    return {
      to: 'finalized',
      label,
      tooltip,
      gate: {
        ok: false,
        reason,
        remaining: Math.max(0, total - completed),
      },
      // Toast the gate's own reason so it matches the tooltip (the shared
      // onGuide default copy is the extract-stage message).
      onAdvance: () => onGuide(reason),
    };
  }

  // consensus-without-permission, finalized, pending, cancelled, null → none.
  return null;
}
