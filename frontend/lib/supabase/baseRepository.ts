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
 * Standardized delete helper
 *
 * NOTE: Uses type assertion due to strict Supabase typing.
 */
export async function deleteOne(
  table: string,
  id: string,
  context = 'delete'
): Promise<void> {

    const { error } = await (supabase.from(table as any) as DynamicSupabaseTable)
    .delete()
    .eq('id', id);

  if (error) {
    handleSupabaseError(error, context);
  }
}
