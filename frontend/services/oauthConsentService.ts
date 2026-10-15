/**
 * The consent step of the OAuth flow for MCP clients: read a pending
 * authorization request, then approve or deny it. The decision answers with
 * the app's redirect URL, built by the server.
 */
import {ApiError, apiClient} from '@/integrations/api/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

export type OAuthConsentRequestRead = components['schemas']['OAuthConsentRequestRead'];
export type OAuthConsentDecisionRequest = components['schemas']['OAuthConsentDecisionRequest'];
export type OAuthConsentDecisionRead = components['schemas']['OAuthConsentDecisionRead'];

const requestPath = (id: string) => `/api/v1/oauth/requests/${id}`;

export function fetchConsentRequest(id: string): Promise<ErrorResult<OAuthConsentRequestRead>> {
  return toResult(
    () => apiClient<OAuthConsentRequestRead>(requestPath(id)),
    'oauthConsentService.fetchConsentRequest',
  );
}

export function decideConsentRequest(
  id: string,
  body: OAuthConsentDecisionRequest,
): Promise<ErrorResult<OAuthConsentDecisionRead>> {
  return toResult(
    () => apiClient<OAuthConsentDecisionRead>(`${requestPath(id)}/decision`, {method: 'POST', body}),
    'oauthConsentService.decideConsentRequest',
  );
}

/** The 404 for an unknown or expired request. */
export function isRequestGoneError(error: Error): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** The 409 when the request was already approved or denied. */
export function isAlreadyDecidedError(error: Error): boolean {
  return error instanceof ApiError && error.code === 'REQUEST_ALREADY_DECIDED';
}

/** The 429 from the consent routes' rate limit. */
export function isRateLimitedError(error: Error): boolean {
  return error instanceof ApiError && error.status === 429;
}
