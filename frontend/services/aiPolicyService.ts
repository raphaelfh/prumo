/**
 * Per-project AI agents policy: who may start AI extraction runs through a
 * connected agent, and the per-run and per-day article caps. Any member reads
 * it; only a manager replaces it (the PUT answers 403 otherwise). Both calls
 * go through the typed client and return `ErrorResult<T>`.
 */

import {apiClient} from '@/integrations/api/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

export type AiPolicyRead = components['schemas']['AiPolicyRead'];
export type AiPolicyUpdateRequest = components['schemas']['AiPolicyUpdateRequest'];

export function fetchAiPolicy(projectId: string): Promise<ErrorResult<AiPolicyRead>> {
  return toResult(
    () => apiClient<AiPolicyRead>(`/api/v1/projects/${projectId}/ai-policy`),
    'aiPolicyService.fetchAiPolicy',
  );
}

/** A full replacement: the body always carries all three fields. */
export function updateAiPolicy(
  projectId: string,
  body: AiPolicyUpdateRequest,
): Promise<ErrorResult<AiPolicyRead>> {
  return toResult(
    () => apiClient<AiPolicyRead>(`/api/v1/projects/${projectId}/ai-policy`, {method: 'PUT', body}),
    'aiPolicyService.updateAiPolicy',
  );
}
