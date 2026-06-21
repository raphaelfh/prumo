import { t } from '@/lib/copy';
import type { ExtractionRunStage } from '@/types/ai-extraction';
import type { StageTransition } from '@/components/runs/header/RunHeaderContext';

export interface BuildQaTransitionArgs {
  stage: ExtractionRunStage | null;
  /** Whether the current user can resolve conflicts (canResolveConflicts from useComparisonPermissions). */
  canResolveConflicts: boolean;
  /**
   * QA's primary publish handler — drives the full proposal→review→consensus→finalized
   * pipeline in one shot. Used for proposal + review stages.
   */
  onPublish: () => void | Promise<void>;
  /**
   * Finalize handler — used when the run is already in consensus stage.
   * Maps to handleFinalizeFromConsensus on the page.
   */
  onFinalize: () => void | Promise<void>;
}

/**
 * Builds a StageTransition for the QA PrimaryAction slot.
 *
 * QA's publish flow is opaque — the handler drives proposal→review→consensus→finalized
 * in one shot, so there is no per-stage completeness percentage to gate on.
 * The gate is always ok:true; the runtime handler (handlePublish) performs its own
 * preflight check and surfaces a toast if no fields are filled.
 *
 * Mirrors buildExtractionTransition's shape so PrimaryAction renders identically.
 */
export function buildQaTransition(args: BuildQaTransitionArgs): StageTransition | null {
  const { stage, canResolveConflicts, onPublish, onFinalize } = args;

  if (stage === 'extract') {
    // Primary action: publish the assessment (drives the full pipeline).
    return {
      to: 'finalized',
      label: t('runs', 'finalize'),
      gate: { ok: true },
      onAdvance: onPublish,
    };
  }

  if (stage === 'consensus') {
    if (canResolveConflicts) {
      // Manager/reconciler can finalize from consensus directly.
      return {
        to: 'finalized',
        label: t('runs', 'finalize'),
        gate: { ok: true },
        onAdvance: onFinalize,
      };
    }
    // Reviewer in consensus: no primary action (manager must finalize).
    return null;
  }

  // finalized, pending, cancelled, null → no primary action.
  return null;
}
