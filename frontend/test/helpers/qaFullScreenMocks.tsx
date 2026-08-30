/**
 * Shared fixtures and mock BODIES for the QualityAssessmentFullScreen suites.
 *
 * `QualityAssessmentFullScreen.test.tsx` sat at exactly its file-size baseline
 * cap (1594 = 1594), so no assertion could be added to it. Splitting it needed
 * somewhere for the ~290-line preamble to go — but `vi.mock` is hoisted PER
 * MODULE and cannot be shared, so each suite still declares its own `vi.mock`
 * calls and takes only the factory BODIES from here.
 *
 * Deliberately imports NO component. These builders are pulled in from inside
 * `vi.mock` factories via `await import`, the only form that is safe against
 * hoisting; dragging the page under test into that graph would invert the
 * order the mocks depend on. `renderPage` lives in the sibling
 * `qaFullScreenRender.tsx` for exactly that reason.
 */
import { vi } from "vitest";

export const BLIND_PERMISSIONS = {
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

export const PROBAST_TEMPLATE = {
  id: "tpl-1",
  name: "PROBAST",
  description: "Prediction model Risk Of Bias ASsessment Tool",
  kind: "quality_assessment",
  framework: "CUSTOM",
  version: "1.0.0",
};

export const PARTICIPANTS_DOMAIN = {
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

export const SIGNALING_QUESTION = {
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

export const ROB_FIELD = {
  ...SIGNALING_QUESTION,
  id: "f-2",
  name: "risk_of_bias",
  label: "Risk of bias",
  allowed_values: ["Low", "High", "Unclear"],
  sort_order: 99,
};

// The project's QA worklist, in the order fetchProjectArticles returns it
// (created_at desc). "a1" is the article every test opens by default, so the
// next-article jump target is "a2" and "a2" is the end-of-queue case.
export const WORKLIST_ARTICLES = [
  { id: "a1", title: "First article" },
  { id: "a2", title: "Second article" },
];

/**
 * The `supabase` client stub.
 *
 * `members` is the caller's own `vi.hoisted` roster — hoisted state has to be
 * created in the test file, so it is passed in rather than owned here.
 */
export function makeSupabaseClientMock(members: {
  rows: Array<Record<string, unknown>>;
}) {
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
    // useAISuggestions -> AISuggestionService.loadSuggestions resolves the
    // current reviewer via supabase.auth.getUser(); without this stub every
    // render surfaces an "Error loading suggestions" toast that drowns out the
    // assertions.
    auth: {
      getUser: async () => ({
        data: { user: { id: "qa-test-reviewer-id" } },
        error: null,
      }),
    },
    // useProjectMembers (run-header reviewer denominator) goes through the
    // get_project_members RPC.
    rpc: (fn: string) =>
      Promise.resolve(
        fn === "get_project_members"
          ? { data: members.rows, error: null }
          : { data: null, error: null },
      ),
    from: (table: string) => {
      if (table === "project_extraction_templates") {
        return makeQuery(PROBAST_TEMPLATE);
      }
      if (table === "extraction_entity_types") {
        // useProjectQATemplate uses select("*, extraction_fields(*)") — return
        // the embedded join shape so fields are picked up.
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
      if (table === "articles") {
        return makeQuery(WORKLIST_ARTICLES);
      }
      return makeQuery([]);
    },
  };
}

/**
 * The default URL-keyed `apiClient` implementation. Keyed by URL so a suite is
 * not coupled to the order of fetches.
 */
export function makeApiClientDefault() {
  return async (url: string) => {
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
  };
}
