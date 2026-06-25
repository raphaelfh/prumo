---
status: draft
last_reviewed: 2026-06-24
owner: '@raphaelfh'
---

# Stored-markdown ingestion + deterministic citation highlight — design

> **Status:** Draft · Date: 2026-06-24 · Deciders: @raphaelfh
> **Relation to existing design:** Refines ADR-0011 (structured parsing at
> ingest) and ADR-0013 (dual-tier markdown). It (1) makes the block-projection
> markdown a **stored** artifact (`article_files.content_markdown`) instead of
> an on-demand derivation, (2) makes `pymupdf` the free default parser and the
> only synchronous on-demand parser, (3) feeds that stored markdown **directly**
> into the AI extraction prompt, (4) makes the reader highlight deterministic via
> a persisted `block_id` anchor, and (5) removes the related legacy (pypdf
> fallback, dead columns, orphaned citation service). It introduces **no** new
> HITL/run-lifecycle concepts.

## 1. Context and problem

The extraction pipeline already parses each PDF once at ingest and persists
`article_text_blocks` (per-block text + `char_start`/`char_end` + `bbox` +
`block_index`). But three seams cost compute, break grounding, or leave legacy:

1. **The "not parsed" path re-extracts every call, throwaway.** When an article
   has no blocks, `build_prompt_input`
   (`backend/app/services/extraction_prompt_input.py:46`) runs `pypdf`
   (`PDFProcessor.extract_text`) and wraps the raw text into synthetic blocks via
   `blocks_from_plain_text` (`backend/app/llm/assembler.py:366`) with
   `char_start=0`, `bbox={}`. These blocks are **not persisted**, have **no real
   offsets**, and are rebuilt on **every** extraction request — so the cheap
   parser runs over and over and citations/highlights cannot anchor.

2. **Markdown is never stored.** The block-projection markdown is re-derived from
   blocks on demand (`render_blocks_to_markdown`) for both the reader (per-block)
   and the prompt assembler (`assemble_for_model`). The `content_markdown` /
   `markdown_tier` columns ADR-0013 envisioned were never built. The LLM input
   and the reader view therefore share only the table-serialization codepath, not
   a single stored string.

3. **Highlight is a best-effort text match.** The reader locates evidence by
   normalizing the LLM quote and doing a substring match against block text
   (`frontend/pdf-viewer/primitives/readerLocate.ts::findBlockForQuote`), then
   scroll + 1800 ms flash. The `AnchorMatch` already computes the exact
   `block_ids` server-side (`backend/app/services/evidence_anchor_service.py`),
   but they are discarded — so highlight can mis-target or miss on ambiguous or
   multi-block quotes.

Confirmed legacy in this cluster: dead `article_files.text_raw` / `text_html`
columns (`backend/app/models/article.py:218-219`); orphaned
`backend/app/services/citation_read_service.py` (no endpoint); unused frontend
`projectPdfRectToCss` and `HighlightAnnotation`; a stale "proposal"-stage
comment flagged near `frontend/pages/ExtractionFullScreen.tsx:969`.

## 2. Goals / non-goals

**Goals**

- Parse each PDF **once**, store the result, and reuse it for both AI ingestion
  and the reader — never re-parse and never re-call a parser API on subsequent
  extractions.
- Feed the **stored** markdown directly into the AI extraction prompt.
- Run a **simple `pymupdf` parse only when the PDF has never been parsed**, and
  **persist** its output on a successful run so it is never re-run. (A failed
  run rolls back the parse; the next attempt re-parses — cheap and
  deterministic.)
- Keep citation/evidence anchoring consistent and make the markdown-viewer
  highlight **deterministic** (right location, already highlighted).
- Leave **no related legacy** behind (code, columns, docs).

**Non-goals (explicitly out of scope; separate efforts)**

- Moving synchronous inline AI extraction onto Celery (the 120 s timeout class).
- The HITL-config-inert quorum question, the PHI fail-closed gate, or any
  run-lifecycle/consensus change.
- The ADR-0013 *enriched* (vision-table) markdown tier — remains future work.

