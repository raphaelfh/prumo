/**
 * Rate Limiter simples para Edge Functions
 * 
 * Implementação simples usando tabela do banco de dados.
 * Segue padrão KISS: funcionalidade direta sem over-engineering.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Verifica se requisição está dentro do limite de rate
 * 
 * @param supabase - Cliente Supabase (service role para bypass RLS)
 * @param key - Chave única para rate limiting (ex: `user_${userId}`)
 * @param limit - Número máximo de requisições
 * @param windowSeconds - Janela de tempo em segundos
 * @returns {allowed, remaining}
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = new Date();
  
  // Buscar registro existente
  const { data, error } = await supabase
    .from('rate_limits')
    .select('count, reset_at')
    .eq('key', key)
    .maybeSingle();

  if (error) {
    // Se erro ao buscar (ex: tabela não existe), permitir (graceful degradation)
    // Isso evita que problemas de infraestrutura bloqueiem requisições
    console.warn('Rate limit check failed, allowing request', { error: error.message });
    return { allowed: true, remaining: limit };
  }

  const resetAt = data?.reset_at ? new Date(data.reset_at) : null;

  // Reset se window expirou
  if (!resetAt || now > resetAt) {
    const newResetAt = new Date(now.getTime() + windowSeconds * 1000);
    await supabase.from('rate_limits').upsert({
      key,
      count: 1,
      reset_at: newResetAt.toISOString(),
    }, {
      onConflict: 'key'
    });
    return { allowed: true, remaining: limit - 1 };
  }

  // Verificar limite
  if (data.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  // Incrementar
  await supabase.from('rate_limits')
    .update({ count: data.count + 1 })
    .eq('key', key);

  return { allowed: true, remaining: limit - data.count - 1 };
}

