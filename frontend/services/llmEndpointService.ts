/**
 * Project custom LLM endpoints — CRUD + verify (§5.2, C2 PR-C).
 *
 * The manager-only management surface behind the engine popover: an
 * OpenAI-compatible endpoint the project runs on its own shared key. Every
 * call routes through the typed client and returns `ErrorResult<T>` (never
 * throws across the boundary, never toasts).
 *
 * No read normalization, deliberately: these five routes are greenfield,
 * so an old backend 404s them wholesale rather than serving a narrower
 * payload — there is no deploy-window field to tolerate the way
 * `llmEngineService` tolerates `alternates`. The wire shape IS the read.
 *
 * The read NEVER carries key material (`has_api_key` is the only trace a
 * key exists); on the write side `api_key` is a tri-state this service
 * transports verbatim and never interprets: `null`/omitted keeps the
 * stored key, `""` clears it, a non-empty string sets a new one.
 */

import {apiClient} from '@/integrations/api/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

export type LlmEndpointRead = components['schemas']['LlmEndpointRead'];
export type LlmEndpointCreateRequest =
  components['schemas']['LlmEndpointCreateRequest'];
export type LlmEndpointUpdateRequest =
  components['schemas']['LlmEndpointUpdateRequest'];
export type LlmEndpointProbeResult =
  components['schemas']['LlmEndpointProbeResult'];
export type LlmEndpointDeleteResult =
  components['schemas']['LlmEndpointDeleteResult'];

const collectionPath = (projectId: string): string =>
  `/api/v1/projects/${projectId}/llm-endpoints`;

const itemPath = (projectId: string, endpointId: string): string =>
  `${collectionPath(projectId)}/${endpointId}`;

export function fetchLlmEndpoints(
  projectId: string,
): Promise<ErrorResult<LlmEndpointRead[]>> {
  return toResult(
    () => apiClient<LlmEndpointRead[]>(collectionPath(projectId)),
    'llmEndpointService.fetchLlmEndpoints',
  );
}

export function createLlmEndpoint(
  projectId: string,
  body: LlmEndpointCreateRequest,
): Promise<ErrorResult<LlmEndpointRead>> {
  return toResult(
    () =>
      apiClient<LlmEndpointRead>(collectionPath(projectId), {
        method: 'POST',
        body,
      }),
    'llmEndpointService.createLlmEndpoint',
  );
}

export function updateLlmEndpoint(
  projectId: string,
  endpointId: string,
  body: LlmEndpointUpdateRequest,
): Promise<ErrorResult<LlmEndpointRead>> {
  return toResult(
    () =>
      apiClient<LlmEndpointRead>(itemPath(projectId, endpointId), {
        method: 'PUT',
        body,
      }),
    'llmEndpointService.updateLlmEndpoint',
  );
}

/**
 * 409 when the project engine still points at this endpoint — the typed
 * message rides the ErrorResult so the dialog surfaces the real reason
 * instead of a generic failure.
 */
export function deleteLlmEndpoint(
  projectId: string,
  endpointId: string,
): Promise<ErrorResult<LlmEndpointDeleteResult>> {
  return toResult(
    () =>
      apiClient<LlmEndpointDeleteResult>(itemPath(projectId, endpointId), {
        method: 'DELETE',
      }),
    'llmEndpointService.deleteLlmEndpoint',
  );
}

/**
 * Runs the capabilities probe and PERSISTS the outcome on the row. A
 * probe that answers "this endpoint is broken" is a SUCCESSFUL call
 * (`validation_status: "failed"` + a sanitized reason); only a transport
 * or authorization failure is an ErrorResult.
 */
export function verifyLlmEndpoint(
  projectId: string,
  endpointId: string,
): Promise<ErrorResult<LlmEndpointProbeResult>> {
  return toResult(
    () =>
      apiClient<LlmEndpointProbeResult>(
        `${itemPath(projectId, endpointId)}/verify`,
        {method: 'POST'},
      ),
    'llmEndpointService.verifyLlmEndpoint',
  );
}
