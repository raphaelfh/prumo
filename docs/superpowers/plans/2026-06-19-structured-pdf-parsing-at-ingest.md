---
status: planned
last_reviewed: 2026-06-19
owner: '@raphaelfh'
---

# Structured PDF parsing at ingest with grounded evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Decision record: ADR 0011 (structured PDF parsing at ingest).

**Goal:** Replace the lazy `pypdf` raw-text + 15k-truncation + discard path with
a parse-at-ingest pipeline that persists structured, bbox-bearing blocks into
the already-migrated `article_text_blocks`, feeds section-aware structured text
to extraction, and grounds every extracted value to a verifiable source span
(char range + bbox) so the HITL reviewer can click a value and see it
highlighted on the page. Accuracy leads; clinical PHI stays in-house.

**Architecture:** The target schema and read path already exist
(`ArticleTextBlock`, `PositionV1` anchors, `parse_position`,
`citation_read_service.py`). This plan supplies the two missing halves — the
**populating step** (a parser running at ingest) and the **position writer**
(evidence anchoring at extraction time) — behind a parser-agnostic adapter so
the concrete parser is swappable after the bake-off. Parsing runs in the Celery
worker as a Python library call (no new service); blocks are written through a
new repository; the table/formula vision pass and a second LLM provider go
behind the single `build_model()` doorway plus a direct-SDK image adapter
(forced by the `pydantic-ai < 2` pin). No new tables are required — block status
rides on the existing `ArticleFile.extraction_status`; only a later cleanup
migration drops dead columns.

**Tech Stack:** Python 3.11 + FastAPI + SQLAlchemy 2.0 async + Alembic; Celery +
Redis worker (`worker_session()` NullPool); pydantic-ai (text extraction) +
provider image SDK (vision pass); a self-hosted layout parser (Docling or
MinerU, locked in Phase 0); pytest integration against local Supabase
(`db_session_real`, project-scoped fixtures); React 19 + pdf.js for the Phase 6
highlight wiring. Suggested branch: `feat/pdf-structured-ingest`.

**Constraints (from the constitution + `.claude/rules/backend.md`):** four-layer
flow (API → Service → Repository → Model); repositories `flush()` never
`commit()`; the only singleton is `EventBus`; every Celery DB task uses
`worker_session()` + `run_task()`; Alembic owns the public schema (revision id
≤ 32 chars); new/changed tables keep RLS via `is_project_member()`; one provider
doorway (`build_model()`); no `try/finally` in React-compiled code (use
`.then/.catch`); integration tests scope queries by `project_id`.

---

## Phases

- **Phase 0 — Parser bake-off & decision (gates everything).** Lock parser,
  GPU/CPU, and cost/latency budget on real papers.
- **Phase 1 — Parse at ingest → persist blocks.** Adapter + writer + Celery
  task; the backbone.
- **Phase 2 — Source routing: JATS fast-path, OCR, supplementary.**
- **Phase 3 — Table/formula vision pass + second provider.**
- **Phase 4 — Extraction reads blocks + evidence anchoring + verification.**
- **Phase 5 — Backfill, dead-schema cleanup, docs, flip ADR to accepted.**
- **Phase 6 — Frontend highlight wiring (enabled by Phases 1–4; may be its own
  plan).**

## File map

