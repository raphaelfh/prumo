---
status: draft
last_reviewed: 2026-06-23
owner: '@raphaelfh'
---

# Extraction pipeline stabilization & fine-tuning — design

> **Status:** Draft · Date: 2026-06-23 · Deciders: @raphaelfh
> **Relation to existing design:** This spec does **not** introduce new
> infrastructure. It (1) finishes the *unbuilt half* of ADR-0011 (feed the
> already-persisted blocks to the LLM, retiring the 15k truncation), (2) ratifies
> the markdown-first citation reality that already shipped in #382 and supersedes
> ADR-0013's stale "canvas-only" limitation, (3) centralizes LLM model/provider
> configuration and makes Claude selectable, and (4) fixes a bounded set of
> genuinely-real reliability bugs in the extraction services. Three premises in
> the original brief were disproven by the evidence and are recorded below as
> *non-fixes* (guarded by regression tests, not patched).

## 1. Context — verified current state of `dev`

Evidence was gathered by a read-only investigation across the pipeline and by
direct inspection of `dev` at `ff1c99c1`. The headline facts:

- **The LLM is still fed lossy text.** Extraction fetches the PDF, runs
  `PDFProcessor.extract_text()` (pypdf), and **hard-truncates to 15,000 chars**
  (`MAX_PDF_CHARS`, `backend/app/llm/prompts/__init__.py`) at three prompt sites
  (`section_extraction`, `model_identification`, `quality_assessment`). There is
  **no chunking or windowing**; `extract_text_chunked()` exists with zero callers.
- **The grounding substrate is already live.** Ingest enqueues
  `parsing_tasks.py` → `DocumentParsingService` → `article_text_blocks`
  (char offsets + bbox), via `create_document_parser` (`app/core/factories.py`);
  a fitness test forbids bypass. Default `PARSER_BACKEND="docling"`, per-project
  `auto` (LlamaParse when a `llama_cloud` BYOK key exists). **Docling's native
  deps (libxcb/libGL/glib) are already installed in the Dockerfile** — the
  historical slim-worker crash is mitigated in code.
- **Blocks ground citations but bypass the LLM input.** `article_text_blocks`
  are read only *after* extraction, inside `_create_suggestions()`, to anchor
  evidence via `evidence_anchor_service.build_anchor`. They never reach the
  prompt. `render_blocks_to_markdown` (ADR-0013 free tier) **does not exist**.
- **Citations already went text-first.** #382 shipped markdown-first locate
  (`useReaderLocate` → scroll+flash in `Reader.tsx`) to `dev` and prod. The live
  AI-suggestion popover calls `useReaderLocate()` and **no longer imports**
  `useCitationHighlight`. The PDF-bbox stack (`useCitationHighlight`,
  `CitationOverlay`) is **orphaned** from the extraction flow. **ADR-0013 was
  never updated** and still claims highlight is "canvas-only" — now false.
- **Model is hardcoded.** `gpt-4o-mini` is a string literal in **12 places across
  6 production files**; `OPENAI_DEFAULT_MODEL` exists in config but is **never read
  at runtime** (a dead artifact). `build_model(model_name, *, api_key)` is
  **OpenAI-only** — it ignores any provider and always builds `OpenAIChatModel`. However, BYOK key storage for
  Claude **already exists**: `user_api_keys.provider` allows
  `('openai','anthropic','gemini','grok','llama_cloud')` (CHECK constraint,
  migration 0027 + baseline) and `SUPPORTED_PROVIDERS` lists them. The only gap
  is `build_model` and caller-side provider/key resolution.

## 2. Decisions

### A1 — LLM consumes a block-derived markdown projection, windowed

The LLM input becomes a **markdown projection of `article_text_blocks`**
(headings, GFM tables, lists, reading order), assembled within a **model-aware
token budget** and **windowed** for long documents. The 15k blind truncation is
deleted. This finishes ADR-0011's grounded-extraction half and feeds the model
the *same representation* the reader renders and citations anchor against.

**Staged:**

