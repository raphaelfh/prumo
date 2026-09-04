/**
 * Template structure CRUD service (entity-types, sections).
 *
 * IO for template configuration: loading entity types, updating labels,
 * adding/removing sections.  Creating a template (from scratch, from the
 * catalogue, or from a file) is server-authoritative and lives in
 * templateImportService.ts; article-list queries live in articlesService.ts;
 * auth queries in authService.ts.
 *
 * Section WRITES (create/rename/delete) go through apiClient onto the
 * typed B-7 endpoints; the reads stay PostgREST until the read-path
 * consolidation follow-up.
 *
 * All exported functions return ErrorResult<T> via toResult so components
 * can branch on result.ok without try/catch.
 *
 * @module services/templateService
 */

import {ApiError, apiClient} from '@/integrations/api/client';
import {supabase} from '@/integrations/supabase/client';
import {t} from '@/lib/copy';
import type {ErrorResult} from '@/lib/error-utils';
import {PgError, toResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

// --- Types ---

export type RepublishTemplateVersionResponse =
  components['schemas']['RepublishTemplateVersionResponse'];

/** What Publish submits: the fingerprint the sheet showed, the ticked
 * destructive rows, and an optional note (B-9b2b). */
export type RepublishTemplateVersionRequest =
  components['schemas']['RepublishTemplateVersionRequest'];


export type TemplateConfigStatus =
  components['schemas']['TemplateConfigStatusRead'];

export type TemplateConfigDiff =
  components['schemas']['TemplateConfigDiffRead'];

export type TemplateChangeRow = components['schemas']['TemplateChangeRowRead'];

export type TemplateVersionHistory =
  components['schemas']['TemplateVersionHistoryRead'];

export type TakeOverDraftLockResponse =
  components['schemas']['TakeOverDraftLockResponse'];

export type RestoreVersionResponse =
  components['schemas']['RestoreVersionResponse'];

export type TemplateVersionHistoryEntry =
  components['schemas']['TemplateVersionHistoryEntry'];

export type ChangeTier = components['schemas']['ChangeTier'];

export type ChangeVariant = components['schemas']['ChangeVariant'];

export type DiffStatus = components['schemas']['DiffStatus'];

export type OpaqueValueState = components['schemas']['OpaqueValueState'];

export type DiscardDraftResponse = components['schemas']['DiscardDraftResponse'];

export type TemplateDiscardRefusalCode =
  components['schemas']['TemplateDiscardRefusalCode'];

export type TemplatePublishRefusalCode =
  components['schemas']['TemplatePublishRefusalCode'];

/** One field whose recorded answers a Discard would strand, already
 * human-readable (`Section → Field`); `nodeId` is a hint for keys/tests,
 * never something the screen shows. */
export interface TemplateDiscardOrphan {
  nodeId: string | null;
  label: string;
}

type SectionRead = components['schemas']['SectionRead'];
type SectionDeleteResponse = components['schemas']['SectionDeleteResponse'];
type SectionRole = components['schemas']['SectionCreateRequest']['role'];
type SectionCardinality = NonNullable<
  components['schemas']['SectionUpdateRequest']['cardinality']
>;

/**
 * A `POST .../republish-version` the server deliberately refused (409, B-9b0 D1).
 *
 * Same discipline as `TemplateDiscardRefusal` below: a plain `Error`
 * subclass survives `normalizeError`/`toResult` untouched, so the hook
 * branches on `instanceof` and `ApiError` never escapes this directory.
 * Carries the labels because the toast names every offending section.
 */
export class TemplatePublishRefusal extends Error {
  constructor(
    message: string,
    /** The server's refusal code — typed as the generated union because
     * that is the contract. The message is diagnostic only; the copy
     * layer composes what the manager reads. */
    public readonly code: TemplatePublishRefusalCode,
    public readonly sectionLabels: readonly string[] = [],
  ) {
    super(message);
    this.name = 'TemplatePublishRefusal';
  }
}

/**
 * Runtime-validate `error.details.section_labels`.
 *
 * The generated type says what the server *should* send; this guard is what
 * makes rendering safe. A missing or non-array payload yields `[]` (the copy
 * layer then falls back to the nameless sentence) and non-string entries are
 * dropped rather than interpolated as `undefined`.
 */
function parsePublishSectionLabels(details: unknown): string[] {
  if (!details || typeof details !== 'object') return [];
  const raw = (details as {section_labels?: unknown}).section_labels;
  if (!Array.isArray(raw)) return [];
  return raw.filter((label): label is string => typeof label === 'string');
}

/**
 * Publish the live template structure as a new active version.
 *
 * B-4: this is the explicit Publish button's call — config edits are
 * draft edits (the DB stamps `config_draft_since`) and only this
 * publish moves snapshots, prompts and editable-stage run pins.
 *
 * A 409 is the publish-time many→one cardinality re-check (B-8 review),
 * typed since B-9b0: the code and `section_labels` are the contract, so
 * the refusal travels as data and `useTemplateRepublish` composes its own
 * sentence instead of echoing server prose. Only a 409 maps to it —
 * every other failure stays a plain error so a server fault can never be
 * framed as a policy decision.
 */
export async function republishTemplateVersion(
  projectId: string,
  templateId: string,
  contract: RepublishTemplateVersionRequest,
): Promise<ErrorResult<RepublishTemplateVersionResponse>> {
  return toResult(async () => {
    try {
      return await apiClient<RepublishTemplateVersionResponse>(
        `/api/v1/projects/${projectId}/templates/${templateId}/republish-version`,
        // The body is REQUIRED by the endpoint (B-9b2b): sending none would
        // be a 422, never a silent unchecked publish. Passed as the object —
        // apiClient owns the stringify, and a pre-stringified body ships as
        // a JSON string literal the server refuses with the same 422.
        {method: 'POST', body: contract},
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw new TemplatePublishRefusal(
          error.message,
          error.code as TemplatePublishRefusalCode,
          parsePublishSectionLabels(error.details),
        );
      }
      throw error;
    }
  }, 'republishTemplateVersion');
}

/**
 * A `POST .../discard-draft` the server deliberately refused (409, B-9c2 D3).
 *
 * Mirrors `PgError`'s discipline: a plain `Error` subclass passes through
 * `normalizeError`/`toResult` untouched, so callers branch on `instanceof`
 * instead of casting — and `ApiError` never escapes `frontend/services/`.
 * Unlike `PgError` this one also carries a payload, because the orphan
 * pane has to list the fields by name.
 */
export class TemplateDiscardRefusal extends Error {
  constructor(
    message: string,
    /** The server's refusal code. Typed as the generated union because
     * that is the contract; a value outside it is still delivered, and
     * the copy layer falls back to the generic outcome (D5/D9). */
    public readonly code: TemplateDiscardRefusalCode,
    public readonly orphans: readonly TemplateDiscardOrphan[] = [],
  ) {
    super(message);
    this.name = 'TemplateDiscardRefusal';
  }
}

/**
 * Runtime-validate `error.details.orphans`.
 *
 * The generated type says what the server *should* send; this guard is what
 * makes rendering safe. Anything without a string `label` is dropped rather
 * than surfaced as `undefined`, and a non-string `node_id` degrades to null
 * (it is a hint, never displayed).
 */
function parseDiscardOrphans(details: unknown): TemplateDiscardOrphan[] {
  if (!details || typeof details !== 'object') return [];
  const raw = (details as {orphans?: unknown}).orphans;
  if (!Array.isArray(raw)) return [];

  const orphans: TemplateDiscardOrphan[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const {node_id: nodeId, label} = entry as {node_id?: unknown; label?: unknown};
    if (typeof label !== 'string') continue;
    orphans.push({nodeId: typeof nodeId === 'string' ? nodeId : null, label});
  }
  return orphans;
}

/**
 * Discard the unpublished draft, restoring the live structure to the
 * active published version (B-9c1 backend, B-9c2 UI).
 *
 * `acknowledgeOrphans` is never defaulted true: the first POST is the
 * question ("these recorded answers will be stranded"), the second is the
 * answer. Only a 409 is a deliberate refusal — every other failure
 * (500, timeout, offline) flows through the normal error path so the UI
 * cannot frame a server fault as a policy decision.
 */
export async function discardTemplateDraft(
  projectId: string,
  templateId: string,
  opts: {acknowledgeOrphans?: boolean} = {},
): Promise<ErrorResult<DiscardDraftResponse>> {
  return toResult(async () => {
    try {
      return await apiClient<DiscardDraftResponse>(
        `/api/v1/projects/${projectId}/templates/${templateId}/discard-draft`,
        {
          method: 'POST',
          body: {acknowledge_orphans: opts.acknowledgeOrphans ?? false},
        },
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw new TemplateDiscardRefusal(
          error.message,
          error.code as TemplateDiscardRefusalCode,
          parseDiscardOrphans(error.details),
        );
      }
      throw error;
    }
  }, 'discardTemplateDraft');
}

/** Draft/publish status for the Configuration tab's chip (B-4). */
export async function loadTemplateConfigStatus(
  projectId: string,
  templateId: string,
): Promise<ErrorResult<TemplateConfigStatus>> {
  return toResult(
    async () =>
      apiClient<TemplateConfigStatus>(
        `/api/v1/projects/${projectId}/templates/${templateId}/config-status`,
      ),
    'loadTemplateConfigStatus',
  );
}

/**
 * What the open draft would publish, bucketed by severity tier (B-9b2a).
 *
 * All three shapes are HTTP 200 — an un-diffable template is a state the
 * sheet explains, not an error — so only transport failures reach the
 * ErrorResult branch.
 */
export async function loadTemplateConfigDiff(
  projectId: string,
  templateId: string,
): Promise<ErrorResult<TemplateConfigDiff>> {
  return toResult(
    async () =>
      apiClient<TemplateConfigDiff>(
        `/api/v1/projects/${projectId}/templates/${templateId}/config-diff`,
      ),
    'loadTemplateConfigDiff',
  );
}

/**
 * The published-version timeline (B-9e).
 *
 * Read-only and manager-gated server-side; an empty `versions` array is a
 * real state (a template that never published), never an error.
 */
export async function loadTemplateVersionHistory(
  projectId: string,
  templateId: string,
): Promise<ErrorResult<TemplateVersionHistory>> {
  return toResult(
    async () =>
      apiClient<TemplateVersionHistory>(
        `/api/v1/projects/${projectId}/templates/${templateId}/versions`,
      ),
    'loadTemplateVersionHistory',
  );
}

/**
 * Stage an older version's shape as the current draft (B-9e).
 *
 * Never rewrites history: the tree is reconciled to that version and the
 * draft marker stays stamped, so it lands as v_max+1 through the ordinary
 * Publish sheet.
 */
export async function restoreTemplateVersion(
  projectId: string,
  templateId: string,
  versionId: string,
): Promise<ErrorResult<RestoreVersionResponse>> {
  return toResult(
    async () =>
      apiClient<RestoreVersionResponse>(
        `/api/v1/projects/${projectId}/templates/${templateId}/versions/${versionId}/restore`,
        {method: 'POST'},
      ),
    'restoreTemplateVersion',
  );
}

/** Seize the advisory editor lock (B-9f). Unconditional by design. */
export async function takeOverDraftLock(
  projectId: string,
  templateId: string,
): Promise<ErrorResult<TakeOverDraftLockResponse>> {
  return toResult(
    async () =>
      apiClient<TakeOverDraftLockResponse>(
        `/api/v1/projects/${projectId}/templates/${templateId}/draft-lock/take-over`,
        {method: 'POST'},
      ),
    'takeOverDraftLock',
  );
}

// Entity-type LOADING lives in `useTemplateEntityTypes` (one cached
// PostgREST read, shared by the editor and the grid panel). The imperative
// `loadTemplateEntityTypes` this file used to export was its last caller's
// private reload protocol and went with the B-9c2 editor migration.

// --- Entity type label update ---

/**
 * Update the label of an entity type (section rename) via the typed
 * rename endpoint — the label is the only client-editable attribute
 * after creation.
 * NOTE: on success the caller should show a toast using the extraction
 * 'labelUpdatedSuccess' copy key.
 */
export async function updateEntityTypeLabel(
  projectId: string,
  templateId: string,
  entityTypeId: string,
  label: string,
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    await apiClient<SectionRead>(
      `/api/v1/projects/${projectId}/templates/${templateId}/sections/${entityTypeId}`,
      {method: 'PATCH', body: {label}},
    );
  }, 'updateEntityTypeLabel');
}

