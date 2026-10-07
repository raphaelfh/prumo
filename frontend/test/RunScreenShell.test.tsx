/**
 * The run screen chrome both kinds render: header compound, ⌘K palette,
 * pager, kebab, reveal and reopen affordances. Driven by the REAL lifecycle
 * hook over a RunView fixture; only the transport and the app-wide
 * notification plumbing are stubbed.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/api", () => ({ apiClient: vi.fn() }));
vi.mock("@/services/hitlConfigService", () => ({ setManagerReviewVisibility: vi.fn() }));
vi.mock("@/hooks/runs/useExpectedReviewerCount", () => ({ useExpectedReviewerCount: () => 1 }));
// Utility mounts NotificationCenter, whose import graph reaches the supabase
// client; it makes no supabase call here. Its AI-batch hooks are not under test.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) } },
}));
vi.mock("@/hooks/useAiBatchJobSync", () => ({ useAiBatchJobSync: vi.fn() }));
vi.mock("@/hooks/extraction/useExtractionBatches", () => ({
  useCancelBatch: () => ({ mutate: vi.fn(), isPending: false }),
  useBatchDetail: () => ({ data: undefined }),
}));
vi.mock("@/components/extraction/batch/BatchDetailsSheet", () => ({ BatchDetailsSheet: () => null }));
// The reader pulls in pdfjs worker/canvas globals that crash jsdom — stub the
// component, keep the engine-free core store.
vi.mock("@prumo/pdf-viewer", async () => {
  const core = await vi.importActual<typeof import("@/pdf-viewer/core")>("@/pdf-viewer/core");
  return {
    PrumoPdfViewer: () => <div data-testid="pdf-viewer-stub">PDF</div>,
    articleFileSourceFromStorageKey: () => ({ kind: "lazy" as const, load: async () => ({ kind: "url" as const, url: "stub://" }) }),
    createViewerStore: core.createViewerStore,
    subscribeReaderLocate: core.subscribeReaderLocate,
  };
});

import { apiClient } from "@/integrations/api";
import { setManagerReviewVisibility } from "@/services/hitlConfigService";
import { RunScreenShell } from "@/components/runs/RunScreenShell";
import { SidebarProvider } from "@/contexts/SidebarContext";
import { useRunLifecycleScreen, type RunWorklist } from "@/hooks/runs/useRunLifecycleScreen";
import { useRunReader } from "@/hooks/runs/useRunReader";
import type { RunViewResponse } from "@/hooks/runs/types";
import type { RunScreenKind } from "@/lib/runs/runScreenKind";
import { ARBITRATOR, BLIND_REVIEWER, makeRunView } from "./helpers/runViewFixture";

// cmdk scrolls the active item into view, which jsdom does not implement.
Element.prototype.scrollIntoView = vi.fn();

const ARTICLES = [
  { id: "art-1", title: "Article 1" },
  { id: "art-2", title: "Article 2" },
  { id: "art-3", title: "Article 3" },
];

interface HarnessProps {
  kind: RunScreenKind;
  view: RunViewResponse;
  permissions: typeof BLIND_REVIEWER;
  worklist: RunWorklist;
}

function Harness({ kind, view, permissions, worklist }: HarnessProps) {
  const kindTerms =
    kind === "extraction"
      ? ({ kind, formProgress: { isComplete: true, completed: 1, total: 1 } } as const)
      : ({ kind } as const);
  const lifecycle = useRunLifecycleScreen({
    ...kindTerms,
    projectId: "p1",
    runId: view.run.id,
    runDetail: view,
    permissions,
    currentUserId: "reviewer-1",
    saveNow: async () => undefined,
    goToNextArticle: worklist.goToNextArticle,
    requiredCoords: [],
    refetchSession: async () => undefined,
  });
  const reader = useRunReader(false);
  return (
    <RunScreenShell
      lifecycle={lifecycle}
      runDetail={view}
      permissions={permissions}
      currentUserId="reviewer-1"
      worklist={worklist}
      reader={reader}
      projectId="p1"
      articleId={worklist.currentId}
      title="Article title"
      titleAdornment={<span data-testid="title-adornment" />}
      progress={{ completed: 0, total: 0, pct: 0 }}
      save={{ state: "idle", lastSavedAt: null }}
      ai={{ pendingCount: 0, canExtract: false, extracting: false, onExtract: vi.fn(), onOpenSuggestions: vi.fn() }}
      formPanel={<div data-testid="form-panel" />}
      consensus={null}
    />
  );
}

function makeWorklist(currentId = "art-2", articles = ARTICLES): RunWorklist {
  return {
    articles,
    isLoading: false,
    error: null,
    currentId,
    exitRoute: "/projects/p1",
    goToArticle: vi.fn(),
    goToNextArticle: vi.fn(),
    exit: vi.fn(),
  };
}

function renderShell(
  kind: RunScreenKind,
  {
    view = makeRunView(),
    permissions = BLIND_REVIEWER,
    worklist = makeWorklist(),
  }: Partial<HarnessProps> = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SidebarProvider>
          <Harness kind={kind} view={view} permissions={permissions} worklist={worklist} />
        </SidebarProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { worklist };
}

beforeEach(() => {
  vi.mocked(apiClient).mockImplementation(async (url: string) =>
    url.endsWith("/reviewers") ? { reviewers: [] } : [],
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe.each(["extraction", "qa"] as const)("RunScreenShell (%s)", (kind) => {
  it("folds help into the kebab at narrow widths and offers no feedback item", async () => {
    // jsdom measures the header as zero-width, so it always reads as narrow.
    renderShell(kind);
    await userEvent.click(screen.getByRole("button", { name: /more/i }));
    expect(screen.getByRole("menuitem", { name: /help and shortcuts/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /send feedback/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Export Data/i)).not.toBeInTheDocument();
  });

  it("surfaces notifications inline and renders the screen's title adornment", () => {
    renderShell(kind);
    expect(screen.getByRole("button", { name: /notifications/i })).toBeInTheDocument();
    expect(screen.getByTestId("title-adornment")).toBeInTheDocument();
  });

  it("⌘K offers 'View run status', which opens the status popover", async () => {
    renderShell(kind);
    expect(screen.getByTestId("run-stage-current")).toBeInTheDocument();
    // jsdom's userAgent is not a Mac, so ⌘K is Ctrl+K here.
    await userEvent.keyboard("{Control>}k{/Control}");
    await userEvent.click(await screen.findByText("View run status"));
    expect(await screen.findByTestId("run-status-popover")).toBeInTheDocument();
  });

  it("the primary button label carries no parenthetical", () => {
    renderShell(kind);
    const btn = screen.getByRole("button", { name: /^finish (extraction|assessment)/i });
    expect(btn.textContent).not.toMatch(/\(.*\)/);
  });

  describe("reveal (status popover)", () => {
    it("is absent unless the caller is a blind manager", async () => {
      renderShell(kind);
      await userEvent.click(screen.getByTestId("run-stage-current"));
      await screen.findByTestId("run-status-popover");
      expect(screen.queryByRole("button", { name: /reveal reviewers/i })).toBeNull();
    });

    it("lets a blind manager reveal reviewers", async () => {
      vi.mocked(setManagerReviewVisibility).mockResolvedValue({} as never);
      renderShell(kind, { permissions: { ...BLIND_REVIEWER, userRole: "manager" } });
      await userEvent.click(screen.getByTestId("run-stage-current"));
      await userEvent.click(await screen.findByRole("button", { name: /reveal reviewers/i }));
      expect(setManagerReviewVisibility).toHaveBeenCalledWith(
        "p1",
        kind === "qa" ? "quality_assessment" : "extraction",
        true,
      );
    });
  });

  describe("reopen to extract (kebab)", () => {
    const consensus = () => makeRunView({ run: { stage: "consensus" } });
    const item = kind === "qa" ? /reopen assessment/i : /reopen extraction/i;

    it("an arbitrator in consensus gets the item, which asks for confirmation", async () => {
      renderShell(kind, { view: consensus(), permissions: ARBITRATOR });
      await userEvent.click(screen.getByRole("button", { name: /more/i }));
      await userEvent.click(await screen.findByRole("menuitem", { name: item }));
      expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    });

    it("a reviewer does not", async () => {
      renderShell(kind, { view: consensus() });
      await userEvent.click(screen.getByRole("button", { name: /more/i }));
      expect(screen.queryByRole("menuitem", { name: item })).not.toBeInTheDocument();
    });
  });

  describe("article pager", () => {
    it("prev and next page through the worklist", async () => {
      const { worklist } = renderShell(kind);
      await userEvent.click(screen.getByRole("button", { name: /previous article/i }));
      expect(worklist.goToArticle).toHaveBeenCalledWith("art-1");
      await userEvent.click(screen.getByRole("button", { name: /next article/i }));
      expect(worklist.goToArticle).toHaveBeenCalledWith("art-3");
    });

    it("the ends are aria-disabled, staying focusable", () => {
      renderShell(kind, { worklist: makeWorklist("art-1") });
      expect(screen.getByRole("button", { name: /previous article/i })).toHaveAttribute("aria-disabled", "true");
    });

    it("renders no pager for a single article", () => {
      renderShell(kind, { worklist: makeWorklist("art-1", [ARTICLES[0]]) });
      expect(screen.queryByRole("button", { name: /previous article/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /next article/i })).not.toBeInTheDocument();
    });
  });
});

describe("RunScreenShell — the kind-specific palette", () => {
  it.each([
    ["extraction", true],
    ["qa", false],
  ] as const)("%s: ⌘K offers the reopen items: %s", async (kind, offered) => {
    renderShell(kind, { view: makeRunView({ run: { stage: "finalized" } }) });
    await userEvent.keyboard("{Control>}k{/Control}");
    const palette = (await screen.findByText("View run status")).closest("[cmdk-root]") as HTMLElement;
    expect(within(palette).queryByText(/reopen for revision/i) !== null).toBe(offered);
  });
});
