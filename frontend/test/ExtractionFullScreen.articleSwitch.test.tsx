/**
 * Paging to the next article must not paint the PREVIOUS run's form (2026-09-05).
 *
 * The extraction screen stays mounted across an article change (the [ / ] pager
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
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// Worklist (header pager + next-article) and the reader's DOI lookup read
// `articles` through the baselined PostgREST path; the stub serves both.
vi.mock("@/integrations/supabase/client", async () => {
  const { makeSupabaseClientMock } = await import("./helpers/runScreenFixtures");
  return {
    supabase: makeSupabaseClientMock(),
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

vi.mock("@/integrations/api", () => ({
  apiClient: vi.fn(async () => ({})),
}));

import { renderExtractionPage } from "./helpers/runScreenRender";
import { apiClient } from "@/integrations/api";
import { pages } from "@/lib/copy/pages";
import {
  extractionApi,
  instance,
  makeRunView,
  section,
  textField,
} from "./helpers/runScreenFixtures";

/** One field per article, so the rendered label names the run on screen. */
function runView(runId: string, articleId: string, fieldLabel: string) {
  return makeRunView({
    run: { id: runId, article_id: articleId },
    entity_types: [
      section({
        id: "et-1",
        name: "source_of_data",
        label: "Section",
        is_required: true,
        fields: [textField("f1", fieldLabel, { name: "source", is_required: true })],
      }),
    ],
    instances: [instance(`inst-${runId}`, "et-1", { article_id: articleId, label: "Section" })],
  });
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
    extractionApi({
      routes: async (url, options) => {
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
        return viewMatch ? VIEWS[viewMatch[1]] : undefined;
      },
    }),
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
    renderExtractionPage();
    expect(await screen.findByRole("textbox", {name: "First article field"})).toBeInTheDocument();

    // "]" — the worklist pager. Same route element, new :articleId.
    await userEvent.keyboard("]");
    await waitFor(() =>
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/projects/p1/extraction/a2",
      ),
    );

    // The bootstrap read for a2 resolves immediately; only the session open is
    // still in flight. Nothing left to settle — whatever renders now is what a
    // reviewer sees.
    await flush();

    expect(screen.queryByRole("textbox", {name: "First article field"})).not.toBeInTheDocument();
    expect(screen.getByText(pages.extractionScreenLoading)).toBeInTheDocument();

    // Once the session for a2 lands, the new article's own form takes over.
    releaseSessionA2?.();
    expect(await screen.findByRole("textbox", {name: "Second article field"})).toBeInTheDocument();
  });

  it("surfaces the run error — not the previous run's form — when the new article's session open FAILS", async () => {
    // The failure ordering. `useExtractionSession` sets loading=false and
    // error=<msg> but, before this fix, kept the PREVIOUS article's `session`.
    // `activeRunId` therefore still pointed at run-a1, whose RunView is still
    // in the TanStack cache, so the page rendered a1's form under a2's header
    // AND swallowed the session error entirely — no message, no retry.
    sessionA2Mode = "reject";
    renderExtractionPage();
    expect(await screen.findByRole("textbox", {name: "First article field"})).toBeInTheDocument();

    await userEvent.keyboard("]");
    await waitFor(() =>
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/projects/p1/extraction/a2",
      ),
    );
    await flush();

    // The previous article's form must be gone, and the failure must be
    // visible with a retry rather than silently masked.
    expect(screen.queryByRole("textbox", {name: "First article field"})).not.toBeInTheDocument();
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
    renderExtractionPage();
    expect(await screen.findByRole("textbox", {name: "First article field"})).toBeInTheDocument();

    const editor = screen.getByRole("textbox", {name: "First article field"});
    // jsdom reports every panel at (0,0); the split pane pointer handler
    // mistakes a synthetic click for its separator. Focus the real editor.
    act(() => editor.focus());
    await userEvent.type(editor, "pending edit", {skipClick: true});
    expect(screen.getByRole("textbox", {name: "First article field"})).toHaveValue("pending edit");
    await userEvent.keyboard("]");

    await waitFor(() =>
      expect(vi.mocked(apiClient)).toHaveBeenCalledWith(
        "/api/v1/runs/run-a1/decisions",
        expect.anything(),
      ),
    );
  });
});
