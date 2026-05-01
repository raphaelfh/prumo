/**
 * HTTP client for FastAPI backend communication.
 *
 * Features:
 * - Automatically includes JWT from Supabase Auth
 * - Full request/response typing
 * - Consistent error handling
 * - Operation logging in development
 */

import {supabase} from "@/integrations/supabase/client";
import {t} from "@/lib/copy";

// API base URL (configurable via env)
const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

function createTraceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * Standard API response (compatible with backend format).
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
 * Options for API requests.
 */
export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /**
   * If true, do not include auth token.
   * Use for public endpoints.
   */
  skipAuth?: boolean;
  /**
   * Timeout in milliseconds (default: 60000).
   */
  timeout?: number;
}

/**
 * Custom error for API responses.
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
 * Client for FastAPI requests.
 *
 * @param endpoint - Endpoint path (e.g. "/api/v1/extraction/models")
 * @param options - Request options
 * @returns Promise with typed response
 * @throws ApiError if the request fails
 *
 * @example
 * ```typescript
 * // POST request
 * const result = await apiClient<ExtractionResult>(
 *   '/api/v1/extraction/models',
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
    "X-Trace-Id": createTraceId(),
    ...Object.fromEntries(
      Object.entries(customHeaders).map(([k, v]) => [k, String(v)])
    ),
  };

    // Add auth token if needed
  if (!skipAuth) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    } else {
        // Unauthenticated user trying to access protected endpoint
      throw new ApiError(
        "AUTH_REQUIRED",
          t('common', 'errors_authRequired'),
        401
      );
    }
  }

    // Prepare body
  const requestBody = body ? JSON.stringify(body) : undefined;

    // Create controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const url = `${API_BASE_URL}${endpoint}`;

    if (import.meta.env.DEV) {
        console.warn(`[API] ${fetchOptions.method || "GET"} ${endpoint}`);
    }

    const response = await fetch(url, {
      ...fetchOptions,
      headers,
      body: requestBody,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

      // Parse response
    const responseData: ApiResponse<T> = await response.json();

      // Check if response indicates error
    if (!response.ok || !responseData.ok) {
      const error = responseData.error || {
        code: "UNKNOWN_ERROR",
          message: t('common', 'errors_unknownError'),
      };

      throw new ApiError(
        error.code,
        error.message,
        response.status,
        responseData.trace_id,
        error.details
      );
    }

      // Return data
    return responseData.data as T;
  } catch (error) {
    clearTimeout(timeoutId);

      // Handle timeout errors
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(
        "TIMEOUT",
          t('common', 'errors_requestExpired'),
        408
      );
    }

      // Handle network errors
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      throw new ApiError(
        "NETWORK_ERROR",
          t('common', 'errors_connectionError'),
        0
      );
    }

    // Re-throw ApiError
    if (error instanceof ApiError) {
      throw error;
    }

      // Generic error
    throw new ApiError(
      "UNKNOWN_ERROR",
        error instanceof Error ? error.message : t('common', 'errors_unknownError'),
      500
    );
  }
}

// =================== HELPERS FOR SPECIFIC ENDPOINTS ===================

/**
 * Zotero action types.
 */
export type ZoteroAction =
  | "save-credentials"
  | "test-connection"
  | "list-collections"
  | "fetch-items"
  | "fetch-attachments"
    | "download-attachment"
    | "sync-collection"
    | "sync-status"
    | "sync-retry-failed"
    | "sync-item-result";

/**
 * Client for Zotero endpoints.
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
 * Client for section extraction endpoints.
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
 * Client for model extraction endpoints.
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

export interface ManualModelHierarchyRequest {
  project_id: string;
  article_id: string;
  template_id: string;
  model_name: string;
  modelling_method?: string | null;
}

export interface ManualModelHierarchyChild {
  id: string;
  entity_type_id: string;
  parent_instance_id: string;
  label: string;
}

export interface ManualModelHierarchyResponse {
  model_id: string;
  model_label: string;
  child_instances: ManualModelHierarchyChild[];
  proposal_run_id?: string | null;
}

export async function createManualModelHierarchy(
  body: ManualModelHierarchyRequest
): Promise<ManualModelHierarchyResponse> {
  return apiClient<ManualModelHierarchyResponse>("/api/v1/extraction/models/manual", {
    method: "POST",
    body,
  });
}


