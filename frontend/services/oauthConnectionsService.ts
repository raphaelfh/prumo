/**
 * The viewer's OAuth connections: apps they approved on the consent page to
 * use prumo's MCP server for them. Distinct from `llmConnectionsService`
 * (`/api/v1/me/connections`), which lists the user's LLM provider keys.
 */
import {apiClient} from '@/integrations/api/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

export type OAuthConnectionRead = components['schemas']['OAuthConnectionRead'];

const CONNECTIONS = '/api/v1/me/oauth-connections';

export function fetchMyConnections(): Promise<ErrorResult<OAuthConnectionRead[]>> {
  return toResult(
    () => apiClient<OAuthConnectionRead[]>(CONNECTIONS),
    'oauthConnectionsService.fetchMyConnections',
  );
}

/** Idempotent on the server: revoking an already-revoked connection succeeds. */
export function revokeMyConnection(id: string): Promise<ErrorResult<void>> {
  return toResult(async () => {
    await apiClient<unknown>(`${CONNECTIONS}/${id}`, {method: 'DELETE'});
  }, 'oauthConnectionsService.revokeMyConnection');
}
