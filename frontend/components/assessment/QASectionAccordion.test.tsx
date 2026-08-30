import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The shared button's hook talks to TanStack; stub it so this stays a pure
// render test (no QueryClient needed).
vi.mock("@/hooks/extraction/useSectionExtraction", () => ({
  useSectionExtraction: () => ({ extractSection: vi.fn(), loading: false, error: null }),
}));
vi.mock("@/lib/copy", () => ({ t: (_ns: string, key: string) => key }));

import { QASectionAccordion } from "@/components/assessment/QASectionAccordion";
import { RunEditabilityProvider } from "@/components/runs/RunEditabilityContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { qa } from "@/lib/copy/qa";

// Radix Select needs the pointer-capture surface jsdom lacks.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const BASE_ENTITY = {
  id: "qa-dom",
  template_id: "t",
  name: "qa_domain_one",
  label: "Patient Selection",
  description: null,
  parent_entity_type_id: null,
  cardinality: "one",
  role: "study_section",
  sort_order: 0,
  is_required: true,
  created_at: "2020-01-01T00:00:00Z",
};

const QA_DOMAIN = {
  entityType: {
    id: "qa-dom",
    template_id: "t",
    name: "qa_domain_one",
    label: "Patient Selection",
    description: null,
    parent_entity_type_id: null,
    cardinality: "one",
    role: "study_section",
    sort_order: 0,
    is_required: true,
    created_at: "2020-01-01T00:00:00Z",
  },
  fields: [
    {
      id: "f1",
      entity_type_id: "qa-dom",
      name: "signaling_q1",
      label: "Was a consecutive sample enrolled?",
      description: null,
      field_type: "text",
      is_required: true,
      validation_schema: null,
      allowed_values: null,
      unit: null,
      allowed_units: null,
      llm_description: null,
      sort_order: 0,
      created_at: "2020-01-01T00:00:00Z",
    },
  ],
} as never;

describe("QASectionAccordion", () => {
  it("renders a per-domain AI extract button keyed by the entity-type id", () => {
    render(
      <QASectionAccordion
        domain={QA_DOMAIN}
        values={{}}
        onValueChange={() => {}}
        projectId="p1"
        articleId="a1"
        templateId="t1"
        runId="r1"
        instanceId="i1"
        defaultOpen
      />,
    );
    expect(screen.getByTestId("section-ai-extract-qa-dom")).toBeInTheDocument();
  });

  it("read-only: hides the per-domain AI-extract button", () => {
    // The editable test above is the positive control for this selector.
    render(
      <RunEditabilityProvider stage="finalized">
        <QASectionAccordion
          domain={QA_DOMAIN}
          values={{}}
          onValueChange={() => {}}
          projectId="p1"
          articleId="a1"
          templateId="t1"
          runId="r1"
          instanceId="i1"
          defaultOpen
        />
      </RunEditabilityProvider>,
    );
    expect(
      screen.queryByTestId("section-ai-extract-qa-dom"),
    ).not.toBeInTheDocument();
  });
});

// --- v2: recommendation card, divergence gate, exclusions (spec §6) ---------

function v2Field(overrides: Record<string, unknown>) {
  return {
    entity_type_id: "qa-dom",
    description: null,
    is_required: true,
    validation_schema: null,
    allowed_values: null,
    unit: null,
    allowed_units: null,
    llm_description: null,
    created_at: "2020-01-01T00:00:00Z",
    ...overrides,
  };
}

const V2_DOMAIN = {
  entityType: BASE_ENTITY,
  fields: [
    v2Field({ id: "d1", name: "desc_data_sources", label: "Describe the data sources", field_type: "text", sort_order: 0 }),
    v2Field({ id: "q1", name: "q1_appropriate_data_sources", label: "Appropriate data sources?", field_type: "select", allowed_values: ["Y", "PY", "PN", "N"], sort_order: 1 }),
    v2Field({ id: "j1", name: "quality_concern", label: "Quality", field_type: "select", allowed_values: ["Low", "High", "Unclear"], sort_order: 2 }),
    v2Field({ id: "r1", name: "quality_concern_rationale", label: "Rationale of quality rating", field_type: "text", sort_order: 3 }),
    v2Field({ id: "app1", name: "applicability_concerns", label: "Applicability concerns", field_type: "select", allowed_values: ["Low", "High", "Unclear"], sort_order: 4 }),
    v2Field({ id: "appr1", name: "applicability_concerns_rationale", label: "Rationale of applicability rating", field_type: "text", sort_order: 5 }),
  ],
} as never;

