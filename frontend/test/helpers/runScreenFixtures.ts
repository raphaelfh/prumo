/**
 * The one fixture module for both run screens (extraction and quality
 * assessment) and the lifecycle they share: the RunView as
 * `GET /api/v1/runs/{id}/view` serializes it, the caller's permissions, the
 * supabase stub body, and each kind's default transport.
 *
 * `vi.mock` is hoisted PER MODULE, so each suite declares its own `vi.mock`
 * calls and takes only the factory BODIES from here, pulled in with
 * `await import` — the one form that is safe against that hoisting.
 * Deliberately imports NO component: dragging the page under test into a mock
 * factory's graph would evaluate it before the mocks it depends on.
 */
import { vi } from "vitest";

import type { RunSummaryResponse, RunViewResponse } from "@/hooks/runs/types";
import type { ComparisonPermissions } from "@/hooks/shared/useComparisonPermissions";

const CREATED_AT = "2026-08-01T12:00:00Z";

// =================== RUN VIEW ===================

export function makeRunSummary(overrides: Partial<RunSummaryResponse> = {}): RunSummaryResponse {
  return {
    id: "run-1",
    project_id: "p1",
    article_id: "a1",
    template_id: "tpl-1",
    kind: "extraction",
    version_id: "v-1",
    stage: "extract",
    status: "running",
    hitl_config_snapshot: {},
    parameters: {},
    results: {},
    created_at: CREATED_AT,
    created_by: "u-1",
    ...overrides,
  };
}

/**
 * Every collection a suite does not name is empty. Collections are loosely
 * typed: page suites hand-write the rows they care about, often without the
 * optional server fields.
 */
export type RunViewOverrides = { run?: Partial<RunSummaryResponse> } & {
  [K in Exclude<keyof RunViewResponse, "run">]?: unknown;
};

export function makeRunView({ run, ...overrides }: RunViewOverrides = {}): RunViewResponse {
  return {
    run: makeRunSummary(run),
    proposals: [],
    decisions: [],
    consensus_decisions: [],
    published_states: [],
    entity_types: [],
    instances: [],
    current_values: [],
    ...overrides,
  } as RunViewResponse;
}

/** One reviewer decision on a coord. */
export function makeDecision(
  overrides: Partial<RunViewResponse["decisions"][number]> & { id: string; reviewer_id: string },
): RunViewResponse["decisions"][number] {
  return {
    run_id: "run-1",
    instance_id: "i1",
    field_id: "f1",
    decision: "edit",
    proposal_record_id: null,
    value: { value: "Yes" },
    rationale: null,
    created_at: CREATED_AT,
    ...overrides,
  };
}

/** One consensus decision resolving a coord. */
export function makeConsensusDecision(
  overrides: Partial<RunViewResponse["consensus_decisions"][number]> = {},
): RunViewResponse["consensus_decisions"][number] {
  return {
    id: "cons-1",
    run_id: "run-1",
    instance_id: "i1",
    field_id: "f1",
    consensus_user_id: "reviewer-1",
    mode: "select_existing",
    selected_decision_id: null,
    value: { value: "Yes" },
    rationale: null,
    created_at: CREATED_AT,
    ...overrides,
  };
}

// =================== PERMISSIONS ===================

/** A blind reviewer — the default caller of both screens. */
export const BLIND_PERMISSIONS: ComparisonPermissions = {
  userRole: "reviewer",
  isBlindMode: true,
  canSeeOthers: false,
  canResolveConflicts: false,
  canManageBlindMode: false,
  canExport: false,
  canEditTemplate: false,
  loading: false,
  error: null,
  refresh: vi.fn(async () => undefined),
};

/** An unblinded manager who arbitrates consensus. */
export const ARBITRATOR: ComparisonPermissions = {
  ...BLIND_PERMISSIONS,
  userRole: "manager",
  isBlindMode: false,
  canSeeOthers: true,
  canResolveConflicts: true,
};

// =================== SUPABASE ===================

