/**
 * API Keys Service
 * 
 * Gerencia API keys de provedores externos (OpenAI, Anthropic, Gemini, Grok).
 * As keys são criptografadas via Fernet no backend FastAPI.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

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
   * Lista todas as API keys do usuário.
   */
  async listKeys(token: string, activeOnly: boolean = true): Promise<APIKeyInfo[]> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/user-api-keys?active_only=${activeOnly}`,
      {
        method: 'GET',
        headers: this.getAuthHeaders(token),
      }
    );

    if (!response.ok) {
      throw new Error(`Erro ao listar API keys: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.ok) {
      throw new Error(data.error?.message || 'Erro ao listar API keys');
    }

    return data.data.keys || [];
  }

  /**
   * Cria nova API key.
   */
  async createKey(
    token: string,
    request: CreateAPIKeyRequesthttps://render.com/
  ): Promise<CreateAPIKeyResponse> {
    const response = await fetch(`${API_BASE_URL}/api/v1/user-api-keys`, {
      method: 'POST',
      headers: this.getAuthHeaders(token),
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Erro ao criar API key: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.ok) {
      throw new Error(data.error?.message || 'Erro ao criar API key');
    }

    return data.data;
  }

  /**
   * Atualiza uma API key (ativar/desativar, definir como default).
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
      throw new Error(errorData.detail || `Erro ao atualizar API key: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.ok) {
      throw new Error(data.error?.message || 'Erro ao atualizar API key');
    }
  }

  /**
   * Remove permanentemente uma API key.
   */
  async deleteKey(token: string, keyId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/v1/user-api-keys/${keyId}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders(token),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Erro ao remover API key: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.ok) {
      throw new Error(data.error?.message || 'Erro ao remover API key');
    }
  }

  /**
   * Revalida uma API key existente.
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
      throw new Error(errorData.detail || `Erro ao validar API key: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.ok) {
      throw new Error(data.error?.message || 'Erro ao validar API key');
    }

    return data.data;
  }

  /**
   * Lista provedores suportados.
   */
  async listProviders(token: string): Promise<ProviderInfo[]> {
    const response = await fetch(`${API_BASE_URL}/api/v1/user-api-keys/providers`, {
      method: 'GET',
      headers: this.getAuthHeaders(token),
    });

    if (!response.ok) {
      throw new Error(`Erro ao listar provedores: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.ok) {
      throw new Error(data.error?.message || 'Erro ao listar provedores');
    }

    return data.data.providers || [];
  }
}

export const apiKeysService = new APIKeysService();
