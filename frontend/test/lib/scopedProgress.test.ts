import { describe, expect, it } from "vitest";

import { scopedRowProgress } from "@/lib/qa/scopedProgress";
import type { ExtractionField } from "@/types/extraction";

const field = (id: string, name: string, required: boolean): ExtractionField =>
  ({ id, name, is_required: required }) as ExtractionField;

/**
 * A miniature PROBAST+AI: a scope classifier plus one development domain and
 * one evaluation domain, each owing a single required judgment.
 */
const SCHEMA = {
  scope_rules: {
    classifier: { section: "assessment_scope", field: "study_type" },
    excludes: { development_only: ["eval_d1"], evaluation_only: ["dev_d1"] },
  },
};

const ENTITY_TYPES = [
  {
    id: "et-scope",
    name: "assessment_scope",
    fields: [field("f-type", "study_type", true)],
  },
  { id: "et-dev", name: "dev_d1", fields: [field("f-dev", "quality_concern", true)] },
  { id: "et-eval", name: "eval_d1", fields: [field("f-eval", "risk_of_bias", true)] },
];

const INSTANCES = [
  { id: "i-scope", entity_type_id: "et-scope" },
  { id: "i-dev", entity_type_id: "et-dev" },
  { id: "i-eval", entity_type_id: "et-eval" },
];

const classifiedAs = (studyType: string) => ({
  instance_id: "i-scope",
  field_id: "f-type",
  value: { value: studyType },
});
const devJudged = { instance_id: "i-dev", field_id: "f-dev", value: { value: "Low" } };
const evalJudged = { instance_id: "i-eval", field_id: "f-eval", value: { value: "High" } };

describe("scopedRowProgress", () => {
  it("a COMPLETE development-only assessment reads 100%, not 2 of 3", () => {
    // The headline defect: every required field of the part the study does
    // not have stayed in the denominator, so a finished assessment was
    // indistinguishable from an abandoned one on the worklist forever.
    const values = [classifiedAs("development_only"), devJudged];
    expect(scopedRowProgress(SCHEMA, ENTITY_TYPES, INSTANCES, values)).toBe(100);
  });

  it("is symmetric for evaluation-only", () => {
    const values = [classifiedAs("evaluation_only"), evalJudged];
    expect(scopedRowProgress(SCHEMA, ENTITY_TYPES, INSTANCES, values)).toBe(100);
  });

  it("a value left behind in an out-of-scope part is not counted as progress either", () => {
    // Reclassifying must not push the row ABOVE what is owed: the excluded
    // section leaves both sides of the metric, never just the denominator.
    const values = [classifiedAs("development_only"), evalJudged];
    expect(scopedRowProgress(SCHEMA, ENTITY_TYPES, INSTANCES, values)).toBe(50);
  });

  it("keeps counting the whole instrument while the study type is undecided", () => {
    // Fails open, matching the backend: unclassified assesses everything.
    expect(scopedRowProgress(SCHEMA, ENTITY_TYPES, INSTANCES, [devJudged])).toBe(33);
    const combination = [classifiedAs("combination"), devJudged];
    expect(scopedRowProgress(SCHEMA, ENTITY_TYPES, INSTANCES, combination)).toBe(67);
  });

  it("is inert for a template with no scope rules", () => {
    const values = [classifiedAs("development_only"), devJudged];
    expect(scopedRowProgress(undefined, ENTITY_TYPES, INSTANCES, values)).toBe(67);
    expect(scopedRowProgress({}, ENTITY_TYPES, INSTANCES, values)).toBe(67);
  });

  it("returns 0 for an article with no instances", () => {
    expect(scopedRowProgress(SCHEMA, ENTITY_TYPES, [], [])).toBe(0);
  });
});