| File | Responsibility | Change |
| --- | --- | --- |
| `backend/app/services/parsing/base.py` | parser port | New: `DocumentParser` Protocol + `ParsedBlock` dataclass (page, index, text, char_start/end, bbox, block_type) |
| `backend/app/services/parsing/docling_parser.py` (and/or `mineru_parser.py`) | parser adapter | New: wrap the chosen library; emit `ParsedBlock`s with bbox + reading order |
| `backend/app/services/document_parsing_service.py` | orchestration | New: source routing (PDF/JATS), run parser, run table pass, write blocks, set status |
| `backend/app/repositories/article_text_block_repository.py` | persistence | New: bulk insert/replace blocks for an `article_file_id` (`flush`, not `commit`) |
| `backend/app/worker/tasks/parsing_tasks.py` | async entry | New: `parse_article_file_task` (worker_session + run_task) |
| `backend/app/services/zotero_import_service.py` | ingest | Enqueue `parse_article_file_task` after `ArticleFile` creation |
| `backend/app/services/parsing/jats_parser.py` | XML fast-path | New: parse PMC JATS → blocks (text+structure); PDF stays the bbox surface |
| `backend/app/llm/provider.py` | provider doorway | Add `provider` arg + Anthropic branch (text); keep single doorway |
| `backend/app/llm/vision/table_pass.py` | vision adapter | New: direct provider image SDK call on table/formula regions |
| `backend/app/core/config.py` | settings | Add `ANTHROPIC_API_KEY`, `ANTHROPIC_DEFAULT_MODEL`, parser/vision toggles |
| `backend/app/services/api_key_service.py` | BYOK | Learn an `anthropic` key alongside `openai` |
| `backend/app/services/section_extraction_service.py` | extraction | Read persisted blocks; section-aware assembly (kill 15k truncation); anchor evidence |
| `backend/app/services/evidence_anchor_service.py` | grounding | New: quote→block match (NFKC + white-space fold) → `PositionV1`; verbatim verify |
| `backend/app/llm/validators.py` | validation | Extend `evidence_is_plausible` → flag non-verbatim citations |
| `backend/app/llm/prompts/__init__.py` (+ 3 templates) | prompts | Replace `MAX_PDF_CHARS` prefix-cut with section-aware selection |
| `backend/alembic/versions/NNNN_drop_dead_article_text.py` | schema | New (Phase 5): drop `text_raw`, `text_html`, `pdf_extracted_text`, `semantic_*` |
| `frontend/pdf-viewer/*`, `frontend/components/extraction/ai/*` | UI | Phase 6: wire `PositionV1` → canvas highlight + jump-to |
| `docs/reference/extraction-hitl-architecture.md` | docs | Document the ingest parse + anchoring contract; bump `last_reviewed` |
| `docs/adr/0011-structured-pdf-parsing-at-ingest.md` | docs | Flip `status: accepted` once Phase 0 locks the parser |

---

## Phase 0 — Parser bake-off & decision

> Output is a decision + a short results doc, not production code. Phase 1
> depends on the parser choice from here.

### Task 0.1: Assemble and lock the evaluation set

- [ ] **Step 1:** Collect ≥ 50 real prumo papers balanced across born-digital,
  scanned/image-only, and JATS-available inputs; include clinical-trial papers
  with data-dense and merged-cell tables. Store the set + a manifest; freeze it.
- [ ] **Step 2:** A domain reviewer labels ground truth per paper: key tables
  (cell grid), section boundaries (IMRaD), figure captions, reference count,
  equations present, and a handful of target extraction fields with their true
  source page + region. Record an inter-annotator spot-check.

### Task 0.2: Build the bake-off harness

- [ ] **Step 1:** A standalone script (`scripts/parsing_bakeoff/run.py`, outside
  the app layers) runs each candidate — Docling, MinerU, OpenDataLoader-PDF, and
  one API baseline (e.g. LlamaParse) — over the set, emitting `ParsedBlock`-shaped
  output + bboxes.
- [ ] **Step 2:** Score: table fidelity (TEDS **and** an LLM-judge, since
  exact-match penalizes valid reformatting), section/figure/reference/equation
  recovery, bbox correctness vs labeled regions, and per-article wall-clock +
  $ + peak RAM/VRAM. Emit a CSV + a short markdown summary under
  `docs/superpowers/quality-runs/`.

### Task 0.3: Decide and record