## 3. Decisions (locked)

| # | Decision | Source |
| - | -------- | ------ |
| D1 | Scope = markdown-ingestion + citation/highlight + related legacy removal only. | user |
| D2 | `pymupdf` (`pymupdf4llm`) becomes the **free default** parser; `auto` → LlamaParse if a `llama_cloud` key resolves, else `pymupdf`. **Docling becomes explicit opt-in.** | user-confirmed |
| D3 | Parse output is **stored once**: blocks (substrate) **plus** a new `article_files.content_markdown` string + `content_version`, written **atomically** with the blocks. | user (store markdown in the table) |
| D4 | When a PDF is unparsed at extraction time, run `pymupdf` **inline, once**, via the shared parsing service, **persist**, and continue. | user |
| D5 | Highlight is deterministic: the evidence anchor **persists the matched `block_id`(s)**; the reader locates by `block_id` first, falling back to the existing quote match. | user |
| D6 | AI ingestion reads the **stored `content_markdown`** directly when it fits the token budget; over-budget papers still use `assemble_for_model(blocks)` for IMRaD section-dropping. | derived from D3 |

## 4. Architecture

### 4.1 Data model (Alembic, additive)

- Add `article_files.content_markdown TEXT NULL` and
  `article_files.content_version INTEGER NOT NULL DEFAULT 0`.
- **Drop** dead `article_files.text_raw` and `text_html` (same or a co-sequenced
  additive migration; not repurposed). Remove them from
  `backend/app/models/article.py`.
- `content_markdown` is a pure projection of the file's blocks; it is written in
  the **same transaction** as the blocks (see 4.3) and `content_version` bumps on
  every blocks rewrite, so it can never drift from the blocks.
- Revision id ≤ 32 chars. Bump the migration-head line + `last_reviewed` in
  `docs/reference/extraction-hitl-architecture.md`. Update
  `backend/tests/.../test_migration_roundtrip` head-pin + the explicit
  `downgrade -1` parent guard.

### 4.2 Parser layer (`pymupdf` default + opt-in Docling)

- New `backend/app/infrastructure/parsing/pymupdf_parser.py` implementing the
  existing `DocumentParser` protocol via `pymupdf4llm` (page-chunked
  `to_markdown`), emitting `ParsedBlock`s with real `page_number`, `block_index`,
  `block_type` (heading/paragraph/table_cell/...), and `bbox` where pymupdf
  exposes it. `char_start`/`char_end` remain placeholders until
  `assign_char_offsets_to_blocks` runs (unchanged contract).
- Register it in `create_document_parser` (`backend/app/core/factories.py`).
  Backend resolution in `parse_article_file_task`
  (`backend/app/worker/tasks/parsing_tasks.py:47-60`): `auto` → LlamaParse if a
  `llama_cloud` key resolves, else **`pymupdf`**. `docling` stays selectable
  explicitly. Default `PARSER_BACKEND` scalar → `pymupdf`
  (`backend/app/core/config.py:115`).
- Dependency: add `pymupdf4llm` to `backend/pyproject.toml`; it must be installed
  in **both** the web and worker images (on-demand parse runs in the web
  request). No system libs required (self-contained wheels) — unlike Docling.

### 4.3 Persist-once (atomic blocks + markdown)

- Extend the block-write path (`replace_for_file` in
  `backend/app/repositories/article_text_block_repository.py` + its caller
  `DocumentParsingService.parse_article_file`) so that, inside the existing
  `pg_advisory_xact_lock` + delete-then-bulk-insert, it also computes
  `render_blocks_to_markdown(blocks)` and writes it to
  `article_files.content_markdown`, bumping `content_version`. One transaction,
  one source of truth.

### 4.4 On-demand simple parse (inline, once)

- `build_prompt_input` (`backend/app/services/extraction_prompt_input.py`): when
  an article's main file has no blocks, call a shared
  `ensure_article_parsed(...)` that invokes `DocumentParsingService` **forcing the
  `pymupdf` backend** (never LlamaParse/Docling synchronously in a web request),
  persists blocks + `content_markdown` (4.3), and returns the fresh blocks.
