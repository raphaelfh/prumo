import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The shared button's hook talks to TanStack; stub it so this stays a pure
// render test (no QueryClient needed).
vi.mock("@/hooks/extraction/useSectionExtraction", () => ({
  useSectionExtraction: () => ({ extractSection: vi.fn(), loading: false, error: null }),
}));
vi.mock("@/lib/copy", () => ({ t: (_ns: string, key: string) => key }));

import { QASectionAccordion } from "@/components/assessment/QASectionAccordion";

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
});
