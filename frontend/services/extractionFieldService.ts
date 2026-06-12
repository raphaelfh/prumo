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
import {toResult, type ErrorResult} from '@/lib/error-utils';
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
// Field loading
// ---------------------------------------------------------------------------

/**
 * Load all fields for a given entity type, ordered by sort_order.
 */
export function loadEntityTypeFields(
  entityTypeId: string,
): Promise<ErrorResult<ExtractionField[]>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('extraction_fields')
      .select('*')
      .eq('entity_type_id', entityTypeId)
      .order('sort_order', {ascending: true});

    if (error) throw error;
    return (data as ExtractionField[]) ?? [];
  }, 'loadEntityTypeFields');
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
 * Count reviewer decisions (non-reject) for a field, grouped by article.
 * Used to determine whether a field can be deleted or its type changed.
 */
export function validateFieldImpact(
  fieldId: string,
  safeMessage: string,
  inUseMessage: (count: number, articles: number) => string,
): Promise<ErrorResult<FieldValidationResult>> {
  return toResult(async () => {
    const {data: decisionRows, error: decisionsError} = await supabase
      .from('extraction_reviewer_decisions')
      .select('id, decision, run:run_id(article_id)')
      .eq('field_id', fieldId)
      .neq('decision', 'reject');

    if (decisionsError) throw decisionsError;

    const extractedCount = decisionRows?.length ?? 0;
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
 */
export function deleteField(fieldId: string): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const {error} = await supabase
      .from('extraction_fields')
      .delete()
      .eq('id', fieldId);

    if (error) throw error;
  }, 'deleteField');
}

/**
 * Batch-update sort_order for a set of fields.
 * PostgREST resolves (never rejects) on SQL/RLS errors — so we inspect
 * each result for an error field rather than relying on Promise.all to throw.
 */
export function reorderFields(
  reorderedFields: {id: string; sort_order: number}[],
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const updates = reorderedFields.map(({id, sort_order}) =>
      supabase
        .from('extraction_fields')
        .update({sort_order})
        .eq('id', id),
    );

    const results = await Promise.all(updates);
    const failed = results
      .map((r) => (r as {error: {message: string} | null}).error)
      .filter((e): e is {message: string} => Boolean(e));

    if (failed.length > 0) {
      throw new Error(
        `Failed to update sort_order for ${failed.length} field(s): ${failed[0].message}`,
      );
    }
  }, 'reorderFields');
}
