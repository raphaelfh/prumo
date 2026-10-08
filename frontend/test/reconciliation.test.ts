import { describe, expect, it } from "vitest";
import { classifyReconciliation } from "@/lib/runs/reconciliation";

const params = (over: Partial<Parameters<typeof classifyReconciliation>[0]>) => ({
  divergentCoords: new Set<string>(),
  decisionCountByCoord: new Map<string, number>(),
  participantCount: 0,
  requiredCoords: [] as string[],
  publishedCoords: new Set<string>(),
  ...over,
});

describe("classifyReconciliation", () => {
  it("puts divergent coords in conflicts (precedence over everything)", () => {
    const r = classifyReconciliation(
      params({
        divergentCoords: new Set(["i_f1"]),
        decisionCountByCoord: new Map([["i_f1", 2]]),
        participantCount: 2,
        requiredCoords: ["i_f1"],
      }),
    );
    expect(r.conflicts).toEqual(["i_f1"]);
    expect(r.requiredGaps).toEqual([]);
    expect(r.singleFiller).toEqual([]);
    expect(r.agreements).toEqual([]);
  });

  it("flags an untouched, unpublished required coord as a required gap", () => {
    const r = classifyReconciliation(
      params({ requiredCoords: ["i_f2"], participantCount: 2 }),
    );
    expect(r.requiredGaps).toEqual(["i_f2"]);
  });

  it("does NOT flag a required coord that is already published", () => {
    const r = classifyReconciliation(
      params({ requiredCoords: ["i_f2"], publishedCoords: new Set(["i_f2"]) }),
    );
    expect(r.requiredGaps).toEqual([]);
  });

  it("flags single-filler: 2 participants but only 1 decision on the coord", () => {
    const r = classifyReconciliation(
      params({
        decisionCountByCoord: new Map([["i_f3", 1]]),
        participantCount: 2,
      }),
    );
    expect(r.singleFiller).toEqual(["i_f3"]);
    expect(r.agreements).toEqual([]);
  });

  it("treats a coord all participants filled (non-divergent) as agreement", () => {
    const r = classifyReconciliation(
      params({
        decisionCountByCoord: new Map([["i_f4", 2]]),
        participantCount: 2,
      }),
    );
    expect(r.agreements).toEqual(["i_f4"]);
    expect(r.singleFiller).toEqual([]);
  });

  it("solo reviewer (1 participant) is agreement, never single-filler", () => {
    const r = classifyReconciliation(
      params({
        decisionCountByCoord: new Map([["i_f5", 1]]),
        participantCount: 1,
      }),
    );
    expect(r.agreements).toEqual(["i_f5"]);
    expect(r.singleFiller).toEqual([]);
  });
});