// --- Section update (B-8 D5) ---

/** Partial section update — provided keys only; explicit nulls are
 * rejected by the endpoint (omit instead), so the param type bans them.
 * `description` is the section's AI instruction; a blank string clears it
 * (the one column where emptying is a legitimate edit). */
export interface UpdateSectionChanges {
  label?: string;
  entry_label?: string;
  cardinality?: SectionCardinality;
  description?: string;
}

/**
 * PATCH a section's label / entry_label / cardinality / description via the
 * typed endpoint (rules live server-side: entry_label on repeating sections
 * only, cardinality on per-model sections only).
 *
 * A many→one switch is REFUSED with a 409 while any model still holds
 * multiple entries of the section — re-wrapped as PgError('23503')
 * carrying friendly copy, the same translate-verbatim contract as
 * `deleteSection` (the T6 inspector toasts it as-is; the raw backend
 * message never reaches the user). NOTE: caller toasts success/error.
 */
export async function updateSection(
  projectId: string,
  templateId: string,
  sectionId: string,
  changes: UpdateSectionChanges,
): Promise<ErrorResult<SectionRead>> {
  return toResult(async () => {
    try {
      return await apiClient<SectionRead>(
        `/api/v1/projects/${projectId}/templates/${templateId}/sections/${sectionId}`,
        {method: 'PATCH', body: changes},
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw new PgError(t('templateConfig', 'errors_cardinalityInUse'), '23503');
      }
      throw error;
    }
  }, 'updateSection');
}

