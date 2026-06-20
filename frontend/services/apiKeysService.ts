/**
 * API Keys Service
 *
 * Manages API keys for external providers (OpenAI, Anthropic, Gemini, Grok).
 * Keys are encrypted via Fernet in the FastAPI backend.
 *
 * All calls route through the typed client (`frontend/integrations/api/client.ts`):
 * it injects the Supabase JWT, unwraps the `ApiResponse` envelope, and throws
 * `ApiError` carrying `error.message` (never FastAPI's `detail`). The exported
 * `ErrorResult` wrappers let `ApiKeysSection` call these without try/catch.
 */

import {apiClient} from '@/integrations/api/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';

const BASE_PATH = '/api/v1/user-api-keys';

export interface APIKeyInfo {
  id: string;
  provider: string;
  keyName: string | null;
  isActive: boolean;
  isDefault: boolean;
  validationStatus: string | null;
  lastUsedAt: string | null;
  lastValidatedAt: string | null;
  createdAt: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  docsUrl: string;
}

export interface CreateAPIKeyRequest {
  provider: string;
  apiKey: string;
  keyName?: string;
  isDefault?: boolean;
  validateKey?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CreateAPIKeyResponse {
  id: string;
  provider: string;
  validationStatus: string;
  validationMessage: string | null;
  isDefault: boolean;
}

export interface ValidationResult {
  status: string;
  message: string;
}

class APIKeysService {
  /**
   * Lists all API keys for the user.
   */
  async listKeys(activeOnly: boolean = true): Promise<APIKeyInfo[]> {
    const data = await apiClient<{keys: APIKeyInfo[]}>(
      `${BASE_PATH}?active_only=${activeOnly}`,
      {method: 'GET'},
    );
    return data.keys || [];
  }

  /**
   * Creates a new API key.
   */
  async createKey(request: CreateAPIKeyRequest): Promise<CreateAPIKeyResponse> {
    return apiClient<CreateAPIKeyResponse>(BASE_PATH, {method: 'POST', body: request});
  }

  /**
   * Updates an API key (activate/deactivate, set as default).
   */
  async updateKey(
    keyId: string,
    updates: {isDefault?: boolean; isActive?: boolean},
  ): Promise<void> {
    await apiClient<unknown>(`${BASE_PATH}/${keyId}`, {method: 'PATCH', body: updates});
  }

  /**
   * Permanently removes an API key.
   */
  async deleteKey(keyId: string): Promise<void> {
    await apiClient<unknown>(`${BASE_PATH}/${keyId}`, {method: 'DELETE'});
  }

  /**
   * Revalidates an existing API key.
   */
  async validateKey(keyId: string): Promise<ValidationResult> {
    return apiClient<ValidationResult>(`${BASE_PATH}/${keyId}/validate`, {method: 'POST'});
  }

  /**
   * Lists supported providers.
   */
  async listProviders(): Promise<ProviderInfo[]> {
    const data = await apiClient<{providers: ProviderInfo[]}>(
      `${BASE_PATH}/providers`,
      {method: 'GET'},
    );
    return data.providers || [];
  }
}

export const apiKeysService = new APIKeysService();

// ---------------------------------------------------------------------------
// ErrorResult wrappers — used by ApiKeysSection so handlers have no try/catch
// ---------------------------------------------------------------------------

export interface LoadedKeysAndProviders {
  keys: APIKeyInfo[];
  providers: ProviderInfo[];
}

export function loadKeysAndProviders(): Promise<ErrorResult<LoadedKeysAndProviders>> {
  return toResult(async () => {
    const [keys, providers] = await Promise.all([
      apiKeysService.listKeys(false),
      apiKeysService.listProviders(),
    ]);
    return {keys, providers};
  }, 'apiKeysService.loadKeysAndProviders');
}

export function createApiKey(
  request: CreateAPIKeyRequest,
): Promise<ErrorResult<CreateAPIKeyResponse>> {
  return toResult(
    () => apiKeysService.createKey(request),
    'apiKeysService.createApiKey',
  );
}

export function setDefaultApiKey(keyId: string): Promise<ErrorResult<void>> {
  return toResult(
    () => apiKeysService.updateKey(keyId, {isDefault: true}),
    'apiKeysService.setDefaultApiKey',
  );
}

export function deleteApiKey(keyId: string): Promise<ErrorResult<void>> {
  return toResult(
    () => apiKeysService.deleteKey(keyId),
    'apiKeysService.deleteApiKey',
  );
}

export function validateApiKey(keyId: string): Promise<ErrorResult<ValidationResult>> {
  return toResult(
    () => apiKeysService.validateKey(keyId),
    'apiKeysService.validateApiKey',
  );
}
