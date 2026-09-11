/**
 * Header "Review N pending suggestions" on an entry group.
 *
 * A group renders its children for its ACTIVE entry only, while a section is
 * registered under its entity type. Revealing the section by entity type alone
 * opens and scrolls to the active entry's copy of it, so a suggestion under any
 * other entry stays hidden: the locate has to select the entries holding the
 * suggestion before it reveals the section.
 *
 * Harness cloned from ExtractionFullScreen.readonly.test.tsx; the click path is
 * QualityAssessmentFullScreen.hydration.test.tsx's header suggestion locate.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ userId: "reviewer-1" }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "reviewer-1", email: "reviewer@test.local" },
    session: null,
    loading: false,
  }),
}));

vi.mock("@/hooks/shared/useComparisonPermissions", () => ({
  useComparisonPermissions: () => ({
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
  }),
}));

vi.mock("@/services/extractionDataService", () => ({
  loadExtractionPhase1: vi.fn(async () => ({
    ok: true,
    data: {
      article: { id: "a1", title: "Test article", project_id: "p1" },
      project: { id: "p1", name: "Test project" },
      template: {
        id: "tpl-1",
        name: "CHARMS",
        kind: "extraction",
        version: "1.0.0",
        is_active: true,
      },
      articles: [{ id: "a1", title: "Test article" }],
    },
  })),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: async () => ({
        data: { user: { id: "reviewer-1" } },
        error: null,
      }),
    },
  },
}));

// The PDF viewer pulls in worker/canvas globals (pdfjs/DOMMatrix) that crash
// jsdom — stub the component but use the REAL engine-free core store.
vi.mock("@prumo/pdf-viewer", async () => {
  const core =
    await vi.importActual<typeof import("@/pdf-viewer/core")>("@/pdf-viewer/core");
  return {
    PrumoPdfViewer: () => <div data-testid="pdf-viewer-stub">PDF</div>,
    articleFileSourceFromStorageKey: (storageKey: string) => ({
      kind: "lazy" as const,
      load: async () => ({ kind: "url" as const, url: `stub://${storageKey}` }),
    }),
    createViewerStore: core.createViewerStore,
    subscribeReaderLocate: core.subscribeReaderLocate,
  };
});

vi.mock("@/integrations/api", () => ({ apiClient: vi.fn() }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/contexts/SidebarContext";
import { apiClient } from "@/integrations/api";
import ExtractionFullScreen from "@/pages/ExtractionFullScreen";

const NOW = new Date().toISOString();

function textField(id: string, label: string) {
  return {
    id,
    name: id,
    label,
    description: null,
    field_type: "text",
    is_required: false,
    validation_schema: null,
    allowed_values: null,
    unit: null,
    allowed_units: null,
    llm_description: null,
    sort_order: 0,
    allow_other: false,
    other_label: null,
    other_placeholder: null,
  };
}

function section(over: Record<string, unknown>) {
  return {
    description: null,
    parent_entity_type_id: null,
    cardinality: "one",
    entry_label: null,
    sort_order: 0,
    is_required: false,
    fields: [],
    ...over,
  };
}

function instance(id: string, entityTypeId: string, parent: string | null, label: string, sortOrder = 0) {
  return {
    id,
    project_id: "p1",
    article_id: "a1",
    template_id: "tpl-1",
    entity_type_id: entityTypeId,
    parent_instance_id: parent,
    label,
    sort_order: sortOrder,
    metadata: {},
    created_by: "u-1",
    created_at: NOW,
    updated_at: NOW,
  };
}

function currentValue(instanceId: string, fieldId: string, text: string) {
  return { instance_id: instanceId, field_id: fieldId, value: { value: text }, decision: "edit" };
}

/**
 * One tree, two depths. Each model owns a Model Development section; only the
 * second model has predictors, and each predictor owns a Predictor Detail
 * section. Every instance holds its own value, which tells its copy apart.
 */
const RUN_VIEW = {
  run: {
    id: "run-1",
    project_id: "p1",
    article_id: "a1",
    template_id: "tpl-1",
    kind: "extraction",
    version_id: "v-1",
    stage: "extract",
    status: "running",
    hitl_config_snapshot: {},
    parameters: {},
    results: {},
    created_at: NOW,
    created_by: "u-1",
  },
  proposals: [],
  decisions: [],
  consensus_decisions: [],
  published_states: [],
  entity_types: [
    section({
      id: "et-models",
      name: "prediction_models",
      label: "Prediction Models",
      cardinality: "many",
      entry_label: "model",
    }),
    section({
      id: "et-dev",
      name: "model_development",
      label: "Model Development",
      parent_entity_type_id: "et-models",
      sort_order: 1,
      fields: [textField("f-dev", "Notes")],
    }),
    section({
      id: "et-pred",
      name: "final_predictors",
      label: "Final Predictors",
      cardinality: "many",
      entry_label: "predictor",
      parent_entity_type_id: "et-models",
      sort_order: 2,
    }),
    section({
      id: "et-detail",
      name: "predictor_detail",
      label: "Predictor Detail",
      parent_entity_type_id: "et-pred",
      sort_order: 3,
      fields: [textField("f-detail", "Detail")],
    }),
  ],
  instances: [
    instance("m-a", "et-models", null, "Cox Model", 0),
    instance("m-b", "et-models", null, "XGBoost", 1),
    instance("d-a", "et-dev", "m-a", "Cox development"),
    instance("d-b", "et-dev", "m-b", "XGBoost development"),
    instance("p-b1", "et-pred", "m-b", "Age", 0),
    instance("p-b2", "et-pred", "m-b", "Smoking", 1),
    instance("pd-b1", "et-detail", "p-b1", "Age detail"),
    instance("pd-b2", "et-detail", "p-b2", "Smoking detail"),
  ],
  current_values: [
    currentValue("d-a", "f-dev", "cox-notes"),
    currentValue("d-b", "f-dev", "xgb-notes"),
    currentValue("pd-b1", "f-detail", "age-detail"),
    currentValue("pd-b2", "f-detail", "smoking-detail"),
  ],
};