// --- Section deletion ---

/**
 * Delete an entity type via the typed endpoint (the DB cascades fields
 * and child sections).
 *
 * Recorded extraction work anywhere under the section (RESTRICT FKs)
 * refuses the delete with a 409 — no client-side probe precedes this
 * write, so this translation is the real invariant: re-wrap
 * as a typed PgError ('23503', the SQLSTATE behind the refusal)
 * carrying friendly copy. The editor's section delete toasts exactly that
 * pair to toast it verbatim; the raw backend message never reaches the
 * user. NOTE: caller toasts success/error.
 */
export async function deleteSection(
  projectId: string,
  templateId: string,
  entityTypeId: string,
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    try {
      await apiClient<SectionDeleteResponse>(
        `/api/v1/projects/${projectId}/templates/${templateId}/sections/${entityTypeId}`,
        {method: 'DELETE'},
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw new PgError(t('templateConfig', 'errors_deleteSectionInUse'), '23503');
      }
      throw error;
    }
  }, 'deleteSection');
}

// --- Global templates ---

export interface GlobalTemplateWithCount {
  id: string;
  name: string;
  framework: 'CHARMS' | 'PICOS' | 'CUSTOM';
  description: string | null;
  version: string | null;
  is_global: boolean;
  schema: unknown;
  created_at: string | null;
  updated_at: string | null;
  entityTypesCount: number;
}

