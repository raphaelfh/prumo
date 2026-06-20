import { t } from '@/lib/copy';
import type { ExtractionRunStage } from '@/types/ai-extraction';
import type { StageTransition } from '@/components/runs/header/RunHeaderContext';

export interface BuildTransitionArgs {
  stage: ExtractionRunStage | null;
  canResolveConflicts: boolean;
  isComplete: boolean;
  completed: number;
  total: number;
  onSubmit: () => void | Promise<void>;
  onReconcile: () => void | Promise<void>;
  onFinalize: () => void | Promise<void>;
  onGuide: () => void;
}

function makeTransition(
  to: ExtractionRunStage,
  label: string,
  isComplete: boolean,
  completed: number,
  total: number,
  advance: () => void | Promise<void>,
  onGuide: () => void,
): StageTransition {
  if (isComplete) {
    return { to, label, gate: { ok: true }, onAdvance: advance };
  }
  return {
    to,
    label,
    gate: {
      ok: false,
      reason: t('extraction', 'runHeaderGateBlocked'),
      remaining: Math.max(0, total - completed),
    },
    onAdvance: onGuide,
  };
}

export function buildExtractionTransition(args: BuildTransitionArgs): StageTransition | null {
  const { stage, canResolveConflicts, isComplete, completed, total, onSubmit, onReconcile, onFinalize, onGuide } = args;

  if (stage === 'proposal') {
    return makeTransition(
      'review',
      t('extraction', 'runHeaderSubmitForReview'),
      isComplete,
      completed,
      total,
      onSubmit,
      onGuide,
    );
  }

  if (stage === 'review' && canResolveConflicts) {
    return makeTransition(
      'consensus',
      t('extraction', 'runHeaderReconcile'),
      isComplete,
      completed,
      total,
      onReconcile,
      onGuide,
    );
  }

  if (stage === 'consensus') {
    return makeTransition(
      'finalized',
      t('extraction', 'runHeaderFinalize'),
      isComplete,
      completed,
      total,
      onFinalize,
      onGuide,
    );
  }

  // review without permission, finalized, pending, cancelled, null → no primary action
  return null;
}
