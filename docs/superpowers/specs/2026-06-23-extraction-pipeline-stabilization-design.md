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
- **Model is hardcoded.** `gpt-4o-mini` is a string literal in **7 production
  files**; `OPENAI_DEFAULT_MODEL` exists in config but is **never read at
  runtime**. `build_model(model_name, *, api_key)` is **OpenAI-only** — it ignores
  any provider and always builds `OpenAIChatModel`. However, BYOK key storage for
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
  feed the LLM the block-markdown of the whole article, bounded by a token
  budget, **surfacing overflow** (structured log + a typed "truncated N/M blocks"
  signal on the result) instead of a silent mid-context chop. Fallback to today's
  pypdf path when an article has **no blocks yet** (the two-tier state ADR-0011
  promised but never wired).
- **P2 (enhancement, may defer):** section-aware block *selection* — feed only
  the blocks relevant to the entity-type being extracted. This depends on a
  reliable section→block mapping we do not yet have; if reliable detection is not
  cheap, P2 is deferred and P1's budgeted full-doc window stands. **No silent
  truncation in either stage.**

**Out of scope:** vision-to-model / table-vision pass (deferred per ADR-0011);
the enriched markdown tier (`markdown_enriched` column stays unbuilt).

### B1 — Text-first citations; delete the orphaned bbox stack

Markdown-locate is the **sole** citation-highlight surface. The orphaned
`useCitationHighlight`, `CitationOverlay`, the canvas overlay rendering, and their
tests are **deleted** (closes the existing follow-up `task_987a3c69`). The backend
keeps producing the **text/char-range** anchor; it stops *producing* bbox rects,
but `parse_position`/`citation_read_service` stay **backward-compatible** with any
hybrid-shaped positions already stored in prod (`extraction_evidence.position` is
JSONB — no data migration, no read break). ADR-0013's "Highlight limitation"
section is superseded.

Figure/table coverage under text-first: tables render as GFM (cell text is
searchable), figure captions are `figure_caption` text blocks (searchable); only
a bare image region cited with no quotable text degrades to a nearest-block flash
— rare in clinical field extraction.

### C1 — One configurable model/provider; Claude selectable; keep pydantic-ai

