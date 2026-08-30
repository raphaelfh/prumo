/**
 * QualityAssessmentFullScreen — finalized read-only state, extract hydration
 * from current_values (D8), and the header suggestion locate.
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
  const { makeSupabaseClientMock } = await import("./helpers/qaFullScreenMocks");
  return { supabase: makeSupabaseClientMock(membersFixture) };
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

// Spy the DOM-scroll half of the header suggestion-locate pair (jsdom has no
// scrollIntoView); the key-parsing half stays real so the reverse lookup is
// covered end to end.
vi.mock("@/lib/runs/suggestionLocate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/runs/suggestionLocate")>(
    "@/lib/runs/suggestionLocate",
  );
  return { ...actual, scrollToSectionById: vi.fn(() => true) };
});

vi.mock("@/integrations/api", async () => {
  const { makeApiClientDefault } = await import("./helpers/qaFullScreenMocks");
  return { apiClient: vi.fn(makeApiClientDefault()) };
});

import { useComparisonPermissions } from "@/hooks/shared/useComparisonPermissions";
import { apiClient } from "@/integrations/api";

import {
  BLIND_PERMISSIONS,
} from "./helpers/qaFullScreenMocks";
import { renderPage } from "./helpers/qaFullScreenRender";

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
        return {
          run: {
            id: "run-1",
            project_id: "p1",
            article_id: "a1",
            template_id: "tpl-1",
            kind: "quality_assessment",
            version_id: "v-1",
            stage: "finalized",
            status: "completed",
            hitl_config_snapshot: {},
            parameters: {},
            results: {},
            created_at: new Date().toISOString(),
            created_by: "u-1",
          },
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
          decisions: [],
          consensus_decisions: [],
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
          entity_types: [],
          current_values: [],
        };
      }
      if (url.includes("/suggestions")) {
        return { suggestions: [], count: 0 };
      }
      if (url.includes("/files") || url.includes("/text-blocks")) {
        return [];
      }
      return {};
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finalized: form shows published values, not latest proposals", async () => {
    renderPage();
    const domain = await screen.findByTestId("qa-domain-participants");
    // Published code renders on the select trigger; the stale proposal does not.
    await waitFor(() => expect(within(domain).getByText("Y")).toBeInTheDocument());
    expect(within(domain).queryByText("PY")).not.toBeInTheDocument();
  });

  it("finalized: shows the published banner with a reopen button, hides edit chrome", async () => {
    renderPage();
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
describe("QualityAssessmentFullScreen — extract hydration from current_values (D8)", () => {
  beforeEach(() => {
    mockedPermissions.mockReturnValue(BLIND_PERMISSIONS);
    // Decision-backed run: proposals stay EMPTY — post-D8 the reviewer's
    // answers live in decisions, surfaced caller-scoped via current_values.
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
        return {
          run: {
            id: "run-1",
            project_id: "p1",
            article_id: "a1",
            template_id: "tpl-1",
            kind: "quality_assessment",
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
          decisions: [
            {
              id: "dec-own-1",
              run_id: "run-1",
              instance_id: "inst-1",
              field_id: "f-1",
              reviewer_id: "qa-test-reviewer-id",
              decision: "edit",
              proposal_record_id: null,
              value: { value: "Y" },
              rationale: null,
              created_at: new Date().toISOString(),
            },
          ],
          consensus_decisions: [],
          published_states: [],
          entity_types: [],
          current_values: [
            {
              instance_id: "inst-1",
              field_id: "f-1",
              value: { value: "Y" },
              decision: "edit",
            },
          ],
        };
      }
      if (url.includes("/suggestions")) {
        return { suggestions: [], count: 0 };
      }
      if (url.includes("/files") || url.includes("/text-blocks")) {
        return [];
      }
      return {};
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hydrates from current_values (not proposals) and does not re-post on mount", async () => {
    renderPage();
    const domain = await screen.findByTestId("qa-domain-participants");
    // The decision-backed value renders even though proposals is empty.
    await waitFor(() => expect(within(domain).getByText("Y")).toBeInTheDocument());
    // The autosave baseline derives from the SAME current_values map, so the
    // hydrated coord is clean — zero decision writes may fire on mount. The
    // hook only ever writes through its 600ms debounce, so the assertion must
    // wait PAST that window or it is vacuous (verified: with baselineValues
    // deliberately broken the immediate assertion still passed).
    await new Promise((resolve) => setTimeout(resolve, 900));
    const decisionPosts = vi
      .mocked(apiClient)
      .mock.calls.filter(
        ([url, opts]) =>
          typeof url === "string" &&
          /\/decisions$/.test(url) &&
          (opts as { method?: string } | undefined)?.method === "POST",
      );
    expect(decisionPosts).toHaveLength(0);
  });

  // The ADR-0016 marker-publish double-wrap test that lived here is retired
  // with the one-shot publish: the frontend no longer wraps form values for
  // publishing. Markers now travel as reviewer-decision envelopes and the
  // backend publishes them VERBATIM via approve-finalize
  // (test_run_lifecycle_service.test_approve_and_finalize_qa_*); the panel
  // override's wrapping stays covered by the valueSemantics unit tests.
});
describe("QualityAssessmentFullScreen — header suggestion locate", () => {
  // Self-contained fixture (the finalized describe's restoreAllMocks wipes
  // the factory apiClient implementation for everything after it).
  beforeEach(() => {
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
        return {
          run: {
            id: "run-1",
            project_id: "p1",
            article_id: "a1",
            template_id: "tpl-1",
            kind: "quality_assessment",
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
          entity_types: [],
          current_values: [],
        };
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
      return {};
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Review-pending menu item scrolls to the domain of the first pending suggestion", async () => {
    const { scrollToSectionById } = await import("@/lib/runs/suggestionLocate");
    vi.mocked(scrollToSectionById).mockClear();

    renderPage();
    const trigger = await screen.findByTestId("run-ai-actions");
    await waitFor(() => expect(trigger).toHaveTextContent("1"));
    await userEvent.click(trigger);
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /review 1 pending/i }),
    );
    // inst-1 belongs to et-1 (session.instancesByEntityType reverse lookup).
    expect(vi.mocked(scrollToSectionById)).toHaveBeenCalledWith("et-1");
  });
});

/**
 * Where a QA screen sends you when you are done with it (2026-08-22):
 * finishing a form opens the NEXT article in the worklist, and both the back
 * arrow and the end-of-queue fallback land on the project's quality tab —
 * not the Articles tab the bare /projects/:id URL defaults to.
 */
