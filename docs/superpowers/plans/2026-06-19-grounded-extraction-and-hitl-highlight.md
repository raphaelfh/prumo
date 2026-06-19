---
status: planned
last_reviewed: 2026-06-19
owner: '@raphaelfh'
---

# Grounded extraction and HITL evidence highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Decision record: ADR 0011. **Depends on** `docs/superpowers/plans/2026-06-19-structured-pdf-parsing-at-ingest.md` — that plan must already populate `article_text_blocks`; this plan consumes them.

**Goal:** Turn the persisted, bbox-bearing blocks into accurate, *traceable*
extraction: feed section-aware structured text to the model (retiring the 15k
prefix-truncation), anchor every extracted value to a verifiable source span
(`PositionV1` = char range and/or bbox) with verbatim verification, backfill
existing articles, drop the now-dead schema, and wire the reviewer's
click-to-highlight UI against the citation types the viewer already models.

**Architecture:** The hard parts already exist on both ends — populated
`article_text_blocks` (from the ingest plan) and the read path
(`citation_read_service.py` → `PositionV1` → `pdf-viewer/core/citation.ts`,
`Reader.tsx`). This plan fills the middle: a pure **block assembler** that feeds
extraction, the **position writer** (`EvidenceAnchorService`) that replaces
today's `position={}`, a **verification flag** that kills silent hallucinated
citations, an idempotent **backfill**, a **cleanup** migration, and the
**frontend binding** from an evidence click to a pdf.js highlight. A
`READ_FROM_BLOCKS` flag lets extraction fall back to today's lazy `pypdf` path
per-article until blocks exist, so rollout is non-breaking.

**Tech Stack:** Python 3.11 + FastAPI + SQLAlchemy 2.0 async + Alembic; Celery +
Redis (`worker_session()`); pydantic-ai; pytest integration vs local Supabase
(`db_session_real`, project-scoped fixtures); React 19 + pdf.js + TanStack Query
and Zustand; vitest + MSW v2 + Playwright (E2E + axe) for the UI; the
`design-review` loop for the highlight UX. Suggested branch:
`feat/grounded-extraction`.

**Constraints (constitution + `.claude/rules/`):** four-layer flow; repositories
`flush()` never `commit()`; Celery DB work via `worker_session()` + `run_task()`;
Alembic owns the public schema (revision id ≤ 32 chars); RLS via
`is_project_member()`; every project-scoped endpoint calls
`ensure_project_member()` (BOLA); **no `try/finally`/`throw` in React-compiled
code — use `.then/.catch`** (compiler panics at `all_errors`); integration tests
scope queries by `project_id`; `ExtractionEvidence.position` is the canonical
`PositionV1` JSONB and must round-trip through `parse_position` + camelCase.

---

## Phases

- **Phase 1 — Extraction consumes blocks** (section-aware assembler; retire the
  15k truncation at all three prompt sites; flag + lazy fallback).
- **Phase 2 — Evidence anchoring + verbatim verification** (write `PositionV1`;
  flag non-verbatim citations; observability).
- **Phase 3 — Backfill + dead-schema cleanup** (idempotent backfill; drop dead
  columns / `pdf-lib` / unused `PDFProcessor` methods).
- **Phase 4 — Reviewer highlight UI** (click evidence → highlight on the page;
  reader/canvas sync; a11y; design-review) + a manual-evidence stretch.
- **Finalize** — flip ADR 0011 to `accepted`; update the architecture reference.

## File map

