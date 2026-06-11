---
status: approved
created: 2026-06-11
last_reviewed: 2026-06-11
owner: '@raphaelfh'
---

# Design — Extraction LLM Stack Modernization (Pydantic AI + Logfire)

**Date:** 2026-06-11
**Decision drivers:** typed end-to-end extraction, state-of-the-art Python
structured-output tooling, maintainability (versioned prompts, dedicated LLM
observability), no legacy left behind.

## 1. Context

The extraction stack today is raw OpenAI over HTTP with manual JSON handling:

- `app/services/openai_service.py` (446 LOC) wraps the OpenAI API with
  tenacity retries; structured output is `json_schema`/`json_object`
  response formats plus `app/utils/json_parser.py` fallbacks (parse failure
  silently degrades to an empty dict).
- `app/services/section_extraction_service.py` (1,439 LOC) and
  `app/services/model_extraction_service.py` (586 LOC) hand-build JSON
  schemas at runtime from `extraction_entity_types` / `extraction_fields`
  rows and embed prompt text inside 130+ line methods.
- `langchain`, `langchain-openai`, and `instructor` are installed but
  **unused** (dead dependency surface).
- Observability is structlog events + token counts in
  `extraction_runs.results` JSONB; there is no per-call LLM trace, no cost
  view, no prompt versioning.

Hard product constraint: extraction schemas are **not static code**. They
are built at runtime from DB rows (UI-customizable templates: field name,
type, description, allowed enum values). Any build-time-codegen approach is
disqualified unless it has a first-class runtime escape hatch.

## 2. Scope decisions (validated 2026-06-11)

1. **Full migration** — all extraction flows (section extraction single /
   batch / in-run HITL, and model identification) move to the new stack.
   No dual code paths remain at the end.
2. **Model-agnostic library, OpenAI active** — multi-provider is a
   capability, not immediate work. BYOK per-user API keys stay per-call.
3. **Celery remains the orchestrator** — queueing, task retries, and
   parallelism stay as-is. The new library is a typed *call layer*, not an
   agent/workflow framework. No durable-execution engine.
4. **Maintenance scope** — versioned prompts in the repo + dedicated LLM
   observability. Eval/regression suites are explicitly **out of scope**
   (the chosen tooling must not preclude them later).

## 3. Library decision

Research snapshot (June 2026, verified against PyPI/GitHub/vendor docs):

| Candidate | Verdict |
| --- | --- |
| **Pydantic AI v1** (chosen) | Only candidate covering every constraint natively: runtime schemas via `pydantic.create_model` (validated) or `StructuredDict` (raw JSON schema), per-call `model` + `output_type` (clean BYOK inside Celery tasks), `ModelRetry`/output validators for semantic reask, `run_sync()` for sync task bodies, `RunUsage` token accounting, vendor-neutral OTel instrumentation. Weekly releases, backed by the Pydantic team (same vendor as our Pydantic v2 core). |
| Instructor | Meets the hard requirements with minimal surface, but release momentum has slowed (last release 2026-04), observability is DIY hooks, and an in-flight v2 rewrite adds churn risk. |
| Native OpenAI SDK (`responses.parse`) | Satisfies the runtime-schema constraint with zero new deps, but we would hand-roll reask retries, usage normalization, OTel wiring, and a second provider integration later — the commodity code the libraries already maintain. |
| BAML | Codegen-first grain; fully DB-driven schemas would live permanently in its TypeBuilder escape hatch. Rejected. |
| Outlines | Constrained decoding only applies to self-hosted models; on the OpenAI API it delegates to OpenAI's own json_schema. N/A. |
| LangChain / DSPy / Mirascope / Marvin | Too heavy for structured-output-only / optimizer-centric with awkward per-call BYOK / adoption risk / a wrapper over Pydantic AI, respectively. |