- Delete the `pypdf` fallback entirely: remove `blocks_from_plain_text`
  (`assembler.py`), `backend/app/services/pdf_processor.py`, and the `pypdf`
  dependency. There is no unbounded-text path left.

### 4.5 AI ingestion reads stored markdown

- `build_prompt_input` returns the stored `content_markdown` directly when
  `estimate_tokens(content_markdown) <= LLM_ASSEMBLY_BUDGET_TOKENS`. Otherwise it
  falls back to `assemble_for_model(blocks, ...)` for deterministic IMRaD
  section-dropping (whole sections only). Both derive from the same blocks → the
  prompt and the reader stay consistent. The `extraction.assembly` log keeps
  reporting `total_blocks`/`included_blocks`/`truncated`/`est_tokens`, plus a new
  `source = stored_markdown | budgeted_blocks` field.
- `anchor_blocks` returned for evidence anchoring continue to be the persisted
  blocks (no second fetch).

### 4.6 Citation write — persist `block_id`

- `evidence_anchor_service.build_anchor` already produces `AnchorMatch.block_ids`
  (indices). Resolve those to persisted `article_text_blocks.id`s and store them
  on **`PositionV1`** (the anchor wire format already serialized into
  `ExtractionEvidence.position`, so no extra column): add
  `block_ids: list[int]` to every anchor variant. The fuzzy quote match (0.85)
  and `bbox` stay as-is for the canvas path; `block_ids` is the new deterministic
  key for the reader.
- Because blocks now always exist (parsed or pymupdf-on-demand), anchoring always
  has a real substrate — the empty-fallback no-anchor case disappears.

### 4.7 Reader — deterministic highlight by `block_id`

- Surface `blockIds` on the evidence delivered to the client (the suggestions
  payload already carries `evidence.text_content` / `page_number`; add
  `evidence.blockIds`).
- `frontend/pdf-viewer/primitives/readerLocate.ts`: add `findBlockById(blocks,
  blockIds)` tried **first**; fall back to the existing `findBlockForQuote`. The
  scroll + 1800 ms flash mechanism (`Reader.tsx`) is unchanged — it already keys
  off `data-block-id`.
- ADR-0013's "canvas-only highlight" caveat is superseded for the markdown path:
  highlight is now block-id-anchored and deterministic.

### 4.8 Legacy removal

- Backend: delete `pdf_processor.py`, `blocks_from_plain_text`, `pypdf` dep;
  delete `citation_read_service.py` (orphaned — evidence ships via the
  suggestions endpoint); drop `text_raw`/`text_html`.
- Frontend: remove `projectPdfRectToCss` and `HighlightAnnotation` if confirmed
  unused; remove the stale "proposal"-stage comment near
  `ExtractionFullScreen.tsx:969` (verify exact line at execution time).
- Docs: ADR-0013 `proposed → accepted` (stored `content_markdown` supersedes
  derive-on-demand; `pymupdf` free default; deterministic block-id highlight);
  ADR-0011 (parser default `pymupdf`, Docling opt-in); update
  `docs/reference/extraction-hitl-architecture.md` §4.2 (input = stored markdown,
  pymupdf on-demand, no pypdf), `docs/reference/observability-extraction.md`
  (new `source` field), and `docs/ROADMAP.md`.

## 5. End-to-end data flow (target)

```text
INGEST (async, once):
  upload → ArticleFile(pending) → parse_article_file_task
    → backend = auto→(LlamaParse if key else pymupdf) | docling(opt-in)
    → blocks + content_markdown persisted atomically (content_version++) → parsed

EXTRACT (sync web request):
  build_prompt_input
    → blocks present?  yes → use stored content_markdown (or budgeted blocks if over budget)
                        no → pymupdf inline once → persist blocks+content_markdown → use it
    → LLM extract → proposals(ai) + ExtractionEvidence(block_ids, bbox, quote)

VIEW:
  reader fetches blocks → renders per-block (data-block-id)
  click citation → findBlockById(blockIds) → scroll + flash   (fallback: quote match)
```

