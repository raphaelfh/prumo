/**
 * Screen-level proof for THE reported bug (spec 2026-07-02): a run whose
 * header says Published must render the form read-only with the PUBLISHED
 * values — not the viewer's drafts — with a banner + Reopen affordance and
 * no fill-completion chrome.
 *
 * Harness cloned from QualityAssessmentFullScreen.test.tsx (the canonical
 * screen harness): URL-keyed apiClient mock, engine-free pdf-viewer core,
 * data-service mock instead of a supabase chain builder.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ userId: "reviewer-1" }),
}));

// useFieldManagement/useModelManagement read the signed-in user from
// AuthContext; the harness has no real AuthProvider.
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
vi.mock("@/hooks/shared/useComparisonPermissions", () => ({
  useComparisonPermissions: vi.fn(),
}));

// Phase-1 data (article/project/template/worklist) — service-level mock, the
// screen's entity types + instances come from the run view below.
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

const FINALIZED_RUN_VIEW = {
  run: {
    id: "run-1",
    project_id: "p1",
    article_id: "a1",
    template_id: "tpl-1",
    kind: "extraction",
    version_id: "v-1",
    stage: "finalized",
    status: "completed",
    hitl_config_snapshot: {},
    parameters: {},
    results: {},
    created_at: new Date().toISOString(),
    created_by: "u-1",
  },
  proposals: [],
  decisions: [],
  consensus_decisions: [],
  published_states: [
    {
      id: "ps-1",
      run_id: "run-1",
      instance_id: "i1",
      field_id: "f1",
      value: { value: "published-final" },
      published_at: new Date().toISOString(),
      published_by: "u-1",
      version: 1,
    },
  ],
  entity_types: [
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
  ],
  instances: [
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
  ],
  // The viewer's own draft — must NOT surface on a published run.
  current_values: [
    {
      instance_id: "i1",
      field_id: "f1",
      value: { value: "MY-DRAFT" },
      decision: "edit",
    },
  ],
};

vi.mock("@/integrations/api", () => ({
  apiClient: vi.fn(async (url: string) => {
    if (url === "/api/v1/hitl/sessions") {
      return {
        run_id: "run-1",
        kind: "extraction",
        project_template_id: "tpl-1",
        instances_by_entity_type: { "et-1": "i1" },
      };
    }
    if (url === "/api/v1/runs/run-1/view") {
      return FINALIZED_RUN_VIEW;
    }
    if (url.includes("/finalized-run")) {
      return {
        id: "run-1",
        stage: "finalized",
        status: "completed",
        template_id: "tpl-1",
      };
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
  }),
}));

import { useComparisonPermissions } from "@/hooks/shared/useComparisonPermissions";
import { SidebarProvider } from "@/contexts/SidebarContext";
import ExtractionFullScreen from "@/pages/ExtractionFullScreen";
import { apiClient } from "@/integrations/api";

const mockedPermissions = vi.mocked(useComparisonPermissions);

function renderPage(path = "/projects/p1/extraction/a1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
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

describe("ExtractionFullScreen — finalized (published, read-only)", () => {
  beforeEach(() => {
    mockedPermissions.mockReturnValue(BLIND_PERMISSIONS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("published run renders read-only with published values", async () => {
    renderPage();

    // Published value hydrates (not the viewer draft) and the input disables.
    const input = await screen.findByDisplayValue("published-final");
    expect(input).toBeDisabled();
    expect(screen.queryByDisplayValue("MY-DRAFT")).not.toBeInTheDocument();

    // Banner: Published badge + read-only notice + inline Reopen.
    expect(screen.getByTestId("extraction-finalized-badge")).toBeInTheDocument();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(screen.getByTestId("extraction-reopen-button")).toBeInTheDocument();

    // No fill-completion CTA, no per-section AI extract.
    await waitFor(() =>
      expect(screen.queryByText(/required left/i)).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("section-ai-extract-et-1"),
    ).not.toBeInTheDocument();
  });
});

describe("ExtractionFullScreen — consensus dead affordances (D6)", () => {
  // Identity-granted arbitrator: canCompare's data preconditions all hold, so
  // only the D6 stage guard can hide the toggle.
  const REVEALED_ARBITRATOR = {
    ...BLIND_PERMISSIONS,
    userRole: "manager" as const,
    isBlindMode: false,
    canSeeOthers: true,
    canResolveConflicts: true,
  };

  function mockStageView(stage: string) {
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
        return {
          ...FINALIZED_RUN_VIEW,
          run: { ...FINALIZED_RUN_VIEW.run, stage, status: "running" },
          published_states: [],
          current_values: [],
          peers_revealed: true,
          // Two divergent peer decisions: decisionsByCoord.size > 0.
          decisions: [
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
          ],
        };
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

  beforeEach(() => {
    mockedPermissions.mockReturnValue(REVEALED_ARBITRATOR);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extract stage (positive control): the Compare toggle renders", async () => {
    mockStageView("extract");
    renderPage();
    expect(
      await screen.findByRole("button", { name: /^compare$/i }),
    ).toBeInTheDocument();
  });

  it("consensus stage: no Compare toggle — the resolve table is the only surface", async () => {
    mockStageView("consensus");
    renderPage();
    // Wait until the consensus surface is up so the header is fully settled.
    await waitFor(() =>
      expect(screen.getByTestId("extraction-consensus-area")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /^compare$/i }),
    ).not.toBeInTheDocument();
  });
});
