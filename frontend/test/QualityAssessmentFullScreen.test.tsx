import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ userId: "qa-test-reviewer-id" }),
}));

// Default: blind reviewer (no compare access). The compare-mode test below
// overrides this to a manager who may see peers.
const BLIND_PERMISSIONS = {
  userRole: "reviewer" as const,
  isBlindMode: true,
  canSeeOthers: false,
  canResolveConflicts: false,
  canManageBlindMode: false,
  canExport: false,
  canEditTemplate: false,
  loading: false,
  error: null,
  refresh: vi.fn(),
};
vi.mock("@/hooks/shared/useComparisonPermissions", () => ({
  useComparisonPermissions: vi.fn(),
}));

import { useComparisonPermissions } from "@/hooks/shared/useComparisonPermissions";
import QualityAssessmentFullScreen from "@/pages/QualityAssessmentFullScreen";

const mockedPermissions = vi.mocked(useComparisonPermissions);

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
      // useAISuggestions → AISuggestionService.loadSuggestions resolves the
      // current reviewer via supabase.auth.getUser(); without this stub every
      // render surfaces an "Error loading suggestions" toast that drowns out
      // the assertions below.
      auth: {
        getUser: async () => ({
          data: { user: { id: "qa-test-reviewer-id" } },
          error: null,
        }),
      },
      from: (table: string) => {
        if (table === "project_extraction_templates") {
          return makeQuery(PROBAST_TEMPLATE);
        }
        if (table === "extraction_entity_types") {
          // useProjectQATemplate uses select("*, extraction_fields(*)")
          // — return the embedded join shape so fields are picked up.
          return makeQuery([
            {
              ...PARTICIPANTS_DOMAIN,
              extraction_fields: [SIGNALING_QUESTION, ROB_FIELD],
            },
          ]);
        }
        if (table === "extraction_fields") {
          return makeQuery([SIGNALING_QUESTION, ROB_FIELD]);
        }
        return makeQuery([]);
      },
    },
  };
});

// The PDF viewer pulls in worker / canvas globals that aren't worth wiring
// up for a unit test — stub it out.
vi.mock("@prumo/pdf-viewer", () => ({
  PrumoPdfViewer: () => <div data-testid="qa-pdf-viewer-stub">PDF</div>,
  articleFileSource: (articleId: string) => ({
    kind: "lazy" as const,
    load: async () => ({kind: "url" as const, url: `stub://articles/${articleId}.pdf`}),
  }),
}));