- [ ] **Step 1:** Pick the parser (primary metric = table fidelity; bbox
  correctness breaks ties) and decide CPU-only (Docling) vs GPU (MinerU) by the
  quality/latency/ops delta. Set the per-article cost and latency budget; sign
  off by product and engineering.
- [ ] **Step 2:** Update ADR 0011 with the chosen parser + budget and flip its
  `Decision Drivers`/`Validation` notes to reflect the result (keep `status:
  proposed` until Phase 1 lands the integration).

---

## Phase 1 — Parse at ingest → persist blocks

### Task 1.1: Define the parser port + ParsedBlock

**Files:** `backend/app/services/parsing/base.py`

- [ ] **Step 1:** Add a `ParsedBlock` dataclass mirroring `ArticleTextBlock`
  exactly: `page_number` (1-indexed), `block_index` (0-indexed, reading order),
  `text`, `char_start`, `char_end` (offsets into **the page's** text concatenated
  in `block_index` order), `bbox` (`{x, y, width, height}` in PDF user space,
  origin bottom-left, points), `block_type` (one of the closed 7:
  `paragraph|heading|list_item|table_cell|figure_caption|header|footer`; unknown
  → `paragraph`).
- [ ] **Step 2:** Add a `DocumentParser` Protocol: `parse(pdf_bytes: bytes) ->
  list[ParsedBlock]`. Add a pure helper `assemble_page_text(blocks) ->
  dict[int, str]` that concatenates per page in `block_index` order — the single
  source of truth for char offsets.
