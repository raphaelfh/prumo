/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Helper de Autenticação para Edge Functions
 * 
 * Extrai boilerplate comum de autenticação, mantendo flexibilidade.
 * Retorna {user, supabase} ou lança AppError.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError, ErrorCode } from "./error-handler.ts";

interface AuthResult {
  user: { id: string };
  supabase: SupabaseClient;
}

/**
 * Autentica usuário e retorna cliente Supabase configurado
 * 
 * @param authHeader - Header Authorization da requisição
 * @param logger - Logger opcional para logging de erros
 * @returns {user, supabase} ou lança AppError
 */
export async function authenticateUser(
  authHeader: string | null,
  logger?: { error: (msg: string, err?: Error | unknown, data?: Record<string, any>) => void }
): Promise<AuthResult> {
  // Validar header
  if (!authHeader) {
    throw new AppError(ErrorCode.AUTH_ERROR, "Missing authorization", 401);
  }

  // Buscar variáveis de ambiente
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Server configuration error", 500);
  }

  // Criar cliente Supabase com autorização do usuário
  // Service role key permite acesso completo, mas mantemos autorização do usuário
  // para logging e auditoria
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // Verificar autenticação
  // Extrair JWT do header para passar diretamente
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.replace("Bearer ", "") : authHeader;
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);

  if (authError) {
    if (logger) {
      logger.error("Auth error from getUser", authError as Error, {
        errorMessage: authError.message,
        errorStatus: (authError as any).status,
      });
    }
    throw new AppError(ErrorCode.AUTH_ERROR, `Unauthorized: ${authError.message}`, 401);
  }

  if (!user) {
    if (logger) {
      logger.error("No user returned from getUser");
    }
    throw new AppError(ErrorCode.AUTH_ERROR, "Unauthorized: No user found", 401);
  }

  return { user, supabase };
}

