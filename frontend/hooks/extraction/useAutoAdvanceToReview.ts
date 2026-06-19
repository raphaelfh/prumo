/**
 * Cross an extraction Run from PROPOSAL into REVIEW exactly once, the moment
 * it has content worth reviewing.
 *
 * Why this exists: the extraction form keeps the Run in PROPOSAL while the AI
 * seeds proposals and the proposer fills values. Everything that makes
 * multi-user extraction work — per-reviewer decisions, the reviewer counter,
 * "0% until you accept" — lives in REVIEW. If the Run never advances it stays
 * stuck in PROPOSAL and those surfaces misreport (phantom %, 0/N reviewers,
 * accept never sticks). This hook performs the advance so the page does not
 * have to thread it through every AI/edit handler.
 *
 * Triggers (the caller passes the combined signal as ``shouldAdvance``):
 *   - AI extraction seeded proposals on the Run, or
 *   - the reviewer made their first manual edit.
 *
 * Idempotent: never fires outside PROPOSAL, and fires ``onAdvance`` at most
 * once per PROPOSAL→REVIEW transition. A failed advance (e.g. a concurrent
 * reviewer won the transition) re-arms so the next trigger retries; leaving
 * PROPOSAL also re-arms so a later Run (article navigation, reopen) can advance
 * again.
 */

import { useEffect, useRef } from 'react';

export interface UseAutoAdvanceToReviewParams {
  /** Current run stage (``runDetail.run.stage``). */
  stage: string | null | undefined;
  /** True when the Run has proposals to review or the user has unsaved edits. */
  shouldAdvance: boolean;
  /** Gate: only attempt once the run + values have loaded. */
  enabled: boolean;
  /** Performs the PROPOSAL→REVIEW transition (flush + advance + refetch). */
  onAdvance: () => Promise<void>;
}

export function useAutoAdvanceToReview({
  stage,
  shouldAdvance,
  enabled,
  onAdvance,
}: UseAutoAdvanceToReviewParams): void {
  const firedRef = useRef(false);

  useEffect(() => {
    // Re-arm once the run has left PROPOSAL so a later PROPOSAL run can
    // advance again, and so a failed advance that flipped nothing is retried.
    if (stage !== 'proposal') {
      firedRef.current = false;
      return;
    }
    if (!enabled || !shouldAdvance || firedRef.current) return;
    firedRef.current = true;
    void onAdvance().catch(() => {
      // Advance rejected — re-arm so the next trigger retries.
      firedRef.current = false;
    });
  }, [stage, shouldAdvance, enabled, onAdvance]);
}