- [ ] **Step 3:** Unit-test `assemble_page_text` + offset invariants (every
  block's `text == page_text[char_start:char_end]`).

### Task 1.2: Implement the chosen parser adapter

**Files:** `backend/app/services/parsing/docling_parser.py` (parser per Phase 0)

- [ ] **Step 1:** Write a failing integration test: feed a small fixture PDF,
  assert ≥ 1 block per page, monotonic `block_index`, valid `block_type`s, bboxes
  within page bounds, and the offset invariant from Task 1.1 Step 3.
- [ ] **Step 2:** Implement the adapter mapping the library's output to
  `ParsedBlock`; map the library's block taxonomy onto the closed 7-value set.
- [ ] **Step 3:** Run the test → PASS. Commit
  `feat(parsing): DocumentParser port + <parser> adapter`.

### Task 1.3: ArticleTextBlock repository (the writer)

**Files:** `backend/app/repositories/article_text_block_repository.py`

- [ ] **Step 1:** Failing test (`db_session_real`, project-scoped fixture):
  `replace_for_file(article_file_id, blocks)` deletes existing blocks then bulk-
  inserts; round-trips fields exactly; respects RLS (a non-member cannot read).
- [ ] **Step 2:** Implement on `BaseRepository` (`flush()`, never `commit()`).
  Re-upload relies on the existing `ON DELETE CASCADE`; `replace_for_file` is for
  re-parse of the same file.
- [ ] **Step 3:** Run → PASS. Commit `feat(parsing): article_text_block repository`.

### Task 1.4: DocumentParsingService (orchestration, PDF-only first)

**Files:** `backend/app/services/document_parsing_service.py`

- [ ] **Step 1:** Failing test: given an `ArticleFile` with a stored PDF, the
  service downloads bytes via the injected `StorageAdapter`, runs the parser,
  writes blocks via the repo, and sets `ArticleFile.extraction_status` to a
  terminal `parsed` (and `parse_failed` on parser error, with structlog + a
  re-raise the task can retry).
- [ ] **Step 2:** Implement `DocumentParsingService(db, user_id, storage,
  trace_id)`; instantiate the repo inside; return a typed
  `DocumentParsingResult` dataclass (block count, page count, status). No HTTP
  objects. Table/JATS/OCR routing are added in Phases 2–3 behind flags.
- [ ] **Step 3:** Run → PASS. Commit `feat(parsing): document parsing service (PDF path)`.

### Task 1.5: Celery task + ingest wiring

**Files:** `backend/app/worker/tasks/parsing_tasks.py`,
`backend/app/services/zotero_import_service.py`

- [ ] **Step 1:** Failing integration test: enqueuing `parse_article_file_task`
  for a seeded file populates `article_text_blocks` and flips
  `extraction_status`; a parser error retries (max_retries) then lands
  `parse_failed`.
- [ ] **Step 2:** Implement the task with the established pattern — nested
  `async def run()`, `worker_session()` for the DB, `create_storage_adapter()`
  for storage, `run_task()` bridge; `max_retries=3`, sane `rate_limit`. Enqueue
  it from `_import_pdf()` right after the `ArticleFile` row is created.
- [ ] **Step 3:** Run → PASS. Commit
  `feat(parsing): parse PDFs at ingest and persist text blocks`.

---

## Phase 2 — Source routing: JATS fast-path, OCR, supplementary

### Task 2.1: PMC JATS fast-path

**Files:** `backend/app/services/parsing/jats_parser.py`, `document_parsing_service.py`

- [ ] **Step 1:** Failing test: when a JATS/PMC XML source is present, blocks are
  built from the XML (sections, headings, table cells, references) with stable
  per-page-equivalent ordering; the service still records that the PDF is the
  bbox-anchor surface (XML blocks carry `bbox=null`/sentinel, page mapped by the
  PDF pass when available).
- [ ] **Step 2:** Implement the JATS parser + a `choose_source()` step (XML when
  available, else PDF). Document that XML gives the cleanest text/structure but
  no native bbox; anchoring for XML-only articles falls back to text-range
  (page-level) until a PDF pass supplies regions.
- [ ] **Step 3:** Run → PASS. Commit `feat(parsing): PMC JATS fast-path`.

### Task 2.2: OCR for scanned/image PDFs

- [ ] **Step 1:** Failing test on a scanned fixture: today's path yields empty
  text; the new path detects no/low text layer and routes to OCR (the parser's
  OCR or the Phase 3 vision model), producing non-empty blocks.
- [ ] **Step 2:** Implement detection + OCR routing; on OCR failure set
  `parse_failed` and surface it (no silent empty extraction). Commit
  `feat(parsing): OCR fallback for scanned PDFs`.

### Task 2.3: Supplementary files

- [ ] **Step 1:** Parse supplementary/appendix files (existing `file_role`),
  storing their blocks linked to their own `ArticleFile`; extraction can include
  them per template scope. Test + commit `feat(parsing): parse supplementary files`.

---

## Phase 3 — Table/formula vision pass + second provider

### Task 3.1: Provider doorway — add Anthropic (text) without breaking the single doorway

**Files:** `backend/app/llm/provider.py`, `backend/app/core/config.py`,
`backend/app/services/api_key_service.py`

- [ ] **Step 1:** Failing test: `build_model(provider='anthropic',
  model_name=...)` returns an Anthropic pydantic-ai model; `provider='openai'`
  (default) unchanged; `APIKeyService` resolves an `anthropic` BYOK key with the
  same precedence as `openai`.
- [ ] **Step 2:** Add the `provider` arg + Anthropic branch in `build_model`
  only; add `ANTHROPIC_API_KEY`/`ANTHROPIC_DEFAULT_MODEL` to `config.py`; teach
  `APIKeyService` the `anthropic` provider. Services keep calling
  `extract_structured()` unchanged.
- [ ] **Step 3:** Run → PASS. Commit `feat(llm): add Anthropic provider behind build_model`.

### Task 3.2: Vision table/formula adapter (direct SDK, outside pydantic-ai)

**Files:** `backend/app/llm/vision/table_pass.py`

- [ ] **Step 1:** Failing test (stubbed image client): given a page image + a
  table region bbox, the adapter returns structured table markdown/HTML for that
  region; the result reconciles onto the parser's `table_cell` blocks (replaces
  their text, keeps their bboxes).