| File | Responsibility | Change |
| --- | --- | --- |
| `backend/app/services/extraction/block_assembler.py` | prompt source | New: pure blocks → section-aware structured text (token-budgeted, deterministic) |
| `backend/app/services/section_extraction_service.py` | extraction | Source text from blocks via the assembler; call the anchor service; `READ_FROM_BLOCKS` + lazy fallback |
| `backend/app/services/model_extraction_service.py` | model id | Same block-sourced assembly (the second 15k site) |
| `backend/app/llm/prompts/__init__.py` (+ `section_extraction`, `quality_assessment`, `model_identification`) | prompts | Remove `MAX_PDF_CHARS` prefix-cut; accept assembled text; keep `content_version` |
| `backend/app/services/evidence_anchor_service.py` | grounding | New: quote→block match → `PositionV1`; multi-block + region anchors |
| `backend/app/llm/validators.py` | validation | Set `verified` on evidence from the anchor result (flag, never drop/raise) |
| `backend/app/services/citation_read_service.py` | read model | Surface `verified` + anchor kind in the citation wire shape |
| `backend/app/core/config.py` | settings | `READ_FROM_BLOCKS` flag + assembler token budget |
| `backend/app/worker/tasks/parsing_tasks.py` (+ a backfill entry) | backfill | Enqueue parsing for articles lacking blocks (idempotent, batched) |
| `scripts/backfill_text_blocks.py` | ops | New: resumable, dry-run, project-ordered backfill driver |
| `backend/alembic/versions/NNNN_drop_dead_article_text.py` | schema | New: drop `text_raw`, `text_html`, `pdf_extracted_text`, `semantic_*` |
| `backend/app/services/pdf_processor.py` | cleanup | Remove now-unused `extract_text_chunked` / `detect_sections` (keep `extract_text` for fallback) |
| `package.json` | deps | Remove unused `pdf-lib` |
| `frontend/hooks/extraction/useCitationHighlight.ts` | UI | New: map `PositionV1` → pdf.js scroll + text-range / region highlight |
| `frontend/components/extraction/ai/AISuggestionEvidence.tsx` | UI | Click evidence → highlight; "couldn't locate" affordance for unverified/un-anchored |
| `frontend/pdf-viewer/PrumoPdfViewer.tsx` + `primitives/Reader.tsx` | UI | Accept an active highlight; sync canvas ↔ reader modes |
| `docs/reference/extraction-hitl-architecture.md` | docs | Document consume/anchor/verify flow; bump `last_reviewed` |
| `docs/adr/0011-structured-pdf-parsing-at-ingest.md` | docs | Flip `status: accepted` when the full pipeline ships |

---

## Phase 1 — Extraction consumes blocks

### Task 1.1: Pure section-aware block assembler

**Files:** `backend/app/services/extraction/block_assembler.py`

- [ ] **Step 1: Write the failing unit test.** Given ordered `ArticleTextBlock`s
  (paragraphs, headings, `table_cell`s, captions across pages), `assemble(blocks,
  budget)` returns structured text that: preserves reading order; emits section
  markers from `heading` blocks (IMRaD-aware); renders contiguous `table_cell`s
  as a reconstructed table (markdown/HTML) rather than interleaved runs; and,
  when over `budget`, selects whole sections by relevance to the requested
  entity/section (never a mid-sentence/mid-table prefix cut) and records what was
  dropped. Assert no content past a naive 15k cut is silently lost for an
  in-budget doc.
- [ ] **Step 2: Run → fails.** `cd backend && uv run pytest tests/unit/test_block_assembler.py -v`.
- [ ] **Step 3: Implement** the assembler as a pure function/class (no DB, no IO):
  group by page → order by `block_index` → fold headings into section spans →
  coalesce table cells → serialize. Token budget from config; deterministic
  section selection when over budget (no RAG/embeddings — explicit section
  ranking). Return `(text, dropped_sections)`.
- [ ] **Step 4: Run → passes.** Commit `feat(extraction): section-aware block assembler`.

### Task 1.2: Source the three prompt sites from blocks

**Files:** `section_extraction_service.py`, `model_extraction_service.py`,
`llm/prompts/__init__.py` (+ the three templates)

