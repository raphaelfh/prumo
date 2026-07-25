import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ userId: "qa-test-reviewer-id" }),
}));

// Default: blind reviewer (no compare access). The compare-mode test below
// overrides this to a manager who may see peers.
const BLIND_PERMISSIONS = {
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
};
vi.mock("@/hooks/shared/useComparisonPermissions", () => ({
  useComparisonPermissions: vi.fn(),
}));

import { useComparisonPermissions } from "@/hooks/shared/useComparisonPermissions";
import { SidebarProvider } from "@/contexts/SidebarContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import QualityAssessmentFullScreen from "@/pages/QualityAssessmentFullScreen";
import { apiClient } from "@/integrations/api";

const mockedPermissions = vi.mocked(useComparisonPermissions);

const PROBAST_TEMPLATE = {
  id: "tpl-1",
  name: "PROBAST",
  description: "Prediction model Risk Of Bias ASsessment Tool",
  kind: "quality_assessment",
  framework: "CUSTOM",
  version: "1.0.0",
};

const PARTICIPANTS_DOMAIN = {
  id: "et-1",
  name: "participants",
  label: "Participants",
  description: "PROBAST domain 1",
  template_id: null,
  project_template_id: "tpl-1",
  parent_entity_type_id: null,
  cardinality: "one",
  sort_order: 1,
  is_required: false,
};

const SIGNALING_QUESTION = {
  id: "f-1",
  entity_type_id: "et-1",
  name: "q1_1_appropriate_data_sources",
  label: "Appropriate data sources?",
  field_type: "select",
  is_required: false,
  allowed_values: ["Y", "PY", "PN", "N", "NI", "NA"],
  unit: null,
  allowed_units: null,
  sort_order: 1,
  llm_description: null,
  validation_schema: null,
  allow_other: false,
};

const ROB_FIELD = {
  ...SIGNALING_QUESTION,
  id: "f-2",
  name: "risk_of_bias",
  label: "Risk of bias",
  allowed_values: ["Low", "High", "Unclear"],
  sort_order: 99,
};

vi.mock("@/integrations/supabase/client", () => {
  function makeQuery(rows: unknown) {
    const result = { data: rows, error: null };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      maybeSingle: () => Promise.resolve(result),
      then: (cb: (r: typeof result) => unknown) => Promise.resolve(cb(result)),
    };
    return builder;
  }

  return {
    supabase: {
      // useAISuggestions → AISuggestionService.loadSuggestions resolves the
      // current reviewer via supabase.auth.getUser(); without this stub every
      // render surfaces an "Error loading suggestions" toast that drowns out
      // the assertions below.
      auth: {
        getUser: async () => ({
          data: { user: { id: "qa-test-reviewer-id" } },
          error: null,
        }),
      },
      from: (table: string) => {
        if (table === "project_extraction_templates") {
          return makeQuery(PROBAST_TEMPLATE);
        }
        if (table === "extraction_entity_types") {
          // useProjectQATemplate uses select("*, extraction_fields(*)")
          // — return the embedded join shape so fields are picked up.
          return makeQuery([
            {
              ...PARTICIPANTS_DOMAIN,
              extraction_fields: [SIGNALING_QUESTION, ROB_FIELD],
            },
          ]);
        }
        if (table === "extraction_fields") {
          return makeQuery([SIGNALING_QUESTION, ROB_FIELD]);
        }
        return makeQuery([]);
      },
    },
  };
});