Keep `pydantic-ai` (NativeOutput structured output works; the whole prompt/
extractor/validator layer is built on it; switching is a large rewrite for no
concrete gain). Collapse the 7 `gpt-4o-mini` literals into **one authoritative
configurable setting** actually read at runtime. `build_model` gains a
**provider branch** (OpenAI now, Anthropic added) via the existing pydantic-ai
extras; `APIKeyService` resolves the provider's BYOK/global key. **The live
default model is unchanged in this effort** — flipping to Claude becomes a config/
deploy decision, not a code change. Parser default is **verify-and-locked**, not
churned (the crash + ignored-key bugs were already fixed by #359).

## 3. Migrations

**None.** Verified:

- A1 — `render_blocks_to_markdown` is a pure on-demand projection (ADR-0013, no
  column); the assembler reads the existing `article_text_blocks` (table 0006).
- B1 — `extraction_evidence.position` is JSONB; the anchor-contract change is
  Pydantic-schema/code only.
- C1 — `user_api_keys.provider` already permits `anthropic` (CHECK constraint
  since baseline/0027); `SUPPORTED_PROVIDERS` already lists it. No new column,
  enum, or constraint.

(Consequently the `test_migration_roundtrip` head-pin / `downgrade -1` gotcha
does not apply to this effort.)

## 4. Architecture & components (layering-compliant)

### A1

| Layer | Change |
| --- | --- |
| Infrastructure | `app/infrastructure/parsing/base.py`: add pure `render_blocks_to_markdown(blocks) -> str` beside `concat_page_text`. Deterministic GFM tables, `#` headings, lists, reading order. |
| Service helper | New token-budgeted assembler (pure function or small helper class) that takes ordered blocks + a token budget + the active model and returns `(markdown, AssemblyInfo)` where `AssemblyInfo` carries `total_blocks`, `included_blocks`, `truncated: bool`, `est_tokens`. Token estimate via `tiktoken` for OpenAI models, char/4 heuristic fallback. |
| Service | `section_extraction_service` / `model_extraction_service`: read persisted blocks (`ArticleTextBlockRepository.list_ordered_for_file`), assemble budgeted markdown, pass to `_extract_with_llm`. **Fallback to pypdf** when no blocks exist. Surface `AssemblyInfo.truncated` in structured logs + the run/section result. |
| Prompts | `prompts/__init__.py`: delete `MAX_PDF_CHARS`; the three `render(...)` functions receive pre-assembled, budgeted text. |

### B1

| Layer | Change |
| --- | --- |
| Frontend (delete) | `frontend/hooks/extraction/useCitationHighlight.ts` (+ tests), `frontend/pdf-viewer/primitives/CitationOverlay.tsx` (+ tests/a11y), the `Viewer.tsx` overlay render, dead copy keys. Confirm no other live importer first (`usePageHandle` reference is the audit boundary). |
| Frontend (keep) | `useReaderLocate` markdown-locate stays the only surface. |
| Backend | `evidence_anchor_service.build_anchor`: produce text/char-range anchor; stop emitting rects. `schemas/extraction.py` + `citation_read_service.parse_position`: keep tolerant parsing of historical hybrid/region shapes (no break), but the **emitted** contract is text-first. |
| Docs | Supersede ADR-0013 §"Highlight limitation"; cross-reference from ADR-0011. |

### C1

| Layer | Change |
| --- | --- |
| Config | `app/core/config.py`: one authoritative `LLM_PROVIDER` + `LLM_DEFAULT_MODEL` (read at runtime); `ANTHROPIC_*`; `LLM_TIMEOUT_SECONDS`. Defaults preserve current OpenAI behavior. |
| Provider | `provider.py::build_model(provider, model_name, *, api_key)`: OpenAI branch (current) + Anthropic branch (`pydantic-ai-slim[anthropic]` extra). `MissingLLMKeyError` message becomes provider-aware. |
| Service/endpoints | Replace the 7 `"gpt-4o-mini"` literals with the config default; thread `provider` from request/project through to `build_model`; `APIKeyService` resolves the chosen provider's key. |
| Extractor | `extractor.py`: `asyncio.wait_for(agent.run(...), timeout=settings.LLM_TIMEOUT_SECONDS)`. |

## 5. Reliability bug fixes (error-handling design)

| # | Bug | Fix |
| --- | --- | --- |
| 3 | Batch exception swallowing (`section_extraction_service.py` ~385–424 & ~761–811): per-section errors caught, logged, execution continues — a half-failed batch reports success. | Aggregate **per-section status** into the typed batch result. Policy: a batch where **every** section failed (or zero output produced) **fails the run** (`status=failed`); partial failures complete but surface the failed-section list — never silent. |
| 4 | No timeout on `agent.run()`. | `asyncio.wait_for` with configurable `LLM_TIMEOUT_SECONDS`; timeout → typed transient error → task retry path. |
| 5 | Celery retry: fixed 60s delay, no transient/permanent split (`extraction_tasks.py`). | `retry_backoff=True` + jitter + `retry_backoff_max`; **fail-fast (no retry)** on permanent errors (`MissingLLMKeyError`, missing PDF/file, template/validation); retry only transient (timeout, rate-limit, 5xx). |
| 7 | Schema chunk dedup last-win (`schema.py` ~118): duplicate field names silently drop data. | **Fail-closed**: raise a typed `SchemaBuildError` naming the duplicate `(entity_type, field_name)` so the template is fixed. *(Open: disambiguate-and-warn alternative — see §8.)* |
| 10 | No full-chain integration test. | Add it (see §6). |

**Non-fixes (disproven premises) — guarded, not patched:**

| # | Claim | Reality | Action |
| --- | --- | --- | --- |
| 6 | `.format()` injection on user `entity_name`/`article_text`/memory. | Python `str.format(**kwargs)` renders braces in *argument values* literally and never re-evaluates them. Verified. Not a bug. | Add a regression test feeding brace/format-spec-laden `entity_name` + `article_text` asserting literal pass-through, so it stays safe. No code change. |
| 8 | LLM key validated late. | Keys resolved at endpoint entry; `MissingLLMKeyError` raised before the task runs. | Add coverage asserting early failure; no code change. |
| 9 | `#bug: AI extraction values not appearing` marker. | A design-intent comment: the run is deliberately left in `extract` so AI values hydrate; current behavior is correct. | Add a regression test asserting the run stays in `extract` after AI extraction (guards the latent fragility). Keep the comment. |

## 6. Testing strategy (TDD — failing test first for every behavioral change)

- **Full-chain integration test (item 10):** blocks fixture → assembler →
  `build_output_models` → mocked `extract_structured` → `record_proposal` +
  `build_anchor` evidence → `citation_read_service` read. Asserts the anchor char
  range maps back to the correct block and the proposal+evidence materialize.
- **Endpoint-coroutine unit tests:** call the extraction endpoint coroutines
  directly (not only via httpx ASGI) to cover handler lines the diff-cover gate
  misses (the documented ASGI blind spot).
- **Unit:** `render_blocks_to_markdown` (deterministic GFM/headings/order); the
  budgeted assembler (`truncated` flag set when over budget, never silent); the
  pypdf fallback when no blocks; timeout path; retry classification
  (permanent→no-retry, transient→backoff); schema duplicate-name handling; the
  three non-fix guard tests (#6/#8/#9).
- **Frontend:** deletion leaves the suite green; markdown-locate tests remain the
  citation coverage; no dangling imports.
- **Gates:** `make lint-backend`, `make test-backend`, `npm run lint`,
  `npm run test:run` — all green, output pasted as evidence before "done".

## 7. Phasing → incremental PRs to `dev`

1. **C1 + extractor stabilization** — config/provider/Claude, timeout (#4), retry
   (#5), batch status (#3), schema dedup (#7), the #6/#8/#9 guard tests.
2. **A1** — renderer + budgeted assembler + wire blocks→LLM + windowing + pypdf
   fallback + full-chain integration test (#10); note ADR-0011's block-input now
   built.
3. **B1** — frontend bbox-stack deletion + backend anchor simplification + ADR-0013
   supersession.

Each PR: conventional commit, squash-merged, all gates green, `code-review` before
"done".

## 8. Open decisions to confirm at spec review

1. **#7 policy** — fail-closed `SchemaBuildError` (recommended; silent merge can
   mismap evidence) **vs.** disambiguate duplicate names with a suffix + warning
   (preserves data, changes the field-name contract). Default in this spec:
   **fail-closed**.
2. **A1 P2** — build section-aware block *selection* now, or ship P1
   (budgeted full-doc window) and defer P2 until a reliable section→block mapping
   exists? Default: **ship P1, defer P2**.
3. **C1 default** — confirm the live default model stays the current OpenAI model
   in this effort (no behavior/cost flip). Default: **unchanged**.

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