- [ ] **Step 1: Failing integration test** (`db_session_real`): with blocks
  present, `extract_section` builds its prompt from the assembler (assert the
  prompt contains a known post-15k table value); `MAX_PDF_CHARS` is no longer
  applied. Repeat for the model-identification path (the second site) and assert
  the quality-assessment template no longer prefix-cuts (third site).
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement.** Replace the three `article_text[:MAX_PDF_CHARS]`
  injections with assembler output threaded through the templates; delete the
  constant once unreferenced; keep `content_version` hashing (the template text
  changes, so the version bumps — expected). Block-fetch via the
  `ArticleTextBlock` repository, scoped by `article_file_id`.
- [ ] **Step 4: Run → passes.** Commit `feat(extraction): assemble prompts from blocks, drop 15k truncation`.

### Task 1.3: READ_FROM_BLOCKS flag + lazy fallback + telemetry

**Files:** `section_extraction_service.py`, `model_extraction_service.py`, `config.py`

- [ ] **Step 1: Failing test.** With `READ_FROM_BLOCKS=true` and **no** blocks for
  the article, extraction falls back to today's `PDFProcessor.extract_text()` and
  still runs; with blocks, it uses them. A structlog field records which path ran.
- [ ] **Step 2–3: Implement** the flag + fallback branch; log
  `extraction.text_source = blocks|pdf_fallback` and block/char counts on the
  span (Logfire) so the rollout and the two-tier window are observable.
- [ ] **Step 4: Run → passes.** Commit `feat(extraction): gate block-sourcing with lazy pypdf fallback`.

---

## Phase 2 — Evidence anchoring + verbatim verification

### Task 2.1: Quote→block matcher (the core algorithm)

**Files:** `backend/app/services/evidence_anchor_service.py`

- [ ] **Step 1: Failing unit test** over fixtures: an exact quote anchors to the
  right block + char range; a quote differing only by ligatures (`ﬁ`), smart
  quotes, or collapsed whitespace still matches under **Unicode NFKC + whitespace
  folding**; a quote spanning two adjacent blocks anchors to the merged range; a
  genuinely absent quote returns `None`; ties resolve deterministically (earliest
  page/block, then longest contiguous overlap).
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** `match(quote, blocks) -> AnchorMatch | None`:
  normalize both sides, slide over each page's assembled text, allow a bounded
  token-level fuzz (configurable threshold) for OCR noise, and map the matched
  span back to `(page, char_start, char_end, block_ids, bbox_union)`. Pure and
  fully unit-tested — no DB.
- [ ] **Step 4: Run → passes.** Commit `feat(extraction): quote-to-block anchor matcher`.

### Task 2.2: Write PositionV1 (text / region / hybrid)

**Files:** `evidence_anchor_service.py`, `section_extraction_service.py`

- [ ] **Step 1: Failing integration test:** anchoring a prose quote writes a
  `TextCitationAnchor` (char range) into `ExtractionEvidence.position`; a quote
  whose block is a `table_cell`/`figure_caption` writes a `RegionCitationAnchor`
  (page + `rect`) or `HybridCitationAnchor` (range + rect + quote);
  `text_content`/`page_number` stay denormalized in sync; `parse_position`
  validates the row and `citation_read_service` emits it camelCase.
- [ ] **Step 2–3: Implement** an `anchor(evidence, blocks)` that picks the anchor
  variant by `block_type`, builds the `PositionV1`, and persists it where
  proposals + evidence are recorded today (the `position={}` site). Idempotent on
  re-run.
- [ ] **Step 4: Run → passes.** Commit `feat(extraction): persist PositionV1 anchors for evidence`.

### Task 2.3: Verbatim verification — flag, never drop

**Files:** `backend/app/llm/validators.py`, `citation_read_service.py`

- [ ] **Step 1: Failing test:** a planted hallucinated quote (absent from all
  blocks) yields `verified=false` + a reason on the evidence — the run still
  completes, the proposal is **not** discarded, and nothing raises; a real quote
  yields `verified=true`. The read model exposes `verified` + `anchorKind`.