// The PDF viewer pulls in worker / canvas globals (pdfjs/DOMMatrix) that aren't
// worth wiring up for a unit test — stub PrumoPdfViewer. But the page now also
// imports createViewerStore + subscribeReaderLocate from this module; use the
// REAL (engine-free) implementations from the `core` subpath so the shared
// viewer-store wiring behaves correctly (a partial stub would make
// `subscribeReaderLocate` undefined → TypeError at render).
vi.mock("@prumo/pdf-viewer", async () => {
  const core =
    await vi.importActual<typeof import("@/pdf-viewer/core")>("@/pdf-viewer/core");
  return {
    PrumoPdfViewer: () => <div data-testid="qa-pdf-viewer-stub">PDF</div>,
    articleFileSourceFromStorageKey: (storageKey: string) => ({
      kind: "lazy" as const,
      load: async () => ({kind: "url" as const, url: `stub://${storageKey}`}),
    }),
    createViewerStore: core.createViewerStore,
    subscribeReaderLocate: core.subscribeReaderLocate,
  };
});

// Spy the DOM-scroll half of the header suggestion-locate pair (jsdom has no
// scrollIntoView); the key-parsing half stays real so the reverse lookup is
// covered end-to-end.
vi.mock("@/lib/runs/suggestionLocate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/runs/suggestionLocate")>(
    "@/lib/runs/suggestionLocate",
  );
  return { ...actual, scrollToSectionById: vi.fn(() => true) };
});

// apiClient gets called from the QA hooks; map by URL so the test isn't
// coupled to the order of fetches.
vi.mock("@/integrations/api", () => ({
  apiClient: vi.fn(async (url: string) => {
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
        // One peer reviewer decision so reviewerSummary.decisionsByCoord is
        // non-empty — the compare toggle's data precondition. (The blind gate
        // is enforced separately by useComparisonPermissions.)
        decisions: [
          {
            id: "dec-peer-1",
            run_id: "run-1",
            instance_id: "inst-1",
            field_id: "f-1",
            reviewer_id: "peer-reviewer-id",
            decision: "edit",
            proposal_record_id: null,
            value: { value: "PY" },
            rationale: null,
            created_at: new Date().toISOString(),
          },
        ],
        consensus_decisions: [],
        published_states: [],
        entity_types: [],
        current_values: [],
      };
    }
    if (url.includes("/suggestions")) {
      return { suggestions: [], count: 0 };
    }
    // Document switcher data source + reader blocks (array-typed).
    if (url.includes("/files") || url.includes("/text-blocks")) {
      return [];
    }
    return {};
  }),
}));

