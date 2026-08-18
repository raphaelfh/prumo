/**
 * Pure PUT-body builder for the per-project LLM engine (§5, C2 A4).
 *
 * Lives in lib/, NOT in the service: `LlmEngineChip` calls it directly,
 * and a value import from the service module would drag the api client —
 * and its supabase client, which throws at import time without
 * `VITE_SUPABASE_URL` — into every component test's module graph (the
 * exact CI-only failure this split fixes; the local `.env` masks it).
 * Only types cross back to the service, and types are erased.
 */
import type {LlmEngineRead} from '@/services/llmEngineService';
import type {components} from '@/types/api/schema';

type LlmEngineUpdateRequest = components['schemas']['LlmEngineUpdateRequest'];

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