- [ ] **Step 2–3: Implement.** Add `evidence_is_grounded(evidence, match)` (or
  extend `evidence_is_plausible`) to set the flag from the matcher result; never
  `raise` in the extraction path (constitution: no `try/finally` in compiled code
  applies FE-side, but keep services exception-light too). Surface `verified` in
  the citation wire shape.
- [ ] **Step 4: Run → passes.** Commit `feat(extraction): verbatim-verify citations (flag, not drop)`.

### Task 2.4: Observability

**Files:** `section_extraction_service.py` (span fields)

- [ ] **Step 1:** Emit per-run counters (Logfire/structlog): citations total,
  anchored, region vs text, and **unverified** — so the hallucination rate is a
  watchable metric and a regression alarm. Add a test asserting the fields are
  logged. Commit `chore(extraction): citation grounding telemetry`.

---

## Phase 3 — Backfill + dead-schema cleanup

### Task 3.1: Idempotent, resumable backfill

**Files:** `scripts/backfill_text_blocks.py`, `backend/app/worker/tasks/parsing_tasks.py`

- [ ] **Step 1: Failing test:** the driver enqueues `parse_article_file_task`
  only for `ArticleFile`s without blocks (idempotent — re-running is a no-op),
  in batches with a rate limit, ordered by recent/active projects first; a
  `--dry-run` reports counts without enqueuing; `parse_failed` files are retried
  up to a cap.
- [ ] **Step 2–3: Implement** the driver with a resumable cursor and progress
  logging; reuse the ingest task. **Gated:** running against the live project's
  articles requires explicit user OK (it touches real, possibly PHI, data).
- [ ] **Step 4: Run → passes.** Commit `feat(parsing): resumable text-block backfill driver`.

### Task 3.2: Confirm-dead gate

- [ ] **Step 1:** Grep/fitness-assert zero readers and writers remain for
  `ArticleFile.text_raw`, `text_html`, `Article.pdf_extracted_text`,
  `semantic_abstract_text`, `semantic_fulltext_text`, and for
  `PDFProcessor.extract_text_chunked` / `detect_sections` (the assembler replaced
  them; `extract_text` stays for the lazy fallback). Add the assertion to
  `scripts/fitness/` so the columns can't silently come back. Commit
  `test(arch): fitness gate for dead article-text surfaces`.

### Task 3.3: Drop dead columns + dep + methods

**Files:** `backend/alembic/versions/NNNN_drop_dead_article_text.py`,
`backend/app/models/article.py`, `backend/app/services/pdf_processor.py`,
`package.json`

- [ ] **Step 1:** Write the Alembic migration dropping the five columns (revision
  id ≤ 32 chars; RLS/relationships unaffected; its own migration so the destruct
  is isolated and Railway auto-applies it cleanly on deploy). Remove the ORM
  columns, the unused `PDFProcessor` methods, and `pdf-lib` from `package.json`.
- [ ] **Step 2:** `cd backend && alembic upgrade head` + the migration roundtrip
  test locally; `npm run build` clean. Commit
  `chore(schema): drop dead article-text columns, unused parser methods, pdf-lib`.

---

## Phase 4 — Reviewer highlight UI

### Task 4.1: `useCitationHighlight` hook

**Files:** `frontend/hooks/extraction/useCitationHighlight.ts`

- [ ] **Step 1: Failing test** (vitest + a stubbed pdf.js viewport): given a
  `TextCitationAnchor`, the hook resolves the page + selects the char range in the
  text layer; given a `RegionCitationAnchor`/`HybridCitationAnchor`, it computes a
  canvas overlay rect by transforming the PDF user-space `bbox`
  (origin bottom-left, points) through the page viewport; both scroll the page
  into view. `.then/.catch` only (no `try/finally`, compiler rule).
- [ ] **Step 2–3: Implement** the hook returning `{ highlight(citation) }` and the
  active-highlight state (single active highlight; cleared on blur/change for
  perf).
- [ ] **Step 4: Run → passes.** Commit `feat(pdf-viewer): citation highlight hook`.

