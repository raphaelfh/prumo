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
import { screen, waitFor } from "@testing-library/react";
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

vi.mock("@/hooks/shared/useComparisonPermissions", () => ({
  useComparisonPermissions: vi.fn(),
}));

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

// Two reviewers disagreeing on the single required coord — the divergence the
// arbitrator resolves before Approve & finalize opens.
const DIVERGENT_DECISIONS = [
  makeDecision({ id: "dec-a", reviewer_id: "peer-a", value: { value: "Yes" } }),
  makeDecision({ id: "dec-b", reviewer_id: "peer-b", value: { value: "No" } }),
];

const RESOLVED_CONSENSUS = [makeConsensusDecision({ selected_decision_id: "dec-a" })];

function runView(overrides: RunViewOverrides = {}) {
  return makeRunView({
    ...sourceOfDataForm(),
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
  });
}

vi.mock("@/integrations/api", () => ({
  apiClient: vi.fn(async () => ({})),
}));

import { useComparisonPermissions } from "@/hooks/shared/useComparisonPermissions";
import { renderExtractionPage } from "./helpers/runScreenRender";
import { apiClient } from "@/integrations/api";
import {
  ARBITRATOR,
  BLIND_PERMISSIONS,
  extractionApi,
  makeConsensusDecision,
  makeDecision,
  makeRunView,
  sourceOfDataForm,
  type RunViewOverrides,
} from "./helpers/runScreenFixtures";

const mockedPermissions = vi.mocked(useComparisonPermissions);

function mockRun(view: ReturnType<typeof runView>) {
  vi.mocked(apiClient).mockImplementation(extractionApi({ view: () => view }));
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
    renderExtractionPage();
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
    renderExtractionPage("/projects/p1/extraction/a2");
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
    renderExtractionPage();
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
    renderExtractionPage("/projects/p1/extraction/a2");
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
