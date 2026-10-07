/**
 * QualityAssessmentFullScreen — the assessment form's page-level chrome: the
 * finalized read-only state, accepting an AI suggestion (the one accept path
 * both run screens share, through useRunValues) and the header suggestion
 * locate. What the form SHOWS per stage is useRunValues' contract, tested at
 * that seam (test/hooks/useRunValues.test.tsx).
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` is hoisted PER MODULE, so every suite that renders this page must
// declare the full set itself. Only the factory BODIES are shared — pulled in
// with `await import`, the one form that is safe against that hoisting.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ userId: "qa-test-reviewer-id" }),
}));

// SectionAIExtractButton's useSectionExtraction reads the signed-in user from
// AuthContext; the harness has no real AuthProvider.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "qa-test-reviewer-id" }, session: null, loading: false }),
}));

vi.mock("@/hooks/shared/useComparisonPermissions", () => ({
  useComparisonPermissions: vi.fn(),
}));

// Mutable roster consumed by the supabase.rpc("get_project_members") stub.
// Hoisted state has to be created here, not in the helper. Default [] keeps the
// role-derived denominator at the participant count.
const membersFixture = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { makeSupabaseClientMock } = await import("./helpers/runScreenFixtures");
  return { supabase: makeSupabaseClientMock({ members: membersFixture, userId: "qa-test-reviewer-id" }) };
});

// The PDF viewer pulls in worker/canvas globals (pdfjs/DOMMatrix) not worth
// wiring for a unit test — stub the component but keep the REAL (engine-free)
// store wiring from the `core` subpath, or `subscribeReaderLocate` is undefined
// and the page TypeErrors at render.
vi.mock("@prumo/pdf-viewer", async () => {
  const core =
    await vi.importActual<typeof import("@/pdf-viewer/core")>("@/pdf-viewer/core");
  return {
    PrumoPdfViewer: () => <div data-testid="qa-pdf-viewer-stub">PDF</div>,
    articleFileSourceFromStorageKey: (storageKey: string) => ({
      kind: "lazy" as const,
      load: async () => ({ kind: "url" as const, url: `stub://${storageKey}` }),
    }),
    createViewerStore: core.createViewerStore,
    subscribeReaderLocate: core.subscribeReaderLocate,
  };
});

vi.mock("@/integrations/api", async () => {
  const { qaApi } = await import("./helpers/runScreenFixtures");
  return { apiClient: vi.fn(qaApi()) };
});

import { useComparisonPermissions } from "@/hooks/shared/useComparisonPermissions";
import { apiClient } from "@/integrations/api";

import {
  BLIND_PERMISSIONS,
  makeDecision,
  makeQaRunView,
  qaApi,
} from "./helpers/runScreenFixtures";
import { renderQaPage } from "./helpers/runScreenRender";

// A per-test apiClient override answers its own URLs and hands every other
// one to the shared default (template lists, files, suggestions).
const answerByDefault = qaApi();

const mockedPermissions = vi.mocked(useComparisonPermissions);

describe("QualityAssessmentFullScreen — finalized (published, read-only)", () => {
  beforeEach(() => {
    mockedPermissions.mockReturnValue(BLIND_PERMISSIONS);
    // Finalized run-view variant: stale proposal 'PY' for inst-1/f-1 must NOT
    // hydrate; the published row 'Y' must (spec 2026-07-02 D3).
    vi.mocked(apiClient).mockImplementation(async (url: string) => {
      if (url === "/api/v1/hitl/sessions") {
        return {
          run_id: "run-1",
          kind: "quality_assessment",
          project_template_id: "tpl-1",
          instances_by_entity_type: { "et-1": "inst-1" },
        };
      }
      if (url === "/api/v1/runs/run-1/view") {
        return makeQaRunView({
          run: { stage: "finalized", status: "completed" },
          proposals: [
            {
              id: "p-stale",
              run_id: "run-1",
              instance_id: "inst-1",
              field_id: "f-1",
              source: "human",
              source_user_id: "qa-test-reviewer-id",
              proposed_value: { value: "PY" },
              confidence_score: null,
              rationale: null,
              created_at: new Date().toISOString(),
            },
          ],
          published_states: [
            {
              id: "ps-1",
              run_id: "run-1",
              instance_id: "inst-1",
              field_id: "f-1",
              value: { value: "Y" },
              published_at: new Date().toISOString(),
              published_by: "u-1",
              version: 1,
            },
          ],
        });
      }
      if (url.includes("/suggestions")) {
        return { suggestions: [], count: 0 };
      }
      if (url.includes("/files") || url.includes("/text-blocks")) {
        return [];
      }
      return answerByDefault(url);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finalized: shows the published banner with a reopen button, hides edit chrome", async () => {
    renderQaPage();
    expect(await screen.findByTestId("qa-finalized-badge")).toBeInTheDocument();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(screen.getByTestId("qa-reopen-button")).toBeInTheDocument();
    // Header AI trigger stays absent (pendingCount forced to 0 +
    // canExtract via isRunEditable) — testid pin, since the menu trigger's
    // accessible name is no longer "Extract with AI":
    expect(screen.queryByTestId("run-ai-actions")).not.toBeInTheDocument();
    // Per-domain AI-extract hidden by the provider:
    await screen.findByTestId("qa-domain-participants");
    expect(screen.queryByTestId("section-ai-extract-et-1")).not.toBeInTheDocument();
    // The select trigger is disabled (FieldInput consumes the provider):
    const domain = screen.getByTestId("qa-domain-participants");
    await waitFor(() => expect(within(domain).getByText("Y")).toBeInTheDocument());
    const trigger = within(domain).getByText("Y").closest("button");
    expect(trigger).toBeDisabled();
  });
});
describe("QualityAssessmentFullScreen — accepting an AI suggestion", () => {
  beforeEach(() => {
    mockedPermissions.mockReturnValue(BLIND_PERMISSIONS);
    // The reviewer already answered inst-1/f-1 ("N"); the AI proposes "Y".
    vi.mocked(apiClient).mockImplementation(async (url: string, opts?: { method?: string; body?: unknown }) => {
      if (url === "/api/v1/hitl/sessions") {
        return {
          run_id: "run-1",
          kind: "quality_assessment",
          project_template_id: "tpl-1",
          instances_by_entity_type: { "et-1": "inst-1" },
        };
      }
      if (url === "/api/v1/runs/run-1/view") {
        return makeQaRunView({
          decisions: [
            makeDecision({ id: "dec-own-1", reviewer_id: "qa-test-reviewer-id", instance_id: "inst-1", field_id: "f-1", value: { value: "N" } }),
          ],
          current_values: [{ instance_id: "inst-1", field_id: "f-1", value: { value: "N" }, decision: "edit" }],
        });
      }
      if (url === "/api/v1/runs/run-1/decisions" && opts?.method === "POST") {
        return makeDecision({ id: "dec-own-2", reviewer_id: "qa-test-reviewer-id", instance_id: "inst-1", field_id: "f-1", value: { value: "Y" }, proposal_record_id: "sug-1", ...(opts.body as object) });
      }
      if (url.includes("/suggestions") && !url.includes("history")) {
        return {
          suggestions: [
            {
              id: "sug-1",
              run_id: "run-1",
              instance_id: "inst-1",
              field_id: "f-1",
              proposed_value: { value: "Y" },
              confidence_score: 0.9,
              rationale: "",
              created_at: new Date().toISOString(),
              evidence: [],
            },
          ],
          count: 1,
        };
      }
      if (url.includes("/files") || url.includes("/text-blocks")) {
        return [];
      }
      return answerByDefault(url);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records the acceptance at once as the reviewer's linked decision, guarded on their current one", async () => {
    renderQaPage();
    const domain = await screen.findByTestId("qa-domain-participants");
    await userEvent.click(await within(domain).findByRole("button", { name: "Accept suggestion" }));
    await waitFor(() =>
      expect(vi.mocked(apiClient)).toHaveBeenCalledWith(
        "/api/v1/runs/run-1/decisions",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            instance_id: "inst-1",
            field_id: "f-1",
            decision: "edit",
            proposal_record_id: "sug-1",
            value: { value: "Y" },
            expected_current_decision_id: "dec-own-1",
          }),
        }),
      ),
    );
    // The confirmed decision, not a local status flip, marks the suggestion accepted.
    expect(await within(domain).findByRole("button", { name: "Suggestion accepted" })).toBeInTheDocument();
  });
});
describe("QualityAssessmentFullScreen — header suggestion locate", () => {
  // Self-contained fixture (the finalized describe's restoreAllMocks wipes
  // the factory apiClient implementation for everything after it).
  beforeEach(() => {
    // jsdom has no scrollIntoView; the section registry calls it on the domain's wrapper.
    Element.prototype.scrollIntoView = vi.fn();
    mockedPermissions.mockReturnValue(BLIND_PERMISSIONS);
    vi.mocked(apiClient).mockImplementation(async (url: string) => {
      if (url === "/api/v1/hitl/sessions") {
        return {
          run_id: "run-1",
          kind: "quality_assessment",
          project_template_id: "tpl-1",
          instances_by_entity_type: { "et-1": "inst-1" },
        };
      }
      if (url === "/api/v1/runs/run-1/view") {
        return makeQaRunView();
      }
      if (url.includes("/suggestions") && !url.includes("history")) {
        // One pending AI suggestion for inst-1/f-1 (no status → pending).
        return {
          suggestions: [
            {
              id: "sug-1",
              run_id: "run-1",
              instance_id: "inst-1",
              field_id: "f-1",
              proposed_value: { value: "Y" },
              confidence_score: 0.9,
              rationale: "",
              created_at: new Date().toISOString(),
              evidence: [],
            },
          ],
          count: 1,
        };
      }
      if (url.includes("/files") || url.includes("/text-blocks")) {
        return [];
      }
      return answerByDefault(url);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function reviewPendingSuggestions() {
    const trigger = await screen.findByTestId("run-ai-actions");
    await waitFor(() => expect(trigger).toHaveTextContent("1"));
    await userEvent.click(trigger);
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /review 1 pending/i }),
    );
  }

  it("Review-pending menu item scrolls to the domain of the first pending suggestion", async () => {
    renderQaPage();
    const domain = await screen.findByTestId("qa-domain-participants");
    await reviewPendingSuggestions();
    // inst-1 belongs to et-1 (session.instancesByEntityType reverse lookup); the
    // section the page registered for et-1 is the domain's wrapper.
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts).toContain(
      domain.parentElement,
    );
  });

  it("Review-pending menu item opens the domain when it is closed", async () => {
    renderQaPage();
    const domain = await screen.findByTestId("qa-domain-participants");
    const row = "qa-field-row-q1_1_appropriate_data_sources";
    // Precondition: the first domain renders open, showing the suggestion's row.
    expect(await within(domain).findByTestId(row)).toBeInTheDocument();
    await userEvent.click(
      within(domain).getByRole("button", { name: /participants/i, expanded: true }),
    );
    await waitFor(() => expect(within(domain).queryByTestId(row)).not.toBeInTheDocument());

    await reviewPendingSuggestions();

    expect(await within(domain).findByTestId(row)).toBeInTheDocument();
    expect(
      within(domain).getByRole("button", { name: /participants/i, expanded: true }),
    ).toBeInTheDocument();
  });
});
