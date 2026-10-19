import { t } from '@/lib/copy';
import type { ExtractionRunStage } from '@/types/ai-extraction';
import type { StageTransition } from '@/components/runs/header/RunHeaderContext';

/**
 * The one kind-specific term of the stage machine (ADR-0018: QA mirrors
 * extraction, so everything else is shared).
 *
 * - `extraction` gates on completeness: the reviewer's Mark-ready on their own
 *   form (`isComplete`), the arbitrator's finalize on run-level required-field
 *   completeness (`consensusComplete` — published ∪ every reviewer's decision,
 *   mirroring the backend IncompleteFinalizeError gate, ADR-0009). Distinct
 *   from `isComplete`: an arbitrator who resolved required fields by adopting
 *   peers has an incomplete personal form yet a complete run.
 * - `qa` has no completeness metric (signaling questions are optional), so
 *   Mark-ready is always open; finalize is refused only when nothing was
 *   recorded and nothing resolved (the backend EmptyFinalizeError), so the gate
 *   names the Reopen-assessment exit instead of letting the click 400.
 */
export type TransitionGate =
  | {
      kind: 'extraction';
      isComplete: boolean;
      completed: number;
      total: number;
      consensusComplete: boolean;
    }
  | { kind: 'qa'; nothingRecorded: boolean };

export interface BuildTransitionArgs {
  stage: ExtractionRunStage | null;
  canResolveConflicts: boolean;
  /** Every diverging coord carries a consensus decision. */
  divergencesResolved: boolean;
  /** The caller is in reviewers_ready (flips the Mark-ready label). */
  isReady: boolean;
  gate: TransitionGate;
  /** Extract, reviewer: flag this reviewer ready (advisory — no stage move). */
  onMarkReady: () => void | Promise<void>;
  /** Extract, arbitrator: advance extract → consensus. */
  onOpenConsensus: () => void | Promise<void>;
  /** Consensus, arbitrator: publish every agreed value then finalize (ADR-0015). */
  onApproveFinalize: () => void | Promise<void>;
  /**
   * Blocked-click affordance. The message is the gate's own reason, so the
   * toast never contradicts the tooltip shown on hover.
   */
  onGuide: (message?: string) => void;
}

function blocked(
  to: string,
  label: string,
  tooltip: string,
  reason: string,
  remaining: number,
  onAdvance: () => void,
): StageTransition {
  return { to, label, tooltip, gate: { ok: false, reason, remaining }, onAdvance };
}

/**
 * The StageTransition for the run header's PrimaryAction, for both kinds:
 * reviewers signal readiness during EXTRACT, an arbitrator opens CONSENSUS (a
 * real, visitable stage — never skipped), and finalize only happens from
 * inside consensus via approve-finalize. Returns null where the caller has no
 * primary action (consensus without arbitration rights, finalized, pending,
 * cancelled, no run).
 */
export function buildTransition(args: BuildTransitionArgs): StageTransition | null {
  const { stage, canResolveConflicts, divergencesResolved, isReady, gate } = args;
  const { onMarkReady, onOpenConsensus, onApproveFinalize, onGuide } = args;

  if (stage === 'extract') {
    if (canResolveConflicts) {
      // The N/M-ready hint guides timing; the arbitrator opens consensus at will.
      return {
        to: 'consensus',
        label: t('extraction', 'runHeaderStartConsensus'),
        tooltip: t('extraction', 'runHeaderStartConsensusTooltip'),
        gate: { ok: true },
        onAdvance: onOpenConsensus,
      };
    }
    // Reviewer: per-reviewer ready signal. `to` names the display node only —
    // onMarkReady never advances the run.
    if (gate.kind === 'qa') {
      return {
        to: 'consensus',
        label: isReady ? t('qa', 'runHeaderAssessmentFinished') : t('qa', 'runHeaderFinishAssessment'),
        tooltip: t('qa', 'runHeaderFinishAssessmentTooltip'),
        gate: { ok: true },
        onAdvance: onMarkReady,
      };
    }
    const label = isReady
      ? t('extraction', 'runHeaderExtractionFinished')
      : t('extraction', 'runHeaderFinishExtraction');
    const tooltip = t('extraction', 'runHeaderFinishExtractionTooltip');
    if (gate.isComplete) {
      return { to: 'consensus', label, tooltip, gate: { ok: true }, onAdvance: onMarkReady };
    }
    return blocked(
      'consensus',
      label,
      tooltip,
      t('extraction', 'runHeaderGateBlocked'),
      Math.max(0, gate.total - gate.completed),
      onGuide,
    );
  }

  if (stage === 'consensus' && canResolveConflicts) {
    const label = t('extraction', 'runHeaderApproveFinalize');
    const tooltip = t('extraction', 'runHeaderApproveFinalizeTooltip');
    const finalize = (reason: string, remaining: number): StageTransition =>
      blocked('finalized', label, tooltip, reason, remaining, () => onGuide(reason));

    if (gate.kind === 'qa') {
      if (gate.nothingRecorded) return finalize(t('qa', 'runHeaderApproveNothingRecorded'), 0);
      if (!divergencesResolved) return finalize(t('qa', 'runHeaderApproveBlocked'), 0);
    } else if (!(gate.consensusComplete && divergencesResolved)) {
      return finalize(
        t('extraction', 'runHeaderApproveBlocked'),
        Math.max(0, gate.total - gate.completed),
      );
    }
    return { to: 'finalized', label, tooltip, gate: { ok: true }, onAdvance: onApproveFinalize };
  }

  return null;
}
