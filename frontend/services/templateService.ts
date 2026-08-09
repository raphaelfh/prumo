/**
 * Template structure CRUD service (entity-types, sections).
 *
 * IO for template configuration: loading entity types, updating labels,
 * adding/removing sections, creating custom templates.  Article-list
 * queries live in articlesService.ts; auth queries in authService.ts.
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

export type TemplateConfigStatus =
  components['schemas']['TemplateConfigStatusRead'];

export type DiscardDraftResponse = components['schemas']['DiscardDraftResponse'];

export type TemplateDiscardRefusalCode =
  components['schemas']['TemplateDiscardRefusalCode'];

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
 * Publish the live template structure as a new active version.
 *
 * B-4: this is the explicit Publish button's call — config edits are
 * draft edits (the DB stamps `config_draft_since`) and only this
 * publish moves snapshots, prompts and editable-stage run pins.
 *
 * A 409 is the publish-time many→one cardinality re-check (B-8 review):
 * its server message names the offending section, which no static copy
 * key can carry — re-wrapped as PgError('409') with the message
 * VERBATIM so useTemplateRepublish toasts it instead of the generic
 * failure copy.
 */
export async function republishTemplateVersion(
  projectId: string,
  templateId: string,
): Promise<ErrorResult<RepublishTemplateVersionResponse>> {
  return toResult(async () => {
    try {
      return await apiClient<RepublishTemplateVersionResponse>(
        `/api/v1/projects/${projectId}/templates/${templateId}/republish-version`,
        {method: 'POST'},
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw new PgError(error.message, '409');
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

export interface SectionImpact {
  fieldsCount: number;
  instancesCount: number;
  dataCount: number;
  canDelete: boolean;
  warnings: string[];
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
 * rejected by the endpoint (omit instead), so the param type bans them. */
export interface UpdateSectionChanges {
  label?: string;
  entry_label?: string;
  cardinality?: SectionCardinality;
}

/**
 * PATCH a section's label / entry_label / cardinality via the typed
 * endpoint (role rules live server-side: entry_label on groups only,
 * cardinality on per-model sections only).
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

// --- Section removal impact analysis ---

/**
 * Analyze the impact of removing a section (entity type).
 * Returns field/instance/data counts and warnings so the component can
 * present them before the user confirms.
 *
 * ADVISORY only, and honest debt: these are direct workflow-table reads
 * from the frontend. B-7 moved only the config WRITES onto typed
 * endpoints; these reads move with the read-path consolidation
 * follow-up (the multi-line fitness-regex fix + honest baseline, split
 * out of B-7). The real refusal is `deleteSection`'s 409 remap.
 */
export async function analyzeSectionRemovalImpact(
  entityTypeId: string,
): Promise<ErrorResult<SectionImpact>> {
  return toResult(async () => {
    // Count section fields
    const {count: fieldsCount, error: fieldsError} = await supabase
      .from('extraction_fields')
      .select('id', {count: 'exact', head: true})
      .eq('entity_type_id', entityTypeId);

    if (fieldsError) throw fieldsError;

    // Count section instances
    const {count: instancesCount, error: instancesError} = await supabase
      .from('extraction_instances')
      .select('id', {count: 'exact', head: true})
      .eq('entity_type_id', entityTypeId);

    if (instancesError) throw instancesError;

    // Count non-reject reviewer decisions tied to instances of this type
    const {data: typeInstances} = await supabase
      .from('extraction_instances')
      .select('id')
      .eq('entity_type_id', entityTypeId);
    const typeInstanceIds = (typeInstances || []).map((i) => i.id);
    let dataCount = 0;
    if (typeInstanceIds.length > 0) {
      const {count, error: dataError} = await supabase
        .from('extraction_reviewer_decisions')
        .select('id', {count: 'exact', head: true})
        .in('instance_id', typeInstanceIds)
        .neq('decision', 'reject');
      if (dataError) {
        console.warn('Could not count reviewer decisions:', dataError);
      } else {
        dataCount = count ?? 0;
      }
    }

    return {
      fieldsCount: fieldsCount || 0,
      instancesCount: instancesCount || 0,
      dataCount,
      canDelete: true,
      warnings: [], // Caller builds warnings from counts + copy keys
    } satisfies SectionImpact;
  }, 'analyzeSectionRemovalImpact');
}

// --- Section deletion ---

/**
 * Delete an entity type via the typed endpoint (the DB cascades fields
 * and child sections).
 *
 * Recorded extraction work anywhere under the section (RESTRICT FKs)
 * refuses the delete with a 409 — the advisory impact probe above can
 * miss those rows, so this translation is the real invariant: re-wrap
 * as a typed PgError ('23503', the SQLSTATE behind the refusal)
 * carrying friendly copy. RemoveSectionDialog branches on exactly that
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

// --- Custom template creation ---

export interface CreateCustomTemplateParams {
  projectId: string;
  name: string;
  description?: string | null;
  framework: 'CUSTOM' | 'CHARMS' | 'PICOS';
  createdBy: string;
}

export interface CreatedTemplate {
  id: string;
  name: string;
}

/**
 * Insert a new project_extraction_templates row.
 * NOTE: caller toasts success ("${name}" created) + info (add sections).
 */
export async function createCustomTemplate(
  params: CreateCustomTemplateParams,
): Promise<ErrorResult<CreatedTemplate>> {
  return toResult(async () => {
    const {data: template, error} = await supabase
      .from('project_extraction_templates')
      .insert({
        project_id: params.projectId,
        name: params.name,
        description: params.description,
        framework: params.framework,
        version: '1.0.0',
        schema: {
          description: params.description || '',
          custom: true,
          created_via_ui: true,
        },
        is_active: true,
        created_by: params.createdBy,
      })
      .select()
      .single();

    if (error) throw error;

    return {id: template.id, name: template.name} satisfies CreatedTemplate;
  }, 'createCustomTemplate');
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
  /** Repeating-group entry noun (B-8 D3) — model_container only; the
   * server defaults a blank/omitted value to 'model'. */
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
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    await apiClient<SectionRead>(
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

