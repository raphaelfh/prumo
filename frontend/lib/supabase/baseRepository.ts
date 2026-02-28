/**
 * Base Repository para chamadas Supabase padronizadas
 * 
 * Abstrai chamadas comuns ao Supabase, padronizando:
 * - Tratamento de erros
 * - Verificação de autenticação
 * - Logging estruturado
 * 
 * Segue princípio DRY: evita duplicação de código em services.
 * 
 * @module lib/supabase/baseRepository
 */

import {supabase} from '@/integrations/supabase/client';
import type {PostgrestError} from '@supabase/supabase-js';

// =================== TIPOS ===================

/**
 * Type helper para contornar tipagem estrita do Supabase em queries dinâmicas.
 * O Supabase client espera nomes literais de tabelas, mas este repository trabalha com strings dinâmicas.
 * Usamos 'as any' apenas na chamada .from() para permitir nomes dinâmicos de tabelas.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// =================== ERROS ===================

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
  constructor(message = 'Usuário não autenticado') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

// =================== HELPERS ===================

/**
 * Verifica se o usuário está autenticado
 */
export async function requireAuth(): Promise<string> {
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (error || !session) {
    throw new AuthenticationError();
  }
  
  return session.access_token;
}

/**
 * Trata erro do Supabase de forma consistente
 */
export function handleSupabaseError(
  error: PostgrestError | null,
  context: string,
  customMessage?: string
): never {
  if (!error) {
    throw new SupabaseRepositoryError(
      customMessage || `Erro desconhecido em ${context}`
    );
  }

  throw new SupabaseRepositoryError(
    customMessage || `Falha em ${context}: ${error.message}`,
    error,
    { code: error.code, details: error.details, hint: error.hint }
  );
}

/**
 * Query builder genérico para Supabase (retorna array)
 * 
 * NOTA: Usa type assertion devido à tipagem estrita do Supabase.
 * Para queries complexas, continue usando supabase.from() diretamente.
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

  // Type assertion necessário: Supabase espera literais de tabela, mas recebemos strings dinâmicas
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase.from(table as any) as DynamicSupabaseTable).select(select);

  // Aplicar filtros
  Object.entries(filters).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      query = query.is(key, null);
    } else if (Array.isArray(value)) {
      query = query.in(key, value);
    } else {
      query = query.eq(key, value);
    }
  });

  // Ordenação
  if (orderBy) {
    query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
  }

  // Limite
  if (limit) {
    query = query.limit(limit);
  }

  // Executar query
  // O objeto query após aplicar filtros já é "thenable" (pode ser await diretamente)
  if (single) {
    const { data, error } = await query.single();
    // Quando single=true, retornar como array com um elemento (ou null)
    return { data: data ? [data as T] : null, error };
  }

  // Para queries múltiplas, await diretamente (não chamar como função)
  const { data, error } = await query;
  return { data: (data || []) as T[], error };
}

/**
 * Query builder para single result (retorna T | null)
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
 * Insert helper padronizado
 * 
 * NOTA: Usa type assertion devido à tipagem estrita do Supabase.
 */
export async function insertOne<T>(
  table: string,
  data: Partial<T>,
  context = 'insert'
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: result, error } = await (supabase.from(table as any) as DynamicSupabaseTable)
    .insert(data)
    .select()
    .single();

  if (error) {
    handleSupabaseError(error, context);
  }

  if (!result) {
    throw new SupabaseRepositoryError(`Falha ao inserir em ${table}: nenhum dado retornado`);
  }

  return result as T;
}

/**
 * Insert many helper padronizado
 * 
 * NOTA: Usa type assertion devido à tipagem estrita do Supabase.
 */
export async function insertMany<T>(
  table: string,
  data: Partial<T>[],
  context = 'insertMany'
): Promise<T[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: result, error } = await (supabase.from(table as any) as DynamicSupabaseTable)
    .insert(data)
    .select();

  if (error) {
    handleSupabaseError(error, context);
  }

  return (result || []) as T[];
}

/**
 * Update helper padronizado
 * 
 * NOTA: Usa type assertion devido à tipagem estrita do Supabase.
 */
export async function updateOne<T>(
  table: string,
  id: string,
  updates: Partial<T>,
  context = 'update'
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: result, error } = await (supabase.from(table as any) as DynamicSupabaseTable)
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    handleSupabaseError(error, context);
  }

  if (!result) {
    throw new SupabaseRepositoryError(`Falha ao atualizar ${table} (id: ${id}): nenhum dado retornado`);
  }

  return result as T;
}

/**
 * Delete helper padronizado
 * 
 * NOTA: Usa type assertion devido à tipagem estrita do Supabase.
 */
export async function deleteOne(
  table: string,
  id: string,
  context = 'delete'
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from(table as any) as DynamicSupabaseTable)
    .delete()
    .eq('id', id);

  if (error) {
    handleSupabaseError(error, context);
  }
}
