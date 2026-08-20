/**
 * Shared LLM-engine read fixtures (§5 C1b/C2).
 *
 * Four suites — service, deploy-window, hook, chip — each hand-rolled the
 * same eleven-field payload, so a contract field added to `LlmEngineRead`
 * had to be found four times.
 *
 * TWO builders, because the wire payload and the app-side read are
 * genuinely different shapes and blurring them would hide the very
 * normalization the deploy-window suites pin:
 *
 * - `makeEngineReadWire` — what a CURRENT backend serves. Feed it to
 *   `apiClient` / MSW mocks, i.e. anything upstream of the service.
 * - `makeEngineRead` — that payload as `normalizeEngineRead` returns it,
 *   plus the client-only `hasAlternates`. Feed it to hooks and components,
 *   which only ever see the normalized read.
 *
 * An OLD backend's payload (pre-C2: no `alternates` key at all) is the
 * wire builder minus that field — destructure it off at the call site so
 * the omission stays visible in the test that depends on it.
 *
 * The service module is imported for TYPES only (erased at runtime): its
 * value exports pull in the api client, which several of these suites mock.
 */
import type {LlmEngineRead} from '@/services/llmEngineService';

/** The read exactly as the wire carries it — no client-only fields. */
export type LlmEngineReadWire = Omit<
  LlmEngineRead,
  'hasAlternates' | 'hasEndpointId'
>;

/** A current backend's read payload; override any field. */
export function makeEngineReadWire(
  overrides: Partial<LlmEngineReadWire> = {},
): LlmEngineReadWire {
  return {
    provider: 'openai',
    model: 'gpt-4o-mini',
    mode: 'fast',
    source: 'default',
    retired: false,
    updated_by_name: null,
    updated_at: null,
    previous_model: null,
    catalog: [],
    availability: {openai: true, anthropic: false},
    alternates: [],
    endpoint_id: null,
    endpoint_label: null,
    ...overrides,
  };
}

/** The same read as the service normalizes it (wire + the client flags). */
export function makeEngineRead(
  overrides: Partial<LlmEngineRead> = {},
): LlmEngineRead {
  return {
    ...makeEngineReadWire(),
    hasAlternates: true,
    hasEndpointId: true,
    ...overrides,
  };
}