## 6. Error handling / edge cases

- **pymupdf yields zero blocks** (image-only/scanned PDF): raise the same
  `ValueError("... produced no text blocks")` the other parsers raise → the file
  is marked `parse_failed`; the inline on-demand path surfaces a typed
  `ApiResponse` error (`error.message`), not a silent empty extraction. No
  pypdf-style degraded fallback remains.
- **Concurrent inline parse vs. async ingest parse** of the same file: both go
  through `pg_advisory_xact_lock(hashtextextended(article_file_id))` +
  delete-then-insert, so they serialize; `content_version` makes the last write
  authoritative.
- **Over-budget paper**: section-dropping via `assemble_for_model` (unchanged);
  `truncated=true` logged.
- **Anchor finds no block** (quote not present after 0.85 fuzz): store empty
  `block_ids`; reader falls back to quote match then page-header scroll (current
  behavior) — no regression.
- **content_markdown stale after a manual reparse**: reparse rewrites blocks →
  same transaction rewrites `content_markdown` + bumps `content_version`, so it
  cannot lag.

## 7. Testing strategy (goal-driven, integration-first)

- **Backend (pytest, real local Supabase):**
  - `PymupdfParser` unit: blocks, ordering, block_type, bbox presence.
  - `replace_for_file` writes `content_markdown` + bumps `content_version`
    atomically (deferred-trigger / real session).
  - On-demand inline parse: unparsed article → first **successful** extraction
    persists blocks + markdown; second extraction performs **no** parse (assert
    parser not called). A failed run rolls back the parse; the next attempt
    re-parses — cheap and deterministic.
  - `build_prompt_input` returns stored markdown under budget; budgeted blocks
    over budget; emits `source`.
  - Evidence write persists `block_ids`.
  - Migration roundtrip (head-pin + downgrade) green.
  - Diff-cover ≥ 80%: add endpoint-coroutine unit tests (avoid the ASGI
    coverage blind spot) for any touched endpoint.
- **Frontend (vitest + MSW):**
  - `findBlockById` precedence + quote fallback; locate→scroll→flash.
  - Markdown render unchanged; XSS sanitization test still passes (planted
    `<script>`/`onerror`/`javascript:` does not execute).
  - MSW handler for the markdown/evidence payload shape with `blockIds`.
- **E2E (Playwright):** upload an unparsed PDF → Run AI → suggestion appears →
  click its citation → reader scrolls to and highlights the correct block.

## 8. Migration & rollout

- Alembic only; revision id ≤ 32 chars; additive (add `content_markdown`,
  `content_version`; drop `text_raw`/`text_html`). Bump the migration-head line +
  `last_reviewed` in `docs/reference/extraction-hitl-architecture.md`.
- `pymupdf4llm` added to web + worker images.
- Backfill is **not** required: `content_markdown` is lazily populated on the next
  parse/reparse or on the first on-demand extraction; existing parsed articles
  keep working off blocks until then (the assembler path covers `content_markdown
  IS NULL`).
- PR → `dev` (squash, auto-merge after the 8 checks). Promotion `dev → main` via
  a merge-commit PR (Railway deploys from `main`).
- Post-deploy: `preflight` skill + manual verify on the test account
  (`teste@prumo.local`): upload → parse → Run AI → citation highlight.

## 9. References

- ADR-0011 `docs/adr/0011-structured-pdf-parsing-at-ingest.md`
- ADR-0013 `docs/adr/0013-dual-tier-markdown-representation.md`
- `docs/reference/extraction-hitl-architecture.md` §4.2
- Code touch-points: `backend/app/services/extraction_prompt_input.py`,
  `backend/app/llm/assembler.py`, `backend/app/infrastructure/parsing/`,
  `backend/app/services/document_parsing_service.py`,
  `backend/app/repositories/article_text_block_repository.py`,
  `backend/app/services/evidence_anchor_service.py`,
  `backend/app/models/article.py`,
  `frontend/pdf-viewer/primitives/readerLocate.ts`,
  `frontend/hooks/extraction/useReaderLocate.ts`.
