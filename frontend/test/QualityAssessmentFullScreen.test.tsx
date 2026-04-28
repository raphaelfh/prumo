import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import QualityAssessmentFullScreen from "@/pages/QualityAssessmentFullScreen";

const PROBAST_TEMPLATE = {
  id: "tpl-1",
  name: "PROBAST",
  description: "Prediction model Risk Of Bias ASsessment Tool",
  kind: "quality_assessment",
  framework: "CUSTOM",
  version: "1.0.0",
};

const PARTICIPANTS_DOMAIN = {
  id: "et-1",
  name: "participants",
  label: "Participants",
  description: "PROBAST domain 1",
  template_id: null,
  project_template_id: "tpl-1",
  parent_entity_type_id: null,
  cardinality: "one",
  sort_order: 1,
  is_required: false,
};

const SIGNALING_QUESTION = {
  id: "f-1",
  entity_type_id: "et-1",
  name: "q1_1_appropriate_data_sources",
  label: "Appropriate data sources?",
  field_type: "select",
  is_required: false,
  allowed_values: ["Y", "PY", "PN", "N", "NI", "NA"],
  unit: null,
  allowed_units: null,
  sort_order: 1,
  llm_description: null,
  validation_schema: null,
  allow_other: false,
};

const ROB_FIELD = {
  ...SIGNALING_QUESTION,
  id: "f-2",
  name: "risk_of_bias",
  label: "Risk of bias",
  allowed_values: ["Low", "High", "Unclear"],
  sort_order: 99,
};

vi.mock("@/integrations/supabase/client", () => {
  function makeQuery(rows: unknown) {
    const result = { data: rows, error: null };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      maybeSingle: () => Promise.resolve(result),
      then: (cb: (r: typeof result) => unknown) => Promise.resolve(cb(result)),
    };
    return builder;
  }

  return {
    supabase: {
      from: (table: string) => {
        if (table === "project_extraction_templates") {
          return makeQuery(PROBAST_TEMPLATE);
        }
        if (table === "extraction_entity_types") {
          return makeQuery([PARTICIPANTS_DOMAIN]);
        }
        if (table === "extraction_fields") {
          return makeQuery([SIGNALING_QUESTION, ROB_FIELD]);
        }
        return makeQuery([]);
      },
    },
  };
});

// PDFViewer pulls in worker / canvas globals that aren't worth wiring up
// for a unit test — stub it out.
vi.mock("@/components/PDFViewer", () => ({
  PDFViewer: () => <div data-testid="qa-pdf-viewer-stub">PDF</div>,
}));

// apiClient gets called from the QA hooks; map by URL so the test isn't
// coupled to the order of fetches.
vi.mock("@/integrations/api", () => ({
  apiClient: vi.fn(async (url: string) => {
    if (url === "/api/v1/qa-assessments") {
      return {
        run_id: "run-1",
        project_template_id: "tpl-1",
        instances_by_entity_type: { "et-1": "inst-1" },
      };
    }
    if (url === "/api/v1/runs/run-1") {
      return {
        run: {
          id: "run-1",
          project_id: "p1",
          article_id: "a1",
          template_id: "tpl-1",
          kind: "quality_assessment",
          version_id: "v-1",
          stage: "proposal",
          status: "running",
          hitl_config_snapshot: {},
          parameters: {},
          results: {},
          created_at: new Date().toISOString(),
          created_by: "u-1",
        },
        proposals: [],
        decisions: [],
        consensus_decisions: [],
        published_states: [],
      };
    }
    return {};
  }),
}));

function renderPage(path = "/projects/p1/articles/a1/quality-assessment/tpl-1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/projects/:projectId/articles/:articleId/quality-assessment/:templateId"
            element={<QualityAssessmentFullScreen />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("QualityAssessmentFullScreen", () => {
  beforeEach(() => {
    // No-op; supabase + apiClient are mocked at module scope.
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders header with QA badge + template name + version", async () => {
    renderPage();
    expect(screen.getByTestId("qa-kind-badge")).toHaveTextContent(
      "Quality Assessment",
    );
    await waitFor(() =>
      expect(screen.getByTestId("qa-template-name")).toHaveTextContent(
        "PROBAST",
      ),
    );
    expect(screen.getByText(/v1\.0\.0/)).toBeInTheDocument();
  });

  it("AssessmentShell starts with PDF collapsed (Show PDF visible)", async () => {
    renderPage();
    expect(screen.getByTestId("assessment-shell")).toBeInTheDocument();
    expect(screen.getByTestId("assessment-shell-show-pdf")).toBeInTheDocument();
    expect(
      screen.queryByTestId("assessment-shell-pdf"),
    ).not.toBeInTheDocument();
  });

  it("renders one accordion per domain after template loads", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("qa-domains")).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("qa-domain-participants"),
    ).toBeInTheDocument();
  });

  it("first domain accordion opens by default exposing summary card", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("qa-domains")).toBeInTheDocument(),
    );
    // Radix Accordion with defaultValue mounts the open item's content;
    // domain-judgment summary card is unique to the open domain.
    await waitFor(() =>
      expect(
        screen.getByTestId("qa-domain-summary-participants"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/Domain judgment/i)).toBeInTheDocument();
  });

  it("renders form-panel container", async () => {
    renderPage();
    expect(screen.getByTestId("qa-form-panel")).toBeInTheDocument();
  });
});
