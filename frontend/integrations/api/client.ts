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
 * @param endpoint - Endpoint path (e.g. "/api/v1/assessment/ai")
 * @param options - Request options
 * @returns Promise with typed response
 * @throws ApiError if the request fails
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
 * Client for AI Assessment endpoints.
 */
export async function aiAssessmentClient<T>(
  body: Record<string, unknown>
): Promise<T> {
  return apiClient<T>("/api/v1/assessment/ai", {
    method: "POST",
    body,
      timeout: 120000, // 2 minutes for AI operations
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

// =================== UNIFIED EVALUATION DTOs & CLIENTS ===================

export interface CreateEvaluationRunRequest {
  project_id: string;
  schema_version_id: string;
  target_ids: string[];
}

export interface EvaluationRunResponse {
  id: string;
  project_id: string;
  schema_version_id: string;
  status: "pending" | "active" | "completed" | "failed" | "cancelled";
  current_stage: "proposal" | "review" | "consensus" | "finalized";
}

export interface AsyncAcceptedResponse {
  accepted: true;
}

export interface ReviewQueueItemResponse {
  run_id: string;
  target_id: string;
  item_id: string;
  latest_proposal_id: string | null;
  reviewer_state: "pending" | "accept" | "reject" | "edit";
}

export interface EvaluationReviewQueueResponse {
  items: ReviewQueueItemResponse[];
}

export interface CreateReviewerDecisionRequest {
  project_id: string;
  run_id: string;
  target_id: string;
  item_id: string;
  schema_version_id: string;
  proposal_id?: string | null;
  decision: "accept" | "reject" | "edit";
  edited_value?: unknown;
  rationale?: string | null;
}

export interface ReviewerDecisionResponse {
  id: string;
  reviewer_id: string;
  decision: "accept" | "reject" | "edit";
}

export interface CreateConsensusDecisionRequest {
  project_id: string;
  run_id?: string | null;
  target_id: string;
  item_id: string;
  schema_version_id: string;
  mode: "select_existing" | "manual_override";
  selected_reviewer_decision_id?: string | null;
  override_value?: unknown;
  override_justification?: string | null;
}

export interface PublishedStateResponse {
  id: string;
  project_id: string;
  target_id: string;
  item_id: string;
  schema_version_id: string;
  latest_consensus_decision_id: string;
}

export interface CreateEvidenceUploadRequest {
  project_id: string;
  entity_type: "proposal" | "reviewer_decision" | "consensus_decision" | "published_state";
  entity_id: string;
  filename: string;
  mime_type: "application/pdf" | "image/png" | "image/jpeg" | "text/plain";
  size_bytes: number;
}

export interface EvidenceUploadResponse {
  upload_url: string;
  storage_path: string;
}

export async function createEvaluationRun(
  body: CreateEvaluationRunRequest
): Promise<EvaluationRunResponse> {
  return apiClient<EvaluationRunResponse>("/api/v1/evaluation-runs", {
    method: "POST",
    body,
  });
}

export async function getEvaluationRun(runId: string): Promise<EvaluationRunResponse> {
  return apiClient<EvaluationRunResponse>(`/api/v1/evaluation-runs/${runId}`);
}

export async function triggerProposalGeneration(runId: string): Promise<AsyncAcceptedResponse> {
  return apiClient<AsyncAcceptedResponse>(`/api/v1/evaluation-runs/${runId}/proposal-generation`, {
    method: "POST",
  });
}

export async function listReviewQueue(params: {
  runId?: string;
  status?: "pending" | "decided";
}): Promise<EvaluationReviewQueueResponse> {
  const searchParams = new URLSearchParams();

  if (params.runId) {
    searchParams.set("runId", params.runId);
  }
  if (params.status) {
    searchParams.set("status", params.status);
  }

  const query = searchParams.toString();
  const endpoint = query ? `/api/v1/review-queue?${query}` : "/api/v1/review-queue";
  return apiClient<EvaluationReviewQueueResponse>(endpoint);
}

export async function createReviewerDecision(
  body: CreateReviewerDecisionRequest
): Promise<ReviewerDecisionResponse> {
  return apiClient<ReviewerDecisionResponse>("/api/v1/reviewer-decisions", {
    method: "POST",
    body,
  });
}

export async function createConsensusDecision(
  body: CreateConsensusDecisionRequest
): Promise<PublishedStateResponse> {
  return apiClient<PublishedStateResponse>("/api/v1/consensus-decisions", {
    method: "POST",
    body,
  });
}

export async function createEvidenceUploadUrl(
  body: CreateEvidenceUploadRequest
): Promise<EvidenceUploadResponse> {
  return apiClient<EvidenceUploadResponse>("/api/v1/evidence-attachments/presign", {
    method: "POST",
    body,
  });
}

