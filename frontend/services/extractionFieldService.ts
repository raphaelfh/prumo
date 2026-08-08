/**
 * Extraction field service — CRUD IO for extraction fields and permission
 * checks on project members.
 *
 * Service-layer contract (zero-bailouts spec): exported functions never
 * throw across the boundary; they return ErrorResult<T>. try/catch and
 * throw are free here — module-level functions are not compiled by the
 * React Compiler.
 *
 * @module services/extractionFieldService
 */

import {supabase} from '@/integrations/supabase/client';
import {t} from '@/lib/copy';
import {PgError, toResult, type ErrorResult} from '@/lib/error-utils';
import type {
  ExtractionField,
  ExtractionFieldInsert,
  ExtractionFieldUpdate,
  PermissionCheckResult,
  ProjectMemberRole,
} from '@/types/extraction';

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
 * published rows RESTRICT at the DB yet count 0 here — the SQLSTATE
 * 23503 mapping in `deleteField` is the real invariant. This probe just
 * explains the common in-use cases before the database refuses.
 */
export function validateFieldImpact(
  fieldId: string,
  safeMessage: string,
  inUseMessage: (count: number, articles: number) => string,
): Promise<ErrorResult<FieldValidationResult>> {
  return toResult(async () => {
    // Honest debt: the proposal-records count is a direct workflow-table
    // read from the frontend — parked at B-7 with the typed-endpoint
    // consolidation (same as the reviewer-decisions read above it).
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
// Field CRUD
// ---------------------------------------------------------------------------

/**
 * Insert a new field and return the created row.
 */
export function insertField(
  newField: ExtractionFieldInsert,
): Promise<ErrorResult<ExtractionField>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('extraction_fields')
      .insert(newField)
      .select()
      .single();

    if (error) throw error;
    return data as ExtractionField;
  }, 'insertField');
}

/**
 * Update an existing field and return the updated row.
 */
export function updateField(
  fieldId: string,
  updates: ExtractionFieldUpdate,
): Promise<ErrorResult<ExtractionField>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('extraction_fields')
      .update(updates)
      .eq('id', fieldId)
      .select()
      .single();

    if (error) throw error;
    return data as ExtractionField;
  }, 'updateField');
}

/**
 * Delete a field by id.
 *
 * A RESTRICT foreign key (proposal records, reviewer decisions/states,
 * consensus decisions, published states) refuses the delete with
 * SQLSTATE 23503. The advisory probe above can miss those rows, so THIS
 * mapping is the real invariant: re-wrap as a typed PgError carrying the
 * friendly copy — the raw Postgres FK message must never reach a toast.
 */
export function deleteField(fieldId: string): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const {error} = await supabase
      .from('extraction_fields')
      .delete()
      .eq('id', fieldId);

    if (error?.code === '23503') {
      throw new PgError(t('extraction', 'errors_deleteFieldInUse'), error.code);
    }
    if (error) throw error;
  }, 'deleteField');
}
