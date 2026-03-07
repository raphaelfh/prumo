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

export interface QueryOptions {
  select?: string;
  filters?: Record<string, unknown>;
  orderBy?: { column: string; ascending?: boolean };
  limit?: number;
  single?: boolean;
}

export interface RepositoryResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

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

export class AuthenticationError extends Error {
    constructor(message = 'User not authenticated') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

// =================== HELPERS ===================

/**
 * Ensures user is authenticated
 */
export async function requireAuth(): Promise<string> {
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (error || !session) {
    throw new AuthenticationError();
  }
  
  return session.access_token;
}

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
 * Generic query builder for Supabase (returns array)
 *
 * NOTE: Uses type assertion due to strict Supabase typing.
 * For complex queries, use supabase.from() directly.
 * 
 * @example
 * ```typescript
 * const result = await queryBuilder<Article>('articles', {
 *   select: '*',
 *   filters: { project_id: projectId },
 *   orderBy: { column: 'created_at', ascending: false },
 *   limit: 10
 * });
 * ```
 */
export async function queryBuilder<T>(
  table: string,
  options: QueryOptions = {}
): Promise<RepositoryResult<T[]>> {
  const { select = '*', filters = {}, orderBy, limit, single = false } = options;

    // Type assertion needed: Supabase expects table literals but we pass dynamic strings

    let query = (supabase.from(table as any) as DynamicSupabaseTable).select(select);

    // Apply filters
  Object.entries(filters).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      query = query.is(key, null);
    } else if (Array.isArray(value)) {
      query = query.in(key, value);
    } else {
      query = query.eq(key, value);
    }
  });

    // Order
  if (orderBy) {
    query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
  }

    // Limit
  if (limit) {
    query = query.limit(limit);
  }

    // Execute query
    // Query object after filters is thenable (can be awaited directly)
  if (single) {
    const { data, error } = await query.single();
      // When single=true, return as array with one element (or null)
    return { data: data ? [data as T] : null, error };
  }

    // For multiple rows, await directly (do not call as function)
  const { data, error } = await query;
  return { data: (data || []) as T[], error };
}

/**
 * Query builder for single result (returns T | null)
 */
export async function queryBuilderSingle<T>(
  table: string,
  options: Omit<QueryOptions, 'single'> = {}
): Promise<RepositoryResult<T>> {
  const result = await queryBuilder<T>(table, { ...options, single: true });
  return { 
    data: result.data ? (result.data[0] as T) : null, 
    error: result.error 
  };
}

/**
 * Standardized insert helper
 *
 * NOTE: Uses type assertion due to strict Supabase typing.
 */
export async function insertOne<T>(
  table: string,
  data: Partial<T>,
  context = 'insert'
): Promise<T> {

    const { data: result, error } = await (supabase.from(table as any) as DynamicSupabaseTable)
    .insert(data)
    .select()
    .single();

  if (error) {
    handleSupabaseError(error, context);
  }

  if (!result) {
      throw new SupabaseRepositoryError(`Failed to insert into ${table}: no data returned`);
  }

  return result as T;
}

/**
 * Standardized insert many helper
 *
 * NOTE: Uses type assertion due to strict Supabase typing.
 */
export async function insertMany<T>(
  table: string,
  data: Partial<T>[],
  context = 'insertMany'
): Promise<T[]> {

    const { data: result, error } = await (supabase.from(table as any) as DynamicSupabaseTable)
    .insert(data)
    .select();

  if (error) {
    handleSupabaseError(error, context);
  }

  return (result || []) as T[];
}

/**
 * Standardized update helper
 *
 * NOTE: Uses type assertion due to strict Supabase typing.
 */
export async function updateOne<T>(
  table: string,
  id: string,
  updates: Partial<T>,
  context = 'update'
): Promise<T> {

    const { data: result, error } = await (supabase.from(table as any) as DynamicSupabaseTable)
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    handleSupabaseError(error, context);
  }

  if (!result) {
      throw new SupabaseRepositoryError(`Failed to update ${table} (id: ${id}): no data returned`);
  }

  return result as T;
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
