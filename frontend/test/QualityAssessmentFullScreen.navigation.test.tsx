/**
 * QualityAssessmentFullScreen — moving between articles: the worklist, the
 * header pager (J/K, ⌘K), in-place run-switch hydration, and the status
 * popover's reviewer denominator.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("QualityAssessmentFullScreen — worklist navigation", () => {
  beforeEach(() => {
    mockedPermissions.mockReturnValue(BLIND_PERMISSIONS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("back arrow returns to the project's quality tab", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /^back$/i }));
    await waitFor(() =>
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/projects/p1?tab=quality",
      ),
    );
  });

  it("Finish assessment opens the next article in the worklist", async () => {
    renderPage();
    const button = await screen.findByRole("button", { name: /finish assessment/i });
    await waitFor(() => expect(button).not.toHaveAttribute("disabled"));
    await userEvent.click(button);
    await waitFor(() =>
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/projects/p1/articles/a2/quality-assessment/tpl-1",
      ),
    );
  });

  it("Finish assessment on the LAST article falls back to the quality tab", async () => {
    // "a2" is last in WORKLIST_ARTICLES — there is no next article to open.
    renderPage("/projects/p1/articles/a2/quality-assessment/tpl-1");
    const button = await screen.findByRole("button", { name: /finish assessment/i });
    await waitFor(() => expect(button).not.toHaveAttribute("disabled"));
    await userEvent.click(button);
    await waitFor(() =>
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/projects/p1?tab=quality",
      ),
    );
  });
});

/**
 * Header article pager + shortcut parity with the extraction screen
 * (2026-08-22). The shared help panel has always advertised "J / K — Next /
 * previous article" on BOTH run screens; until this change the QA screen had
 * no pager, no J/K and no ⌘K palette, so the help panel promised a binding
 * that did not exist.
 */