const V2_ENTRY = {
  id: "dev_d1_quality",
  label: "Development D1: quality",
  value: "High",
  inputs: [{ label: "Q1", value: "PN", contribution: "High" }],
  target_entity_type_id: "qa-dom",
  target_field_id: "j1",
  rationale_field_id: "r1",
  summary_field_id: null,
  rationale_required: false,
};

function renderV2(
  overrides: Partial<Parameters<typeof QASectionAccordion>[0]> = {},
) {
  const onValueChange = vi.fn();
  const utils = render(
    <TooltipProvider>
    <QASectionAccordion
      domain={V2_DOMAIN}
      values={{}}
      onValueChange={onValueChange}
      projectId="p1"
      articleId="a1"
      templateId="t1"
      runId="r1"
      instanceId="i1"
      defaultOpen
      derivedJudgments={[V2_ENTRY]}
      {...overrides}
    />
    </TooltipProvider>,
  );
  return { onValueChange, ...utils };
}

describe("QASectionAccordion — recommendation card (v2)", () => {
  it("renders the chip for the matched judgment and Apply dispatches the default", async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderV2();
    const card = screen.getByTestId("qa-judgment-card-j1");
    expect(
      within(card).getByTestId("qa-derived-chip-dev_d1_quality"),
    ).toHaveTextContent("High");
    await user.click(
      within(card).getByTestId("qa-derived-apply-dev_d1_quality"),
    );
    expect(onValueChange).toHaveBeenCalledWith("j1", "High");
  });

  it("renders the paired rationale INSIDE the judgment card, not the SQ list", () => {
    renderV2();
    const card = screen.getByTestId("qa-judgment-card-j1");
    expect(
      within(card).getByText("Rationale of quality rating"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("qa-field-row-quality_concern_rationale"),
    ).not.toBeInTheDocument();
  });

  it("a divergent pick is written through, and the server's requirement shows", async () => {
    // The pick is NOT held. Holding it was what let the rationale be deleted
    // afterwards, hid a divergence loaded from an earlier session, and dropped
    // a pending pick on article navigation. The requirement is now a property
    // of the stored state — `rationale_required`, decided by the same server
    // rule that refuses the finalize — so it survives all three.
    const user = userEvent.setup();
    const { onValueChange } = renderV2({
      derivedJudgments: [{ ...V2_ENTRY, rationale_required: true }],
    });
    const card = screen.getByTestId("qa-judgment-card-j1");
    await user.click(within(card).getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: "Low" }));
    expect(onValueChange).toHaveBeenCalledWith("j1", "Low");
    expect(screen.getByTestId("qa-divergence-j1")).toBeInTheDocument();
  });

  it("a pick matching the derived default dispatches immediately", async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderV2();
    const card = screen.getByTestId("qa-judgment-card-j1");
    await user.click(within(card).getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: "High" }));
    expect(onValueChange).toHaveBeenCalledWith("j1", "High");
    expect(screen.queryByTestId("qa-divergence-j1")).not.toBeInTheDocument();
  });

  it("a divergence hydrated from an earlier session states the same requirement", () => {
    // Previously this rendered a muted note and nothing else, so a divergence
    // created anywhere but this select — the consensus panel, a marker, an
    // earlier session — was only ever annotated. One server flag, one render.
    renderV2({
      values: { j1: "Low" },
      derivedJudgments: [{ ...V2_ENTRY, rationale_required: true }],
    });
    expect(screen.getByTestId("qa-divergence-j1")).toBeInTheDocument();
  });

  it("says nothing when the server says the rationale is not owed", () => {
    // The complement that stops the assertion above passing vacuously: the
    // same hydrated divergence, with the rationale already written, is silent.
    renderV2({ values: { j1: "Low", r1: "explained" } });
    expect(screen.queryByTestId("qa-divergence-j1")).not.toBeInTheDocument();
  });

  it("judgments without a matching entry render exactly as today", async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderV2();
    // applicability_concerns is a judgment field with NO entry: plain input,
    // immediate dispatch, no chip.
    const summaryCard = screen.getByTestId("qa-domain-summary-qa_domain_one");
    const appCombobox = within(summaryCard).getAllByRole("combobox").at(-1)!;
    await user.click(appCombobox);
    await user.click(screen.getByRole("option", { name: "Unclear" }));
    expect(onValueChange).toHaveBeenCalledWith("app1", "Unclear");
    expect(screen.getAllByTestId(/qa-derived-chip-/)).toHaveLength(1);
  });

  it("the header badge counts only select questions, never text boxes", () => {
    renderV2();
    expect(screen.getByText("1 signaling question")).toBeInTheDocument();
  });

  it("shows an out-of-scope hint when the study type excludes this part", () => {
    renderV2({ outOfScope: true });
    expect(screen.getByTestId("qa-out-of-scope-qa_domain_one")).toBeInTheDocument();
  });

  it("offers the AI extract button while the section is in scope", () => {
    renderV2();
    expect(screen.getByTestId("section-ai-extract-qa-dom")).toBeInTheDocument();
  });

  it("hides the AI extract button on an out-of-scope section", () => {
    // The backend refuses the fields anyway (llm_field_filter), so the button
    // would spin and return nothing — the dead affordance the same guard
    // already rejects for a fully assessor-owned section.
    renderV2({ outOfScope: true });
    expect(screen.queryByTestId("section-ai-extract-qa-dom")).not.toBeInTheDocument();
  });
});

