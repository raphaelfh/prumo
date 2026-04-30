import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useReviewerSummary } from "@/hooks/runs/useReviewerSummary";
import type {
  ReviewerDecisionResponse,
  RunDetailResponse,
} from "@/hooks/runs/types";

function decision(
  partial: Partial<ReviewerDecisionResponse>,
): ReviewerDecisionResponse {
  return {
    id: partial.id ?? "dec-x",
    run_id: "run-1",
    instance_id: partial.instance_id ?? "inst-1",
    field_id: partial.field_id ?? "field-1",
    reviewer_id: partial.reviewer_id ?? "user-a",
    decision: partial.decision ?? "edit",
    proposal_record_id: null,
    value: partial.value ?? null,
    rationale: null,
    created_at: partial.created_at ?? "2026-04-28T10:00:00Z",
  };
}

function runDetail(
  overrides: Partial<RunDetailResponse> & {
    decisions: ReviewerDecisionResponse[];
    reviewer_count?: number;
  },
): RunDetailResponse {
  return {
    run: {
      id: "run-1",
      project_id: "p1",
      article_id: "a1",
      template_id: "t1",
      kind: "extraction",
      version_id: "v1",
      stage: "review",
      status: "running",
      hitl_config_snapshot: { reviewer_count: overrides.reviewer_count ?? 1 },
      parameters: {},
      results: {},
      created_at: "2026-04-28T09:00:00Z",
      created_by: "user-a",
      ...(overrides.run ?? {}),
    },
    proposals: overrides.proposals ?? [],
    decisions: overrides.decisions,
    consensus_decisions: overrides.consensus_decisions ?? [],
    published_states: overrides.published_states ?? [],
  };
}

describe("useReviewerSummary", () => {
  it("returns the empty default for a null runDetail", () => {
    const { result } = renderHook(() => useReviewerSummary(null));
    expect(result.current.reviewers).toEqual([]);
    expect(result.current.requiredReviewerCount).toBe(1);
    expect(result.current.completionRatio).toBe(0);
  });

  it("counts distinct reviewers regardless of how many decisions each made", () => {
    const { result } = renderHook(() =>
      useReviewerSummary(
        runDetail({
          reviewer_count: 3,
          decisions: [
            decision({
              reviewer_id: "user-a",
              instance_id: "i1",
              field_id: "f1",
              value: { value: "X" },
            }),
            decision({
              reviewer_id: "user-a",
              instance_id: "i1",
              field_id: "f2",
              value: { value: "Y" },
            }),
            decision({
              reviewer_id: "user-b",
              instance_id: "i1",
              field_id: "f1",
              value: { value: "X" },
            }),
          ],
        }),
      ),
    );
    expect(new Set(result.current.reviewers)).toEqual(
      new Set(["user-a", "user-b"]),
    );
    expect(result.current.requiredReviewerCount).toBe(3);
    expect(result.current.completionRatio).toBeCloseTo(2 / 3, 5);
  });

  it("treats append-only decision history as latest-wins per (reviewer, coord)", () => {
    const { result } = renderHook(() =>
      useReviewerSummary(
        runDetail({
          decisions: [
            decision({
              id: "older",
              reviewer_id: "user-a",
              instance_id: "i1",
              field_id: "f1",
              value: { value: "old" },
              created_at: "2026-04-28T09:00:00Z",
            }),
            decision({
              id: "newer",
              reviewer_id: "user-a",
              instance_id: "i1",
              field_id: "f1",
              value: { value: "new" },
              created_at: "2026-04-28T10:00:00Z",
            }),
          ],
        }),
      ),
    );
    const current = result.current.currentDecisions.get("i1::f1");
    expect(current?.id).toBe("newer");
  });

  it("flags coords as divergent when reviewers disagree on value", () => {
    const { result } = renderHook(() =>
      useReviewerSummary(
        runDetail({
          decisions: [
            decision({
              reviewer_id: "user-a",
              instance_id: "i1",
              field_id: "f1",
              value: { value: "Yes" },
            }),
            decision({
              reviewer_id: "user-b",
              instance_id: "i1",
              field_id: "f1",
              value: { value: "No" },
            }),
            // Same coord, both agree → not divergent.
            decision({
              reviewer_id: "user-a",
              instance_id: "i1",
              field_id: "f2",
              value: { value: "Yes" },
            }),
            decision({
              reviewer_id: "user-b",
              instance_id: "i1",
              field_id: "f2",
              value: { value: "Yes" },
            }),
          ],
        }),
      ),
    );
    expect(result.current.divergentCoords.has("i1::f1")).toBe(true);
    expect(result.current.divergentCoords.has("i1::f2")).toBe(false);
  });

  it("treats reject as not equal to a positive value but equal to another reject", () => {
    const { result } = renderHook(() =>
      useReviewerSummary(
        runDetail({
          decisions: [
            decision({
              reviewer_id: "user-a",
              instance_id: "i1",
              field_id: "f1",
              decision: "reject",
              value: null,
            }),
            decision({
              reviewer_id: "user-b",
              instance_id: "i1",
              field_id: "f1",
              decision: "edit",
              value: { value: "X" },
            }),
            decision({
              reviewer_id: "user-a",
              instance_id: "i1",
              field_id: "f2",
              decision: "reject",
              value: null,
            }),
            decision({
              reviewer_id: "user-b",
              instance_id: "i1",
              field_id: "f2",
              decision: "reject",
              value: null,
            }),
          ],
        }),
      ),
    );
    expect(result.current.divergentCoords.has("i1::f1")).toBe(true);
    expect(result.current.divergentCoords.has("i1::f2")).toBe(false);
  });

  it("includes reject coords in touched but not in filled", () => {
    const { result } = renderHook(() =>
      useReviewerSummary(
        runDetail({
          decisions: [
            decision({
              reviewer_id: "user-a",
              instance_id: "i1",
              field_id: "f1",
              decision: "reject",
              value: null,
            }),
            decision({
              reviewer_id: "user-a",
              instance_id: "i1",
              field_id: "f2",
              decision: "edit",
              value: { value: "X" },
            }),
          ],
        }),
      ),
    );
    expect(result.current.touchedCoords.has("i1::f1")).toBe(true);
    expect(result.current.filledCoords.has("i1::f1")).toBe(false);
    expect(result.current.touchedCoords.has("i1::f2")).toBe(true);
    expect(result.current.filledCoords.has("i1::f2")).toBe(true);
  });

  it("clamps completionRatio at 1 when more reviewers participated than required", () => {
    const { result } = renderHook(() =>
      useReviewerSummary(
        runDetail({
          reviewer_count: 1,
          decisions: [
            decision({ reviewer_id: "user-a" }),
            decision({ reviewer_id: "user-b" }),
            decision({ reviewer_id: "user-c" }),
          ],
        }),
      ),
    );
    expect(result.current.completionRatio).toBe(1);
  });
});
