/**
 * Soft-gate decision for "Approve & finalize" in the consensus stage. Never
 * blocks (the backend still hard-blocks unresolved conflicts + required gaps);
 * this only decides whether to show a confirm dialog and why.
 */
export type FinalizeWarningReason = "missing_reviewers" | "single_filler";

export interface FinalizeWarning {
  shouldWarn: boolean;
  reasons: FinalizeWarningReason[];
}

export function computeFinalizeWarning(p: {
  participantCount: number;
  expectedReviewerCount: number;
  singleFillerCount: number;
}): FinalizeWarning {
  const reasons: FinalizeWarningReason[] = [];
  if (p.participantCount < p.expectedReviewerCount) reasons.push("missing_reviewers");
  if (p.singleFillerCount > 0) reasons.push("single_filler");
  return { shouldWarn: reasons.length > 0, reasons };
}
