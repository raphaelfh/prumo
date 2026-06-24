import { describe, expect, it } from "vitest";
import { computeFinalizeWarning } from "@/lib/runs/finalizeWarning";

describe("computeFinalizeWarning", () => {
  it("warns when fewer participants than expected", () => {
    const r = computeFinalizeWarning({ participantCount: 1, expectedReviewerCount: 2, singleFillerCount: 0 });
    expect(r.shouldWarn).toBe(true);
    expect(r.reasons).toEqual(["missing_reviewers"]);
  });
  it("warns when there are single-filler coords", () => {
    const r = computeFinalizeWarning({ participantCount: 2, expectedReviewerCount: 2, singleFillerCount: 3 });
    expect(r.shouldWarn).toBe(true);
    expect(r.reasons).toEqual(["single_filler"]);
  });
  it("warns for both, in stable order", () => {
    const r = computeFinalizeWarning({ participantCount: 1, expectedReviewerCount: 3, singleFillerCount: 2 });
    expect(r.reasons).toEqual(["missing_reviewers", "single_filler"]);
  });
  it("does not warn when complete and fully participated", () => {
    const r = computeFinalizeWarning({ participantCount: 2, expectedReviewerCount: 2, singleFillerCount: 0 });
    expect(r.shouldWarn).toBe(false);
    expect(r.reasons).toEqual([]);
  });
});
