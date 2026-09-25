/**
 * Personal access tokens (PATs) for header-capable AI agents talking to
 * `/mcp` (spec §4.5). The secret is returned once, by create, and never
 * again — the server stores only its hash.
 */
import {ApiError, apiClient} from '@/integrations/api/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

export type PersonalAccessTokenRead = components['schemas']['PersonalAccessTokenRead'];
export type PersonalAccessTokenCreateRequest = components['schemas']['PersonalAccessTokenCreateRequest'];
export type PersonalAccessTokenCreated = components['schemas']['PersonalAccessTokenCreated'];

const TOKENS = '/api/v1/me/tokens';

export function fetchMyTokens(): Promise<ErrorResult<PersonalAccessTokenRead[]>> {
  return toResult(() => apiClient<PersonalAccessTokenRead[]>(TOKENS), 'personalAccessTokenService.fetchMyTokens');
}

export function createMyToken(
  body: PersonalAccessTokenCreateRequest,
): Promise<ErrorResult<PersonalAccessTokenCreated>> {
  return toResult(
    () => apiClient<PersonalAccessTokenCreated>(TOKENS, {method: 'POST', body}),
    'personalAccessTokenService.createMyToken',
  );
}

export function revokeMyToken(id: string): Promise<ErrorResult<void>> {
  return toResult(async () => {
    await apiClient<unknown>(`${TOKENS}/${id}`, {method: 'DELETE'});
  }, 'personalAccessTokenService.revokeMyToken');
}

/** The 409 at the 10-active-token cap. */
export function isTokenLimitError(error: Error): boolean {
  return error instanceof ApiError && error.code === 'TOKEN_LIMIT_REACHED';
}
