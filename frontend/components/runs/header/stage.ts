import type { ExtractionRunStage } from '@/types/ai-extraction';

export type StageNodeState = 'done' | 'current' | 'future' | 'cancelled';
export type StageKey = 'proposal' | 'review' | 'consensus' | 'finalized';
export interface StageNode {
  key: StageKey;
  label: string;
  state: StageNodeState;
}

const ORDER: StageNode['key'][] = ['proposal', 'review', 'consensus', 'finalized'];
const LABEL: Record<StageNode['key'], string> = {
  proposal: 'Proposal',
  review: 'Review',
  consensus: 'Consensus',
  finalized: 'Finalized',
};

export function stageNodeStates(stage: ExtractionRunStage | null): StageNode[] {
  if (stage === 'cancelled') {
    return ORDER.map((key) => ({ key, label: LABEL[key], state: 'cancelled' as const }));
  }
  // pending / null behave as "at proposal, nothing done yet".
  const currentIndex = stage === 'pending' || stage == null ? 0 : ORDER.indexOf(stage);
  return ORDER.map((key, i) => ({
    key,
    label: LABEL[key],
    state: i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'future',
  }));
}
