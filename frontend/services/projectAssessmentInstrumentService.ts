/**
 * Project Assessment Instrument Service
 *
 * Gerencia instrumentos de avaliacao por projeto.
 * Permite clonar instrumentos globais (PROBAST, ROBIS) ou criar customizados.
 *
 * Usa apiClient centralizado para:
 * - Autenticacao automatica via JWT do Supabase
 * - Tratamento de erros consistente
 * - Timeout e retry padronizados
 */

import {apiClient} from '@/integrations/api/client';
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

const INSTRUMENTS_BASE = '/api/v1/assessment-instruments';

/**
 * Lista instrumentos globais disponiveis para clonagem.
 */
export async function listGlobalInstruments(): Promise<GlobalInstrumentSummary[]> {
  const result = await apiClient<{ instruments: GlobalInstrumentSummary[] }>(
    `${INSTRUMENTS_BASE}/global`,
  );
  return result.instruments;
}

/**
 * Lista instrumentos de um projeto.
 */
export async function listProjectInstruments(
  projectId: string,
  activeOnly = true,
): Promise<ProjectAssessmentInstrument[]> {
  const params = new URLSearchParams();
  if (!activeOnly) {
    params.append('active_only', 'false');
  }
  const queryString = params.toString();
  const url = `${INSTRUMENTS_BASE}/project/${projectId}${queryString ? `?${queryString}` : ''}`;

  const result = await apiClient<{ instruments: ProjectAssessmentInstrument[] }>(url);
  return result.instruments;
}

/**
 * Busca um instrumento por ID com items.
 */
export async function getInstrument(
  instrumentId: string,
): Promise<ProjectAssessmentInstrument> {
  return apiClient<ProjectAssessmentInstrument>(
    `${INSTRUMENTS_BASE}/${instrumentId}`,
  );
}

/**
 * Clona um instrumento global para um projeto.
 */
export async function cloneGlobalInstrument(
  request: CloneInstrumentRequest,
): Promise<CloneInstrumentResponse> {
  return apiClient<CloneInstrumentResponse>(`${INSTRUMENTS_BASE}/clone`, {
    method: 'POST',
    body: request,
  });
}

/**
 * Cria um instrumento customizado.
 */
export async function createInstrument(
  request: CreateProjectInstrumentRequest,
): Promise<ProjectAssessmentInstrument> {
  return apiClient<ProjectAssessmentInstrument>(INSTRUMENTS_BASE, {
    method: 'POST',
    body: request,
  });
}

/**
 * Atualiza um instrumento.
 */
export async function updateInstrument(
  instrumentId: string,
  request: UpdateProjectInstrumentRequest,
): Promise<ProjectAssessmentInstrument> {
  return apiClient<ProjectAssessmentInstrument>(
    `${INSTRUMENTS_BASE}/${instrumentId}`,
    {
      method: 'PATCH',
      body: request,
    },
  );
}

/**
 * Deleta um instrumento.
 */
export async function deleteInstrument(instrumentId: string): Promise<void> {
  await apiClient<{ message: string }>(
    `${INSTRUMENTS_BASE}/${instrumentId}`,
    { method: 'DELETE' },
  );
}

/**
 * Adiciona um item a um instrumento.
 */
export async function addItem(
  instrumentId: string,
  request: CreateProjectItemRequest,
): Promise<ProjectAssessmentItem> {
  return apiClient<ProjectAssessmentItem>(
    `${INSTRUMENTS_BASE}/${instrumentId}/items`,
    {
      method: 'POST',
      body: request,
    },
  );
}

/**
 * Atualiza um item.
 */
export async function updateItem(
  itemId: string,
  request: UpdateProjectItemRequest,
): Promise<ProjectAssessmentItem> {
  return apiClient<ProjectAssessmentItem>(
    `${INSTRUMENTS_BASE}/items/${itemId}`,
    {
      method: 'PATCH',
      body: request,
    },
  );
}

/**
 * Deleta um item.
 */
export async function deleteItem(itemId: string): Promise<void> {
  await apiClient<{ message: string }>(
    `${INSTRUMENTS_BASE}/items/${itemId}`,
    { method: 'DELETE' },
  );
}

/**
 * Verifica se um projeto tem instrumento configurado.
 */
export async function hasConfiguredInstrument(
  projectId: string,
): Promise<boolean> {
  try {
    const instruments = await listProjectInstruments(projectId, true);
    return instruments.length > 0;
  } catch {
    return false;
  }
}

/**
 * Busca instrumento por tipo em um projeto.
 */
export async function getInstrumentByType(
  projectId: string,
  toolType: string,
): Promise<ProjectAssessmentInstrument | null> {
  const instruments = await listProjectInstruments(projectId, true);
  return instruments.find((i) => i.toolType === toolType) || null;
}

// Re-exportar como namespace para compatibilidade
export const projectAssessmentInstrumentService = {
  listGlobalInstruments,
  listProjectInstruments,
  getInstrument,
  cloneGlobalInstrument,
  createInstrument,
  updateInstrument,
  deleteInstrument,
  addItem,
  updateItem,
  deleteItem,
  hasConfiguredInstrument,
  getInstrumentByType,
};

export default projectAssessmentInstrumentService;
