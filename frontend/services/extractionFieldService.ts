/**
 * Extraction field service — field writes on the typed B-7 endpoints,
 * plus permission checks and the ADVISORY impact probe.
 *
 * Writes (insert/update/delete/move/reorder) go through apiClient onto
 * `/api/v1/projects/{pid}/templates/{tid}/fields...` — manager-gated,
 * BOLA-checked and server-validated. Reads (permission probe, impact
 * probe) stay PostgREST until the read-path consolidation follow-up.
 *
 * Service-layer contract (zero-bailouts spec): exported functions never
 * throw across the boundary; they return ErrorResult<T>. try/catch and
 * throw are free here — module-level functions are not compiled by the
 * React Compiler.
 *
 * @module services/extractionFieldService
 */

import {ApiError, apiClient} from '@/integrations/api/client';
import {supabase} from '@/integrations/supabase/client';
import {t} from '@/lib/copy';
import {PgError, toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';
import type {
  ExtractionField,
  ExtractionFieldInsert,
  ExtractionFieldUpdate,
  PermissionCheckResult,
  ProjectMemberRole,
} from '@/types/extraction';

type TemplateFieldRead = components['schemas']['TemplateFieldRead'];
type TemplateFieldDeleteResponse =
  components['schemas']['TemplateFieldDeleteResponse'];
type TemplateFieldReorderResponse =
  components['schemas']['TemplateFieldReorderResponse'];

/**
 * The endpoint payload mirrors `ExtractionField` 1:1 at runtime
 * (Pydantic serializes every key, defaulted or not); the generated type
 * only marks server-defaulted keys optional, so one normalizing cast
 * bridges the generated shape to the editor's interface.
 */
function toExtractionField(row: TemplateFieldRead): ExtractionField {
  return row as ExtractionField;
}

/**
 * The typed endpoints refuse a duplicate per-section field name with a
 * 409 (uniqueness is server-enforced since B-7). Re-wrap as a typed
 * PgError carrying the friendly copy — 23505 mirrors the unique
 * violation the DB raises for the same conflict. Everything else
 * (404 family, 422 cross-template, network) passes through untouched.
 */
function rethrowFieldWriteRefusal(error: unknown): never {
  if (error instanceof ApiError && error.status === 409) {
    throw new PgError(t('templateConfig', 'errors_duplicateFieldName'), '23505');
  }
  throw error;
}

// ---------------------------------------------------------------------------
// Permission check
// ---------------------------------------------------------------------------

/**
 * Check what actions the given user is allowed to perform on a project.
 * Returns a full PermissionCheckResult — never throws.
 */
export function checkProjectPermissions(
  userId: string,
  projectId: string,
): Promise<ErrorResult<PermissionCheckResult>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .single();

    if (error) throw error;

    const role = data?.role as ProjectMemberRole;
    const isManager = role === 'manager';

    return {
      canView: true,
      canEdit: isManager,
      canDelete: isManager,
      canCreate: isManager,
      role,
    } satisfies PermissionCheckResult;
  }, 'checkProjectPermissions');
}

// ---------------------------------------------------------------------------
// Field impact validation
// ---------------------------------------------------------------------------

export interface FieldValidationResult {
  canDelete: boolean;
  canUpdate: boolean;
  canChangeType: boolean;
  extractedValuesCount: number;
  affectedArticles: string[];
  message: string;
}

/**
 * Count workflow rows referencing a field — reviewer decisions
 * (non-reject, grouped by article) plus AI/human proposal records.
 * Used to determine whether a field can be deleted or its type changed.
 *
 * ADVISORY only (B-5 Task 7): reject-only decisions and consensus/
 * published rows RESTRICT at the DB yet count 0 here — the 409 →
 * PgError('23503') translation in `deleteField` is the real invariant.
 * This probe just explains the common in-use cases before the backend
 * refuses.
 */