function renderPage(path = "/projects/p1/articles/a1/quality-assessment/tpl-1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/projects/:projectId/articles/:articleId/quality-assessment/:templateId"
            element={
              // TooltipProvider mirrors the app-level provider in App.tsx —
              // form-panel tooltips (suggestion rows) rely on it in prod.
              <TooltipProvider>
                <SidebarProvider>
                  <QualityAssessmentFullScreen />
                </SidebarProvider>
              </TooltipProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("QualityAssessmentFullScreen", () => {
  beforeEach(() => {
    // supabase + apiClient are mocked at module scope. Reset the permission
    // hook to the blind default; the compare-mode test overrides it.
    mockedPermissions.mockReturnValue(BLIND_PERMISSIONS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders header with QA badge + template name + version", async () => {
    renderPage();
    // Kind badge shows the full 'Quality Assessment' label (reverted from short 'QA').
    expect(screen.getByTestId("qa-kind-badge")).toHaveTextContent("Quality Assessment");
    // Template name is now in the Breadcrumb crumb; version is in qa-template-name.
    await waitFor(() =>
      expect(screen.getByTestId("qa-template-name")).toHaveTextContent(
        /v1\.0\.0/,
      ),
    );
    // Template name appears in the breadcrumb.
    expect(screen.getByText("PROBAST")).toBeInTheDocument();
  });

  it("AssessmentShell shows PDF panel toggle only in header (no in-shell toggle when pdfState provided)", async () => {
    // QA page passes pdfState to AssessmentShell so the RunHeader.PanelToggle
    // is the single PDF control — the in-shell toggle must be absent.
    renderPage();
    expect(screen.getByTestId("assessment-shell")).toBeInTheDocument();
    expect(
      screen.queryByTestId("assessment-shell-show-pdf"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("assessment-shell-pdf"),
    ).not.toBeInTheDocument();
  });

  it("renders one accordion per domain after template loads", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("qa-domains")).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("qa-domain-participants"),
    ).toBeInTheDocument();
  });

  it("first domain accordion opens by default exposing summary card", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("qa-domains")).toBeInTheDocument(),
    );
    // Radix Accordion with defaultValue mounts the open item's content;
    // domain-judgment summary card is unique to the open domain.
    await waitFor(() =>
      expect(
        screen.getByTestId("qa-domain-summary-participants"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/Domain judgment/i)).toBeInTheDocument();
  });

  it("renders form-panel container", async () => {
    renderPage();
    expect(screen.getByTestId("qa-form-panel")).toBeInTheDocument();
  });

  it("renders the shared RunHeader status chip once the run loads", async () => {
    renderPage();
    // The RunStatus chip (data-testid=run-stage-current) replaces the old
    // stage rail — its presence is the canonical marker that the RunHeader is
    // mounted.
    await waitFor(() =>
      expect(screen.getByTestId("run-stage-current")).toBeInTheDocument(),
    );
    // Old hand-rolled publish button is gone — PrimaryAction owns that slot now.
    expect(
      screen.queryByTestId("qa-publish-button"),
    ).not.toBeInTheDocument();
  });

  it("renders the AI actions menu with Extract with AI once the QA session is open", async () => {
    // RunHeader.AIActions is a menu: the Sparkles trigger opens named items.
    renderPage();
    const trigger = await screen.findByTestId("run-ai-actions");
    await userEvent.click(trigger);
    const item = await screen.findByRole("menuitem", {
      name: /extract with ai/i,
    });
    // The item stays enabled while the session is open and the run is not
    // finalized — it's the only entry point to the AI prefill flow.
    expect(item).not.toHaveAttribute("data-disabled");
  });

  it("Extract with AI click posts to /api/v1/extraction/sections with the session run id", async () => {
    const { apiClient } = (await import(
      "@/integrations/api"
    )) as unknown as { apiClient: ReturnType<typeof vi.fn> };
    apiClient.mockClear();

    renderPage();
    const trigger = await screen.findByTestId("run-ai-actions");
    await userEvent.click(trigger);
    const button = await screen.findByRole("menuitem", {
      name: /extract with ai/i,
    });
    await userEvent.click(button);

    await waitFor(() => {
      const sectionCalls = apiClient.mock.calls.filter(
        (call) => call[0] === "/api/v1/extraction/sections",
      );
      expect(sectionCalls.length).toBeGreaterThan(0);
      const lastBody = sectionCalls[sectionCalls.length - 1][1]?.body ?? {};
      expect(lastBody.runId).toBe("run-1");
      expect(lastBody.projectId).toBe("p1");
      expect(lastBody.articleId).toBe("a1");
      expect(lastBody.templateId).toBe("tpl-1");
      // QA must NOT auto-advance to REVIEW — the publish flow does that.
      expect(lastBody.autoAdvanceToReview).toBe(false);
      // Re-running AI should preserve user-entered values by default.
      expect(lastBody.skipFieldsWithHumanProposals).toBe(true);
    });
  });

  it("extract: reviewer primary action is Finish assessment — marks ready, never advances or finalizes", async () => {
    // Staged-flow regression: the old one-shot publish walked the run
    // extract → consensus → finalized in a single click, so consensus was
    // never a visitable stage. A reviewer's action is now the advisory
    // mark-ready — zero stage moves, zero consensus writes.
    vi.mocked(apiClient).mockClear();

    renderPage();
    const button = await screen.findByRole("button", { name: /finish assessment/i });
    await waitFor(() => expect(button).not.toHaveAttribute("disabled"));
    await userEvent.click(button);

    await waitFor(() => {
      const readyPosts = vi.mocked(apiClient).mock.calls.filter(([url]) =>
        typeof url === "string" && url.includes("/ready"),
      );
      expect(readyPosts).toHaveLength(1);
    });

    const sideEffects = vi.mocked(apiClient).mock.calls.filter(([url]) =>
      typeof url === "string"
        && (url.includes("/advance")
          || url.includes("/consensus")
          || url.includes("/approve-finalize")),
    );
    expect(sideEffects).toHaveLength(0);
  });

  it("extract: manager primary action is Start consensus — advances to consensus ONLY, never finalizes", async () => {
    mockedPermissions.mockReturnValue({
      ...BLIND_PERMISSIONS,
      userRole: "manager" as const,
      isBlindMode: false,
      canSeeOthers: true,
      canResolveConflicts: true,
    });
    vi.mocked(apiClient).mockClear();

    renderPage();
    const button = await screen.findByRole("button", { name: /start consensus/i });
    await waitFor(() => expect(button).not.toHaveAttribute("disabled"));
    await userEvent.click(button);

    await waitFor(() => {
      const advances = vi.mocked(apiClient).mock.calls.filter(([url]) =>
        typeof url === "string" && url.includes("/advance"),
      );
      expect(advances).toHaveLength(1);
      expect(
        (advances[0][1] as { body: { target_stage: string } }).body.target_stage,
      ).toBe("consensus");
    });

    // The one-shot publish regression: no finalize advance, no approve-finalize,
    // and no blanket per-field manual_override consensus writes.
    const finalizeCalls = vi.mocked(apiClient).mock.calls.filter(([url, opts]) =>
      typeof url === "string"
        && (url.includes("/approve-finalize")
          || (url.includes("/advance")
            && (opts as { body?: { target_stage?: string } } | undefined)?.body
              ?.target_stage === "finalized")),
    );
    expect(finalizeCalls).toHaveLength(0);
    const consensusWrites = vi.mocked(apiClient).mock.calls.filter(([url]) =>
      typeof url === "string" && url.endsWith("/consensus"),
    );
    expect(consensusWrites).toHaveLength(0);
  });

  it("blind reviewer sees no compare control and stays on the assess view", async () => {
    // Default permissions (BLIND_PERMISSIONS) → canSeeOthers=false →
    // canCompare is false, so the CompareToggle never renders.
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("qa-domains")).toBeInTheDocument(),
    );
    // Compare view must not appear passively.
    expect(screen.queryByTestId("qa-compare-view")).not.toBeInTheDocument();
    // No visible compare affordance for a blind reviewer.
    expect(screen.queryByRole("button", { name: /^compare$/i })).not.toBeInTheDocument();
  });

  it("manager who may see peers gets a visible Compare toggle, clicking it renders the comparison", async () => {
    mockedPermissions.mockReturnValue({
      ...BLIND_PERMISSIONS,
      userRole: "manager",
      isBlindMode: false,
      canSeeOthers: true,
      canManageBlindMode: true,
    });

    renderPage();

    // Wait for domains to load so canCompare resolves (requires peer decisions).
    await waitFor(() =>
      expect(screen.getByTestId("qa-domains")).toBeInTheDocument(),
    );

    // The Compare toggle is now a visible top-level control (not a kebab item).
    const compareToggle = await screen.findByRole("button", { name: /^compare$/i });
    expect(compareToggle).toBeInTheDocument();

    // Still on the assess view before clicking.
    expect(screen.queryByTestId("qa-compare-view")).not.toBeInTheDocument();

    await userEvent.click(compareToggle);

    // Compare view replaces the domain accordions and renders the shared
    // server-blinded comparison table (peer column sourced from decisionsByCoord).
    await waitFor(() =>
      expect(screen.getByTestId("qa-compare-view")).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("run-reviewer-comparison"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("qa-domains")).not.toBeInTheDocument();
  });
});

