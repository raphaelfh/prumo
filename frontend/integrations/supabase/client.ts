/**
 * Supabase Client Configuration
 * 
 * Suporta múltiplas fontes de env vars para compatibilidade com:
 * - Dev local (VITE_SUPABASE_*)
 * - Vercel + Supabase Integration (SUPABASE_*, NEXT_PUBLIC_SUPABASE_*)
 * - Preview branches (env vars injetados automaticamente)
 */
import {createClient} from '@supabase/supabase-js';
import type {Database} from './types';
import {
    IS_LOCAL_SUPABASE,
    isLocalSupabaseUrl,
    SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_STORAGE_KEY,
    SUPABASE_URL,
} from '@/config/supabase-env';

// Validação em dev para facilitar debugging
if (import.meta.env.DEV && (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY)) {
  console.warn(
    '[Supabase] Missing environment variables. Expected one of:\n' +
    '  URL: VITE_SUPABASE_URL, SUPABASE_URL, or NEXT_PUBLIC_SUPABASE_URL\n' +
    '  KEY: VITE_SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_ANON_KEY, SUPABASE_ANON_KEY, or NEXT_PUBLIC_SUPABASE_ANON_KEY'
  );
}

if (import.meta.env.DEV && IS_LOCAL_SUPABASE && SUPABASE_URL && !isLocalSupabaseUrl(SUPABASE_URL)) {
  console.warn(
    `[Supabase] SUPABASE_ENV=local but SUPABASE_URL is not local: ${SUPABASE_URL}`
  );
}

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    storageKey: SUPABASE_STORAGE_KEY || undefined,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Limpar sessão inválida automaticamente
    flowType: 'pkce',
  },
});
