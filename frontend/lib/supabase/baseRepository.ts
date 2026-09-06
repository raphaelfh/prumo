/**
 * Base repository for standardized Supabase calls
 *
 * Abstracts common Supabase usage, standardizing:
 * - Error handling
 * - Authentication checks
 * - Structured logging
 *
 * Follows DRY: avoids code duplication in services.
 *
 * @module lib/supabase/baseRepository
 */

import {supabase} from '@/integrations/supabase/client';
import type {PostgrestError} from '@supabase/supabase-js';

// =================== TYPES ===================

/**
 * Type helper to work around strict Supabase typing for dynamic queries.
 * Supabase client expects literal table names; this repository uses dynamic strings.
 * We use 'as any' only on .from() to allow dynamic table names.
 */

type DynamicSupabaseTable = any;

// =================== ERRORS ===================

export class SupabaseRepositoryError extends Error {
  constructor(
    message: string,
    public readonly originalError?: PostgrestError | Error,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SupabaseRepositoryError';
  }
}


// =================== HELPERS ===================


/**
 * Handles Supabase error consistently
 */
export function handleSupabaseError(
  error: PostgrestError | null,
  context: string,
  customMessage?: string
): never {
  if (!error) {
    throw new SupabaseRepositoryError(
        customMessage || `Unknown error in ${context}`
    );
  }

  throw new SupabaseRepositoryError(
      customMessage || `Failed in ${context}: ${error.message}`,
    error,
    { code: error.code, details: error.details, hint: error.hint }
  );
}

/**
 * Standardized delete helper. Rejects unless a row was actually deleted.
 *
 * The `.select()` is load-bearing, not decoration. Under RLS a DELETE that
 * matches zero visible rows is NOT an error — Postgres did not fail, it
 * matched nothing — so PostgREST answers success with no rows. Checking only
 * `error` therefore cannot tell "denied" from "done", and the caller reports
 * success over an untouched row. That shipped once: a reviewer's click on the
 * run form's trash icon toasted "removed" while the entry stayed put, because
 * `extraction_instances_delete` is manager-only.
 *
 * The refusal deliberately does NOT distinguish "no such row" from "not
 * permitted": telling them apart makes this an existence oracle for rows the
 * caller may not see, which is the same reason the backend's `owned_article`
 * answers both identically.
 *
 * PRECONDITION for a new caller: the table's SELECT policy must be at least as
 * permissive as its DELETE policy, or a successful delete returns no rows and
 * is misreported as a failure. True for `extraction_instances` (SELECT is
 * `is_project_member`, DELETE is `is_project_manager`) — check it before
 * pointing this helper at another table.
 *
 * NOTE: Uses type assertion due to strict Supabase typing.
 */
export async function deleteOne(
  table: string,
  id: string,
  context = 'delete'
): Promise<void> {
  const { data, error } = await (supabase.from(table as any) as DynamicSupabaseTable)
    .delete()
    .eq('id', id)
    .select('id');

  if (error) {
    handleSupabaseError(error, context);
  }

  if (!data || data.length === 0) {
    throw new SupabaseRepositoryError(
      `Failed in ${context}: no row was deleted — it does not exist, or row-level security hides it from this user`,
      undefined,
      { table, id }
    );
  }
}
