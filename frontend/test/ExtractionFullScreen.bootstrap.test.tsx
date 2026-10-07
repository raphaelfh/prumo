/**
 * How the extraction screen boots (ADR-0007: one read path).
 *
 * The screen opens its HITL session from (project, article) plus the project's
 * newest ACTIVE extraction template, read from the typed templates endpoint —
 * the same list, same order (created_at desc) and same pick as the
 * Configuration view's picker, so the two views can never split on which
 * template is "active" (the old split-picker bug). The article on screen is
 * named from the project's worklist; an article outside it renders the
 * not-found state with a Back affordance instead of opening a session, and a
 * project with no active extraction template bounces to the extraction tab.
 *
 * Harness cloned from ExtractionFullScreen.readonly.test.tsx.
 */
import { screen, waitFor, within } from "@testing-library/react";
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

vi.mock("@/hooks/shared/useComparisonPermissions", async () => {
  const { BLIND_PERMISSIONS } = await import("./helpers/runScreenFixtures");
  return { useComparisonPermissions: () => BLIND_PERMISSIONS };
});

vi.mock("@/integrations/supabase/client", async () => {
  const { makeSupabaseClientMock } = await import("./helpers/runScreenFixtures");
  return {
    supabase: makeSupabaseClientMock({
      articles: [
        { id: "a1", title: "First article" },
        { id: "a2", title: null },
      ],
    }),
  };
});

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

import { toast } from "sonner";
import { apiClient } from "@/integrations/api";
import { common } from "@/lib/copy/common";
import { pages } from "@/lib/copy/pages";
import { renderExtractionPage } from "./helpers/runScreenRender";
import { extractionApi, makeRunView, sourceOfDataForm } from "./helpers/runScreenFixtures";

const TEMPLATES_URL = "/api/v1/projects/p1/templates?kind=extraction";

// The endpoint lists every template of the kind, newest first, active or not.
// Only the newest ACTIVE one may open the session.
const TEMPLATES = [
  { id: "tpl-draft", name: "Draft", kind: "extraction", is_active: false },
  { id: "tpl-new", name: "CHARMS v2", kind: "extraction", is_active: true },
  { id: "tpl-old", name: "CHARMS v1", kind: "extraction", is_active: true },
];

const FORM = sourceOfDataForm({ required: false });
const RUN_VIEW = makeRunView({
  run: { template_id: "tpl-new" },
  entity_types: FORM.entity_types,
  instances: FORM.instances.map((i) => ({ ...i, template_id: "tpl-new" })),
});

function mockApi(templates: unknown[]) {
  vi.mocked(apiClient).mockImplementation(
    extractionApi({
      templates,
      view: () => RUN_VIEW,
      routes: (url) =>
        url === "/api/v1/hitl/sessions"
          ? {
              run_id: "run-1",
              kind: "extraction",
              project_template_id: "tpl-new",
              instances_by_entity_type: { "et-1": "i1" },
              run_view: RUN_VIEW,
            }
          : undefined,
    }),
  );
}

/** The bodies of every session open so far — the seam the template pick is read through. */
const sessionOpens = () =>
  vi
    .mocked(apiClient)
    .mock.calls.filter(([url]) => url === "/api/v1/hitl/sessions")
    .map(
      ([, options]) =>
        (options as { body: { project_id: string; article_id: string; project_template_id: string } })
          .body,
    );

/** The header's single identity slot (spec 2026-07-02). */
const breadcrumb = () => within(screen.getByRole("navigation", { name: "breadcrumb" }));

describe("ExtractionFullScreen — bootstrap through the API", () => {
  beforeEach(() => {
    // `vi.restoreAllMocks` leaves a `vi.fn()`'s call log alone: clear it so one
    // test's opens and toasts never count for the next.
    vi.mocked(apiClient).mockClear();
    vi.mocked(toast.error).mockClear();
    mockApi(TEMPLATES);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the session with the newest ACTIVE extraction template and names the article from the worklist", async () => {
    renderExtractionPage();
    expect(await screen.findByRole("textbox", { name: "Source of Data" })).toBeInTheDocument();

    const opens = sessionOpens();
    expect(opens.length).toBeGreaterThan(0);
    // Not the inactive newest row, not the older active one.
    for (const body of opens) {
      expect(body).toEqual({
        kind: "extraction",
        project_id: "p1",
        article_id: "a1",
        project_template_id: "tpl-new",
      });
    }
    expect(breadcrumb().getByText("First article")).toBeInTheDocument();
  });

  it("names an untitled article in the header instead of a blank", async () => {
    renderExtractionPage("/projects/p1/extraction/a2");
    expect(await screen.findByRole("textbox", { name: "Source of Data" })).toBeInTheDocument();
    expect(breadcrumb().getByText("Untitled article")).toBeInTheDocument();
  });

  it("renders the not-found state for an article outside the project's worklist", async () => {
    renderExtractionPage("/projects/p1/extraction/a-foreign");
    expect(await screen.findByText(pages.extractionScreenErrorLoad)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^back$/i })).toBeInTheDocument();
    // Not a redirect: the user stays on the route with the Back affordance.
    expect(screen.getByTestId("probe-location")).toHaveTextContent("/projects/p1/extraction/a-foreign");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("with no active extraction template: a toast, then back to the project's extraction tab", async () => {
    mockApi([TEMPLATES[0]]);
    renderExtractionPage();
    await waitFor(() =>
      expect(screen.getByTestId("probe-location")).toHaveTextContent("/projects/p1?tab=extraction"),
    );
    expect(toast.error).toHaveBeenCalledWith(common.errors_templateNotFound);
    // Nothing to open a session with.
    expect(sessionOpens()).toEqual([]);
  });

  // The bootstrap reads are TanStack queries now, so they refetch in the
  // background (focus, staleness). A refetch that fails keeps the rows the
  // screen opened with: it must not read as a failed bootstrap and throw the
  // reviewer out of a form mid-edit.
  it("keeps the open form when a background refetch of the templates fails", async () => {
    const { queryClient } = renderExtractionPage();
    expect(await screen.findByRole("textbox", { name: "Source of Data" })).toBeInTheDocument();

    const served = vi.mocked(apiClient).getMockImplementation()!;
    vi.mocked(apiClient).mockImplementation(async (url: string, ...rest) => {
      if (url === TEMPLATES_URL) throw new Error("network down");
      return served(url, ...rest);
    });
    await queryClient.refetchQueries({ type: "active" });
    // Precondition: the refetch really failed.
    await waitFor(() =>
      expect(
        queryClient.getQueryCache().findAll({ predicate: (q) => q.state.status === "error" }).length,
      ).toBeGreaterThan(0),
    );

    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByTestId("probe-location")).toHaveTextContent("/projects/p1/extraction/a1");
    expect(screen.getByRole("textbox", { name: "Source of Data" })).toBeInTheDocument();
  });
});
