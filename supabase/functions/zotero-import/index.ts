// @ts-nocheck
/**
 * Edge Function: Zotero Import Proxy
 * 
 * Usa Web Crypto API (nativa do Deno) para criptografia
 * Evita problemas de permissões do pgcrypto/vault
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

// =================== CONFIGURAÇÃO ===================

const ZOTERO_API_BASE = "https://api.zotero.org";
const ZOTERO_API_VERSION = "3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENCRYPTION_KEY = Deno.env.get("ZOTERO_ENCRYPTION_KEY") || "review_hub_zotero_default_key_change_me_in_production";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// =================== CRYPTO UTILS ===================

const jlog = (level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) => {
  console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
    JSON.stringify({ level, msg, ...extra, timestamp: new Date().toISOString() })
  );
};

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

async function makeZoteroRequest({ endpoint, credentials, params }: ZoteroRequestOptions) {
  const url = new URL(`${ZOTERO_API_BASE}${endpoint}`);
  
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
  }

  jlog("info", "Making Zotero API request", { endpoint, params });

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
    jlog("error", "Zotero API error", { 
      status: response.status, 
      statusText: response.statusText,
      body: errorText 
    });
    throw new Error(`Zotero API error: ${response.status} ${response.statusText}`);
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

async function handleSaveCredentials(supabase: any, userId: string, body: any) {
  const { zoteroUserId, apiKey, libraryType } = body;

  if (!zoteroUserId || !apiKey || !libraryType) {
    throw new Error("Missing required fields: zoteroUserId, apiKey, libraryType");
  }

  if (!['user', 'group'].includes(libraryType)) {
    throw new Error("libraryType must be 'user' or 'group'");
  }

  jlog("info", "Saving Zotero credentials", { userId, zoteroUserId, libraryType });

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
    jlog("error", "Error saving credentials", { error: error.message });
    throw new Error(`Failed to save credentials: ${error.message}`);
  }

  jlog("info", "Credentials saved successfully", { integrationId: data.id });

  return { success: true, integrationId: data.id };
}

async function handleTestConnection(supabase: any, userId: string) {
  jlog("info", "Testing Zotero connection", { userId });

  // Buscar credenciais
  const { data: integration, error: fetchError } = await supabase
    .from('zotero_integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (fetchError || !integration) {
    jlog("error", "No credentials found", { error: fetchError?.message });
    return { success: false, error: "Credenciais não encontradas. Configure a integração primeiro." };
  }

  // Descriptografar API key
  const apiKey = await decryptText(integration.encrypted_api_key, userId);

  try {
    // Usar endpoint /keys/current para validar a API key
    // Este é o endpoint oficial do Zotero para verificar chaves
    const url = new URL(`${ZOTERO_API_BASE}/keys/current`);
    
    jlog("info", "Testing API key", { endpoint: "/keys/current" });

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Zotero-API-Key": apiKey,
        "Zotero-API-Version": ZOTERO_API_VERSION,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      jlog("error", "API key validation failed", { 
        status: response.status, 
        body: errorText 
      });
      
      if (response.status === 403) {
        return { success: false, error: "API Key inválida ou sem permissões. Verifique se a chave tem 'Allow library access'." };
      }
      
      throw new Error(`Zotero API error: ${response.status}`);
    }

    const keyInfo = await response.json();
    
    // Extrair informações da resposta
    const userName = keyInfo.username || integration.zotero_user_id;
    const userID = keyInfo.userID || integration.zotero_user_id;
    
    jlog("info", "Connection test successful", { userName, userID, access: keyInfo.access });

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
    jlog("error", "Connection test failed", { error: error.message });
    return { success: false, error: error.message };
  }
}

async function handleListCollections(supabase: any, userId: string) {
  jlog("info", "Listing Zotero collections", { userId });

  // Buscar credenciais
  const { data: integration, error: fetchError } = await supabase
    .from('zotero_integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (fetchError || !integration) {
    throw new Error("Credenciais não encontradas");
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
  });

  jlog("info", "Collections retrieved", { count: result.data?.length || 0 });

  return { collections: result.data };
}

async function handleFetchItems(supabase: any, userId: string, body: any) {
  const { collectionKey, limit = 100, start = 0 } = body;

  if (!collectionKey) {
    throw new Error("collectionKey is required");
  }

  jlog("info", "Fetching items from collection", { userId, collectionKey, limit, start });

  // Buscar credenciais
  const { data: integration, error: fetchError } = await supabase
    .from('zotero_integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (fetchError || !integration) {
    throw new Error("Credenciais não encontradas");
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
  });

  jlog("info", "Items retrieved", { 
    count: result.data?.length || 0, 
    total: result.totalResults 
  });

  return { 
    items: result.data,
    totalResults: result.totalResults,
    hasMore: result.linkHeader ? result.linkHeader.includes('rel="next"') : false,
  };
}

async function handleFetchAttachments(supabase: any, userId: string, body: any) {
  const { itemKey } = body;

  if (!itemKey) {
    throw new Error("itemKey is required");
  }

  jlog("info", "Fetching attachments", { userId, itemKey });

  // Buscar credenciais
  const { data: integration, error: fetchError } = await supabase
    .from('zotero_integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (fetchError || !integration) {
    throw new Error("Credenciais não encontradas");
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
  });

  jlog("info", "Attachments retrieved", { count: result.data?.length || 0 });

  return { attachments: result.data };
}

async function handleDownloadAttachment(supabase: any, userId: string, body: any) {
  const { attachmentKey } = body;

  if (!attachmentKey) {
    throw new Error("attachmentKey is required");
  }

  jlog("info", "Downloading attachment", { userId, attachmentKey });

  // Buscar credenciais
  const { data: integration, error: fetchError } = await supabase
    .from('zotero_integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (fetchError || !integration) {
    throw new Error("Credenciais não encontradas");
  }

  // Descriptografar API key
  const apiKey = await decryptText(integration.encrypted_api_key, userId);

  // Endpoint para download do arquivo
  const endpoint = integration.library_type === 'user'
    ? `/users/${integration.zotero_user_id}/items/${attachmentKey}/file`
    : `/groups/${integration.zotero_user_id}/items/${attachmentKey}/file`;

  const url = new URL(`${ZOTERO_API_BASE}${endpoint}`);
  
  jlog("info", "Downloading file from Zotero", { endpoint });

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Zotero-API-Key": apiKey,
      "Zotero-API-Version": ZOTERO_API_VERSION,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    jlog("error", "Download failed", { 
      status: response.status, 
      body: errorText 
    });
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  // Verificar tamanho do arquivo
  const contentLength = response.headers.get("Content-Length");
  const fileSizeBytes = contentLength ? parseInt(contentLength) : 0;
  const fileSizeMB = fileSizeBytes / (1024 * 1024);

  // Limite de 50MB
  if (fileSizeMB > 50) {
    throw new Error(`Arquivo muito grande: ${fileSizeMB.toFixed(1)}MB. Máximo: 50MB`);
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

  jlog("info", "File downloaded successfully", { 
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

  const traceId = crypto.randomUUID();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing Authorization header");
    }

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    jlog("info", "Request authenticated", { userId: user.id, traceId });

    const body = await req.json();
    const { action } = body;

    if (!action) {
      throw new Error("Missing 'action' field in request body");
    }

    let result;

    switch (action) {
      case 'save-credentials':
        result = await handleSaveCredentials(supabaseClient, user.id, body);
        break;

      case 'test-connection':
        result = await handleTestConnection(supabaseClient, user.id);
        break;

      case 'list-collections':
        result = await handleListCollections(supabaseClient, user.id);
        break;

      case 'fetch-items':
        result = await handleFetchItems(supabaseClient, user.id, body);
        break;

      case 'fetch-attachments':
        result = await handleFetchAttachments(supabaseClient, user.id, body);
        break;

      case 'download-attachment':
        result = await handleDownloadAttachment(supabaseClient, user.id, body);
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(
      JSON.stringify({ success: true, ...result, traceId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    jlog("error", "Request failed", { error: message, stack, traceId });
    
    return new Response(
      JSON.stringify({ success: false, error: message, traceId }),
      { 
        status: error.message.includes("Unauthorized") ? 401 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