- **P1 (core win):** add the pure `render_blocks_to_markdown(blocks) -> str`;
  **assemble the article's block-markdown once per run** and thread it through the
  per-entity-type extraction loop (do **not** re-assemble per section), bounded by
  a model-aware token budget, **surfacing overflow** (structured log + a typed
  `truncated` flag on `AssemblyInfo`) instead of a silent mid-context chop. The
  **pypdf fallback** (when an article has no blocks yet — the two-tier state
  ADR-0011 promised but never wired) **passes through the same budgeted
  assembler**, so no path can send unbounded text. `model_identification` consumes
  the same whole-document budgeted markdown (it must see the full paper to find
  every model).
- **P2 (enhancement, may defer):** section-aware block *selection* — feed only
  the blocks relevant to the entity-type being extracted. Depends on a reliable
  section→block mapping we do not yet have; if reliable detection is not cheap, P2
  is deferred and P1's budgeted full-doc window stands. **No silent truncation in
  either stage.**

**Cost model (assemble-once + observe).** A run makes one LLM call per
entity-type, and `schema.py` further chunks fields (≤14/chunk, OpenAI strict-mode
limit) into additional calls — so per-run input ≈ (entity-types × field-chunks) ×
budget. Assembling **once and reusing** removes redundant re-assembly; we **log
per-run token/cost** for observability but add **no hard per-run ceiling yet**
(YAGNI until we have real numbers).

**Out of scope:** vision-to-model / table-vision pass (deferred per ADR-0011);
the enriched markdown tier (`markdown_enriched` column stays unbuilt).

### B1 — Text-first citations; delete the orphaned bbox stack

Markdown-locate is the **sole** citation-highlight surface. **B1 is frontend-only.**
The orphaned `useCitationHighlight`, `CitationOverlay`, the canvas overlay
rendering, and their tests are **deleted** (closes the existing follow-up
`task_987a3c69`). The deletion is **coordinated in one commit** — remove the
`CitationOverlay` import+usage from `Viewer.tsx` in the same change that deletes
the file, to avoid an intermediate build break.

**The backend anchor contract is left unchanged.** Markdown-locate matches on the
evidence **quote text** (`evidence.text`), not the backend anchor, and
`build_anchor` already emits only `TextCitationAnchor` (prose) /
`HybridCitationAnchor` (table/figure) — it **never emits** `RegionCitationAnchor`.
So there is no reason to touch `build_anchor`, `parse_position`, or
`schemas/extraction.py`: no contract drift, no `schema.d.ts` regeneration, no
backward-compat read break (`extraction_evidence.position` is JSONB regardless).
`RegionCitationAnchor` stays defined for tolerant reads of any historical rows.
ADR-0013's "Highlight limitation" section is superseded; **canvas mode remains for
navigation only.**

Figure/table coverage under text-first: tables render as GFM (cell text is
searchable), figure captions are `figure_caption` text blocks (searchable); only
a bare image region cited with no quotable text degrades to a nearest-block flash
— rare in clinical field extraction.

### C1 — One configurable model/provider; Claude selectable; keep pydantic-ai

Keep `pydantic-ai` (the whole prompt/extractor/validator layer is built on it;
switching is a large rewrite for no concrete gain). Collapse the **12 hardcoded
`gpt-4o-mini` defaults across 6 files** into **one authoritative configurable
setting** actually read at runtime (`OPENAI_DEFAULT_MODEL` is currently a dead
artifact). `build_model(provider, model_name, *, api_key)` gains a **provider
branch** (OpenAI now, Anthropic added) via the existing pydantic-ai extras.