/**
 * The `supabase` client stub. The worklist (header pager + next-article) reads
 * `articles` through the baselined PostgREST path, and the reader's DOI link
 * reads one article by id; everything else goes through `apiClient`.
 *
 * `articles` is the worklist in the order the service returns it (created_at
 * desc). `members` is the caller's own `vi.hoisted` roster for the
 * get_project_members RPC (hoisted state has to be created in the test file).
 * `tables` replaces the rows of each table it names. `userId` is the reviewer
 * AISuggestionService resolves through `auth.getUser()`.
 */
export function makeSupabaseClientMock({
  articles = WORKLIST_ARTICLES,
  members = { rows: [] },
  tables = {},
  userId = "reviewer-1",
}: {
  articles?: Array<{ id: string; title: string | null }>;
  members?: { rows: Array<Record<string, unknown>> };
  tables?: Record<string, unknown>;
  userId?: string;
} = {}) {
  const defaultRows: Record<string, unknown> = {
    articles,
    project_extraction_templates: PROBAST_TEMPLATE,
    // useProjectQATemplate selects "*, extraction_fields(*)": the embedded join shape.
    extraction_entity_types: [
      { ...PARTICIPANTS_DOMAIN, extraction_fields: [SIGNALING_QUESTION, ROB_FIELD] },
    ],
    extraction_fields: [SIGNALING_QUESTION, ROB_FIELD],
  };

  function makeQuery(table: string) {
    const rows = table in tables ? tables[table] : (defaultRows[table] ?? []);
    let idFilter: string | undefined;
    const result = { data: rows, error: null };
    const byId = () =>
      Array.isArray(rows) ? (rows as Array<{ id: string }>).find((r) => r.id === idFilter) ?? null : rows;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        if (column === "id") idFilter = String(value);
        return builder;
      },
      in: () => builder,
      order: () => builder,
      // Paged reads (fetchProjectArticles) ask for a range; the stub answers
      // the whole fixture, which is short enough to be the last page.
      range: () => builder,
      single: () => {
        const row = byId();
        return Promise.resolve(
          row ? { data: row, error: null } : { data: null, error: { code: "PGRST116", message: "0 rows" } },
        );
      },
      maybeSingle: () => Promise.resolve(idFilter === undefined ? result : { data: byId(), error: null }),
      then: (cb: (r: typeof result) => unknown) => Promise.resolve(cb(result)),
    };
    return builder;
  }

  return {
    auth: {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    },
    rpc: (fn: string) =>
      Promise.resolve(
        fn === "get_project_members" ? { data: members.rows, error: null } : { data: null, error: null },
      ),
    from: makeQuery,
  };
}

// =================== EXTRACTION ===================

/** One text field of an extraction section. */
export function textField(id: string, label: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    label,
    description: null,
    field_type: "text",
    is_required: false,
    validation_schema: null,
    allowed_values: null,
    unit: null,
    allowed_units: null,
    llm_description: null,
    sort_order: 0,
    allow_other: false,
    other_label: null,
    other_placeholder: null,
    ...overrides,
  };
}

/** One extraction section (entity type); a top-level single entry unless overridden. */
export function section(overrides: Record<string, unknown> & { id: string }) {
  return {
    name: overrides.id,
    label: overrides.id,
    description: null,
    parent_entity_type_id: null,
    cardinality: "one",
    entry_label: null,
    sort_order: 0,
    is_required: false,
    fields: [],
    ...overrides,
  };
}

