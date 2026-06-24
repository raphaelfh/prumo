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
        divergentCoords: new Set(["i::f1"]),
        decisionCountByCoord: new Map([["i::f1", 2]]),
        participantCount: 2,
        requiredCoords: ["i::f1"],
      }),
    );
    expect(r.conflicts).toEqual(["i::f1"]);
    expect(r.requiredGaps).toEqual([]);
    expect(r.singleFiller).toEqual([]);
    expect(r.agreements).toEqual([]);
  });

  it("flags an untouched, unpublished required coord as a required gap", () => {
    const r = classifyReconciliation(
      params({ requiredCoords: ["i::f2"], participantCount: 2 }),
    );
    expect(r.requiredGaps).toEqual(["i::f2"]);
  });

  it("does NOT flag a required coord that is already published", () => {
    const r = classifyReconciliation(
      params({ requiredCoords: ["i::f2"], publishedCoords: new Set(["i::f2"]) }),
    );
    expect(r.requiredGaps).toEqual([]);
  });

  it("flags single-filler: 2 participants but only 1 decision on the coord", () => {
    const r = classifyReconciliation(
      params({
        decisionCountByCoord: new Map([["i::f3", 1]]),
        participantCount: 2,
      }),
    );
    expect(r.singleFiller).toEqual(["i::f3"]);
    expect(r.agreements).toEqual([]);
  });

  it("treats a coord all participants filled (non-divergent) as agreement", () => {
    const r = classifyReconciliation(
      params({
        decisionCountByCoord: new Map([["i::f4", 2]]),
        participantCount: 2,
      }),
    );
    expect(r.agreements).toEqual(["i::f4"]);
    expect(r.singleFiller).toEqual([]);
  });

  it("solo reviewer (1 participant) is agreement, never single-filler", () => {
    const r = classifyReconciliation(
      params({
        decisionCountByCoord: new Map([["i::f5", 1]]),
        participantCount: 1,
      }),
    );
    expect(r.agreements).toEqual(["i::f5"]);
    expect(r.singleFiller).toEqual([]);
  });
});
