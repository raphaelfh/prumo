/**
 * Cliente HTTP para comunicação com FastAPI backend.
 *
 * Características:
 * - Inclui automaticamente JWT do Supabase Auth
 * - Suporta tipagem completa de requests/responses
 * - Tratamento de erros consistente
 * - Logging de operações em desenvolvimento
 */

import { supabase } from "@/integrations/supabase/client";

// URL base da API (configurável via env)
const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8000";

/**
 * Resposta padrão da API (compatível com formato do backend).
 */
export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  trace_id?: string;
}

/**
 * Opções para requisições à API.
 */
export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /**
   * Se true, não inclui o token de autenticação.
   * Use para endpoints públicos.
   */
  skipAuth?: boolean;
  /**
   * Timeout em millisegundos (padrão: 60000).
   */
  timeout?: number;
}

/**
 * Erro customizado para respostas da API.
 */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public traceId?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Cliente para fazer requisições à API FastAPI.
 *
 * @param endpoint - Caminho do endpoint (ex: "/api/v1/assessment/ai")
 * @param options - Opções da requisição
 * @returns Promise com a resposta tipada
 * @throws ApiError se a requisição falhar
 *
 * @example
 * ```typescript
 * // POST request
 * const result = await apiClient<AssessmentResult>(
 *   '/api/v1/assessment/ai',
 *   {
 *     method: 'POST',
 *     body: { projectId: '...', articleId: '...' },
 *   }
 * );
 *
 * // GET request
 * const data = await apiClient<ProjectData>('/api/v1/projects/123');
 * ```
 */
export async function apiClient<T>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const {
    body,
    skipAuth = false,
    timeout = 60000,
    headers: customHeaders = {},
    ...fetchOptions
  } = options;

  // Preparar headers
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...Object.fromEntries(
      Object.entries(customHeaders).map(([k, v]) => [k, String(v)])
    ),
  };

  // Adicionar token de autenticação se necessário
  if (!skipAuth) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    } else {
      // Usuário não autenticado tentando acessar endpoint protegido
      throw new ApiError(
        "AUTH_REQUIRED",
        "Autenticação necessária",
        401
      );
    }
  }

  // Preparar body
  const requestBody = body ? JSON.stringify(body) : undefined;

  // Criar controller para timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const url = `${API_BASE_URL}${endpoint}`;

    if (import.meta.env.DEV) {
      console.debug(`[API] ${fetchOptions.method || "GET"} ${endpoint}`);
    }

    const response = await fetch(url, {
      ...fetchOptions,
      headers,
      body: requestBody,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Parse da resposta
    const responseData: ApiResponse<T> = await response.json();

    // Verificar se a resposta indica erro
    if (!response.ok || !responseData.ok) {
      const error = responseData.error || {
        code: "UNKNOWN_ERROR",
        message: "Erro desconhecido",
      };

      throw new ApiError(
        error.code,
        error.message,
        response.status,
        responseData.trace_id,
        error.details
      );
    }

    // Retornar dados
    return responseData.data as T;
  } catch (error) {
    clearTimeout(timeoutId);

    // Tratar erros de timeout
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(
        "TIMEOUT",
        "Requisição expirou. Tente novamente.",
        408
      );
    }

    // Tratar erros de rede
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      throw new ApiError(
        "NETWORK_ERROR",
        "Erro de conexão. Verifique sua internet.",
        0
      );
    }

    // Re-throw ApiError
    if (error instanceof ApiError) {
      throw error;
    }

    // Erro genérico
    throw new ApiError(
      "UNKNOWN_ERROR",
      error instanceof Error ? error.message : "Erro desconhecido",
      500
    );
  }
}

// =================== HELPERS PARA ENDPOINTS ESPECÍFICOS ===================

/**
 * Tipos de ação para Zotero.
 */
export type ZoteroAction =
  | "save-credentials"
  | "test-connection"
  | "list-collections"
  | "fetch-items"
  | "fetch-attachments"
  | "download-attachment";

/**
 * Cliente específico para endpoints Zotero.
 */
export async function zoteroClient<T>(
  action: ZoteroAction,
  body?: Record<string, unknown>
): Promise<T> {
  return apiClient<T>(`/api/v1/zotero/${action}`, {
    method: "POST",
    body,
  });
}

/**
 * Cliente específico para AI Assessment.
 */
export async function aiAssessmentClient<T>(
  body: Record<string, unknown>
): Promise<T> {
  return apiClient<T>("/api/v1/assessment/ai", {
    method: "POST",
    body,
    timeout: 120000, // 2 minutos para operações AI
  });
}

/**
 * Cliente específico para extração de seções.
 */
export async function sectionExtractionClient<T>(
  body: Record<string, unknown>
): Promise<T> {
  return apiClient<T>("/api/v1/extraction/sections", {
    method: "POST",
    body,
    timeout: 120000,
  });
}

/**
 * Cliente específico para extração de modelos.
 */
export async function modelExtractionClient<T>(
  body: Record<string, unknown>
): Promise<T> {
  return apiClient<T>("/api/v1/extraction/models", {
    method: "POST",
    body,
    timeout: 120000,
  });
}

