/**
 * Paging to the next article must not paint the PREVIOUS run's form (2026-09-05).
 *
 * The extraction screen stays mounted across an article change (the J/K pager
 * only swaps the `:articleId` route param). `useExtractionSession` keeps the
 * previous article's `session` until the new `POST /api/v1/hitl/sessions`
 * resolves, so in the window where the page bootstrap has already settled but
 * the session open has not, `activeRunId` / `runDetail` — and therefore the
 * entity types, instances and values derived from them — still describe the
 * PREVIOUS run. Rendering that as 'ready' puts the previous article's form under
 * the new article's header, and autosave writes into the previous run.
 *
 * The gate (`resolveExtractionViewState`) must treat an in-flight session open
 * as 'loading'. Harness cloned from ExtractionFullScreen.nextArticle.test.tsx.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
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

// Two-article worklist so "J" has somewhere to go. The article id echoes back,
// so paging swaps the header without touching the (project-level) template.
vi.mock("@/services/extractionDataService", () => ({
  loadExtractionPhase1: vi.fn(async (articleId: string) => ({
    ok: true,
    data: {
      article: { id: articleId, title: `Article ${articleId}`, project_id: "p1" },
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
      getUser: async () => ({ data: { user: { id: "reviewer-1" } }, error: null }),
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

vi.mock("@/integrations/api", () => ({
  apiClient: vi.fn(async () => ({})),
}));

import { SidebarProvider } from "@/contexts/SidebarContext";
import ExtractionFullScreen from "@/pages/ExtractionFullScreen";
import { apiClient } from "@/integrations/api";
import { pages } from "@/lib/copy/pages";

/** One field per article, so the rendered label names the run on screen. */
function entityTypes(label: string) {
  return [
    {
      id: "et-1",
      name: "source_of_data",
      label: "Section",
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
          label,
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
}

function runView(runId: string, articleId: string, fieldLabel: string) {
  return {
    run: {
      id: runId,
      project_id: "p1",
      article_id: articleId,
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
    entity_types: entityTypes(fieldLabel),
    instances: [
      {
        id: `inst-${runId}`,
        project_id: "p1",
        article_id: articleId,
        template_id: "tpl-1",
        entity_type_id: "et-1",
        parent_instance_id: null,
        label: "Section",
        sort_order: 0,
        metadata: {},
        created_by: "u-1",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    current_values: [],
  };
}

const VIEWS: Record<string, ReturnType<typeof runView>> = {
  "run-a1": runView("run-a1", "a1", "First article field"),
  "run-a2": runView("run-a2", "a2", "Second article field"),
};

/**
 * How the SECOND article's session open behaves. "hang" holds it in flight
 * (the window the loader has to cover); "reject" is the failure ordering —
 * a 403/404/5xx on the new article after paging.
 */
let sessionA2Mode: "hang" | "reject" = "hang";
/** Resolver for the held-open promise, so a test can land it on demand. */
let releaseSessionA2: (() => void) | undefined;

function mockApi() {
  vi.mocked(apiClient).mockImplementation(
    async (url: string, options?: { body?: object }) => {
      if (url === "/api/v1/hitl/sessions") {
        const body = options?.body as { article_id?: string } | undefined;
        const articleId = body?.article_id ?? "";
        const payload = {
          run_id: `run-${articleId}`,
          kind: "extraction",
          project_template_id: "tpl-1",
          instances_by_entity_type: { "et-1": `inst-run-${articleId}` },
        };
        if (articleId === "a2") {
          if (sessionA2Mode === "reject") throw new Error("Session open failed: 403");
          await new Promise<void>((resolve) => {
            releaseSessionA2 = resolve;
          });
        }
        return payload;
      }
      const viewMatch = /^\/api\/v1\/runs\/([^/]+)\/view$/.exec(url);
      if (viewMatch) return VIEWS[viewMatch[1]];
      if (url.includes("/finalized-run")) return null;
      if (url.includes("/reviewers")) return { reviewers: [] };
      if (url.includes("/suggestions")) return { suggestions: [], count: 0 };
      if (url.includes("/files") || url.includes("/text-blocks")) return [];
      return {};
    },
  );
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="probe-location">{loc.pathname}</div>;
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects/p1/extraction/a1"]}>
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

/** Drain microtasks AND one macrotask so every settled promise chain lands. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("ExtractionFullScreen — paging to the next article", () => {
  beforeEach(() => {
    sessionA2Mode = "hang";
    releaseSessionA2 = undefined;
    mockApi();
  });

  afterEach(() => {
    // Free the suspended session-open frame if an assertion threw before the
    // test released it. No spies here, so there is nothing to restore.
    releaseSessionA2?.();
  });

  it("shows the loader — not the previous run's form — while the new article's session opens", async () => {
    renderPage();
    expect(await screen.findByText("First article field")).toBeInTheDocument();

    // "J" — the worklist pager. Same route element, new :articleId.
    await userEvent.keyboard("j");
    await waitFor(() =>
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/projects/p1/extraction/a2",
      ),
    );

    // The bootstrap read for a2 resolves immediately; only the session open is
    // still in flight. Nothing left to settle — whatever renders now is what a
    // reviewer sees.
    await flush();

    expect(screen.queryByText("First article field")).not.toBeInTheDocument();
    expect(screen.getByText(pages.extractionScreenLoading)).toBeInTheDocument();

    // Once the session for a2 lands, the new article's own form takes over.
    releaseSessionA2?.();
    expect(await screen.findByText("Second article field")).toBeInTheDocument();
  });

  it("surfaces the run error — not the previous run's form — when the new article's session open FAILS", async () => {
    // The failure ordering. `useExtractionSession` sets loading=false and
    // error=<msg> but, before this fix, kept the PREVIOUS article's `session`.
    // `activeRunId` therefore still pointed at run-a1, whose RunView is still
    // in the TanStack cache, so the page rendered a1's form under a2's header
    // AND swallowed the session error entirely — no message, no retry.
    sessionA2Mode = "reject";
    renderPage();
    expect(await screen.findByText("First article field")).toBeInTheDocument();

    await userEvent.keyboard("j");
    await waitFor(() =>
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/projects/p1/extraction/a2",
      ),
    );
    await flush();

    // The previous article's form must be gone, and the failure must be
    // visible with a retry rather than silently masked.
    expect(screen.queryByText("First article field")).not.toBeInTheDocument();
    expect(
      screen.getByText(pages.extractionScreenRunErrorTitle),
    ).toBeInTheDocument();
  });

  it("still flushes a pending edit against the PREVIOUS run when the article changes", async () => {
    // Clearing the session drops `activeRunId` to null, which re-keys
    // useAutoSaveProposals' run-switch flush (effect 2). That cleanup runs
    // BEFORE the ref-sync effect, so performSave must still capture run-a1 —
    // if it instead bailed on the null run, a mid-debounce edit would be lost.
    // Deliberately no wait for the 600ms debounce: only the flush can save it.
    renderPage();
    expect(await screen.findByText("First article field")).toBeInTheDocument();

    await userEvent.type(screen.getAllByRole("textbox")[0], "pending edit");
    await userEvent.keyboard("j");

    await waitFor(() =>
      expect(vi.mocked(apiClient)).toHaveBeenCalledWith(
        "/api/v1/runs/run-a1/decisions",
        expect.anything(),
      ),
    );
  });
});