describe("QASectionAccordion — exclusions and summaries (v2)", () => {
  const OVERALL_DOMAIN = {
    entityType: { ...BASE_ENTITY, id: "overall-et", name: "overall_judgement", label: "Overall judgement" },
    fields: [
      v2Field({ id: "s1", name: "summary_rob_evaluation", label: "Summary of risk of bias of the model evaluation", field_type: "text", sort_order: 0, entity_type_id: "overall-et" }),
    ],
  } as never;

  const OVERALL_ENTRY = {
    id: "eval_overall_rob",
    label: "Overall risk of bias (evaluation)",
    value: "High",
    inputs: [],
    target_entity_type_id: null,
    target_field_id: null,
    rationale_field_id: null,
    summary_field_id: "s1",
    rationale_required: false,
  };

  it("hides the AI extract button when every field of the section is excluded", () => {
    render(
      <TooltipProvider>
      <QASectionAccordion
        domain={OVERALL_DOMAIN}
        values={{}}
        onValueChange={() => {}}
        projectId="p1"
        articleId="a1"
        templateId="t1"
        runId="r1"
        instanceId="i2"
        defaultOpen
        derivedJudgments={[OVERALL_ENTRY]}
      />
      </TooltipProvider>,
    );
    expect(
      screen.queryByTestId("section-ai-extract-overall-et"),
    ).not.toBeInTheDocument();
  });

  it("renders an out-of-scope overall as Not applicable, not as a dash", () => {
    // Third render site of the same wire state: the summary badge inside the
    // overall_judgement section, which the banner and the chip both mirror.
    render(
      <TooltipProvider>
      <QASectionAccordion
        domain={OVERALL_DOMAIN}
        values={{}}
        onValueChange={() => {}}
        projectId="p1"
        articleId="a1"
        templateId="t1"
        runId="r1"
        instanceId="i2"
        defaultOpen
        derivedJudgments={[
          {
            ...OVERALL_ENTRY,
            value: null,
            inputs: [{ label: "Evaluation D1", value: null, state: "out-of-scope" }],
          },
        ]}
      />
      </TooltipProvider>,
    );
    const badge = screen.getByTestId("qa-summary-overall-eval_overall_rob");
    expect(badge).toHaveTextContent(qa.outOfScopeValue);
    expect(badge).not.toHaveTextContent(qa.overallIncomplete);
  });

  it("renders the computed overall beside its paired summary field", () => {
    render(
      <TooltipProvider>
      <QASectionAccordion
        domain={OVERALL_DOMAIN}
        values={{}}
        onValueChange={() => {}}
        projectId="p1"
        articleId="a1"
        templateId="t1"
        runId="r1"
        instanceId="i2"
        defaultOpen
        derivedJudgments={[OVERALL_ENTRY]}
      />
      </TooltipProvider>,
    );
    expect(
      screen.getByTestId("qa-summary-overall-eval_overall_rob"),
    ).toHaveTextContent("High");
  });
});