### Task 4.2: Click evidence → highlight

**Files:** `frontend/components/extraction/ai/AISuggestionEvidence.tsx`,
`frontend/pdf-viewer/PrumoPdfViewer.tsx`

- [ ] **Step 1: Failing component test** (MSW): clicking an AI value's evidence
  scrolls to and highlights the anchored span/region; a citation with
  `verified=false` or no anchor shows a "couldn't locate in source" affordance
  instead of a dead jump.
- [ ] **Step 2–3: Implement** the wiring: thread the active citation from the
  evidence popover to the viewer; render the overlay/selection; copy keys in
  `frontend/lib/copy/extraction.ts` (e.g. `evidenceNotLocated`).
- [ ] **Step 4: Run → passes.** Commit `feat(extraction): jump-to and highlight evidence in the PDF`.

### Task 4.3: Reader ↔ canvas sync + a11y

**Files:** `frontend/pdf-viewer/primitives/Reader.tsx`, `PrumoPdfViewer.tsx`

- [ ] **Step 1:** Highlight follows the active mode (canvas overlay vs reader
  block emphasis); keyboard-activatable evidence (Enter/Space), focus moves to the
  highlighted region, `aria` describes the jump; axe has no new violations.
- [ ] **Step 2: Tests** — component + an axe assertion. Commit
  `feat(pdf-viewer): sync highlight across reader/canvas + a11y`.

### Task 4.4: Design-review + E2E

- [ ] **Step 1:** Run the `design-review` loop (`/design-review` on the extraction
  route) on the highlight UX — render, screenshot, compare to the Plane/Linear
  target, fix, re-screenshot. No "done" claim without it.
- [ ] **Step 2:** Playwright E2E: open a finalized run, click an AI value, assert
  the highlight is visible on the correct page; axe pass. Commit
  `test(e2e): evidence click highlights source in the PDF`.

### Task 4.5 (stretch): reviewer attaches a manual highlight as evidence

- [ ] **Step 1:** Select text/region in the PDF → "attach as evidence" → a small
  write endpoint + service persists a `human` `PositionV1` on the field's
  evidence. Enforce `ensure_project_member()` + RLS (BOLA). Test (backend
  integration + FE component) + commit. Out of the critical path; ship only if
  reviewers ask for it.

---

## Finalize

- [ ] **Docs:** update `docs/reference/extraction-hitl-architecture.md` with the
  consume/anchor/verify/highlight flow; bump `last_reviewed`.
- [ ] **ADR:** flip ADR 0011 to `status: accepted` (parser locked + the full
  pipeline shipped end-to-end). Commit `docs(extraction): grounded-extraction flow + accept ADR-0011`.

---

## Self-Review

- **Coverage of the decisions this plan owns:** pixel-bbox anchoring (Tasks 2.1–2.2,
  4.1–4.3); kill the 15k truncation across all three sites (1.2); verbatim verify
  / flag-not-drop (2.3); humans-read + reviewer verification (Phase 4); backfill +
  two-tier safety (1.3, 3.1); dead-schema cleanup (3.2–3.3). The ingest-side
  decisions (parser, vision pass, JATS, PHI hosting) live in the sibling plan.
- **Reuse:** writes the existing `PositionV1` contract and renders via the
  existing viewer types — no new schema; backfill reuses the ingest task; the read
  path only gains a `verified` field.
- **Risk/ordering:** depends on the ingest plan populating blocks; the
  `READ_FROM_BLOCKS` flag + lazy fallback make the rollout non-breaking during
  backfill. The matcher is the highest-risk unit — it is pure and exhaustively
  tested (OCR noise, multi-block, ties) before it touches the DB. Phase 4 depends
  on Phase 2 anchors; the manual-evidence write path (4.5) is the only new
  endpoint and carries the usual BOLA/RLS obligations.
- **Gated/live:** backfill (3.1) and any test against real clinical PDFs need
  explicit user OK and an approved data surface.