describe("QualityAssessmentFullScreen — header pager, J/K and ⌘K", () => {
  beforeAll(() => {
    // cmdk scrolls the selected item into view; jsdom has no scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
  });

  // Self-contained: the describes above end on vi.restoreAllMocks(), which
  // wipes the module-factory apiClient implementation for everything after it.
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

  it("mounts the pager in the header's centre track", async () => {
    renderPage();
    const centre = await screen.findByTestId("run-header-center");
    await waitFor(() =>
      expect(
        within(centre).getByRole("button", { name: /next article/i }),
      ).toBeInTheDocument(),
    );
    // First of two articles: previous is aria-disabled (not the native
    // `disabled` attribute — it stays focusable), next is live.
    expect(
      within(centre).getByRole("button", { name: /previous article/i }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(within(centre).getByLabelText("Article 1 of 2")).toBeInTheDocument();
  });

  it("the next arrow opens the next article, carrying :templateId verbatim", async () => {
    renderPage();
    const next = await screen.findByRole("button", { name: /next article/i });
    await waitFor(() => expect(next).not.toBeDisabled());
    await userEvent.click(next);
    await waitFor(() =>
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/projects/p1/articles/a2/quality-assessment/tpl-1",
      ),
    );
  });

  it("J opens the next article — the binding the help panel already promised", async () => {
    renderPage();
    // Wait for the worklist read to land; below two articles J/K is inert.
    await screen.findByRole("button", { name: /next article/i });
    await userEvent.keyboard("j");
    await waitFor(() =>
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/projects/p1/articles/a2/quality-assessment/tpl-1",
      ),
    );
  });

  it("J on the LAST article stays put (end-of-list guard, no wrap); K still walks back", async () => {
    renderPage("/projects/p1/articles/a2/quality-assessment/tpl-1");
    await screen.findByRole("button", { name: /next article/i });
    // "a2" is last, so J has nowhere to go; K walks back to "a1".
    await userEvent.keyboard("j");
    expect(screen.getByTestId("probe-location")).toHaveTextContent(
      "/projects/p1/articles/a2/quality-assessment/tpl-1",
    );
    await userEvent.keyboard("k");
    await waitFor(() =>
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/projects/p1/articles/a1/quality-assessment/tpl-1",
      ),
    );
  });

  it("⌘K opens the command palette with the run's actions", async () => {
    renderPage();
    await screen.findByTestId("run-stage-current");
    await userEvent.keyboard("{Meta>}k{/Meta}");
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Toggle source panel"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("View run status")).toBeInTheDocument();
  });
});
describe("QualityAssessmentFullScreen — run-switch hydration (in-place article navigation)", () => {
  // Regression (spec 2026-08-22 §7b, Q1): the #657/#671 pagers navigate
  // WITHOUT remounting the page, and hydration used to merge the new run's
  // loadedValues into the PREVIOUS run's values state. Run-A coords then
  // looked dirty against run-B's baseline, so autosave POSTed run-A
  // instances at /runs/run-B/decisions — rejected, error toast per
  // keystroke. Hydration must REPLACE values when the run changes.
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  function runView(
    runId: string,
    articleId: string,
    currentValues: Array<Record<string, unknown>>,
  ) {
    return {
      run: {
        id: runId,
        project_id: "p1",
        article_id: articleId,
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
      current_values: currentValues,
    };
  }

  beforeEach(() => {
    mockedPermissions.mockReturnValue(BLIND_PERMISSIONS);
    vi.mocked(apiClient).mockImplementation(
      async (url: string, opts?: { body?: unknown }) => {
        if (url === "/api/v1/hitl/sessions") {
          const articleId = (opts?.body as { article_id?: string } | undefined)
            ?.article_id;
          return articleId === "a2"
            ? {
                run_id: "run-2",
                kind: "quality_assessment",
                project_template_id: "tpl-1",
                instances_by_entity_type: { "et-1": "inst-2" },
              }
            : {
                run_id: "run-1",
                kind: "quality_assessment",
                project_template_id: "tpl-1",
                instances_by_entity_type: { "et-1": "inst-1" },
              };
        }
        if (url === "/api/v1/runs/run-1/view") {
          return runView("run-1", "a1", [
            {
              instance_id: "inst-1",
              field_id: "f-1",
              value: { value: "Y" },
              decision: "edit",
            },
          ]);
        }
        if (url === "/api/v1/runs/run-2/view") {
          return runView("run-2", "a2", []);
        }
        if (url.includes("/suggestions")) {
          return { suggestions: [], count: 0 };
        }
        if (url.includes("/files") || url.includes("/text-blocks")) {
          return [];
        }
        return {};
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("REPLACES values on a run change — run-1 coords never dirty-POST against run-2", async () => {
    renderPage();
    const domain = await screen.findByTestId("qa-domain-participants");
    await waitFor(() => expect(within(domain).getByText("Y")).toBeInTheDocument());

    // In-place navigation to the next article (same component, new params).
    const next = await screen.findByRole("button", { name: /next article/i });
    await waitFor(() => expect(next).not.toBeDisabled());
    await userEvent.click(next);
    await waitFor(() =>
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/articles/a2/",
      ),
    );

    // Wait for run-2's detail to hydrate, then PAST the 600ms autosave
    // debounce — the pre-fix merge left run-1's coord in values, which is
    // dirty against run-2's empty baseline and fires exactly this POST.
    await waitFor(() =>
      expect(
        vi
          .mocked(apiClient)
          .mock.calls.some(([u]) => u === "/api/v1/runs/run-2/view"),
      ).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 900));

    const run2DecisionPosts = vi
      .mocked(apiClient)
      .mock.calls.filter(
        ([url, o]) =>
          typeof url === "string" &&
          url === "/api/v1/runs/run-2/decisions" &&
          (o as { method?: string } | undefined)?.method === "POST",
      );
    expect(run2DecisionPosts).toHaveLength(0);

    // Replace semantics: run-2's form holds only its own (empty) values.
    const freshDomain = screen.getByTestId("qa-domain-participants");
    expect(within(freshDomain).queryByText("Y")).not.toBeInTheDocument();
  });
});
describe("QualityAssessmentFullScreen — status popover reviewer denominator", () => {
  // Regression (2026-08-22): the QA header derived "N of M reviewers" from
  // run.hitl_config_snapshot.reviewer_count — an inert knob no UI has set
  // since #388, so snapshots carry the system default 1 and two submitted
  // reviewers read "2 of 1 reviewers". M must be role-derived (members with
  // the reviewer/manager role), exactly like the extraction header.
  function memberRow(userId: string, role: string) {
    return {
      id: `pm-${userId}`,
      user_id: userId,
      role,
      user_email: `${userId}@x.test`,
      user_full_name: userId,
      user_avatar_url: null,
    };
  }

  beforeEach(() => {
    mockedPermissions.mockReturnValue(BLIND_PERMISSIONS);
    // 3 reviewers + 1 manager are extraction-eligible; the viewer is not.
    membersFixture.rows = [
      memberRow("m1", "reviewer"),
      memberRow("m2", "reviewer"),
      memberRow("m3", "reviewer"),
      memberRow("m4", "manager"),
      memberRow("m5", "viewer"),
    ];
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
            // The snapshot deliberately has NO reviewer_count — the header
            // must not fall back to the config default of 1.
            hitl_config_snapshot: {},
            parameters: {},
            results: {},
            created_at: new Date().toISOString(),
            created_by: "u-1",
          },
          proposals: [],
          // Two distinct reviewers have submitted → participant count 2.
          decisions: ["peer-a", "peer-b"].map((reviewer, i) => ({
            id: `dec-${i}`,
            run_id: "run-1",
            instance_id: "inst-1",
            field_id: "f-1",
            reviewer_id: reviewer,
            decision: "edit",
            proposal_record_id: null,
            value: { value: "Y" },
            rationale: null,
            created_at: new Date().toISOString(),
          })),
          consensus_decisions: [],
          published_states: [],
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
    membersFixture.rows = [];
    vi.restoreAllMocks();
  });

  it("derives the denominator from project roles, not the run's config snapshot", async () => {
    renderPage();
    await userEvent.click(await screen.findByTestId("run-stage-current"));
    const popover = await screen.findByTestId("run-status-popover");
    expect(
      await within(popover).findByText("2 of 4 reviewers"),
    ).toBeInTheDocument();
  });
});