describe("QASectionAccordion — editability, scope sections, paired rationales", () => {
  it("read-only: the derived-default Apply is disabled with the rest of the form", () => {
    render(
      <RunEditabilityProvider stage="finalized">
        <TooltipProvider>
          <QASectionAccordion
            domain={V2_DOMAIN}
            values={{}}
            onValueChange={() => {}}
            projectId="p1"
            articleId="a1"
            templateId="t1"
            runId="r1"
            instanceId="i1"
            defaultOpen
            derivedJudgments={[V2_ENTRY]}
          />
        </TooltipProvider>
      </RunEditabilityProvider>,
    );
    // The chip still explains the derivation; only the mutation affordance goes.
    expect(screen.getByTestId("qa-derived-chip-dev_d1_quality")).toBeInTheDocument();
    expect(
      screen.queryByTestId("qa-derived-apply-dev_d1_quality"),
    ).not.toBeInTheDocument();
  });

  it("a scope-like section shows neither the risk icon nor a signaling badge", () => {
    const SCOPE_DOMAIN = {
      entityType: { ...BASE_ENTITY, id: "scope-et", name: "assessment_scope", label: "Assessment scope" },
      fields: [
        v2Field({
          id: "st1",
          name: "study_type",
          label: "Study type",
          field_type: "select",
          allowed_values: [
            { value: "development_only", label: "Development only" },
            { value: "evaluation_only", label: "Evaluation only" },
            { value: "combination", label: "Combination" },
          ],
          sort_order: 0,
          entity_type_id: "scope-et",
        }),
      ],
    } as never;
    render(
      <TooltipProvider>
        <QASectionAccordion
          domain={SCOPE_DOMAIN}
          values={{}}
          onValueChange={() => {}}
          projectId="p1"
          articleId="a1"
          templateId="t1"
          runId="r1"
          instanceId="i3"
          defaultOpen
          derivedJudgments={[]}
        />
      </TooltipProvider>,
    );
    expect(
      screen.queryByTestId("qa-section-risk-icon-assessment_scope"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/signaling question/)).not.toBeInTheDocument();
    // Positive control: a real domain keeps its icon.
    render(
      <TooltipProvider>
        <QASectionAccordion
          domain={V2_DOMAIN}
          values={{}}
          onValueChange={() => {}}
          projectId="p1"
          articleId="a1"
          templateId="t1"
          runId="r1"
          instanceId="i1"
          defaultOpen
          derivedJudgments={[V2_ENTRY]}
        />
      </TooltipProvider>,
    );
    expect(
      screen.getByTestId("qa-section-risk-icon-qa_domain_one"),
    ).toBeInTheDocument();
  });

  it("applicability's name-paired rationale renders inside the judgment card", () => {
    renderV2();
    const card = screen.getByTestId("qa-domain-summary-qa_domain_one");
    expect(
      within(card).getByTestId("qa-paired-rationale-applicability_concerns"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("qa-field-row-applicability_concerns_rationale"),
    ).not.toBeInTheDocument();
  });
});

describe("QASectionAccordion — markers and clears are ordinary writes", () => {
  it("a 'No information' marker writes through as the envelope", async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderV2();
    const card = screen.getByTestId("qa-judgment-card-j1");
    // The universal disposition chip on the judgment FieldInput.
    await user.click(
      within(card).getAllByRole("button", { name: "dispositionNoInformation" })[0],
    );
    expect(onValueChange).toHaveBeenCalledWith("j1", {
      value: null,
      absent_reason: "no_information",
    });
  });

  it("a marker the server counts as an override still states the requirement", async () => {
    // The hole this closes: the backend reads a `no_information` marker as a
    // judgment (the instrument reads NI as Unclear on a domain), so overriding
    // a default with one owes a rationale — but a pick-time gate keyed on
    // `typeof next === "string"` could never see an object envelope, and the
    // finalize refused a divergence the screen had never mentioned.
    renderV2({
      values: { j1: { value: null, absent_reason: "no_information" } },
      derivedJudgments: [{ ...V2_ENTRY, rationale_required: true }],
    });
    expect(screen.getByTestId("qa-divergence-j1")).toBeInTheDocument();
  });

  it("clearing a stored marker writes through", async () => {
    const user = userEvent.setup();
    const marker = { value: null, absent_reason: "no_information" };
    const { onValueChange } = renderV2({ values: { j1: marker } });
    const card = screen.getByTestId("qa-judgment-card-j1");
    // The active chip toggles off with an empty-string clear.
    await user.click(
      within(card).getAllByRole("button", { name: /dispositionNoInformation/ })[0],
    );
    expect(onValueChange).toHaveBeenCalledWith("j1", "");
  });
});
