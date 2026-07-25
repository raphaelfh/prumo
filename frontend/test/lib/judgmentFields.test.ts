import { describe, expect, it } from "vitest";

import { isJudgmentField } from "@/lib/extraction/judgmentFields";

describe("isJudgmentField", () => {
  it("detects a Low/High/Unclear select", () => {
    expect(
      isJudgmentField({ field_type: "select", allowed_values: ["Low", "High", "Unclear"] }),
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isJudgmentField({ field_type: "select", allowed_values: ["low", "HIGH"] })).toBe(true);
  });

  it("accepts the wider ROB-2 / ROBINS-I vocabulary (parity with the export)", () => {
    expect(
      isJudgmentField({
        field_type: "select",
        allowed_values: ["Low", "Some concerns", "Serious", "Critical"],
      }),
    ).toBe(true);
  });

  it("rejects PROBAST signaling answers", () => {
    expect(isJudgmentField({ field_type: "select", allowed_values: ["Y", "PY", "PN", "N"] })).toBe(
      false,
    );
  });

  it("rejects QUADAS-2 signaling answers", () => {
    expect(isJudgmentField({ field_type: "select", allowed_values: ["Y", "N", "Unclear"] })).toBe(
      false,
    );
  });

  it("rejects non-select fields", () => {
    expect(isJudgmentField({ field_type: "text", allowed_values: ["Low"] })).toBe(false);
  });

  it("rejects empty or missing allowed_values", () => {
    expect(isJudgmentField({ field_type: "select", allowed_values: [] })).toBe(false);
    expect(isJudgmentField({ field_type: "select" })).toBe(false);
  });

  it("tolerates the {options:[...]} envelope shape", () => {
    expect(
      isJudgmentField({
        field_type: "select",
        allowed_values: { options: ["Low", "High", "Unclear"] },
      }),
    ).toBe(true);
  });
});
