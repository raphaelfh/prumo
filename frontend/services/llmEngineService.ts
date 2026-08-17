/**
 * Per-project LLM engine service (§5, C1b).
 *
 * Read + write for the ⚙ engine chip on the extraction Configuration tab.
 * Both calls route through the typed client and return `ErrorResult<T>`
 * (never throw across the boundary, never toast) — do not copy
 * `parserSettingsService.ts`, which predates that rule.
 */

import {apiClient} from '@/integrations/api/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

export type LlmEngineRead = components['schemas']['LlmEngineRead'];
export type LlmEngineCatalogEntry =
  components['schemas']['LlmEngineCatalogEntryRead'];
export type LlmEngineUpdateRequest =
  components['schemas']['LlmEngineUpdateRequest'];

export function fetchLlmEngine(
  projectId: string,
): Promise<ErrorResult<LlmEngineRead>> {
  return toResult(
    () => apiClient<LlmEngineRead>(`/api/v1/projects/${projectId}/llm-engine`),
    'llmEngineService.fetchLlmEngine',
  );
}

export function setLlmEngine(
  projectId: string,
  body: LlmEngineUpdateRequest,
): Promise<ErrorResult<LlmEngineRead>> {
  return toResult(
    () =>
      apiClient<LlmEngineRead>(`/api/v1/projects/${projectId}/llm-engine`, {
        method: 'PUT',
        body,
      }),
    'llmEngineService.setLlmEngine',
  );
}