/** One materialised instance of a section. */
export function instance(
  id: string,
  entityTypeId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    project_id: "p1",
    article_id: "a1",
    template_id: "tpl-1",
    entity_type_id: entityTypeId,
    parent_instance_id: null,
    label: id,
    sort_order: 0,
    metadata: {},
    created_by: "u-1",
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

/** The single-section form most extraction suites open: et-1 / f1 on instance i1. */
export function sourceOfDataForm({ required = true, fieldLabel = "Source of Data" } = {}) {
  return {
    entity_types: [
      section({
        id: "et-1",
        name: "source_of_data",
        label: "Source of Data",
        is_required: required,
        fields: [textField("f1", fieldLabel, { name: "source", is_required: required })],
      }),
    ],
    instances: [instance("i1", "et-1", { label: "Source of Data" })],
  };
}

const EXTRACTION_TEMPLATES = [{ id: "tpl-1", name: "CHARMS", kind: "extraction", is_active: true }];

type Route = (url: string, options?: { method?: string; body?: unknown }) => unknown;

/**
 * The extraction screen's transport, keyed by URL so a suite is not coupled to
 * the order of fetches. `routes` answers first; `undefined` falls through to
 * the defaults (tpl-1 is the project's one active template, the session opens
 * run-1 on i1, no finalized run, no reviewers, no suggestions, no files).
 */
export function extractionApi({
  view,
  templates = EXTRACTION_TEMPLATES,
  routes,
}: {
  view?: () => unknown;
  templates?: unknown[];
  routes?: Route;
} = {}) {
  return async (url: string, options?: { method?: string; body?: unknown }) => {
    const answer = await routes?.(url, options);
    if (answer !== undefined) return answer;
    if (url === "/api/v1/projects/p1/templates?kind=extraction") return templates;
    if (url === "/api/v1/hitl/sessions") {
      return {
        run_id: "run-1",
        kind: "extraction",
        project_template_id: "tpl-1",
        instances_by_entity_type: { "et-1": "i1" },
      };
    }
    if (url === "/api/v1/runs/run-1/view") return view?.() ?? makeRunView();
    if (url.includes("/finalized-run")) return null;
    if (url.includes("/reviewers")) return { reviewers: [] };
    if (url.includes("/suggestions")) return { suggestions: [], count: 0 };
    if (url.includes("/files") || url.includes("/text-blocks")) return [];
    return {};
  };
}

// =================== QUALITY ASSESSMENT ===================

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

// The project's worklist, in the order fetchProjectArticles returns it
// (created_at desc). "a1" is the article every suite opens by default, so the
// next-article jump target is "a2" and "a2" is the end-of-queue case.
export const WORKLIST_ARTICLES = [
  { id: "a1", title: "First article" },
  { id: "a2", title: "Second article" },
];

/** The QA session open: run-1 with one participants instance. */
export const QA_SESSION = {
  run_id: "run-1",
  kind: "quality_assessment",
  project_template_id: "tpl-1",
  instances_by_entity_type: { "et-1": "inst-1" },
};

/** A QA run view (kind=quality_assessment); collections empty unless named. */
export function makeQaRunView({ run, ...overrides }: RunViewOverrides = {}): RunViewResponse {
  return makeRunView({ run: { kind: "quality_assessment", ...run }, ...overrides });
}

/**
 * The QA screen's default transport, keyed by URL. The run carries one peer
 * reviewer decision so the reviewer summary is non-empty — the compare
 * toggle's data precondition (the blind gate is useComparisonPermissions').
 */
export function qaApi() {
  return async (url: string) => {
    if (url === "/api/v1/hitl/sessions") return QA_SESSION;
    if (url === "/api/v1/runs/run-1/view") {
      return makeQaRunView({
        decisions: [
          makeDecision({
            id: "dec-peer-1",
            reviewer_id: "peer-reviewer-id",
            instance_id: "inst-1",
            field_id: "f-1",
            value: { value: "PY" },
          }),
        ],
      });
    }
    if (url.includes("/suggestions")) return { suggestions: [], count: 0 };
    // Document switcher data source + reader blocks (array-typed).
    if (url.includes("/files") || url.includes("/text-blocks")) return [];
    // The route's :templateId resolves against these two lists: tpl-1 is the
    // project's own QA template, so it opens as a project template.
    if (url === "/api/v1/projects/p1/templates?kind=quality_assessment") return [PROBAST_TEMPLATE];
    if (url === "/api/v1/templates/global?kind=quality_assessment") return [];
    return {};
  };
}