/** Serves RUN_VIEW with one pending AI suggestion, on `fieldId` of `instanceId`. */
function mockRun(instanceId: string, fieldId: string) {
  vi.mocked(apiClient).mockImplementation(async (url: string) => {
    if (url === "/api/v1/hitl/sessions") {
      return {
        run_id: "run-1",
        kind: "extraction",
        project_template_id: "tpl-1",
        instances_by_entity_type: {},
      };
    }
    if (url === "/api/v1/runs/run-1/view") {
      return RUN_VIEW;
    }
    if (url === "/api/v1/articles/a1/instance-ids") {
      return RUN_VIEW.instances.map((i) => i.id);
    }
    if (url.includes("/suggestions") && !url.includes("history")) {
      return {
        suggestions: [
          {
            id: "sug-1",
            run_id: "run-1",
            instance_id: instanceId,
            field_id: fieldId,
            proposed_value: { value: "AI value" },
            confidence_score: 0.9,
            rationale: "",
            created_at: NOW,
            evidence: [],
          },
        ],
        count: 1,
      };
    }
    if (url.includes("/reviewers")) {
      return { reviewers: [] };
    }
    if (url.includes("/files") || url.includes("/text-blocks")) {
      return [];
    }
    return {};
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects/p1/extraction/a1"]}>
        <Routes>
          <Route
            path="/projects/:projectId/extraction/:articleId"
            element={
              // Mirrors the app-level provider in App.tsx: the revealed
              // suggestion's row renders tooltips.
              <TooltipProvider>
                <SidebarProvider>
                  <ExtractionFullScreen />
                </SidebarProvider>
              </TooltipProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function reviewPendingSuggestions() {
  const trigger = await screen.findByTestId("run-ai-actions");
  await waitFor(() => expect(trigger).toHaveTextContent("1"));
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole("menuitem", { name: /review 1 pending/i }));
}

describe("ExtractionFullScreen — header suggestion locate in an entry group", () => {
  beforeEach(() => {
    // The active entry is remembered per slot; a leftover would pick the entry for us.
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("selects the entry holding the first pending suggestion and opens its section", async () => {
    mockRun("d-b", "f-dev");
    renderPage();

    // Precondition: the first model is active and the section shows ITS copy.
    expect(await screen.findByDisplayValue("cox-notes")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /cox model/i, selected: true })).toBeInTheDocument();
    // Collapse the section, so an open one afterwards is the locate's doing.
    await userEvent.click(screen.getByRole("button", { name: /model development/i, expanded: true }));
    await waitFor(() => expect(screen.queryByDisplayValue("cox-notes")).not.toBeInTheDocument());

    await reviewPendingSuggestions();

    expect(await screen.findByRole("tab", { name: /xgboost/i, selected: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /model development/i, expanded: true })).toBeInTheDocument();
    expect(screen.getByDisplayValue("xgb-notes")).toBeInTheDocument();
  });

  it("reaches a section that only mounts once the entries holding it are selected", async () => {
    // The first model has no predictors, so no Predictor Detail section exists
    // until both levels switch: the reveal can only scroll to it after that
    // switch has rendered.
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    mockRun("pd-b2", "f-detail");
    renderPage();

    // Precondition: the first model is active and the section is not mounted.
    expect(await screen.findByRole("tab", { name: /cox model/i, selected: true })).toBeInTheDocument();
    expect(screen.queryByText("Predictor Detail")).not.toBeInTheDocument();

    await reviewPendingSuggestions();

    expect(await screen.findByRole("tab", { name: /xgboost/i, selected: true })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /smoking/i, selected: true })).toBeInTheDocument();
    expect(screen.getByDisplayValue("smoking-detail")).toBeInTheDocument();
    const detail = screen
      .getByRole("button", { name: /predictor detail/i, expanded: true })
      .closest('[data-section-id="et-detail"]');
    expect(detail).not.toBeNull();
    expect(scrollIntoView.mock.contexts).toContain(detail);
  });
});
