import type { ExtractionRunStage } from '@/types/ai-extraction';

export type StageNodeState = 'done' | 'current' | 'future' | 'cancelled';
export type StageKey = 'proposal' | 'review' | 'consensus' | 'finalized';
export interface StageNode {
  key: StageKey;
  state: StageNodeState;
}

const ORDER: StageNode['key'][] = ['proposal', 'review', 'consensus', 'finalized'];

export function stageNodeStates(stage: ExtractionRunStage | null): StageNode[] {
  if (stage === 'cancelled') {
    return ORDER.map((key) => ({ key, state: 'cancelled' as const }));
  }
  // pending / null behave as "at proposal, nothing done yet".
  const currentIndex = stage === 'pending' || stage == null ? 0 : ORDER.indexOf(stage);
  return ORDER.map((key, i) => ({
    key,
    state: i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'future',
  }));
}
