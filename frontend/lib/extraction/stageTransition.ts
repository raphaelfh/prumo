import { t } from '@/lib/copy';
import type { ExtractionRunStage } from '@/types/ai-extraction';
import type { StageTransition } from '@/components/runs/header/RunHeaderContext';

export interface BuildTransitionArgs {
  stage: ExtractionRunStage | null;
  canResolveConflicts: boolean;
  isComplete: boolean;
  completed: number;
  total: number;
  /** Extract phase: advance to consensus AND open the next article. */
  onMarkReady: () => void | Promise<void>;
  onFinalize: () => void | Promise<void>;
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
  const { stage, canResolveConflicts, isComplete, completed, total, onMarkReady, onFinalize, onGuide } = args;

  // Extract phase: proposal + review collapse into one user step. Available to
  // EVERY extractor — POST /runs/{id}/advance is membership-gated, not role-gated.
  if (stage === 'proposal' || stage === 'review') {
    return makeTransition(
      'consensus',
      t('extraction', 'runHeaderMarkReady'),
      t('extraction', 'runHeaderMarkReadyTooltip'),
      isComplete,
      completed,
      total,
      onMarkReady,
      onGuide,
    );
  }

  // Consensus → Finalize, manager/consensus only.
  if (stage === 'consensus' && canResolveConflicts) {
    return makeTransition(
      'finalized',
      t('extraction', 'runHeaderFinalize'),
      t('extraction', 'runHeaderFinalizeTooltip'),
      isComplete,
      completed,
      total,
      onFinalize,
      onGuide,
    );
  }

  // consensus-without-permission, finalized, pending, cancelled, null → none.
  return null;
}
