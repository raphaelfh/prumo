/**
 * Supabase Client Configuration
 * 
 * Suporta múltiplas fontes de env vars para compatibilidade com:
 * - Dev local (VITE_SUPABASE_*)
 * - Vercel + Supabase Integration (SUPABASE_*, NEXT_PUBLIC_SUPABASE_*)
 * - Preview branches (env vars injetados automaticamente)
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Fallback chain para URL do Supabase
// Prioridade: VITE_* > SUPABASE_* > NEXT_PUBLIC_* (compatibilidade com integração Vercel)
const SUPABASE_URL = 
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  '';

// Fallback chain para Anon Key do Supabase
// Suporta diferentes nomes usados por Vercel integration e convenções locais
const SUPABASE_PUBLISHABLE_KEY = 
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

// Validação em dev para facilitar debugging
if (import.meta.env.DEV && (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY)) {
  console.warn(
    '[Supabase] Missing environment variables. Expected one of:\n' +
    '  URL: VITE_SUPABASE_URL, SUPABASE_URL, or NEXT_PUBLIC_SUPABASE_URL\n' +
    '  KEY: VITE_SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_ANON_KEY, SUPABASE_ANON_KEY, or NEXT_PUBLIC_SUPABASE_ANON_KEY'
  );
}

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Limpar sessão inválida automaticamente
    flowType: 'pkce',
  }
});