**Decision:** `pydantic-ai-slim[openai]`, **pinned to v1.x**. v2 is
beta-only as of 2026-06-11 (`2.0.0b7`; betas so far mostly fold in v1
changes) and is not adopted. **Upgrade trigger:** when v2 reaches GA,
schedule the v1→v2 upgrade as its own small follow-up — `app/llm/` is the
only module touching the library, v1 receives security support ≥ 6 months
after v2 lands, and an official upgrade guide is provided.

**Observability decision:** **Pydantic Logfire SaaS** (free tier: 10M
records/month — an order of magnitude above our volume). Only option with
first-party integrations for every layer of this exact stack:
`instrument_pydantic_ai()`, `instrument_fastapi()`, `instrument_celery()`,
and a `StructlogProcessor` correlating existing JSON logs with traces.
Lock-in is low: the SDK emits pure OTel (GenAI semconv); switching backends
later means pointing `OTEL_EXPORTER_OTLP_ENDPOINT` elsewhere, with no code
change. Langfuse self-host was rejected for a solo-dev team (six-container
v3 stack); Langfuse Cloud is the documented runner-up.

## 4. Architecture

New bounded module — the **single doorway to LLMs**. Services import from
it and stop knowing about HTTP/SDK details:

```text
backend/app/llm/
  provider.py        # BYOK key + model name → OpenAIChatModel(name, provider=OpenAIProvider(api_key=...))
  schema.py          # extraction_fields rows → pydantic.create_model output models (+ chunker)
  extractor.py       # the typed call: builds a tools-free Agent per call, run_sync for Celery
  validators.py      # semantic checks that raise ModelRetry (e.g., evidence page exists in doc)
  prompts/
    __init__.py      # registry: name → template module (NAME, VERSION, render())
    section_extraction.py
    quality_assessment.py
    model_identification.py
  observability.py   # Logfire setup — no-op without LOGFIRE_TOKEN
```

Component contracts:

- **`schema.py`** — each template field becomes a typed sub-model
  `{value: <real type from field_type>, confidence: float (ge=0, le=1),
  reasoning: str | None, evidence: Evidence | None}`; `select` /
  `multiselect` map `allowed_values` to `Literal[...]`. Out-of-enum values
  and out-of-range confidences stop being dirty data and become automatic
  reasks. Also owns the **strict-mode chunker** (§6).
- **`extractor.py`** — constructs a fresh tools-free `Agent` per extraction
  call, binding `output_type` and output validators together. Rationale:
  per-run `output_type` is incompatible with agent-level validators in
  Pydantic AI v1, and our output type changes per template; a per-call
  Agent is a cheap object and keeps BYOK state-free.
- **`prompts/`** — plain Python modules: `NAME`, `VERSION` (content hash
  computed at import), `render(context) -> str`. Prompt text leaves the
  service methods. `prompt.name` / `prompt.version` are stamped as span
  attributes so every production trace resolves to an exact git version.
- **`observability.py`** — gated on `LOGFIRE_TOKEN`; absent (local dev,
  tests, CI) everything is a no-op. Instruments FastAPI (web), Celery
  (web producer + worker consumer, for distributed traces), Pydantic AI,
  and adds `logfire.StructlogProcessor` to the existing structlog chain.

**No database change.** No table changes, no Alembic migration. The
contract with `extraction_runs`, `extraction_proposal_records`,
`extraction_evidence`, and the frontend stays identical.

## 5. Data flow

```text
Celery task → SectionExtractionService / ModelExtractionService
  → PDF text (PDFProcessor, unchanged)
  → schema.build_output_model(entity_type)      # DB rows → Pydantic model
  → prompts.render(...)                          # versioned template
  → extractor.extract(prompt, output_model, model_ref, user_key)
  → typed result → proposal/evidence rows (same writes as today)
  → result.usage → extraction_runs.results JSONB (same tokens_* keys)
```

Batch section extraction keeps its accumulated-memory behavior (summary
string threaded between sequential calls) unchanged.

## 6. Error handling

Layered, inside-out:

