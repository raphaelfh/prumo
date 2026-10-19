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

// The page computes its AI kickoff gate from the project role; a reviewer
// unless a case says otherwise.
const memberRole = vi.hoisted(() => ({
  current: { role: "reviewer" as string | null, isManager: false, loading: false },
}));
vi.mock("@/hooks/useProjectMemberRole", () => ({
  useProjectMemberRole: () => memberRole.current,
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
  instance,
  makeDecision,
  makeRunView,
  section,
  sourceOfDataForm,
  textField,
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

describe("ExtractionFullScreen — AI kickoff controls follow the project role", () => {
  // A repeating group with one child section: the group's selector carries
  // the entry-level AI actions, the child accordion the per-section button.
  const MODELS_VIEW = makeRunView({
    entity_types: [
      section({ id: "et-models", name: "prediction_models", label: "Prediction Models", cardinality: "many", entry_label: "model" }),
      section({
        id: "et-dev",
        name: "model_development",
        label: "Model Development",
        parent_entity_type_id: "et-models",
        sort_order: 1,
        fields: [textField("f-dev", "Notes")],
      }),
    ],
    instances: [
      instance("m-a", "et-models", { label: "Cox Model" }),
      instance("d-a", "et-dev", { parent_instance_id: "m-a", label: "Cox development" }),
    ],
  });

  const pageAIButton = () => screen.queryByTestId("run-ai-actions");
  const selectorAIActions = () =>
    screen.queryByRole("button", { name: /extract model entries automatically with ai/i });
  const sectionAIButton = () => screen.queryByTestId("section-ai-extract-et-dev");

  beforeEach(() => {
    mockedPermissions.mockReturnValue(BLIND_PERMISSIONS);
    vi.mocked(apiClient).mockImplementation(extractionApi({ view: () => MODELS_VIEW }));
  });

  afterEach(() => {
    memberRole.current = { role: "reviewer", isManager: false, loading: false };
    vi.restoreAllMocks();
  });

  it.each([
    ["the role is still loading", { role: null, loading: true }],
    ["a stale role is reloading", { role: "reviewer", loading: true }],
    ["the role lookup found no membership", { role: null, loading: false }],
    ["the member is a viewer", { role: "viewer", loading: false }],
  ])("hides every AI kickoff control while %s", async (_case, state) => {
    memberRole.current = { ...state, isManager: false };
    renderExtractionPage();

    // The form is up (its child section rendered) before asserting absence.
    expect((await screen.findAllByText("Model Development")).length).toBeGreaterThan(0);
    expect(pageAIButton()).not.toBeInTheDocument();
    expect(selectorAIActions()).not.toBeInTheDocument();
    expect(sectionAIButton()).not.toBeInTheDocument();
  });

  it("shows every AI kickoff control to a reviewer in the extract stage", async () => {
    memberRole.current = { role: "reviewer", isManager: false, loading: false };
    renderExtractionPage();

    expect(await screen.findByTestId("section-ai-extract-et-dev")).toBeInTheDocument();
    expect(selectorAIActions()).toBeInTheDocument();
    expect(pageAIButton()).toBeInTheDocument();
  });
});
