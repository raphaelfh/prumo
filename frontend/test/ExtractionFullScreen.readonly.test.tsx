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
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ userId: "reviewer-1" }),
}));

// useModelManagement reads the signed-in user from
// AuthContext; the harness has no real AuthProvider.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "reviewer-1", email: "reviewer@test.local" },
    session: null,
    loading: false,
  }),
}));

vi.mock("@/hooks/shared/useComparisonPermissions", () => ({
  useComparisonPermissions: vi.fn(),
}));

// Worklist (header pager + next-article) and the reader's DOI lookup read
// `articles` through the baselined PostgREST path; the stub serves both.
vi.mock("@/integrations/supabase/client", async () => {
  const { makeSupabaseClientMock } = await import("./helpers/runScreenFixtures");
  return {
    supabase: makeSupabaseClientMock({ articles: [{ id: "a1", title: "Test article" }] }),
  };
});

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

import { useComparisonPermissions } from "@/hooks/shared/useComparisonPermissions";
import { renderExtractionPage } from "./helpers/runScreenRender";
import { apiClient } from "@/integrations/api";
import {
  ARBITRATOR,
  BLIND_PERMISSIONS,
  extractionApi,
  makeDecision,
  makeRunView,
  sourceOfDataForm,
} from "./helpers/runScreenFixtures";

const FINALIZED_RUN_VIEW = makeRunView({
  run: { stage: "finalized", status: "completed" },
  ...sourceOfDataForm(),
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
  // The viewer's own draft — must NOT surface on a published run.
  current_values: [
    {
      instance_id: "i1",
      field_id: "f1",
      value: { value: "MY-DRAFT" },
      decision: "edit",
    },
  ],
});

const mockedPermissions = vi.mocked(useComparisonPermissions);

describe("ExtractionFullScreen — finalized (published, read-only)", () => {
  beforeEach(() => {
    mockedPermissions.mockReturnValue(BLIND_PERMISSIONS);
    vi.mocked(apiClient).mockImplementation(
      extractionApi({
        view: () => FINALIZED_RUN_VIEW,
        routes: (url) =>
          url.includes("/finalized-run")
            ? { id: "run-1", stage: "finalized", status: "completed", template_id: "tpl-1" }
            : undefined,
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("published run renders read-only with published values", async () => {
    renderExtractionPage();

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
  // Identity-granted arbitrator (ARBITRATOR): canCompare's data preconditions
  // all hold, so only the D6 stage guard can hide the toggle.
  function mockStageView(stage: string) {
    vi.mocked(apiClient).mockImplementation(
      extractionApi({
        view: () =>
          makeRunView({
            ...FINALIZED_RUN_VIEW,
            run: { ...FINALIZED_RUN_VIEW.run, stage, status: "running" },
            published_states: [],
            current_values: [],
            peers_revealed: true,
            // Two divergent peer decisions: decisionsByCoord.size > 0.
            decisions: [
              makeDecision({ id: "dec-a", reviewer_id: "peer-a", value: { value: "Yes" } }),
              makeDecision({ id: "dec-b", reviewer_id: "peer-b", value: { value: "No" } }),
            ],
          }),
      }),
    );
  }

  beforeEach(() => {
    mockedPermissions.mockReturnValue(ARBITRATOR);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extract stage (positive control): the Compare toggle renders", async () => {
    mockStageView("extract");
    renderExtractionPage();
    expect(
      await screen.findByRole("button", { name: /^compare$/i }),
    ).toBeInTheDocument();
  });

  it("consensus stage: no Compare toggle — the resolve table is the only surface", async () => {
    mockStageView("consensus");
    renderExtractionPage();
    // Wait until the consensus surface is up so the header is fully settled.
    await waitFor(() =>
      expect(screen.getByTestId("extraction-consensus-area")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /^compare$/i }),
    ).not.toBeInTheDocument();
  });

  // The review-table spec (2026-09-14 §§13/15.1) docks the reader open at
  // desktop widths for the editable review workspace only. The setup mock
  // reports every media query unmatched (= below desktop), which would make
  // a "stays collapsed" assertion vacuous — so these cases report desktop.
  describe("source panel default at desktop width", () => {
    beforeEach(() => {
      vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
        matches: query === "(min-width: 1024px)",
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }));
    });

    const sourcePanelToggle = () =>
      screen.findByRole("button", { name: /toggle source panel/i });

    it("extract stage (positive control): the reader opens docked", async () => {
      mockStageView("extract");
      renderExtractionPage();
      await waitFor(async () =>
        expect(await sourcePanelToggle()).toHaveAttribute("aria-pressed", "true"),
      );
    });

    it("consensus stage: the reader stays collapsed", async () => {
      mockStageView("consensus");
      renderExtractionPage();
      await waitFor(() =>
        expect(screen.getByTestId("extraction-consensus-area")).toBeInTheDocument(),
      );
      expect(await sourcePanelToggle()).toHaveAttribute("aria-pressed", "false");
    });
  });
});
