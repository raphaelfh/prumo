import type { ExtractionRunStage } from '@/types/ai-extraction';

export type StageNodeState = 'done' | 'current' | 'future' | 'cancelled';
export type StageKey = 'extract' | 'consensus' | 'finalized';
export interface StageNode {
  key: StageKey;
  state: StageNodeState;
}

const ORDER: StageNode['key'][] = ['extract', 'consensus', 'finalized'];

/**
 * Maps a DB stage to a user-facing 3-node index. `proposal` and `review` both
 * collapse into the single `extract` node — `review` is reviewing one's OWN AI
 * suggestions, not peer review, and is reached via an invisible auto-advance
 * (`useAutoAdvanceToReview`).
 */
function uiIndex(stage: ExtractionRunStage | null): number {
  switch (stage) {
    case 'consensus':
      return 1;
    case 'finalized':
      return 2;
    default:
      // pending / null / proposal / review → Extract
      return 0;
  }
}

export function stageNodeStates(stage: ExtractionRunStage | null): StageNode[] {
  if (stage === 'cancelled') {
    return ORDER.map((key) => ({ key, state: 'cancelled' as const }));
  }
  const currentIndex = uiIndex(stage);
  return ORDER.map((key, i) => ({
    key,
    state: i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'future',
  }));
}
