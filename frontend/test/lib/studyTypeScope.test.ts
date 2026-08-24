import { describe, expect, it } from "vitest";

import { isDomainOutOfScope } from "@/lib/qa/studyTypeScope";

describe("isDomainOutOfScope", () => {
  it("development_only marks the evaluation part out of scope", () => {
    expect(isDomainOutOfScope("eval_d1_participants", "development_only")).toBe(true);
    expect(isDomainOutOfScope("dev_d1_participants", "development_only")).toBe(false);
    expect(isDomainOutOfScope("assessment_scope", "development_only")).toBe(false);
    expect(isDomainOutOfScope("overall_judgement", "development_only")).toBe(false);
  });

  it("evaluation_only marks the development part out of scope", () => {
    expect(isDomainOutOfScope("dev_d4_analysis", "evaluation_only")).toBe(true);
    expect(isDomainOutOfScope("eval_d4_judgment", "evaluation_only")).toBe(false);
  });

  it("combination, unknown, and unanswered never flag anything", () => {
    expect(isDomainOutOfScope("dev_d1_participants", "combination")).toBe(false);
    expect(isDomainOutOfScope("eval_d1_participants", null)).toBe(false);
    expect(isDomainOutOfScope("eval_d1_participants", undefined)).toBe(false);
    expect(isDomainOutOfScope("eval_d1_participants", { value: "x" })).toBe(false);
  });
});