// apiClient gets called from the QA hooks; map by URL so the test isn't
// coupled to the order of fetches.
vi.mock("@/integrations/api", () => ({
  apiClient: vi.fn(async (url: string) => {
    if (url === "/api/v1/hitl/sessions") {
      return {
        run_id: "run-1",
        kind: "quality_assessment",
        project_template_id: "tpl-1",
        instances_by_entity_type: { "et-1": "inst-1" },
      };
    }
    if (url === "/api/v1/runs/run-1/view") {
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
        // One peer reviewer decision so reviewerSummary.decisionsByCoord is
        // non-empty — the compare toggle's data precondition. (The blind gate
        // is enforced separately by useComparisonPermissions.)
        decisions: [
          {
            id: "dec-peer-1",
            run_id: "run-1",
            instance_id: "inst-1",
            field_id: "f-1",
            reviewer_id: "peer-reviewer-id",
            decision: "edit",
            proposal_record_id: null,
            value: { value: "PY" },
            rationale: null,
            created_at: new Date().toISOString(),
          },
        ],
        consensus_decisions: [],
        published_states: [],
        entity_types: [],
        current_values: [],
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
    // supabase + apiClient are mocked at module scope. Reset the permission
    // hook to the blind default; the compare-mode test overrides it.
    mockedPermissions.mockReturnValue(BLIND_PERMISSIONS);
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

  it("renders Extract with AI button once the QA session is open", async () => {
    renderPage();
    const button = await screen.findByTestId("qa-extract-ai-button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent(/Extract with AI/i);
    // The button stays enabled while the session is open and the run is
    // not finalized — guards against accidentally disabling it (it's the
    // only entry point to the AI prefill flow).
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("Extract with AI click posts to /api/v1/extraction/sections with the session run id", async () => {
    const { apiClient } = (await import(
      "@/integrations/api"
    )) as unknown as { apiClient: ReturnType<typeof vi.fn> };
    apiClient.mockClear();

    renderPage();
    const button = await screen.findByTestId("qa-extract-ai-button");
    await waitFor(() => expect(button).not.toBeDisabled());
    button.click();

    await waitFor(() => {
      const sectionCalls = apiClient.mock.calls.filter(
        (call) => call[0] === "/api/v1/extraction/sections",
      );
      expect(sectionCalls.length).toBeGreaterThan(0);
      const lastBody = sectionCalls[sectionCalls.length - 1][1]?.body ?? {};
      expect(lastBody.runId).toBe("run-1");
      expect(lastBody.projectId).toBe("p1");
      expect(lastBody.articleId).toBe("a1");
      expect(lastBody.templateId).toBe("tpl-1");
      // QA must NOT auto-advance to REVIEW — the publish flow does that.
      expect(lastBody.autoAdvanceToReview).toBe(false);
      // Re-running AI should preserve user-entered values by default.
      expect(lastBody.skipFieldsWithHumanProposals).toBe(true);
    });
  });

  it("Publish with no values shows error toast and does NOT advance the run", async () => {
    // BUG-001 regression: clicking "Publish assessment" when no fields are
    // filled previously advanced the run through review → consensus →
    // finalized without writing any consensus, producing a "Published"
    // run with zero PublishedState rows. The preflight check now blocks
    // this before any backend write.
    const { apiClient } = (await import(
      "@/integrations/api"
    )) as unknown as { apiClient: ReturnType<typeof vi.fn> };
    apiClient.mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();

    renderPage();
    const button = await screen.findByTestId("qa-publish-button");
    await waitFor(() => expect(button).not.toBeDisabled());
    button.click();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/at least one signaling question/i),
      );
    });

    // Regression (#252 follow-up): the background suggestions load must not
    // surface its own error toast — only the publish preflight message.
    expect(toast.error).not.toHaveBeenCalledWith(
      expect.stringMatching(/error loading suggestions/i),
    );

    // Crucially, no advance / consensus calls were made.
    const sideEffects = apiClient.mock.calls.filter(([url]) =>
      typeof url === "string"
        && (url.includes("/advance") || url.includes("/consensus")),
    );
    expect(sideEffects).toHaveLength(0);
  });

  it("blind reviewer sees no comparison toggle and stays on the assess view", async () => {
    // Default permissions (BLIND_PERMISSIONS) → canSeeOthers=false → no toggle
    // even though a peer decision exists in the run.
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("qa-domains")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("qa-compare-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("qa-compare-view")).not.toBeInTheDocument();
  });

  it("manager who may see peers gets the toggle, and clicking it renders the shared comparison", async () => {
    mockedPermissions.mockReturnValue({
      ...BLIND_PERMISSIONS,
      userRole: "manager",
      isBlindMode: false,
      canSeeOthers: true,
      canManageBlindMode: true,
    });

    renderPage();

    // Toggle appears once the run + peer decision are loaded.
    const toggle = await screen.findByTestId("qa-compare-toggle");
    expect(toggle).toBeInTheDocument();
    // Still on the assess view until the toggle is clicked.
    expect(screen.getByTestId("qa-domains")).toBeInTheDocument();
    expect(screen.queryByTestId("qa-compare-view")).not.toBeInTheDocument();

    toggle.click();

    // Compare view replaces the domain accordions and renders the shared
    // server-blinded comparison table (peer column sourced from decisionsByCoord).
    await waitFor(() =>
      expect(screen.getByTestId("qa-compare-view")).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("run-reviewer-comparison"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("qa-domains")).not.toBeInTheDocument();
  });
});
