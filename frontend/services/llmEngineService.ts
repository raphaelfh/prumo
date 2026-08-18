/**
 * Per-project LLM engine service (§5, C1b + C2 alternates).
 *
 * Read + write for the ⚙ engine chip on the extraction Configuration tab.
 * Both calls route through the typed client and return `ErrorResult<T>`
 * (never throw across the boundary, never toast) — do not copy
 * `parserSettingsService.ts`, which predates that rule.
 *
 * Deploy-window tolerance (C2 A4, blocking panel finding): an OLD backend
 * during the promotion window serves the read WITHOUT `alternates`. The
 * read is normalized (`alternates: [] `) and flagged with `hasAlternates`
 * so `toUpdateBody` (`@/lib/llmEngineUpdateBody` — pure, importable by
 * components without dragging the api client) can OMIT the key on plain
 * model/mode PUTs — an old backend with `extra="forbid"` 422s on the key.
 */

import {apiClient} from '@/integrations/api/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

/** The read exactly as the wire carries it (generated contract type). */
type LlmEngineReadWire = components['schemas']['LlmEngineRead'];

/**
 * The read the app consumes: the wire shape plus `hasAlternates`, which
 * records whether the wire payload carried the `alternates` field at all
 * (false only against an old backend during the promotion window).
 */
export type LlmEngineRead = LlmEngineReadWire & {hasAlternates: boolean};
export type LlmEngineCatalogEntry =
  components['schemas']['LlmEngineCatalogEntryRead'];
export type LlmEngineAlternate = components['schemas']['LlmEngineAlternate'];
export type LlmEngineAlternateRead =
  components['schemas']['LlmEngineAlternateRead'];
export type LlmEngineUpdateRequest =
  components['schemas']['LlmEngineUpdateRequest'];

function normalizeEngineRead(data: LlmEngineReadWire): LlmEngineRead {
  return {
    ...data,
    alternates: data.alternates ?? [],
    hasAlternates: 'alternates' in data,
  };
}

export function fetchLlmEngine(
  projectId: string,
): Promise<ErrorResult<LlmEngineRead>> {
  return toResult(async () => {
    const data = await apiClient<LlmEngineReadWire>(
      `/api/v1/projects/${projectId}/llm-engine`,
    );
    return normalizeEngineRead(data);
  }, 'llmEngineService.fetchLlmEngine');
}

export function setLlmEngine(
  projectId: string,
  body: LlmEngineUpdateRequest,
): Promise<ErrorResult<LlmEngineRead>> {
  return toResult(async () => {
    const data = await apiClient<LlmEngineReadWire>(
      `/api/v1/projects/${projectId}/llm-engine`,
      {
        method: 'PUT',
        body,
      },
    );
    return normalizeEngineRead(data);
  }, 'llmEngineService.setLlmEngine');
}
