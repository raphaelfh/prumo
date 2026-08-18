---
status: approved
last_reviewed: 2026-08-18
owner: '@raphaelfh'
---

# Local Ollama evaluation — extraction on self-hosted models (C2 O1–O4)

Ran the C2 custom-endpoint path against a real local Ollama server to
answer one question: **is self-hosted local inference a caminho we should
document as supported?**

**Verdict: not yet, and the blocker is not the plumbing.** The endpoint
mechanism worked end to end on the first try; what failed was the model's
ability to satisfy prumo's extraction schema. One real defect in the
probe was found and fixed as a direct result of this run.

## Setup

| | |
|---|---|
| Host | Apple M5 Pro, 37.4 GiB unified memory |
| Server | Ollama 0.32.0, `http://localhost:11434/v1` (OpenAI-compatible) |
| Models | `qwen3.6:35b-mlx` (21 GB, reasoning), `gemma3:1b` |
| Backend | local dev, `SUPABASE_ENV=local`, `ALLOW_PRIVATE_LLM_ENDPOINTS=true` |
| Endpoint | created through the real API as a keyless project endpoint |

The SSRF guard behaved exactly as designed: `http://localhost:11434/v1`
is accepted **only** because the flag is on AND `supabase_env == "local"`
(`net_guard._private_ranges_allowed`). The same URL is rejected in
production regardless of the flag —
`test_flag_is_inert_outside_local_env` pins it. **This evaluation does
not change the §10 posture**: SaaS workers cannot reach a laptop, and
nothing here was promoted.

## Probe results (integration evidence)

| Model | Rung reached | Notes |
|---|---|---|
| `qwen3.6:35b-mlx` | **tool** | tool call arrives at completion token 284 |
| `gemma3:1b` | **native** | Ollama rejects the tool rung itself: *"does not support tools"* |

The endpoint's stored verdict is `ok` / `output_mode: "tool"`, produced
in 2.2 s once the model is warm (12.3 s cold, loading 21 GB).

### Defect found and fixed: the probe truncated reasoning models

The first real probe returned `failed` / *"no structured output mode
succeeded"* for an endpoint that works perfectly by hand. Cause: the
ladder capped every rung at `_MAX_TOKENS = 32`. `qwen3.6` is a reasoning
model — it spends its first tokens thinking, and the tool call only
appears at completion token 284. At 32 (and at 256) the response came
back `finish_reason="length"` with no `tool_calls`.

That is not a cosmetic mis-report: a `failed` endpoint is **not
selectable at all**, so the probe would have locked every reasoning model
out of the feature it exists to enable. Fixed in
`fix(llm): the capabilities probe must not truncate a reasoning model` —
the ceiling is a truncation guard, not a cost control (the 60 s ladder
deadline and the guard's 256 KiB cap are what bound the probe), and a
ladder that only ever ran out of room now reports
`truncated_before_output` instead of a generic failure.

Without running against a real endpoint this defect was invisible: every
unit test mocks the guard seam, so the mocked responses never carried a
`finish_reason`.

## Real extraction

Fixture: seeded article with stored markdown (a compact TRIPOD-style
prediction-model paper), the integration test template, engine pointed at
`openai_compatible` / `qwen3.6:35b-mlx` / endpoint `Local Ollama`.

**Result: the extraction failed after 32.1 s.**

```
UnexpectedModelBehavior: Exceeded maximum output retries (2)
  ToolRetryError("1 validation error\nmodels.0 …")
  output_retries_used = 3
```

The model returned JSON that did not validate against the extraction
schema, three times in a row. Latency per attempt was tolerable (~10 s);
the failure is structural, not a timeout.

**The headline finding: `output_mode` does not predict extraction
success.** A model can pass the ladder's one-boolean probe and still fail
every real extraction, because prumo's schema is a nested array of
richly-typed model objects, not a flat field. The probe is a *capability
smoke test* — it proves the transport and the structured-output mode work
— and must not be read as a quality gate. Worth keeping in mind for §5's
"Verified mode warns/blocks on prompted-only endpoints": that rule is
about ruling out the weakest transport, not about certifying quality.

### What was NOT measured, and why

Field-by-field quality against `gpt-5.6-luna` was not measurable: the
local run never produced a schema-valid payload, so there is nothing to
compare field by field. The structured-output error rate for
`qwen3.6:35b-mlx` on this schema is 3/3 attempts failed.

## Verdict

**Do not document laptop Ollama as a supported extraction path yet.**

- The C2 plumbing is not the obstacle — endpoint CRUD, the SSRF guard,
  the Fernet key path, engine pinning and `openai_compatible` model
  construction all worked end to end without a single change.
- The obstacle is schema compliance under a 35B local model. Before this
  becomes a supported path, we would need either a stronger local model
  tested against the *real* extraction schema, or a schema-relaxation
  strategy for endpoint engines (per-field extraction rather than one
  nested payload) — a design question, not a bug.
- The spec's existing framing survives intact: laptop Ollama stays
  works-via-tunnel-unsupported for SaaS (workers cannot reach
  localhost), and self-hosted prumo remains the strict-perimeter answer.

## Reproducing

1. `ollama serve`; `ollama pull qwen3.6` (or the current reasoning model
   in the live catalogue — check the library page, not memory).
2. `ALLOW_PRIVATE_LLM_ENDPOINTS=true` in `backend/.env` (inert unless
   `SUPABASE_ENV=local`).
3. Create the endpoint via `POST
   /api/v1/projects/{id}/llm-endpoints` with
   `base_url: "http://localhost:11434/v1"` and no key, then `POST
   …/{endpoint_id}/verify`.
4. `PUT /api/v1/projects/{id}/llm-engine` with
   `{provider: "openai_compatible", model, endpoint_id, mode: "fast"}`.
