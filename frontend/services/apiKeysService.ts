/**
 * API Keys Service
 *
 * Manages API keys for external providers (OpenAI, Anthropic, Gemini, Grok).
 * Keys are encrypted via Fernet in the FastAPI backend.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

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
  private getAuthHeaders(token: string): HeadersInit {
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Lists all API keys for the user.
   */
  async listKeys(token: string, activeOnly: boolean = true): Promise<APIKeyInfo[]> {
      const requestUrl = `${API_BASE_URL}/api/v1/user-api-keys?active_only=${activeOnly}`;
    const response = await fetch(
        requestUrl,
      {
        method: 'GET',
        headers: this.getAuthHeaders(token),
      }
    );

    if (!response.ok) {
        throw new Error(`Error listing API keys: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.ok) {
        throw new Error(data.error?.message || 'Error listing API keys');
    }

    return data.data.keys || [];
  }

  /**
   * Creates a new API key.
   */
  async createKey(
    token: string,
    request: CreateAPIKeyRequest
  ): Promise<CreateAPIKeyResponse> {
    const response = await fetch(`${API_BASE_URL}/api/v1/user-api-keys`, {
      method: 'POST',
      headers: this.getAuthHeaders(token),
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Error creating API key: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.ok) {
        throw new Error(data.error?.message || 'Error creating API key');
    }

    return data.data;
  }

  /**
   * Updates an API key (activate/deactivate, set as default).
   */
  async updateKey(
    token: string,
    keyId: string,
    updates: { isDefault?: boolean; isActive?: boolean }
  ): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/v1/user-api-keys/${keyId}`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(token),
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Error updating API key: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.ok) {
        throw new Error(data.error?.message || 'Error updating API key');
    }
  }

  /**
   * Permanently removes an API key.
   */
  async deleteKey(token: string, keyId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/v1/user-api-keys/${keyId}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders(token),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Error deleting API key: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.ok) {
        throw new Error(data.error?.message || 'Error deleting API key');
    }
  }

  /**
   * Revalidates an existing API key.
   */
  async validateKey(token: string, keyId: string): Promise<ValidationResult> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/user-api-keys/${keyId}/validate`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(token),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Error validating API key: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.ok) {
        throw new Error(data.error?.message || 'Error validating API key');
    }

    return data.data;
  }

  /**
   * Lista provedores suportados.
   */
  async listProviders(token: string): Promise<ProviderInfo[]> {
      const requestUrl = `${API_BASE_URL}/api/v1/user-api-keys/providers`;
      const response = await fetch(requestUrl, {
      method: 'GET',
      headers: this.getAuthHeaders(token),
    });

    if (!response.ok) {
        throw new Error(`Error listing providers: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.ok) {
        throw new Error(data.error?.message || 'Error listing providers');
    }

    return data.data.providers || [];
  }
}

export const apiKeysService = new APIKeysService();
