/**
 * Project Assessment Instrument Service
 *
 * Gerencia instrumentos de avaliacao por projeto.
 * Permite clonar instrumentos globais (PROBAST, ROBIS) ou criar customizados.
 */

import type {
  CloneInstrumentRequest,
  CloneInstrumentResponse,
  CreateProjectInstrumentRequest,
  CreateProjectItemRequest,
  GlobalInstrumentSummary,
  ProjectAssessmentInstrument,
  ProjectAssessmentItem,
  UpdateProjectInstrumentRequest,
  UpdateProjectItemRequest,
} from '@/types/assessment';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  traceId?: string;
}

class ProjectAssessmentInstrumentService {
  private getAuthHeaders(token: string): HeadersInit {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Lista instrumentos globais disponiveis para clonagem.
   */
  async listGlobalInstruments(
    token: string
  ): Promise<GlobalInstrumentSummary[]> {
    const url = `${API_BASE_URL}/api/v1/assessment-instruments/global`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getAuthHeaders(token),
    });

    // Handle HTTP errors before parsing JSON
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[listGlobalInstruments] HTTP error:', response.status, errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result: ApiResponse<{ instruments: GlobalInstrumentSummary[] }> =
      await response.json();

    if (!result.ok || !result.data) {
      console.error('[listGlobalInstruments] API error:', result.error);
      throw new Error(result.error?.message || 'Failed to list global instruments');
    }

    return result.data.instruments;
  }

  /**
   * Lista instrumentos de um projeto.
   */
  async listProjectInstruments(
    token: string,
    projectId: string,
    activeOnly = true
  ): Promise<ProjectAssessmentInstrument[]> {
    const params = new URLSearchParams();
    if (!activeOnly) {
      params.append('active_only', 'false');
    }

    const queryString = params.toString();
    const url = `${API_BASE_URL}/api/v1/assessment-instruments/project/${projectId}${queryString ? `?${queryString}` : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getAuthHeaders(token),
    });

    const result: ApiResponse<{ instruments: ProjectAssessmentInstrument[] }> =
      await response.json();

    if (!result.ok || !result.data) {
      throw new Error(result.error?.message || 'Failed to list project instruments');
    }

    return result.data.instruments;
  }

  /**
   * Busca um instrumento por ID.
   */
  async getInstrument(
    token: string,
    instrumentId: string
  ): Promise<ProjectAssessmentInstrument> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/assessment-instruments/${instrumentId}`,
      {
        method: 'GET',
        headers: this.getAuthHeaders(token),
      }
    );

    const result: ApiResponse<ProjectAssessmentInstrument> = await response.json();

    if (!result.ok || !result.data) {
      throw new Error(result.error?.message || 'Failed to get instrument');
    }

    return result.data;
  }

  /**
   * Clona um instrumento global para um projeto.
   */
  async cloneGlobalInstrument(
    token: string,
    request: CloneInstrumentRequest
  ): Promise<CloneInstrumentResponse> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/assessment-instruments/clone`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(token),
        body: JSON.stringify(request),
      }
    );

    const result: ApiResponse<CloneInstrumentResponse> = await response.json();

    if (!result.ok || !result.data) {
      throw new Error(result.error?.message || 'Failed to clone instrument');
    }

    return result.data;
  }

  /**
   * Cria um instrumento customizado.
   */
  async createInstrument(
    token: string,
    request: CreateProjectInstrumentRequest
  ): Promise<ProjectAssessmentInstrument> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/assessment-instruments`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(token),
        body: JSON.stringify(request),
      }
    );

    const result: ApiResponse<ProjectAssessmentInstrument> = await response.json();

    if (!result.ok || !result.data) {
      throw new Error(result.error?.message || 'Failed to create instrument');
    }

    return result.data;
  }

  /**
   * Atualiza um instrumento.
   */
  async updateInstrument(
    token: string,
    instrumentId: string,
    request: UpdateProjectInstrumentRequest
  ): Promise<ProjectAssessmentInstrument> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/assessment-instruments/${instrumentId}`,
      {
        method: 'PATCH',
        headers: this.getAuthHeaders(token),
        body: JSON.stringify(request),
      }
    );

    const result: ApiResponse<ProjectAssessmentInstrument> = await response.json();

    if (!result.ok || !result.data) {
      throw new Error(result.error?.message || 'Failed to update instrument');
    }

    return result.data;
  }

  /**
   * Deleta um instrumento.
   */
  async deleteInstrument(token: string, instrumentId: string): Promise<void> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/assessment-instruments/${instrumentId}`,
      {
        method: 'DELETE',
        headers: this.getAuthHeaders(token),
      }
    );

    const result: ApiResponse<{ message: string }> = await response.json();

    if (!result.ok) {
      throw new Error(result.error?.message || 'Failed to delete instrument');
    }
  }

  /**
   * Adiciona um item a um instrumento.
   */
  async addItem(
    token: string,
    instrumentId: string,
    request: CreateProjectItemRequest
  ): Promise<ProjectAssessmentItem> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/assessment-instruments/${instrumentId}/items`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(token),
        body: JSON.stringify(request),
      }
    );

    const result: ApiResponse<ProjectAssessmentItem> = await response.json();

    if (!result.ok || !result.data) {
      throw new Error(result.error?.message || 'Failed to add item');
    }

    return result.data;
  }

  /**
   * Atualiza um item.
   */
  async updateItem(
    token: string,
    itemId: string,
    request: UpdateProjectItemRequest
  ): Promise<ProjectAssessmentItem> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/assessment-instruments/items/${itemId}`,
      {
        method: 'PATCH',
        headers: this.getAuthHeaders(token),
        body: JSON.stringify(request),
      }
    );

    const result: ApiResponse<ProjectAssessmentItem> = await response.json();

    if (!result.ok || !result.data) {
      throw new Error(result.error?.message || 'Failed to update item');
    }

    return result.data;
  }

  /**
   * Deleta um item.
   */
  async deleteItem(token: string, itemId: string): Promise<void> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/assessment-instruments/items/${itemId}`,
      {
        method: 'DELETE',
        headers: this.getAuthHeaders(token),
      }
    );

    const result: ApiResponse<{ message: string }> = await response.json();

    if (!result.ok) {
      throw new Error(result.error?.message || 'Failed to delete item');
    }
  }

  /**
   * Verifica se um projeto tem um instrumento configurado.
   */
  async hasConfiguredInstrument(
    token: string,
    projectId: string
  ): Promise<boolean> {
    try {
      const instruments = await this.listProjectInstruments(
        token,
        projectId,
        true
      );
      return instruments.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Busca instrumento por tipo em um projeto.
   */
  async getInstrumentByType(
    token: string,
    projectId: string,
    toolType: string
  ): Promise<ProjectAssessmentInstrument | null> {
    const instruments = await this.listProjectInstruments(token, projectId, true);
    return instruments.find((i) => i.toolType === toolType) || null;
  }
}

export const projectAssessmentInstrumentService =
  new ProjectAssessmentInstrumentService();

export default projectAssessmentInstrumentService;
