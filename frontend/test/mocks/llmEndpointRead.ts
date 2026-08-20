/**
 * Shared custom-endpoint read fixtures (§5.2, C2 PR-C).
 *
 * ONE builder, unlike `llmEngineRead.ts`'s two: the endpoints routes are
 * greenfield (an old backend 404s them wholesale, it never serves a
 * narrower payload), so there is no normalization step between the wire
 * payload and the read the app consumes — the wire shape IS the read.
 * If a tolerated field ever appears, split this the way the engine
 * fixtures are split rather than blurring the two shapes here.
 *
 * The service module is imported for TYPES only (erased at runtime): its
 * value exports pull in the api client, which these suites mock.
 */
import type {LlmEndpointRead} from '@/services/llmEndpointService';

/** A single endpoint row; override any field. */
export function makeEndpointRead(
  overrides: Partial<LlmEndpointRead> = {},
): LlmEndpointRead {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    label: 'Lab vLLM',
    base_url: 'https://llm.lab.example.org/v1',
    allowed_models: ['qwen3-30b'],
    has_api_key: true,
    validation_status: 'unverified',
    last_validated_at: null,
    created_by_name: 'Alice Manager',
    capabilities: {output_mode: null, models_seen: []},
    ...overrides,
  };
}