describe("QualityAssessmentFullScreen — blind-reveal stage guards", () => {
  // Security-review finding (2026-07-02 #6): the Reveal affordance must mirror
  // the extraction screen's guards — offered only to a blind manager DURING
  // extract, and never once the run-scoped auto-reveal (peers_revealed) or a
  // consensus/finalized stage makes it redundant (ADR-0015).
  const BLIND_MANAGER = {
    ...BLIND_PERMISSIONS,
    userRole: "manager" as const,
    isBlindMode: true,
    canManageBlindMode: true,
  };

  function mockRunView({
    stage,
    peersRevealed = false,
  }: {
    stage: string;
    peersRevealed?: boolean;
  }) {
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
            stage,
            status: stage === "finalized" ? "completed" : "running",
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
          peers_revealed: peersRevealed,
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
  }

  beforeEach(() => {
    mockedPermissions.mockReturnValue(BLIND_MANAGER);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blind manager during extract sees Reveal inside the status popover", async () => {
    mockRunView({ stage: "extract" });
    renderPage();
    // Reveal lives in the RunStatus popover now (run-header declutter).
    await userEvent.click(await screen.findByTestId("run-stage-current"));
    expect(
      await screen.findByRole("button", { name: /reveal reviewers/i }),
    ).toBeInTheDocument();
  });

  it.each(["consensus", "finalized"])(
    "blind manager on a %s run sees no Reveal affordance",
    async (stage) => {
      mockRunView({ stage });
      renderPage();
      // The status chip mounts only once the run view has loaded, so
      // canReveal is settled by the time this resolves.
      await userEvent.click(await screen.findByTestId("run-stage-current"));
      await screen.findByTestId("run-status-popover");
      expect(
        screen.queryByRole("button", { name: /reveal reviewers/i }),
      ).not.toBeInTheDocument();
    },
  );

  it("run-scoped auto-reveal (peers_revealed) hides the Reveal affordance even during extract", async () => {
    mockRunView({ stage: "extract", peersRevealed: true });
    renderPage();
    await userEvent.click(await screen.findByTestId("run-stage-current"));
    await screen.findByTestId("run-status-popover");
    expect(
      screen.queryByRole("button", { name: /reveal reviewers/i }),
    ).not.toBeInTheDocument();
  });
});