1. **Semantic reask (new):** Pydantic validation failure or a validator
   raising `ModelRetry` feeds the error back to the model; output-retry
   budget of 2. Replaces today's "parse failed → silent empty dict".
2. **Reask budget exhausted:** `UnexpectedModelBehavior` propagates to the
   existing `rollback_and_fail()` path — run marked failed with
   `error_message`, no half-validated data persisted.
3. **Transient network errors:** library-level HTTP retries plus the
   existing Celery task retry (3 attempts, 60s) as the outer safety net.
4. **Spend ceiling (new):** `UsageLimits` per run caps token usage so a
   reask loop cannot run away — important under BYOK (the key is the
   user's).

**OpenAI strict-mode limits:** strict `json_schema` allows ~100 properties
and 5 nesting levels. Each extraction field expands to ~7 properties, so
roughly 14 fields fit per call. `schema.py` chunks fields into batches
under the property budget and merges results — transparent to services.
Small templates stay single-call. Today this limit is simply unhandled.
Accepted trade-off: large templates may cost more calls per run, with
likely better per-call quality; visible in Logfire from day one.

## 7. Testing

Interleaved with each phase, never batched at the end:

- **Unit (no network):** `models.ALLOW_MODEL_REQUESTS = False` globally in
  the test suite — no real call can escape. `TestModel` / `FunctionModel`
  replace HTTP mocking. Covered: schema builder (DB rows → generated
  model, chunking cases), validators (`ModelRetry` firing), prompt
  rendering (snapshot + `VERSION` stability).
- **Integration:** the existing pytest + local Supabase suite keeps
  covering services end-to-end with `FunctionModel` returning canned
  extractions — asserting proposal/evidence/run writes match the current
  contract exactly.
- **Live smoke:** one `@pytest.mark.llm` test (excluded from CI) against
  the real API, run on demand.

## 8. Migration phases

Each phase lands with `make quality-scan` green; detailed task breakdown
belongs to the implementation plan (writing-plans).

1. **Foundation:** `app/llm/` package + deps (`pydantic-ai-slim[openai]`
   pinned v1.x, `logfire`) + instrumentation (inert without token). Nothing
   consumes it yet.
2. **Model identification migrates** — the smaller, isolated flow
   (586 LOC) pilots the design.
3. **Section extraction migrates** — single + batch-with-memory + in-run
   HITL (the bulk of the 1,439 LOC).
4. **Demolition:** delete `openai_service.py` (446 LOC) and the extraction
   paths of `json_parser.py`; drop `langchain`, `langchain-openai`,
   `instructor` from `pyproject.toml` (installed-but-dead today — less CVE
   surface). One code path remains.

### Migration invariants

- Same DB writes (proposals, evidence, runs).
- Same API response envelope.
- Same key structlog events (`section_extraction_*`,
  `model_extraction_*`).
- Same `tokens_*` keys in `extraction_runs.results`.
- The frontend does not notice the swap.

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Pydantic AI v2 transition | Pin v1.x; explicit upgrade trigger at v2 GA (§3); upgrade surface confined to `app/llm/`; v1 security support ≥ 6 months post-v2; official upgrade guide. |
| Chunking raises call count for large templates | Only triggers over the property budget; per-call quality likely improves; cost visible in Logfire. |
| Logfire pricing/posture changes | Instrumentation is pure OTel; re-point `OTEL_EXPORTER_OTLP_ENDPOINT` to Langfuse/Phoenix without code changes. |
| Strict mode rejects an exotic user schema shape | Chunker keeps schemas inside the documented subset; provider 400s fail the run with a clear `error_message`. |

## 10. Out of scope

- Eval / prompt-regression suites (future cycle; `pydantic-evals` is the
  natural OTel-based follow-on and is not precluded).
- Activating Anthropic or any second provider (one-line model swap when
  wanted; BYOK plumbing already provider-shaped).
- Agent/graph orchestration, streaming, durable-execution engines.
- Any schema or frontend change.
