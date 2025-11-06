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

import { supabase } from '@/integrations/supabase/client';
import type { PostgrestError } from '@supabase/supabase-js';

// =================== TIPOS ===================

export interface QueryOptions<T> {
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
  options: QueryOptions<T> = {}
): Promise<RepositoryResult<T[]>> {
  const { select = '*', filters = {}, orderBy, limit, single = false } = options;

  // Type assertion necessário devido à tipagem estrita do Supabase
  let query = (supabase.from(table as any) as any).select(select);

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
  options: Omit<QueryOptions<T>, 'single'> = {}
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
  const { data: result, error } = await (supabase.from(table as any) as any)
    .insert(data as any)
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
  const { data: result, error } = await (supabase.from(table as any) as any)
    .insert(data as any)
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
  const { data: result, error } = await (supabase.from(table as any) as any)
    .update(updates as any)
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
  const { error } = await (supabase.from(table as any) as any)
    .delete()
    .eq('id', id);

  if (error) {
    handleSupabaseError(error, context);
  }
}

/**
 * Helper para chamadas de Edge Functions padronizadas
 * 
 * @param functionName - Nome da edge function (sem /functions/v1/)
 * @param payload - Payload JSON para enviar
 * @param options - Opções de chamada (timeout, signal, headers customizados)
 * @returns Resposta da função parseada como T
 */
export async function callEdgeFunction<T = unknown>(
  functionName: string,
  payload: Record<string, unknown> = {},
  options: {
    timeout?: number;
    signal?: AbortSignal;
    headers?: Record<string, string>;
  } = {}
): Promise<T> {
  const { timeout = 150000, signal, headers: customHeaders = {} } = options; // 150s default (menor que Supabase 150s)
  
  const { data: { session }, error: authError } = await supabase.auth.getSession();
  
  if (authError || !session) {
    throw new AuthenticationError();
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  // Se já tem signal externo, usar ele
  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
  }

  try {
    // Headers padrão + customizados (customHeaders sobrescrevem padrões)
    const headers = {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      ...customHeaders,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorData: any;
      try {
        errorData = await response.json();
      } catch {
        errorData = { error: `Erro desconhecido (status ${response.status})` };
      }
      
      // Extrair mensagem de erro de forma robusta
      let errorMessage: string;
      if (errorData?.error) {
        // Se error é objeto, extrair message
        if (typeof errorData.error === 'object' && errorData.error.message) {
          errorMessage = errorData.error.message;
        } else if (typeof errorData.error === 'string') {
          errorMessage = errorData.error;
        } else {
          errorMessage = JSON.stringify(errorData.error);
        }
      } else if (errorData?.message) {
        errorMessage = errorData.message;
      } else {
        errorMessage = `Erro ao chamar ${functionName}: ${response.statusText}`;
      }
      
      throw new SupabaseRepositoryError(
        errorMessage,
        undefined,
        { 
          status: response.status, 
          functionName,
          errorDetails: errorData?.error?.details || errorData?.details,
          errorCode: errorData?.error?.code || errorData?.code,
        }
      );
    }

    return await response.json() as T;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    
    if (err instanceof SupabaseRepositoryError || err instanceof AuthenticationError) {
      throw err;
    }
    
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SupabaseRepositoryError(
        `Timeout ao chamar ${functionName}`,
        err,
        { functionName, timeout }
      );
    }
    
    throw new SupabaseRepositoryError(
      `Erro ao chamar ${functionName}: ${err instanceof Error ? err.message : 'Erro desconhecido'}`,
      err instanceof Error ? err : undefined,
      { functionName }
    );
  }
}

