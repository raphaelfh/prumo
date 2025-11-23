/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Headers CORS padronizados para Edge Functions
 * 
 * Constante simples e reutilizável para evitar duplicação.
 */

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-client-trace-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
} as const;

