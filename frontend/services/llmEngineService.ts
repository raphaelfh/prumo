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
 * so `toUpdateBody` can OMIT the key on plain model/mode PUTs — an old
 * backend with `extra="forbid"` 422s on the key itself.
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

/** The identity every alternates entry carries, whatever else it holds. */
export type LlmEngineAlternatePair = {provider: string; model: string};

/**
 * Overrides `toUpdateBody` accepts: the request fields, except `alternates`
 * may be ANY pair-bearing entries (catalogue entries, the read's own
 * alternates) — callers hand over what they have and the builder strips.
 */
export type LlmEngineUpdateOverrides = Partial<
  Omit<LlmEngineUpdateRequest, 'alternates'>
> & {alternates?: readonly LlmEngineAlternatePair[]};

/**
 * PUT body builder — EVERY mutation site goes through this. Always sends
 * the explicit mode (omitting it would let the server default silently
 * downgrade a verified project); includes `alternates` (stripped to bare
 * pairs) ONLY when the read carried the field, so plain model/mode PUTs
 * against an old backend stay 422-free during the promotion window.
 */
export function toUpdateBody(
  engine: LlmEngineRead,
  overrides: LlmEngineUpdateOverrides = {},
): LlmEngineUpdateRequest {
  const merged = {
    provider: engine.provider,
    model: engine.model,
    mode: engine.mode,
    // The stored list rides along only when the read carried the field AND
    // the caller is not replacing it — deriving it otherwise is dead work.
    ...(engine.hasAlternates && overrides.alternates === undefined
      ? {alternates: engine.alternates}
      : {}),
    ...overrides,
  };
  const body: LlmEngineUpdateRequest = {
    provider: merged.provider,
    model: merged.model,
    mode: merged.mode,
  };
  // Key ABSENT when neither side resolved a list — an old backend with
  // extra="forbid" 422s on the key itself, undefined value included.
  if (merged.alternates !== undefined) {
    body.alternates = merged.alternates.map(({provider, model}) => ({
      provider,
      model,
    }));
  }
  return body;
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