**Provider-aware structured output (the trap).** OpenAI uses `NativeOutput`
(JSON-schema `response_format`); **Anthropic has no `response_format`** and
pydantic-ai drives Anthropic structured output via **tool-calling (`ToolOutput`)**.
`extractor.py` must select `output_type` by provider
(`NativeOutput(model) if provider == "openai" else ToolOutput(model)`) or Claude
silently fails. **Claude is BYOK-only in this effort** — `APIKeyService` already
resolves a user's `anthropic` BYOK key; **no global `ANTHROPIC_API_KEY` fallback is
wired** (decided 2026-06-23). **The live default model/provider is unchanged** —
flipping to Claude is a per-project/per-request choice once a BYOK key exists.
Parser default is **verify-and-locked**, not churned (the crash + ignored-key bugs
were already fixed by #359).

## 3. Migrations

**None.** Verified:

- A1 — `render_blocks_to_markdown` is a pure on-demand projection (ADR-0013, no
  column); the assembler reads the existing `article_text_blocks` (table 0006).
- B1 — frontend-only deletion; the backend anchor contract is **unchanged** (no
  schema edit, no `schema.d.ts` regen). `extraction_evidence.position` is JSONB
  regardless.
- C1 — `user_api_keys.provider` already permits `anthropic` (CHECK constraint
  since baseline/0027); `SUPPORTED_PROVIDERS` already lists it; the Fernet
  encryption + RLS on that table are provider-agnostic. Claude is **BYOK-only**
  (no global key). No new column, enum, constraint, or migration.

(Consequently the `test_migration_roundtrip` head-pin / `downgrade -1` gotcha
does not apply to this effort.)

## 4. Architecture & components (layering-compliant)

### A1

| Layer | Change |
| --- | --- |
| Infrastructure | `app/infrastructure/parsing/base.py`: add pure `render_blocks_to_markdown(blocks) -> str` beside `concat_page_text`. Deterministic GFM tables, `#` headings, lists, reading order. |
| Assembler | New **pure** module `app/llm/assembler.py`: `assemble(blocks, *, model_name, budget_tokens) -> (markdown, AssemblyInfo)`. `AssemblyInfo` is a **typed Pydantic model** (`app/schemas/extraction.py`): `total_blocks`, `included_blocks`, `truncated: bool`, `est_tokens`. Token estimate via `tiktoken` for OpenAI, char/4 heuristic fallback (Anthropic skew documented in a unit test). |
| Service | `section_extraction_service` / `model_extraction_service`: fetch blocks once (`ArticleTextBlockRepository.list_ordered_for_file`), `assemble` **once per run**, **thread the markdown through the entity-type loop** (no re-assembly). When **no blocks exist**, the **pypdf text is routed through the same `assemble`** (budgeted, never unbounded). Log `AssemblyInfo.truncated` + per-run est-tokens. |
| Prompts | `prompts/__init__.py`: delete `MAX_PDF_CHARS`; all **three** `render(...)` sites (`section_extraction`, `model_identification`, `quality_assessment`) receive pre-assembled, budgeted text. |

### B1

| Layer | Change |
| --- | --- |
| Frontend (delete, one commit) | `frontend/hooks/extraction/useCitationHighlight.ts` (+ tests), `frontend/pdf-viewer/primitives/CitationOverlay.tsx` (+ tests/a11y), the `CitationOverlay` import+render in `Viewer.tsx`, dead copy keys — all in a **single commit** so the build never breaks mid-way. (Confirmed orphaned: the AI popover uses `useReaderLocate`; `usePageHandle` does not import the hook in active code.) |
| Frontend (keep) | `useReaderLocate` markdown-locate stays the only surface. |
| Backend | **No change.** `build_anchor` already emits Text/Hybrid (never Region) and markdown-locate matches on `evidence.text`. Leaving the contract intact avoids `schema.d.ts` drift and historical-read breakage. |
| Docs | Supersede ADR-0013 §"Highlight limitation" (markdown-locate is the citation surface; canvas = navigation-only); cross-reference from ADR-0011. |

### C1

| Layer | Change |
| --- | --- |
| Config | `app/core/config.py`: `LLM_PROVIDER` (default `"openai"`), `LLM_DEFAULT_MODEL` (default the current OpenAI model), `LLM_TIMEOUT_SECONDS`. **No global `ANTHROPIC_API_KEY`** (Claude is BYOK-only). Defaults preserve current behavior exactly. |
| Provider | `provider.py::build_model(provider, model_name, *, api_key)`: OpenAI branch (current) + Anthropic branch (`pydantic-ai-slim[anthropic]` extra). `MissingLLMKeyError` message provider-aware. |
| Extractor | `extractor.py`: select `output_type` by provider (`NativeOutput` for OpenAI, `ToolOutput` for Anthropic). **Timeout at the client/model level** (OpenAI/Anthropic clients accept a `timeout`) so the in-flight request is actually aborted; `asyncio.wait_for` only as a backstop. |
| Service/endpoints | Replace the 12 `"gpt-4o-mini"` literals with the config default; thread `provider` request→service→`build_model`; `APIKeyService.get_key_for_provider` resolves the chosen provider's BYOK key. |
| Errors | New `app/llm/errors.py`: `PermanentLLMError` / `TransientLLMError`. `UsageLimitExceeded` (reask budget exhausted = bad schema/template) → permanent. Timeout/connection/5xx/rate-limit → transient. |

## 5. Reliability bug fixes (error-handling design)

| # | Bug | Fix |
| --- | --- | --- |
| 3 | Batch exception swallowing (`section_extraction_service.py` ~385–424 & ~761–811): per-section errors caught, logged, execution continues — a half-failed batch reports success. | Aggregate **per-section status** into the typed batch result. **Fail-closed threshold:** if `failed_sections == total_sections` **or** `total_suggestions_created == 0`, raise `BatchAllSectionsFailed` (→ run `FAILED`, `ApiResponse(ok=False)`); partial failures complete but surface the failed-section list — never silent. |
| 4 | No timeout on `agent.run()`. | **Client-level timeout** on the OpenAI/Anthropic model (aborts the request), `LLM_TIMEOUT_SECONDS`-configured; `asyncio.wait_for` backstop. Timeout raises `TransientLLMError` → Celery retry. |
| 5 | Celery retry: fixed 60s delay, no transient/permanent split (`extraction_tasks.py`). | Classify via `app/llm/errors.py`: `retry_backoff=True` + jitter + `retry_backoff_max` for `TransientLLMError`; **fail-fast (no retry)** for `PermanentLLMError` (`MissingLLMKeyError`, missing PDF/file, template/validation, `UsageLimitExceeded`). |
| 7 | Schema chunk dedup last-win (`schema.py` ~118): duplicate field names silently drop data. | **Fail-closed (decided):** raise `app.llm.schema.SchemaBuildError(entity_type_id, field_name)` naming the duplicate so the template is fixed — silent merge could mismap evidence. |
| 10 | No full-chain integration test. | Add it (see §6). |

**Non-fixes (disproven premises) — guarded, not patched:**

| # | Claim | Reality | Action |
| --- | --- | --- | --- |
| 6 | `.format()` injection on user `entity_name`/`article_text`/memory. | Python `str.format(**kwargs)` renders braces in *argument values* literally and never re-evaluates them. Verified. Not a bug. | Add a regression test feeding brace/format-spec-laden `entity_name` + `article_text` asserting literal pass-through, so it stays safe. No code change. |
| 8 | LLM key validated late. | Keys resolved at endpoint entry; `MissingLLMKeyError` raised before the task runs. | Add coverage asserting early failure; no code change. |
| 9 | `#bug: AI extraction values not appearing` marker. | A design-intent comment: the run is deliberately left in `extract` so AI values hydrate; current behavior is correct. | Add a regression test asserting the run stays in `extract` after AI extraction (guards the latent fragility). Keep the comment. |

## 6. Testing strategy (TDD — failing test first for every behavioral change)

- **Full-chain integration test (item 10):** blocks fixture → `assemble` →
  `build_output_models` → mocked `extract_structured` → `record_proposal` +
  `build_anchor` evidence → `citation_read_service` read. Asserts the anchor char
  range maps back to the correct block and proposal+evidence materialize. This is a
  **happy-path schema/anchor** test — it mocks the LLM and therefore **cannot**
  catch provider-output drift (see next).
- **Provider-output tests:** drive `extract_structured` with a `FunctionModel`
  returning a realistic **Anthropic tool-call-shaped** payload to prove `ToolOutput`
  parsing works; an **opt-in live Anthropic smoke** test (`@pytest.mark.llm`,
  `PRUMO_LLM_SMOKE=1`, never in CI) round-trips a real Claude call + budget assembly.
- **Endpoint-coroutine unit tests:** call the changed endpoint coroutines directly
  (not only via httpx ASGI) to cover provider-threading + the two service paths
  (blocks-assemble vs pypdf-fallback) the diff-cover gate misses (documented ASGI
  blind spot).
- **Unit:** `render_blocks_to_markdown` (deterministic GFM/headings/order);
  `assemble` (`truncated` set over budget, never silent; tiktoken-vs-heuristic
  skew); pypdf fallback routed through `assemble`; client-timeout path; retry
  classification (permanent→no-retry, transient→backoff); `SchemaBuildError` on
  duplicate field names; **batch partial-failure** (mixed surfaces the failed list;
  all-fail raises). The QA prompt path (`quality_assessment`) is covered alongside
  `section_extraction`.
- **Design-stability assertions (not "guard tests"):** #6 (`.format()` literal
  pass-through with brace-laden inputs), #8 (key validated at endpoint entry), #9
  (run stays in `extract` after AI extraction) — each documents *why the design
  choice matters and what refactor would break it*.
