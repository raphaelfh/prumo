import { describe, expect, it } from "vitest";

import {
  outOfScopeSections,
  outOfScopeSectionsOnForm,
  outOfScopeSectionsOnRow,
} from "@/lib/qa/studyTypeScope";

/** The shape PROBAST+AI 2.1.0 seeds onto the template's `schema` JSONB. */
const SCHEMA = {
  scope_rules: {
    classifier: { section: "assessment_scope", field: "study_type" },
    excludes: {
      development_only: ["eval_d1_participants", "eval_d4_judgment"],
      evaluation_only: ["dev_d1_participants", "dev_d4_analysis"],
    },
  },
};

describe("outOfScopeSections", () => {
  it("returns exactly the sections the rules exclude for that answer", () => {
    expect(outOfScopeSections(SCHEMA, "development_only")).toEqual(
      new Set(["eval_d1_participants", "eval_d4_judgment"]),
    );
    expect(outOfScopeSections(SCHEMA, "evaluation_only")).toEqual(
      new Set(["dev_d1_participants", "dev_d4_analysis"]),
    );
  });

  it("fails OPEN — an answer the rules do not name excludes nothing", () => {
    // `combination` is deliberately absent from `excludes`, and so is every
    // unanswered, marked or unrecognized classification: an unclassified run
    // assesses the whole instrument, the pre-2.1.0 behaviour.
    for (const answer of ["combination", "", null, undefined, { value: "x" }, 42]) {
      expect(outOfScopeSections(SCHEMA, answer)).toEqual(new Set());
    }
  });

  it("excludes nothing when the template carries no usable rules", () => {
    // The disagreement the prefix heuristic caused: a clone whose `schema`
    // predates 2.1.0 was badged out-of-scope on screen while the backend,
    // reading the same absent rules, computed a real verdict for it.
    expect(outOfScopeSections(undefined, "development_only")).toEqual(new Set());
    expect(outOfScopeSections(null, "development_only")).toEqual(new Set());
    expect(outOfScopeSections({}, "development_only")).toEqual(new Set());
    expect(outOfScopeSections({ scope_rules: {} }, "development_only")).toEqual(new Set());
  });

  it("tolerates a malformed excludes entry", () => {
    expect(
      outOfScopeSections({ scope_rules: { excludes: { development_only: "x" } } }, "development_only"),
    ).toEqual(new Set());
  });
});

const DOMAINS = [
  {
    entityType: { id: "et-scope", name: "assessment_scope" },
    fields: [{ id: "f-type", name: "study_type" }],
  },
  {
    entityType: { id: "et-eval", name: "eval_d1_participants" },
    fields: [{ id: "f-q1", name: "q1" }],
  },
];
const INSTANCES_BY_ET = { "et-scope": "inst-scope" };
const keyOf = (instanceId: string, fieldId: string) => `${instanceId}_${fieldId}`;

describe("outOfScopeSectionsOnForm", () => {
  it("reads the classifier through the DECLARED coordinate, not a name convention", () => {
    const values = { "inst-scope_f-type": { value: "development_only" } };
    expect(outOfScopeSectionsOnForm(SCHEMA, DOMAINS, INSTANCES_BY_ET, values, keyOf)).toEqual(
      new Set(["eval_d1_participants", "eval_d4_judgment"]),
    );
  });

  it("follows the rules to a differently-named classifier", () => {
    // The whole point of declaring the rule: a template that names its
    // classifier anything else still gates correctly, with no code change.
    const schema = {
      scope_rules: {
        classifier: { section: "eval_d1_participants", field: "q1" },
        excludes: { Y: ["assessment_scope"] },
      },
    };
    const values = { "inst-x_f-q1": { value: "Y" } };
    expect(
      outOfScopeSectionsOnForm(schema, DOMAINS, { "et-eval": "inst-x" }, values, keyOf),
    ).toEqual(new Set(["assessment_scope"]));
  });

  it("excludes nothing while the coordinate cannot be resolved", () => {
    const values = { "inst-scope_f-type": { value: "development_only" } };
    expect(outOfScopeSectionsOnForm({}, DOMAINS, INSTANCES_BY_ET, values, keyOf)).toEqual(
      new Set(),
    );
    // the named section is absent from this template
    expect(
      outOfScopeSectionsOnForm(SCHEMA, [DOMAINS[1]], INSTANCES_BY_ET, values, keyOf),
    ).toEqual(new Set());
    // no instance yet
    expect(outOfScopeSectionsOnForm(SCHEMA, DOMAINS, undefined, values, keyOf)).toEqual(
      new Set(),
    );
    // never answered
    expect(outOfScopeSectionsOnForm(SCHEMA, DOMAINS, INSTANCES_BY_ET, {}, keyOf)).toEqual(
      new Set(),
    );
  });

  it("an absent-reason marker on the classifier excludes nothing", () => {
    // `study_type` is the one PROBAST+AI field that keeps the NI marker: an
    // article that does not say is not a classification, so it must not gate.
    const values = {
      "inst-scope_f-type": { value: null, absent_reason: "no_information" },
    };
    expect(outOfScopeSectionsOnForm(SCHEMA, DOMAINS, INSTANCES_BY_ET, values, keyOf)).toEqual(
      new Set(),
    );
  });
});

const ENTITY_TYPES = [
  { id: "et-scope", name: "assessment_scope", fields: [{ id: "f-type", name: "study_type" }] },
  { id: "et-eval", name: "eval_d1_participants", fields: [{ id: "f-q1", name: "q1" }] },
];
const ROW_INSTANCES = [
  { id: "inst-scope", entity_type_id: "et-scope" },
  { id: "inst-eval", entity_type_id: "et-eval" },
];

describe("outOfScopeSectionsOnRow", () => {
  it("reads the classifier off one article's own stored rows", () => {
    const values = [
      { instance_id: "inst-eval", field_id: "f-q1", value: { value: "Y" } },
      { instance_id: "inst-scope", field_id: "f-type", value: { value: "evaluation_only" } },
    ];
    expect(outOfScopeSectionsOnRow(SCHEMA, ENTITY_TYPES, ROW_INSTANCES, values)).toEqual(
      new Set(["dev_d1_participants", "dev_d4_analysis"]),
    );
  });

  it("excludes nothing when the article has not been classified", () => {
    expect(outOfScopeSectionsOnRow(SCHEMA, ENTITY_TYPES, ROW_INSTANCES, [])).toEqual(new Set());
    expect(outOfScopeSectionsOnRow(SCHEMA, ENTITY_TYPES, [], [])).toEqual(new Set());
    expect(outOfScopeSectionsOnRow({}, ENTITY_TYPES, ROW_INSTANCES, [])).toEqual(new Set());
  });

  it("ignores a same-field value filed under another entity type's instance", () => {
    const values = [
      { instance_id: "inst-eval", field_id: "f-type", value: { value: "development_only" } },
    ];
    expect(outOfScopeSectionsOnRow(SCHEMA, ENTITY_TYPES, ROW_INSTANCES, values)).toEqual(
      new Set(),
    );
  });
});