- [ ] **Step 2:** Implement a thin adapter calling the provider image API
  **directly** (documented divergence from `extract_structured()` — forced by
  `pydantic-ai < 2`); render page images at a fixed DPI; cap regions per article
  for cost. Gate behind a `VISION_TABLE_PASS` flag.
- [ ] **Step 3:** Wire it into `DocumentParsingService` after the layout parse,
  for detected table/formula regions only. Run → PASS. Commit
  `feat(parsing): vision pass for table and formula regions`.

---

## Phase 4 — Extraction reads blocks + evidence anchoring + verification

### Task 4.1: Section-aware context from blocks (retire the 15k truncation)

**Files:** `backend/app/services/section_extraction_service.py`,
`backend/app/llm/prompts/__init__.py` (+ `section_extraction`,
`quality_assessment`, `model_identification` templates)

- [ ] **Step 1:** Failing test: extraction sources text from persisted
  `article_text_blocks` (not a fresh `pypdf` call); a long document is assembled
  section-aware so post-15k content (e.g. a Results table) is present in the
  prompt. If blocks are absent, it falls back to today's lazy `pypdf` path
  (two-tier until backfill).
- [ ] **Step 2:** Replace the three `article_text[:MAX_PDF_CHARS]` sites with a
  block-driven assembler (whole-doc for normal papers; section/budget-aware for
  outliers). Keep prompt versioning (`content_version`) intact.
- [ ] **Step 3:** Run → PASS. Commit
  `feat(extraction): assemble prompts from persisted blocks, drop 15k truncation`.

### Task 4.2: Evidence anchoring service (write PositionV1)

**Files:** `backend/app/services/evidence_anchor_service.py`,
`backend/app/services/section_extraction_service.py`