describe("QualityAssessmentFullScreen — consensus dead affordances (D6)", () => {
  const SEEING_REVIEWER = {
    ...BLIND_PERMISSIONS,
    isBlindMode: false,
    canSeeOthers: true,
  };

  const DIVERGENT_DECISIONS = [
    {
      id: "dec-a",
      run_id: "run-1",
      instance_id: "inst-1",
      field_id: "f-1",
      reviewer_id: "peer-a",
      decision: "edit",
      proposal_record_id: null,
      value: { value: "Y" },
      rationale: null,
      created_at: new Date().toISOString(),
    },
    {
      id: "dec-b",
      run_id: "run-1",
      instance_id: "inst-1",
      field_id: "f-1",
      reviewer_id: "peer-b",
      decision: "edit",
      proposal_record_id: null,
      value: { value: "N" },
      rationale: null,
      created_at: new Date().toISOString(),
    },
  ];

  function mockConsensusView(consensusDecisions: unknown[] = []) {
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
            stage: "consensus",
            status: "running",
            hitl_config_snapshot: {},
            parameters: {},
            results: {},
            created_at: new Date().toISOString(),
            created_by: "u-1",
          },
          proposals: [],
          decisions: DIVERGENT_DECISIONS,
          consensus_decisions: consensusDecisions,
          published_states: [],
          entity_types: [],
          current_values: [],
          peers_revealed: true,
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
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("consensus: no Compare toggle even though canCompare's preconditions hold", async () => {
    mockedPermissions.mockReturnValue(SEEING_REVIEWER);
    mockConsensusView();
    renderPage();
    // The consensus resolve surface is up (its data preconditions hold)…
    await waitFor(() =>
      expect(screen.getByTestId("consensus-panel")).toBeInTheDocument(),
    );
    // …but the header offers no dead Compare toggle (D6).
    expect(screen.queryByRole("button", { name: /^compare$/i })).not.toBeInTheDocument();
  });

  it("consensus: an arbitrator sees resolve chrome (positive control)", async () => {
    // QA mirrors extraction (2026-07-09): resolving/publishing is arbitrator-only.
    mockedPermissions.mockReturnValue({
      ...SEEING_REVIEWER,
      userRole: "manager" as const,
      canResolveConflicts: true,
    });
    mockConsensusView();
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("consensus-panel")).toBeInTheDocument(),
    );
    // Adopt buttons carry the real aria-label copy.
    expect(
      screen.getAllByRole("button", { name: /publish this reviewer/i }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /^override$/i })).toBeInTheDocument();
  });

  it("consensus: a plain reviewer gets no resolve chrome (arbitrator-only writes)", async () => {
    // SEEING_REVIEWER has canResolveConflicts=false — a non-arbitrator reviewer
    // must not get resolve buttons whose /consensus click the backend 403s.
    mockedPermissions.mockReturnValue(SEEING_REVIEWER);
    mockConsensusView();
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("consensus-panel")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /publish this reviewer/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^override$/i })).not.toBeInTheDocument();
  });

  it("consensus: a read-only viewer gets no resolve chrome (its writes 403)", async () => {
    mockedPermissions.mockReturnValue({
      ...SEEING_REVIEWER,
      userRole: "viewer" as never,
    });
    mockConsensusView();
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("consensus-panel")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /publish this reviewer/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^override$/i })).not.toBeInTheDocument();
  });

  it("consensus: arbitrator with an unresolved divergence — Approve & finalize is gated, click never posts", async () => {
    mockedPermissions.mockReturnValue({
      ...SEEING_REVIEWER,
      userRole: "manager" as const,
      canResolveConflicts: true,
    });
    mockConsensusView();
    renderPage();
    const button = await screen.findByRole("button", { name: /approve & finalize/i });
    await userEvent.click(button);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/resolve every diverging question/i),
      );
    });
    const finalizePosts = vi.mocked(apiClient).mock.calls.filter(([url]) =>
      typeof url === "string" && url.includes("/approve-finalize"),
    );
    expect(finalizePosts).toHaveLength(0);
  });

  it("consensus: arbitrator with divergences resolved — Approve & finalize posts approve-finalize", async () => {
    mockedPermissions.mockReturnValue({
      ...SEEING_REVIEWER,
      userRole: "manager" as const,
      canResolveConflicts: true,
    });
    mockConsensusView([
      {
        id: "cons-1",
        run_id: "run-1",
        instance_id: "inst-1",
        field_id: "f-1",
        consensus_user_id: "qa-test-reviewer-id",
        mode: "select_existing",
        selected_decision_id: "dec-a",
        value: { value: "Y" },
        rationale: null,
        created_at: new Date().toISOString(),
      },
    ]);
    renderPage();
    const button = await screen.findByRole("button", { name: /approve & finalize/i });
    await userEvent.click(button);
    await waitFor(() => {
      const finalizePosts = vi.mocked(apiClient).mock.calls.filter(([url]) =>
        typeof url === "string" && url.includes("/approve-finalize"),
      );
      expect(finalizePosts).toHaveLength(1);
    });
    // Finalization happens through approve-finalize alone — never a bare
    // advance(target=finalized) from the header.
    const bareFinalize = vi.mocked(apiClient).mock.calls.filter(([url, opts]) =>
      typeof url === "string"
        && url.includes("/advance")
        && (opts as { body?: { target_stage?: string } } | undefined)?.body
          ?.target_stage === "finalized",
    );
    expect(bareFinalize).toHaveLength(0);
  });
});

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