/**
 * Load all global extraction templates with entity-type counts.
 * Single round-trip: counts computed client-side over the flat entity-type
 * rows (tiny set, far cheaper than N per-template count queries).
 *
 * Scoped to `kind = 'extraction'`: the global catalogue holds both lineages,
 * and quality-assessment tools (PROBAST, QUADAS-2) belong to the QA
 * configuration screen — `qaTemplateService.fetchGlobalTemplates` reads them.
 */
export function loadGlobalTemplates(): Promise<ErrorResult<GlobalTemplateWithCount[]>> {
  return toResult(async () => {
    const {data: templatesData, error: templatesError} = await supabase
      .from('extraction_templates_global')
      .select('*')
      .eq('is_global', true)
      .eq('kind', 'extraction')
      .order('framework', {ascending: true});

    if (templatesError) throw templatesError;

    if (!templatesData || templatesData.length === 0) return [];

    const templateIds = templatesData.map((t) => t.id);
    const {data: entityTypeRows, error: countError} = await supabase
      .from('extraction_entity_types')
      .select('template_id')
      .in('template_id', templateIds);

    if (countError) throw countError;

    const countByTemplateId = new Map<string, number>();
    for (const row of entityTypeRows ?? []) {
      const tid = (row as {template_id: string}).template_id;
      countByTemplateId.set(tid, (countByTemplateId.get(tid) ?? 0) + 1);
    }

    return templatesData.map((template) => ({
      id: template.id,
      name: template.name,
      framework: template.framework as 'CHARMS' | 'PICOS' | 'CUSTOM',
      description: template.description,
      version: template.version,
      is_global: template.is_global,
      schema: template.schema,
      created_at: template.created_at,
      updated_at: template.updated_at,
      entityTypesCount: countByTemplateId.get(template.id) ?? 0,
    }));
  }, 'loadGlobalTemplates');
}

// --- Section creation ---

export interface CreateSectionParams {
  projectId: string;
  templateId: string;
  name: string;
  label: string;
  description?: string | null;
  cardinality: 'one' | 'many';
  /** Structural role — the caller states its intent (the old service
   * hard-coded study_section). */
  role: SectionRole;
  /** Owning group for a model_section (B-8); roots and containers omit
   * it — the endpoint enforces the role/parent pairing. */
  parentEntityTypeId?: string | null;
  /** Entry noun (B-8 D3, entry-group train): required by the server on
   * every repeating section, refused on one that does not repeat. */
  entryLabel?: string | null;
  isRequired: boolean;
}

/**
 * Create a root entity type via the typed endpoint. `sort_order` is
 * deliberately NOT sent: the server computes max+1 inside the INSERT,
 * killing the old read-then-write race.
 * NOTE: caller toasts success using extraction 'sectionCreatedSuccess' copy key.
 */
export async function createSection(
  params: CreateSectionParams,
): Promise<ErrorResult<SectionRead>> {
  return toResult(async () => {
    // Returns the created row rather than discarding it: undoing a
    // section delete replays the subtree, and every child section and
    // field has to be created against the NEW id (B-9d part 2).
    return await apiClient<SectionRead>(
      `/api/v1/projects/${params.projectId}/templates/${params.templateId}/sections`,
      {
        method: 'POST',
        body: {
          name: params.name,
          label: params.label,
          description: params.description || null,
          cardinality: params.cardinality,
          role: params.role,
          parent_entity_type_id: params.parentEntityTypeId ?? null,
          entry_label: params.entryLabel ?? null,
          is_required: params.isRequired,
        },
      },
    );
  }, 'createSection');
}

