/**
 * Project engine read + the viewer's own engine writes (spec §4). The read
 * carries `default` (the project's, with lock and attribution), `effective`
 * (what the viewer's next run runs on) and `availability` (whose credential
 * each provider would run on, for this caller). Every call routes through
 * the typed client and returns `ErrorResult<T>` — never throws, never toasts.
 */
import {apiClient} from '@/integrations/api/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

export type LlmEngineRead = components['schemas']['LlmEngineRead'];
export type LlmEngineCatalogEntry = components['schemas']['LlmEngineCatalogEntryRead'];
export type LlmEngineUpdateRequest = components['schemas']['LlmEngineUpdateRequest'];
export type UserEngineUpdateRequest = components['schemas']['UserEngineUpdateRequest'];
export type UserEngineClearResult = components['schemas']['UserEngineClearResult'];

export const enginePath = (projectId: string): string => `/api/v1/projects/${projectId}/llm-engine`;

export function fetchLlmEngine(projectId: string): Promise<ErrorResult<LlmEngineRead>> {
  return toResult(() => apiClient<LlmEngineRead>(enginePath(projectId)), 'llmEngineService.fetchLlmEngine');
}

export function setLlmEngine(
  projectId: string,
  body: LlmEngineUpdateRequest,
): Promise<ErrorResult<LlmEngineRead>> {
  return toResult(
    () => apiClient<LlmEngineRead>(enginePath(projectId), {method: 'PUT', body}),
    'llmEngineService.setLlmEngine',
  );
}

export function setMyEngine(
  projectId: string,
  body: UserEngineUpdateRequest,
): Promise<ErrorResult<LlmEngineRead>> {
  return toResult(
    () => apiClient<LlmEngineRead>(`${enginePath(projectId)}/me`, {method: 'PUT', body}),
    'llmEngineService.setMyEngine',
  );
}

export function clearMyEngine(projectId: string): Promise<ErrorResult<UserEngineClearResult>> {
  return toResult(
    () => apiClient<UserEngineClearResult>(`${enginePath(projectId)}/me`, {method: 'DELETE'}),
    'llmEngineService.clearMyEngine',
  );
}