- **Frontend:** measure coverage with the overlay tests removed; if it drops below
  the ratchet (62/80/85), add compensating `useReaderLocate`/markdown-locate tests.
  No dangling imports; suite green.
- **Gates:** `make lint-backend`, `make test-backend`, `npm run lint`,
  `npm run test:run` — all green, output pasted as evidence before "done".

## 7. Phasing → incremental PRs to `dev`

1. **C1 + extractor stabilization** — config/provider/Claude, timeout (#4), retry
   (#5), batch status (#3), schema dedup (#7), the #6/#8/#9 guard tests.
2. **A1** — renderer + budgeted assembler + wire blocks→LLM + windowing + pypdf
   fallback + full-chain integration test (#10); note ADR-0011's block-input now
   built.
3. **B1** — frontend-only bbox-stack deletion (one commit) + ADR-0013 supersession
   (backend anchor untouched).

Each PR: conventional commit, squash-merged, all gates green, `code-review` before
"done".

## 8. Decisions resolved at spec review (2026-06-23, post adversarial review)

1. **#7 duplicate field names** — **fail-closed** `SchemaBuildError` (silent merge
   could mismap evidence). *Resolved.*
2. **A1 P2** — **ship P1** (assemble-once, budgeted full-doc window), **defer P2**
   (section-aware selection) until a reliable section→block mapping exists.
   *Resolved.*
3. **C1 default model** — **unchanged** (current OpenAI model); Claude is selectable
   per-project/request via BYOK. *Resolved.*
4. **Anthropic key** — **BYOK-only**; no global `ANTHROPIC_API_KEY` fallback in this
   effort. *Resolved.*
5. **Per-run cost** — **assemble-once + log** per-run tokens; **no hard ceiling**
   yet (YAGNI). *Resolved.*

### Adversarial review (2026-06-23): refuted claims, deliberately not acted on

- `build_anchor` never instantiates `RegionCitationAnchor` (only Text/Hybrid) — no
  emit-path change needed.
- `usePageHandle` does not import `useCitationHighlight` in active code — deletion
  is safe.
- `build_anchor` is already typed `-> PositionV1 | None` — no typing gap.
- `DocumentParser.parse()` is monolithic (all-or-raise) — no partial-blocks state
  for A1 to defend against.
- C1 and A1 do not both edit `MAX_PDF_CHARS` — no cross-phase merge conflict.

## 9. Non-goals

No enriched-markdown tier; no vision/table pass; no parser bake-off; no HITL
lifecycle change; no flip of the live default model or parser backend; no broad
provider migration beyond making Claude *selectable*.

## 10. References

- ADR-0011 (`docs/adr/0011-structured-pdf-parsing-at-ingest.md`) — blocks at
  ingest; the grounded-extraction half this spec finishes.
- ADR-0013 (`docs/adr/0013-dual-tier-markdown-representation.md`) — markdown as a
  projection of blocks; its "canvas-only" limitation is superseded by B1.
- `docs/reference/extraction-hitl-architecture.md` — run lifecycle + schema.
- `docs/reference/constitution.md` — layering, typed-everything, migration split.
- `docs/reference/migrations.md` — Alembic ownership, RLS, squashing.
- Code touchpoints: `app/llm/{prompts,provider,extractor,schema,validators}.py`,
  `app/services/{section_extraction,model_extraction,evidence_anchor,citation_read}_service.py`,
  `app/infrastructure/parsing/base.py`, `app/worker/tasks/extraction_tasks.py`,
  `frontend/hooks/extraction/{useCitationHighlight,useReaderLocate}.ts`,
  `frontend/pdf-viewer/primitives/CitationOverlay.tsx`.
