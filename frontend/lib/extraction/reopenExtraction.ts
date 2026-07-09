import type { ExtractionRunStage } from '@/types/ai-extraction';

/**
 * Whether the caller may reopen this run from consensus back to extraction
 * (the destructive, arbitrator-only backward transition — ADR-0017).
 *
 * Gate: arbitrator (manager/consensus, i.e. `canResolveConflicts`) AND the run
 * is currently in the `consensus` stage. Extracted as a pure predicate so the
 * gate on a destructive action is unit-tested independently of the page — a
 * wrong gate (showing in `extract`, or to a plain reviewer) would otherwise slip
 * past every prop-level test.
 */
export function deriveCanReopenExtraction(
  canResolveConflicts: boolean,
  stage: ExtractionRunStage | null,
): boolean {
  return canResolveConflicts && stage === 'consensus';
}
