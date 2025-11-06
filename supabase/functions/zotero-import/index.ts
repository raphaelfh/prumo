/**
 * Edge Function: Zotero Import Proxy
 * 
 * Usa Web Crypto API (nativa do Deno) para criptografia
 * Evita problemas de permissões do pgcrypto/vault
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/core/cors.ts";
import { authenticateUser } from "../_shared/core/auth.ts";
import { Logger } from "../_shared/core/logger.ts";
import { ErrorHandler, AppError, ErrorCode } from "../_shared/core/error-handler.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

// =================== CONFIGURAÇÃO ===================

const ZOTERO_API_BASE = "https://api.zotero.org";
const ZOTERO_API_VERSION = "3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ENCRYPTION_KEY = Deno.env.get("ZOTERO_ENCRYPTION_KEY") || "review_hub_zotero_default_key_change_me_in_production";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}

// =================== CRYPTO UTILS ===================

// Deriva chave de criptografia usando Web Crypto API
async function deriveKey(userId: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(ENCRYPTION_KEY + userId),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("zotero_salt"),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Criptografa texto usando AES-GCM
async function encryptText(text: string, userId: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await deriveKey(userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(text)
  );

  // Combinar IV + dados criptografados e converter para base64
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  return btoa(String.fromCharCode(...combined));
}

// Descriptografa texto usando AES-GCM
async function decryptText(encryptedBase64: string, userId: string): Promise<string> {
  const key = await deriveKey(userId);
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

// =================== ZOTERO API ===================

interface ZoteroRequestOptions {
  endpoint: string;
  credentials: { zotero_user_id: string; api_key: string; library_type: string };
  params?: Record<string, string>;
}

async function makeZoteroRequest(
  { endpoint, credentials, params }: ZoteroRequestOptions,
  logger: Logger
) {
  const url = new URL(`${ZOTERO_API_BASE}${endpoint}`);
  
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
  }

  logger.info("Making Zotero API request", { endpoint, params });

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Zotero-API-Key": credentials.api_key,
      "Zotero-API-Version": ZOTERO_API_VERSION,
      "User-Agent": "ReviewHub/1.0",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("Zotero API error", new Error(errorText), {
      status: response.status,
      statusText: response.statusText,
    });
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      `Zotero API error: ${response.status} ${response.statusText}`,
      500
    );
  }

  const data = await response.json();
  
  const totalResults = response.headers.get("Total-Results");
  const linkHeader = response.headers.get("Link");
  
  return {
    data,
    totalResults: totalResults ? parseInt(totalResults) : null,
    linkHeader,
  };
}

// =================== HANDLERS ===================

async function handleSaveCredentials(
  supabase: any,
  userId: string,
  body: any,
  logger: Logger
) {
  const { zoteroUserId, apiKey, libraryType } = body;

  if (!zoteroUserId || !apiKey || !libraryType) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      "Missing required fields: zoteroUserId, apiKey, libraryType",
      400
    );
  }

  if (!['user', 'group'].includes(libraryType)) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      "libraryType must be 'user' or 'group'",
      400
    );
  }

  logger.info("Saving Zotero credentials", { zoteroUserId, libraryType });

  // Criptografar API key usando Web Crypto API
  const encryptedApiKey = await encryptText(apiKey, userId);

  // Salvar diretamente na tabela
  const { data, error } = await supabase
    .from('zotero_integrations')
    .upsert({
      user_id: userId,
      zotero_user_id: zoteroUserId,
      encrypted_api_key: encryptedApiKey,
      library_type: libraryType,
      is_active: true,
    }, {
      onConflict: 'user_id'
    })
    .select('id')
    .single();

  if (error) {
    logger.error("Error saving credentials", error as Error);
    throw new AppError(
      ErrorCode.DB_ERROR,
      `Failed to save credentials: ${error.message}`,
      500
    );
  }

  logger.info("Credentials saved successfully", { integrationId: data.id });

  return { integrationId: data.id };
}

async function handleTestConnection(
  supabase: any,
  userId: string,
  logger: Logger
) {
  logger.info("Testing Zotero connection");

  // Buscar credenciais
  const { data: integration, error: fetchError } = await supabase
    .from('zotero_integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (fetchError || !integration) {
    logger.error("No credentials found", fetchError as Error);
    return { success: false, error: "Credenciais não encontradas. Configure a integração primeiro." };
  }

  // Descriptografar API key
  const apiKey = await decryptText(integration.encrypted_api_key, userId);

  try {
    const url = new URL(`${ZOTERO_API_BASE}/keys/current`);
    logger.info("Testing API key", { endpoint: "/keys/current" });

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Zotero-API-Key": apiKey,
        "Zotero-API-Version": ZOTERO_API_VERSION,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("API key validation failed", new Error(errorText), {
        status: response.status,
      });
      
      if (response.status === 403) {
        return { success: false, error: "API Key inválida ou sem permissões. Verifique se a chave tem 'Allow library access'." };
      }
      
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        `Zotero API error: ${response.status}`,
        500
      );
    }

    const keyInfo = await response.json();
    const userName = keyInfo.username || integration.zotero_user_id;
    const userID = keyInfo.userID || integration.zotero_user_id;
    
    logger.info("Connection test successful", { userName, userID, access: keyInfo.access });

    // Atualizar last_sync_at
    await supabase
      .from('zotero_integrations')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('user_id', userId);

    return { 
      success: true, 
      userName,
      userID: userID.toString(),
      access: keyInfo.access || {}
    };
  } catch (error: any) {
    logger.error("Connection test failed", error);
    return { success: false, error: error.message };
  }
}

async function handleListCollections(
  supabase: any,
  userId: string,
  logger: Logger
) {
  logger.info("Listing Zotero collections");

  // Buscar credenciais
  const { data: integration, error: fetchError } = await supabase
    .from('zotero_integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (fetchError || !integration) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      "Credenciais não encontradas",
      404
    );
  }

  // Descriptografar API key
  const apiKey = await decryptText(integration.encrypted_api_key, userId);

  const endpoint = integration.library_type === 'user'
    ? `/users/${integration.zotero_user_id}/collections`
    : `/groups/${integration.zotero_user_id}/collections`;

  const result = await makeZoteroRequest({
    endpoint,
    credentials: {
      zotero_user_id: integration.zotero_user_id,
      api_key: apiKey,
      library_type: integration.library_type,
    },
    params: {
      format: 'json',
    },
  }, logger);

  logger.info("Collections retrieved", { count: result.data?.length || 0 });

  return { collections: result.data };
}

async function handleFetchItems(
  supabase: any,
  userId: string,
  body: any,
  logger: Logger
) {
  const { collectionKey, limit = 100, start = 0 } = body;

  if (!collectionKey) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      "collectionKey is required",
      400
    );
  }

  logger.info("Fetching items from collection", { collectionKey, limit, start });

  // Buscar credenciais
  const { data: integration, error: fetchError } = await supabase
    .from('zotero_integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (fetchError || !integration) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      "Credenciais não encontradas",
      404
    );
  }

  // Descriptografar API key
  const apiKey = await decryptText(integration.encrypted_api_key, userId);

  const endpoint = integration.library_type === 'user'
    ? `/users/${integration.zotero_user_id}/collections/${collectionKey}/items`
    : `/groups/${integration.zotero_user_id}/collections/${collectionKey}/items`;

  const result = await makeZoteroRequest({
    endpoint,
    credentials: {
      zotero_user_id: integration.zotero_user_id,
      api_key: apiKey,
      library_type: integration.library_type,
    },
    params: {
      format: 'json',
      limit: limit.toString(),
      start: start.toString(),
      itemType: '-attachment',
    },
  }, logger);

  logger.info("Items retrieved", { 
    count: result.data?.length || 0, 
    total: result.totalResults 
  });

  return { 
    items: result.data,
    totalResults: result.totalResults,
    hasMore: result.linkHeader ? result.linkHeader.includes('rel="next"') : false,
  };
}

async function handleFetchAttachments(
  supabase: any,
  userId: string,
  body: any,
  logger: Logger
) {
  const { itemKey } = body;

  if (!itemKey) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      "itemKey is required",
      400
    );
  }

  logger.info("Fetching attachments", { itemKey });

  // Buscar credenciais
  const { data: integration, error: fetchError } = await supabase
    .from('zotero_integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (fetchError || !integration) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      "Credenciais não encontradas",
      404
    );
  }

  // Descriptografar API key
  const apiKey = await decryptText(integration.encrypted_api_key, userId);

  const endpoint = integration.library_type === 'user'
    ? `/users/${integration.zotero_user_id}/items/${itemKey}/children`
    : `/groups/${integration.zotero_user_id}/items/${itemKey}/children`;

  const result = await makeZoteroRequest({
    endpoint,
    credentials: {
      zotero_user_id: integration.zotero_user_id,
      api_key: apiKey,
      library_type: integration.library_type,
    },
    params: {
      format: 'json',
      itemType: 'attachment',
    },
  }, logger);

  logger.info("Attachments retrieved", { count: result.data?.length || 0 });

  return { attachments: result.data };
}

async function handleDownloadAttachment(
  supabase: any,
  userId: string,
  body: any,
  logger: Logger
) {
  const { attachmentKey } = body;

  if (!attachmentKey) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      "attachmentKey is required",
      400
    );
  }

  logger.info("Downloading attachment", { attachmentKey });

  // Buscar credenciais
  const { data: integration, error: fetchError } = await supabase
    .from('zotero_integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (fetchError || !integration) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      "Credenciais não encontradas",
      404
    );
  }

  // Descriptografar API key
  const apiKey = await decryptText(integration.encrypted_api_key, userId);

  // Endpoint para download do arquivo
  const endpoint = integration.library_type === 'user'
    ? `/users/${integration.zotero_user_id}/items/${attachmentKey}/file`
    : `/groups/${integration.zotero_user_id}/items/${attachmentKey}/file`;

  const url = new URL(`${ZOTERO_API_BASE}${endpoint}`);
  logger.info("Downloading file from Zotero", { endpoint });

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Zotero-API-Key": apiKey,
      "Zotero-API-Version": ZOTERO_API_VERSION,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("Download failed", new Error(errorText), {
      status: response.status,
    });
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      `Download failed: ${response.status} ${response.statusText}`,
      500
    );
  }

  // Verificar tamanho do arquivo
  const contentLength = response.headers.get("Content-Length");
  const fileSizeBytes = contentLength ? parseInt(contentLength) : 0;
  const fileSizeMB = fileSizeBytes / (1024 * 1024);

  // Limite de 50MB
  if (fileSizeMB > 50) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Arquivo muito grande: ${fileSizeMB.toFixed(1)}MB. Máximo: 50MB`,
      400
    );
  }

  // Converter para base64 para transporte
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  
  // Converter para base64
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  // Extrair nome do arquivo do header Content-Disposition se disponível
  const contentDisposition = response.headers.get("Content-Disposition");
  let filename = `attachment_${attachmentKey}.pdf`;
  
  if (contentDisposition) {
    const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (filenameMatch && filenameMatch[1]) {
      filename = filenameMatch[1].replace(/['"]/g, '');
    }
  }

  const contentType = response.headers.get("Content-Type") || "application/pdf";

  logger.info("File downloaded successfully", { 
    size: fileSizeBytes, 
    filename,
    contentType
  });

  return { 
    base64,
    filename,
    contentType,
    size: fileSizeBytes
  };
}

// =================== MAIN HANDLER ===================

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const traceId = req.headers.get("x-client-trace-id") || crypto.randomUUID();
  const logger = new Logger({ traceId });

  try {
    // Autenticação
    const authHeader = req.headers.get("Authorization");
    const { user, supabase } = await authenticateUser(authHeader, logger);
    logger.info("Request authenticated", { userId: user.id });

    // Parse body
    let body: any;
    try {
      body = await req.json();
    } catch (e) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        "Invalid JSON body",
        400
      );
    }

    const { action } = body;

    if (!action) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        "Missing 'action' field in request body",
        400
      );
    }

    let result;

    switch (action) {
      case 'save-credentials':
        result = await handleSaveCredentials(supabase, user.id, body, logger);
        break;

      case 'test-connection':
        result = await handleTestConnection(supabase, user.id, logger);
        break;

      case 'list-collections':
        result = await handleListCollections(supabase, user.id, logger);
        break;

      case 'fetch-items':
        result = await handleFetchItems(supabase, user.id, body, logger);
        break;

      case 'fetch-attachments':
        result = await handleFetchAttachments(supabase, user.id, body, logger);
        break;

      case 'download-attachment':
        result = await handleDownloadAttachment(supabase, user.id, body, logger);
        break;

      default:
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Unknown action: ${action}`,
          400
        );
    }

    return new Response(
      JSON.stringify({ ok: true, data: result, traceId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    return ErrorHandler.handle(error, logger);
  }
});
