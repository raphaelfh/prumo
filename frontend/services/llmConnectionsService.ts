/**
 * AI connections (spec §4): a user's own keys and hosts (`/me/connections`),
 * the registry read (`/me/providers`) and a project's shared keys
 * (`/projects/{id}/connections`). Every call routes through the typed
 * client and returns `ErrorResult<T>` — never throws, never toasts. The
 * read never carries key material (`has_api_key` only).
 */
import {apiClient} from '@/integrations/api/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

export type LlmConnectionRead = components['schemas']['LlmConnectionRead'];

const ME = '/api/v1/me/connections';
export const projectConnectionsPath = (projectId: string): string =>
  `/api/v1/projects/${projectId}/connections`;

export function fetchMyConnections(): Promise<ErrorResult<LlmConnectionRead[]>> {
  return toResult(() => apiClient<LlmConnectionRead[]>(ME), 'llmConnectionsService.fetchMyConnections');
}

export function fetchProjectConnections(projectId: string): Promise<ErrorResult<LlmConnectionRead[]>> {
  return toResult(
    () => apiClient<LlmConnectionRead[]>(projectConnectionsPath(projectId)),
    'llmConnectionsService.fetchProjectConnections',
  );
}
export type ProviderRead = components['schemas']['ProviderRead'];
export type UserConnectionCreateRequest = components['schemas']['UserConnectionCreateRequest'];

export function fetchProviders(): Promise<ErrorResult<ProviderRead[]>> {
  return toResult(() => apiClient<ProviderRead[]>('/api/v1/me/providers'), 'llmConnectionsService.fetchProviders');
}

export function createMyConnection(body: UserConnectionCreateRequest): Promise<ErrorResult<LlmConnectionRead>> {
  return toResult(() => apiClient<LlmConnectionRead>(ME, {method: 'POST', body}), 'llmConnectionsService.createMyConnection');
}

export type LlmConnectionVerifyResult = components['schemas']['LlmConnectionVerifyResult'];
export type LlmConnectionDeleteResult = components['schemas']['LlmConnectionDeleteResult'];

export function deleteMyConnection(id: string): Promise<ErrorResult<LlmConnectionDeleteResult>> {
  return toResult(
    () => apiClient<LlmConnectionDeleteResult>(`${ME}/${id}`, {method: 'DELETE'}),
    'llmConnectionsService.deleteMyConnection',
  );
}

export function verifyMyConnection(id: string): Promise<ErrorResult<LlmConnectionVerifyResult>> {
  return toResult(
    () => apiClient<LlmConnectionVerifyResult>(`${ME}/${id}/verify`, {method: 'POST'}),
    'llmConnectionsService.verifyMyConnection',
  );
}
