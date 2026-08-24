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

  it("holds a divergent pick until the rationale exists, then confirm dispatches", async () => {
    const user = userEvent.setup();
    const { onValueChange, rerender } = renderV2();
    const card = screen.getByTestId("qa-judgment-card-j1");
    await user.click(within(card).getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: "Low" }));
    // Held, not dispatched — and the requirement is visible.
    expect(onValueChange).not.toHaveBeenCalledWith("j1", "Low");
    expect(screen.getByTestId("qa-divergence-j1")).toBeInTheDocument();
    const confirm = screen.getByTestId("qa-divergence-confirm-j1");
    expect(confirm).toBeDisabled();

    // The reviewer writes the rationale (arrives via the values map).
    rerender(
      <TooltipProvider>
      <QASectionAccordion
        domain={V2_DOMAIN}
        values={{ r1: "large development sample" }}
        onValueChange={onValueChange}
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
    const confirmEnabled = screen.getByTestId("qa-divergence-confirm-j1");
    expect(confirmEnabled).toBeEnabled();
    await user.click(confirmEnabled);
    expect(onValueChange).toHaveBeenCalledWith("j1", "Low");
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

  it("hydrated pre-existing divergence shows the state but never blocks", () => {
    renderV2({ values: { j1: "Low" } });
    expect(screen.getByTestId("qa-divergence-note-j1")).toBeInTheDocument();
    expect(
      screen.queryByTestId("qa-divergence-confirm-j1"),
    ).not.toBeInTheDocument();
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
