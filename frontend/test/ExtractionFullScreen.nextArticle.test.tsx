/**
 * Where an extraction screen sends you when you are done with it (2026-08-22).
 *
 * Finishing a form — the reviewer's advisory mark-ready AND the arbitrator's
 * terminal Approve & finalize — opens the NEXT article in the worklist, so a
 * queue of articles can be worked through without a detour via the project
 * page. At end-of-queue there is nothing to open, so both fall back to the
 * project's extraction tab (the same place the back arrow goes).
 *
 * Harness cloned from ExtractionFullScreen.readonly.test.tsx.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
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
const ARBITRATOR = {
  ...BLIND_PERMISSIONS,
  userRole: "manager" as const,
  isBlindMode: false,
  canSeeOthers: true,
  canResolveConflicts: true,
};
vi.mock("@/hooks/shared/useComparisonPermissions", () => ({
  useComparisonPermissions: vi.fn(),
}));

// Two-article worklist: "a1" is the default entry, so the jump target is "a2"
// and opening "a2" is the end-of-queue case.
vi.mock("@/services/extractionDataService", () => ({
  loadExtractionPhase1: vi.fn(async (articleId: string) => ({
    ok: true,
    data: {
      article: { id: articleId, title: "Test article", project_id: "p1" },
      project: { id: "p1", name: "Test project" },
      template: {
        id: "tpl-1",
        name: "CHARMS",
        kind: "extraction",
        version: "1.0.0",
        is_active: true,
      },
      articles: [
        { id: "a1", title: "First article" },
        { id: "a2", title: "Second article" },
      ],
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

const ENTITY_TYPES = [
  {
    id: "et-1",
    name: "source_of_data",
    label: "Source of Data",
    description: null,
    parent_entity_type_id: null,
    cardinality: "one",
    role: "study_section",
    sort_order: 0,
    is_required: true,
    fields: [
      {
        id: "f1",
        name: "source",
        label: "Source of Data",
        description: null,
        field_type: "text",
        is_required: true,
        validation_schema: null,
        allowed_values: null,
        unit: null,
        allowed_units: null,
        llm_description: null,
        sort_order: 0,
        allow_other: false,
        other_label: null,
        other_placeholder: null,
      },
    ],
  },
];

const INSTANCES = [
  {
    id: "i1",
    project_id: "p1",
    article_id: "a1",
    template_id: "tpl-1",
    entity_type_id: "et-1",
    parent_instance_id: null,
    label: "Source of Data",
    sort_order: 0,
    metadata: {},
    created_by: "u-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

// Two reviewers disagreeing on the single required coord — the divergence the
// arbitrator resolves before Approve & finalize opens.
const DIVERGENT_DECISIONS = [
  {
    id: "dec-a",
    run_id: "run-1",
    instance_id: "i1",
    field_id: "f1",
    reviewer_id: "peer-a",
    decision: "edit",
    proposal_record_id: null,
    value: { value: "Yes" },
    rationale: null,
    created_at: new Date().toISOString(),
  },
  {
    id: "dec-b",
    run_id: "run-1",
    instance_id: "i1",
    field_id: "f1",
    reviewer_id: "peer-b",
    decision: "edit",
    proposal_record_id: null,
    value: { value: "No" },
    rationale: null,
    created_at: new Date().toISOString(),
  },
];

const RESOLVED_CONSENSUS = [
  {
    id: "cons-1",
    run_id: "run-1",
    instance_id: "i1",
    field_id: "f1",
    consensus_user_id: "reviewer-1",
    mode: "select_existing",
    selected_decision_id: "dec-a",
    value: { value: "Yes" },
    rationale: null,
    created_at: new Date().toISOString(),
  },
];

function runView(overrides: Record<string, unknown> = {}) {
  return {
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
      created_at: new Date().toISOString(),
      created_by: "u-1",
    },
    proposals: [],
    decisions: [],
    consensus_decisions: [],
    published_states: [],
    entity_types: ENTITY_TYPES,
    instances: INSTANCES,
    // The caller's own filled required field — opens the mark-ready gate.
    current_values: [
      {
        instance_id: "i1",
        field_id: "f1",
        value: { value: "my answer" },
        decision: "edit",
      },
    ],
    ...overrides,
  };
}

vi.mock("@/integrations/api", () => ({
  apiClient: vi.fn(async () => ({})),
}));

import { useComparisonPermissions } from "@/hooks/shared/useComparisonPermissions";
import { SidebarProvider } from "@/contexts/SidebarContext";
import ExtractionFullScreen from "@/pages/ExtractionFullScreen";
import { apiClient } from "@/integrations/api";

const mockedPermissions = vi.mocked(useComparisonPermissions);

function mockRun(view: ReturnType<typeof runView>) {
  vi.mocked(apiClient).mockImplementation(async (url: string) => {
    if (url === "/api/v1/hitl/sessions") {
      return {
        run_id: "run-1",
        kind: "extraction",
        project_template_id: "tpl-1",
        instances_by_entity_type: { "et-1": "i1" },
      };
    }
    if (url === "/api/v1/runs/run-1/view") {
      return view;
    }
    if (url.includes("/finalized-run")) {
      return null;
    }
    if (url.includes("/reviewers")) {
      return { reviewers: [] };
    }
    if (url.includes("/suggestions")) {
      return { suggestions: [], count: 0 };
    }
    if (url.includes("/files") || url.includes("/text-blocks")) {
      return [];
    }
    return {};
  });
}

// Renders the live URL so navigation assertions read it straight off the DOM.
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="probe-location">{`${loc.pathname}${loc.search}`}</div>;
}

function renderPage(path = "/projects/p1/extraction/a1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route
            path="/projects/:projectId/extraction/:articleId"
            element={
              <SidebarProvider>
                <ExtractionFullScreen />
              </SidebarProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ExtractionFullScreen — worklist navigation", () => {
  beforeEach(() => {
    mockedPermissions.mockReturnValue(BLIND_PERMISSIONS);
    mockRun(runView());
    // The finalize soft-gate confirm is not what these tests are about.
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Finish extraction opens the next article in the worklist", async () => {
    renderPage();
    const button = await screen.findByRole("button", {
      name: /finish extraction/i,
    });
    await waitFor(() => expect(button).not.toHaveAttribute("disabled"));
    await userEvent.click(button);
    await waitFor(() =>
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/projects/p1/extraction/a2",
      ),
    );
  });

  it("Finish extraction on the LAST article falls back to the extraction tab", async () => {
    renderPage("/projects/p1/extraction/a2");
    const button = await screen.findByRole("button", {
      name: /finish extraction/i,
    });
    await waitFor(() => expect(button).not.toHaveAttribute("disabled"));
    await userEvent.click(button);
    await waitFor(() =>
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/projects/p1?tab=extraction",
      ),
    );
  });

  it("Approve & finalize opens the next article in the worklist", async () => {
    mockedPermissions.mockReturnValue(ARBITRATOR);
    mockRun(
      runView({
        run: { ...runView().run, stage: "consensus" },
        decisions: DIVERGENT_DECISIONS,
        consensus_decisions: RESOLVED_CONSENSUS,
        peers_revealed: true,
      }),
    );
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: /approve & finalize/i }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/projects/p1/extraction/a2",
      ),
    );
  });

  it("Approve & finalize on the LAST article falls back to the extraction tab", async () => {
    mockedPermissions.mockReturnValue(ARBITRATOR);
    mockRun(
      runView({
        run: { ...runView().run, stage: "consensus" },
        decisions: DIVERGENT_DECISIONS,
        consensus_decisions: RESOLVED_CONSENSUS,
        peers_revealed: true,
      }),
    );
    renderPage("/projects/p1/extraction/a2");
    await userEvent.click(
      await screen.findByRole("button", { name: /approve & finalize/i }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/projects/p1?tab=extraction",
      ),
    );
  });
});
