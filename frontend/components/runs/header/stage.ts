import type { ExtractionRunStage } from '@/types/ai-extraction';

export type StageNodeState = 'done' | 'current' | 'future' | 'cancelled';
export type StageKey = 'extract' | 'consensus' | 'finalized';
export interface StageNode {
  key: StageKey;
  state: StageNodeState;
}

const ORDER: StageNode['key'][] = ['extract', 'consensus', 'finalized'];

export type ChipState = 'pending' | 'extract' | 'consensus' | 'finalized' | 'cancelled';

/**
 * Stage-truthful chip state: pending/null is its OWN state (the run is not
 * editable yet — the read-only enforcement of spec 2026-07-02 renders it
 * inert), never disguised as an active Extract.
 */
export function chipState(stage: ExtractionRunStage | null): ChipState {
  switch (stage) {
    case 'extract':
    case 'consensus':
    case 'finalized':
    case 'cancelled':
      return stage;
    default:
      return 'pending';
  }
}

/**
 * Maps a DB stage to the user-facing 3-node timeline. `pending`/`null` yield
 * NO current node (all upcoming): the run has not entered an editable stage,
 * so announcing Extract as "current step" would invite edits the form drops.
 */
function uiIndex(stage: ExtractionRunStage | null): number | null {
  switch (stage) {
    case 'extract':
      return 0;
    case 'consensus':
      return 1;
    case 'finalized':
      return 2;
    default:
      return null;
  }
}

export function stageNodeStates(stage: ExtractionRunStage | null): StageNode[] {
  if (stage === 'cancelled') {
    return ORDER.map((key) => ({ key, state: 'cancelled' as const }));
  }
  const currentIndex = uiIndex(stage);
  return ORDER.map((key, i) => ({
    key,
    state:
      currentIndex == null
        ? 'future'
        : i < currentIndex
          ? 'done'
          : i === currentIndex
            ? 'current'
            : 'future',
  }));
}