- [ ] **Step 1:** Failing test: given a model quote that exists in a block,
  anchoring writes a `PositionV1` (`TextCitationAnchor` char range, or
  `HybridCitationAnchor` with the block's `rect`) into
  `ExtractionEvidence.position`; `text_content`/`page_number` stay denormalized
  in sync; `parse_position` validates it and `citation_read_service` returns it
  camelCase. Matching uses Unicode NFKC + white-space folding (not byte equality).
- [ ] **Step 2:** Implement `EvidenceAnchorService.anchor(evidence, blocks)`;
  call it where proposals + evidence are recorded (replacing the `position={}`
  write). Handle quote-spans-blocks (anchor the containing range) and ambiguity
  (first/nearest match, recorded).
- [ ] **Step 3:** Run → PASS. Commit `feat(extraction): anchor evidence to source blocks`.

### Task 4.3: Verbatim verification (flag, don't drop)

**Files:** `backend/app/llm/validators.py`

- [ ] **Step 1:** Failing test: a planted hallucinated quote (absent from all
  blocks) is **flagged** on the evidence (a `verified: false` / reason), not
  silently dropped and not hard-erroring the run; a genuine quote verifies true.
  Include OCR-ish edge cases (ligatures, smart quotes) that must still verify
  under NFKC folding.
- [ ] **Step 2:** Extend `evidence_is_plausible` (or add `evidence_is_grounded`)
  to set the verification flag from the anchor result. Surface the flag in the
  read model for the UI.
- [ ] **Step 3:** Run → PASS. Commit `feat(extraction): verbatim-verify AI citations`.

---

## Phase 5 — Backfill, cleanup, docs

### Task 5.1: Backfill already-ingested articles

- [ ] **Step 1:** A one-off task/script enqueues `parse_article_file_task` for
  existing `ArticleFile`s lacking blocks (idempotent, batched, rate-limited).
  Until an article has blocks, extraction uses the lazy fallback (Task 4.1).
- [ ] **Step 2:** Verify on a sample; commit `chore(parsing): backfill text blocks for existing articles`.

### Task 5.2: Drop dead schema + unused dep

**Files:** `backend/alembic/versions/NNNN_drop_dead_article_text.py`,
`backend/app/models/article.py`, root `package.json`

- [ ] **Step 1:** Confirm zero readers/writers remain for `ArticleFile.text_raw`,
  `text_html`, `Article.pdf_extracted_text`, `semantic_abstract_text`,
  `semantic_fulltext_text` (grep). Write an Alembic migration dropping them
  (revision id ≤ 32 chars); remove the ORM columns; remove `pdf-lib` from
  `package.json`.
- [ ] **Step 2:** `cd backend && alembic upgrade head` locally + roundtrip test;
  `npm run build` clean. Commit `chore(schema): drop unused article text columns + pdf-lib`.

### Task 5.3: Docs + flip ADR

- [ ] **Step 1:** Update `docs/reference/extraction-hitl-architecture.md` with
  the ingest-parse step, the block contract, and the anchoring/verification flow;
  bump `last_reviewed`.
- [ ] **Step 2:** Flip ADR 0011 `status: accepted` (parser locked in Phase 0,
  pipeline shipped). Commit `docs(extraction): document structured-ingest pipeline`.

---

## Phase 6 — Frontend highlight wiring (enabled; may be a separate plan)

> Backend now writes `PositionV1`; the viewer types (`pdf-viewer/core/citation.ts`)
> and `Reader.tsx` already model it. This phase is UI-only and can ship on its
> own branch once Phase 4 lands.

### Task 6.1: Click-to-highlight evidence

- [ ] **Step 1:** Component test: clicking an AI value's evidence
  (`AISuggestionEvidence.tsx`) scrolls the pdf.js canvas to the page and draws
  the `RegionCitationAnchor` rect (or selects the `TextCitationAnchor` range in
  the text layer); a non-grounded (flagged) citation shows a "couldn't locate in
  source" affordance instead.
- [ ] **Step 2:** Wire the citation read model → viewer highlight; sync Reader and
  canvas modes. Run → PASS. Commit `feat(pdf-viewer): highlight evidence in document`.

### Task 6.2: Reviewer can attach a manual highlight as evidence (stretch)

- [ ] **Step 1:** Let a reviewer select text/region in the PDF and attach it to a
  field as a `human` evidence anchor (writes `PositionV1`). Test + commit.

---

## Self-Review

- **Spec coverage (the 12 decisions):** all inputs → Phases 1–2 (PDF, OCR, JATS,
  supplementary); accuracy-leads + humans-read → blocks serve both; pixel-bbox
  anchoring → Tasks 1.x + 4.2 + 6.1; vision/Claude → Phase 3; cost tradeoff →
  Phase 0 bake-off + budget gate; extract-once-at-ingest + persist → Phase 1;
  self-host on Railway (PHI) → in-worker parser, no egress except the gated,
  region-scoped vision call; vision table pass → Task 3.2; JATS fast-path →
  Task 2.1.
- **Reuse:** consumes the existing `ArticleTextBlock` + `PositionV1` +
  `citation_read_service` contract; no new tables (status on
  `ArticleFile.extraction_status`); the read path is untouched.
- **Layering/risk:** parser is a library call inside the Celery worker (no new
  service); the only architectural divergence is the direct-SDK vision adapter,
  justified by the `pydantic-ai < 2` pin and isolated in `llm/vision/`. Char
  offsets are per-page in `block_index` order (single source of truth in
  `assemble_page_text`). Backfill keeps a lazy fallback so nothing breaks during
  rollout (temporary two-tier).
- **Gated/live:** Phase 0 needs real (possibly PHI) papers — handle on an
  approved data surface, not a public bucket. Backfill (Task 5.1) touches the
  live project's articles — run only with explicit user OK.
- **Ordering:** Phase 0 gates parser-specific code in Phase 1. Phases 2–3 layer
  onto Phase 1's service. Phase 4 depends on blocks existing. Phase 6 depends on
  Phase 4's anchors.