export function validateFieldImpact(
  fieldId: string,
  safeMessage: string,
  inUseMessage: (count: number, articles: number) => string,
): Promise<ErrorResult<FieldValidationResult>> {
  return toResult(async () => {
    // Honest debt: the proposal-records count is a direct workflow-table
    // read from the frontend (same as the reviewer-decisions read below
    // it). B-7 moved only the config WRITES onto typed endpoints; these
    // reads move with the read-path consolidation follow-up (the
    // multi-line fitness-regex fix + honest baseline, split out of B-7).
    const [decisionsResult, proposalsResult] = await Promise.all([
      supabase
        .from('extraction_reviewer_decisions')
        .select('id, decision, run:run_id(article_id)')
        .eq('field_id', fieldId)
        .neq('decision', 'reject'),
      supabase
        .from('extraction_proposal_records')
        .select('id', {count: 'exact', head: true})
        .eq('field_id', fieldId),
    ]);

    if (decisionsResult.error) throw decisionsResult.error;
    if (proposalsResult.error) throw proposalsResult.error;

    const decisionRows = decisionsResult.data;
    const proposalCount = proposalsResult.count ?? 0;
    const extractedCount = (decisionRows?.length ?? 0) + proposalCount;
    const affectedArticles = Array.from(
      new Set(
        (decisionRows ?? [])
          .map((d: {run: {article_id: string} | {article_id: string}[] | null}) => {
            const run = Array.isArray(d.run) ? d.run[0] : d.run;
            return run?.article_id;
          })
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const hasValues = extractedCount > 0;

    return {
      canDelete: !hasValues,
      canUpdate: true,
      canChangeType: !hasValues,
      extractedValuesCount: extractedCount,
      affectedArticles,
      message: hasValues
        ? inUseMessage(extractedCount, affectedArticles.length)
        : safeMessage,
    };
  }, 'validateFieldImpact');
}

// ---------------------------------------------------------------------------
// Field CRUD (typed endpoints — B-7)
// ---------------------------------------------------------------------------

/**
 * Create a field in a section of the template and return the created
 * row. A duplicate per-section name is a 409 → friendly PgError.
 */
export function insertField(
  projectId: string,
  templateId: string,
  newField: ExtractionFieldInsert,
): Promise<ErrorResult<ExtractionField>> {
  return toResult(async () => {
    try {
      const row = await apiClient<TemplateFieldRead>(
        `/api/v1/projects/${projectId}/templates/${templateId}/fields`,
        {method: 'POST', body: newField},
      );
      return toExtractionField(row);
    } catch (error) {
      rethrowFieldWriteRefusal(error);
    }
  }, 'insertField');
}

/**
 * Partially update a field and return the updated row. Only the given
 * keys are applied server-side; relocation is `moveField`'s job (the
 * endpoint rejects a smuggled entity_type_id).
 */
export function updateField(
  projectId: string,
  templateId: string,
  fieldId: string,
  updates: ExtractionFieldUpdate,
): Promise<ErrorResult<ExtractionField>> {
  return toResult(async () => {
    try {
      const row = await apiClient<TemplateFieldRead>(
        `/api/v1/projects/${projectId}/templates/${templateId}/fields/${fieldId}`,
        {method: 'PATCH', body: updates},
      );
      return toExtractionField(row);
    } catch (error) {
      rethrowFieldWriteRefusal(error);
    }
  }, 'updateField');
}

/**
 * Delete a field by id.
 *
 * Recorded extraction work (proposal records, reviewer decisions/
 * states, consensus decisions, published states — RESTRICT FKs) refuses
 * the delete with a 409. The advisory probe above can miss those rows,
 * so THIS translation is the real invariant: re-wrap as a typed PgError
 * ('23503', the SQLSTATE the DB raised behind the endpoint) carrying
 * the friendly copy — useDeleteTemplateField branches on exactly that
 * pair, and the raw backend message must never reach a toast.
 */
export function deleteField(
  projectId: string,
  templateId: string,
  fieldId: string,
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    try {
      await apiClient<TemplateFieldDeleteResponse>(
        `/api/v1/projects/${projectId}/templates/${templateId}/fields/${fieldId}`,
        {method: 'DELETE'},
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw new PgError(t('extraction', 'errors_deleteFieldInUse'), '23503');
      }
      throw error;
    }
  }, 'deleteField');
}

// ---------------------------------------------------------------------------
// Move + reorder
// ---------------------------------------------------------------------------

/** One row of a `reorderFields` batch. */
export interface FieldSortOrderUpdate {
  id: string;
  sort_order: number;
}

/**
 * Atomic batch renumber — callers renumber the whole affected
 * section(s), not just the moved row (sort_order is a per-section
 * RENDERING convention, not a DB invariant). Multi-section batches are
 * legal (a cross-section move renumbers two sections in one batch).
 * The endpoint applies the batch fully or not at all — the old
 * N-independent-UPDATEs partial-failure mode is gone.
 */
export function reorderFields(
  projectId: string,
  templateId: string,
  updates: FieldSortOrderUpdate[],
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    await apiClient<TemplateFieldReorderResponse>(
      `/api/v1/projects/${projectId}/templates/${templateId}/fields/reorder`,
      {method: 'POST', body: {updates}},
    );
  }, 'reorderFields');
}

/**
 * Move a field to another section: destination + landing position
 * (caller-computed, end of destination for live gestures).
 *
 * Deliberately NOT expressed through ExtractionFieldUpdate — the
 * inspector form schema must not learn entity_type_id, and the update
 * endpoint rejects it anyway. The server refuses a destination outside
 * the template (422 — the cross-template hole B-6 documented, closed
 * here) and a duplicate name in the destination (409 → friendly
 * PgError).
 */
export function moveField(
  projectId: string,
  templateId: string,
  fieldId: string,
  entityTypeId: string,
  sortOrder: number,
): Promise<ErrorResult<ExtractionField>> {
  return toResult(async () => {
    try {
      const row = await apiClient<TemplateFieldRead>(
        `/api/v1/projects/${projectId}/templates/${templateId}/fields/${fieldId}/move`,
        {method: 'POST', body: {entity_type_id: entityTypeId, sort_order: sortOrder}},
      );
      return toExtractionField(row);
    } catch (error) {
      rethrowFieldWriteRefusal(error);
    }
  }, 'moveField');
}
