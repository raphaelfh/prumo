---
status: draft
last_reviewed: 2026-06-19
owner: '@raphaelfh'
---

# Structured PDF parsing at ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Decision record: ADR 0011 (structured PDF parsing at ingest).

**Goal:** Replace the lazy `pypdf` raw-text + discard path with a parse-at-ingest
pipeline that persists structured, bbox-bearing blocks into the already-migrated
`article_text_blocks` for every input type (born-digital, scanned, JATS,
supplementary). This plan stops at a **populated, faithful representation**;
consuming it (section-aware extraction, evidence anchoring, dead-schema cleanup,
and the reviewer highlight UI) is the follow-up plan
`2026-06-19-grounded-extraction-and-hitl-highlight.md`. Accuracy leads; clinical
PHI stays in-house.

**Architecture:** The target schema and the eventual read path already exist
(`ArticleTextBlock`, `PositionV1` anchors, `citation_read_service.py`). This plan
supplies the **populating step** — a parser running at ingest behind a
parser-agnostic adapter so the concrete parser is swappable after the bake-off —
and leaves the **position writer** (evidence anchoring) and all consumption to
the follow-up plan. Parsing runs in the Celery worker as a Python library call
(no new service); blocks are written through a new repository; the table/formula
vision pass and a second LLM provider go behind the single `build_model()`
doorway — the pinned `pydantic-ai 1.107` already supports multimodal input, so
the vision pass appends a page-image/PDF `BinaryContent` to the same
`extract_structured()` call (no direct-SDK adapter). Parser backends are
pluggable behind one `DocumentParser` port in `app/infrastructure/parsing/`
(mirroring `StorageAdapter`), built by a `create_document_parser()` factory in
`app/core/factories.py` that owns the `PARSER_BACKEND` switch and the PHI gate
(Docling/MinerU/LiteParse self-hosted, LlamaParse cloud, or vision-LLM-native).
Per ADR-0011's split-default, non-PHI projects default to LlamaParse `agentic`
(Phase-0-confirmed, falling back to the self-hosted winner on quality/cost/
latency); PHI projects always resolve to self-hosted via the fail-closed gate. No
new tables are required — block status rides on the existing
`ArticleFile.extraction_status`.

**Tech Stack:** Python 3.11 + FastAPI + SQLAlchemy 2.0 async + Alembic; Celery +
Redis worker (`worker_session()` NullPool); pydantic-ai (text + multimodal vision via `BinaryContent`); a parser backend
(non-PHI → LlamaParse `agentic` cloud default; PHI → self-hosted Docling/MinerU/LiteParse, resolved by the `create_document_parser()` PHI gate; Phase 0 confirms the cloud default + picks the self-hosted winner); pytest integration against local Supabase (`db_session_real`,
project-scoped fixtures). Suggested branch: `feat/pdf-structured-ingest`.

**Constraints (constitution + `.claude/rules/backend.md`):** four-layer flow
(API → Service → Repository → Model); repositories `flush()` never `commit()`;
the only singleton is `EventBus`; every Celery DB task uses `worker_session()` +
`run_task()`; Alembic owns the public schema (revision id ≤ 32 chars); new/changed
tables keep RLS via `is_project_member()`; one provider doorway (`build_model()`);
integration tests scope queries by `project_id`.

---

## Phases

- **Phase 0 — Parser bake-off & decision (gates everything).** Lock parser,
  GPU/CPU, and cost/latency budget on real papers.
- **Phase 1 — Parse at ingest → persist blocks.** Adapter + writer + Celery
  task; the backbone.
- **Phase 2 — Source routing: JATS fast-path, OCR, supplementary.**
- **Phase 3 — Table/formula vision pass + second provider.**

Consuming the blocks — section-aware extraction, evidence anchoring + verbatim
verification, backfill/cleanup, and the reviewer highlight UI — is the
**follow-up plan**: `2026-06-19-grounded-extraction-and-hitl-highlight.md`.

## File map

| File | Responsibility | Change |
| --- | --- | --- |
| `backend/app/infrastructure/parsing/base.py` | parser port | New: `DocumentParser` ABC + `ParsedBlock` dataclass + `concat_page_text` (the char-offset source of truth) |
| `backend/app/infrastructure/parsing/docling_parser.py` (and/or `mineru_parser.py`) | parser adapter | New: wrap the chosen library; emit `ParsedBlock`s with bbox + reading order |
| `backend/app/infrastructure/parsing/llamaparse_parser.py` | parser adapter (cloud) | New: LlamaParse `agentic` tier → blocks from the `items` tree + granular-bbox JSONL sidecar — the **non-PHI default** backend (PHI-gated; self-hosted is the PHI path + non-PHI fallback). The `llama-cloud` lib is an optional pyproject extra so self-hosted-only deploys can skip it |
| `backend/app/infrastructure/parsing/page_render.py` | rasterizer | New: render a PDF page to an image once (**PyMuPDF** — one dep that also powers the free `pymupdf4llm` markdown tier per ADR-0013; new dependency) for the vision pass |
| `backend/app/core/factories.py` | parser factory | Add `create_document_parser(settings, *, project_is_phi)` — owns `PARSER_BACKEND` + PHI gate (mirrors `create_storage_adapter`) |
| `backend/app/services/document_parsing_service.py` | orchestration | New: source routing via `ingestion_source`, run the injected parser, table pass, write blocks once, set status |
| `backend/app/repositories/article_text_block_repository.py` | persistence | New: `replace_for_file` + the single ordered-read owner (existing read service delegates here); `flush`, not `commit` |
| `backend/app/worker/tasks/parsing_tasks.py` | async entry | New: `parse_article_file_task` (worker_session + run_task) |
| `backend/app/services/zotero_import_service.py` | ingest | Enqueue `parse_article_file_task` after `ArticleFile` creation |
| `backend/app/infrastructure/parsing/jats_parser.py` | XML fast-path | New: parse PMC JATS → blocks (text+structure); PDF stays the bbox surface |
| `backend/app/llm/provider.py` | provider doorway | Add `provider` arg + Anthropic/Gemini branches (`[anthropic]`/`[google]` extras); keep single doorway |
| `backend/app/llm/vision_table_pass.py` | vision pass | New: render page once → crop regions → concurrent `extract_structured()` calls with page-image `BinaryContent` (pydantic-ai multimodal) |
| `backend/app/core/config.py` | settings | Add `ANTHROPIC_API_KEY`, `ANTHROPIC_DEFAULT_MODEL`, `PARSER_BACKEND`, `VISION_TABLE_PASS` |
| `backend/app/services/api_key_service.py` | BYOK | Learn an `anthropic` key alongside `openai` |
| `docs/reference/extraction-hitl-architecture.md` | docs | Document the ingest parse + block contract; bump `last_reviewed` |

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
  the app layers) runs each candidate — PyMuPDF (baseline), Docling, MinerU,
  LiteParse, and LlamaParse (`agentic` tier with `granular_bboxes`) — over the set,
  emitting `ParsedBlock`-shaped output + bboxes (matching the `parsers.py`
  REGISTRY; the old-spec OpenDataLoader-PDF is an unwired stub, not a live
  candidate).
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
  proposed` until the full pipeline lands across both plans).

---

## Phase 1 — Parse at ingest → persist blocks

### Task 1.1: Define the parser port + ParsedBlock

**Files:** `backend/app/infrastructure/parsing/base.py`

- [ ] **Step 1:** Add a `ParsedBlock` dataclass mirroring `ArticleTextBlock`
  exactly: `page_number` (1-indexed), `block_index` (0-indexed, reading order),
  `text`, `char_start`, `char_end` (offsets into **the page's** text concatenated
  in `block_index` order), `bbox` (`{x, y, width, height}` in PDF user space,
  origin bottom-left, points), `block_type` (one of the closed 7:
  `paragraph|heading|list_item|table_cell|figure_caption|header|footer`; unknown
  → `paragraph`).
- [ ] **Step 2:** Add a `DocumentParser` ABC: `parse(pdf_bytes: bytes) ->
  list[ParsedBlock]` (same shape as `StorageAdapter`). Add a pure helper
  `concat_page_text(blocks) -> dict[int, str]` that concatenates per page in
  `block_index` order — the single source of truth for char offsets that the
  follow-up plan's prompt assembler + anchorer import (they must not re-implement
  it).
- [ ] **Step 3:** Unit-test `concat_page_text` + offset invariants (every
  block's `text == page_text[char_start:char_end]`).

### Task 1.2: Implement the chosen parser adapter

**Files:** `backend/app/infrastructure/parsing/docling_parser.py` (parser per Phase 0)

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
- [ ] **Step 2:** Implement `DocumentParsingService(db, user_id, storage, parser,
  trace_id)` — `parser` comes from `create_document_parser(settings,
  project_is_phi=...)` (mirroring how the task builds `StorageAdapter` via
  `create_storage_adapter`); instantiate the repo inside; return a typed
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
  for storage, `create_document_parser()` for the parser, `run_task()` bridge;
  `max_retries=3`, sane `rate_limit`. Enqueue it from `_import_pdf()` right after
  the `ArticleFile` row is created.
- [ ] **Step 3:** Run → PASS. Commit
  `feat(parsing): parse PDFs at ingest and persist text blocks`.

### Task 1.6: LlamaParse adapter (optional grounded cloud backend)

Verified against the live LlamaParse/LlamaCloud API (2026-06-20): the v2 SDK
returns **text-level granular bboxes** (word/line/cell, PDF points, top-left
origin) that map onto `article_text_blocks` + `PositionV1`; markdown is a
projection of those blocks (ADR-0013), never the source of truth. Cost: agentic
tier = 10 credits/page = **$0.0125/page** (~$0.19 per 15-page paper); free tier
= 10k credits/mo (~1k agentic pages, no card). `granular_bboxes` is **not**
available on the `fast` tier, so the grounded path pins `tier='agentic'`. The
backbone (DocumentParser port, repo, `DocumentParsingService`) is already merged
(PR #322); a `LlamaParseParser` drops in as the injected parser with **zero**
service changes.

**Files:** `backend/app/infrastructure/parsing/llamaparse_parser.py`,
`backend/app/core/factories.py`, `backend/app/core/config.py`,
`backend/pyproject.toml`.

- [ ] **Step 0 — config:** add `PARSER_BACKEND: str = "llamaparse"` (the non-PHI
  default = LlamaParse `agentic`, confirmed-or-overturned by the Phase-0 bake-off;
  `create_document_parser()`'s fail-closed PHI gate forces the self-hosted Phase-0
  winner for PHI or unknown-status projects — see ADR-0011's split-default) and
  `LLAMA_CLOUD_API_KEY: str | None = None` to `Settings`, mirroring
  `OPENAI_API_KEY`. Do **not** add `"llamaparse"` to
  `SUPPORTED_PROVIDERS` — it is an org-level **parser** credential, not an LLM
  BYOK provider; never route it through `build_model()` / `APIKeyService`.
- [ ] **Step 1 — failing test:** integration test with a mocked `llama_cloud`
  client. Assert the adapter issues `files.create(purpose="parse")` then
  `parsing.parse(tier="agentic", version="latest",
  output_options={"granular_bboxes": ["word","line","cell"]},
  expand=["markdown","items"])`. Feed a fixture `items` tree + granular-bbox JSONL
  sidecar; assert `ParsedBlock`s have non-null `bbox {x,y,width,height}`, closed-7
  `block_type`, 1-indexed `page_number`, 0-indexed reading-order `block_index`;
  round-trip **through** `DocumentParsingService` (which calls
  `assign_char_offsets_to_blocks`) and assert
  `block.text == page_text[char_start:char_end]`. Edge cases: a box-less item
  (synthesize a covering/sentinel bbox, never `None` — `bbox` is `NOT NULL`); an
  unknown LlamaParse type (degrades to `paragraph`); a Y-flip assertion (top-left
  input → bottom-left stored).
- [ ] **Step 2 — adapter:** `class LlamaParseParser(DocumentParser)`,
  `__init__(api_key: str, tier: str = "agentic")`; sync `parse(pdf_bytes)` uses
  the **sync** `LlamaCloud` client (matching the wired runner at
  `scripts/parsing_bakeoff/parsers.py`, `from llama_cloud import LlamaCloud`) so
  the "one mapper, not two" guarantee holds; the service calls `parse`
  synchronously. Lift the call shape verbatim from
  `scripts/parsing_bakeoff/parsers.py` and finish the `_map_llamaparse_result`
  step the runner stubbed (`ParserNotWiredError`). Map `items` per page →
  `ParsedBlock`; `block_type` via `normalize_block_type`
  (text→paragraph, heading/title→heading, list→list_item, table cell→table_cell,
  figure caption→figure_caption, unknown→paragraph); `bbox` = reduce the item's
  word/line/cell sidecar boxes to a covering `{x,y,width,height}` **then Y-flip to
  bottom-left** (`y' = page_height - y - h`, using the row's `page_height`);
  `char_start` / `char_end` = `0` placeholders (the service overwrites). Discard
  native markdown for block-building (optional merge aid only, per ADR-0013).
- [ ] **Step 3 — factory + PHI gate:** add `create_document_parser(settings, *,
  project_is_phi: bool) -> DocumentParser` (mirror `create_storage_adapter`).
  Owns the `PARSER_BACKEND` switch; on `"llamaparse"` it (a) **fail-closed**
  refuses / falls back to the self-hosted parser when `project_is_phi` is True
  **or** unknown, (b) raises a clear missing-key error when
  `settings.LLAMA_CLOUD_API_KEY` is unset, (c) returns
  `LlamaParseParser(api_key=settings.LLAMA_CLOUD_API_KEY)`. Register the
  self-hosted backends (Docling/MinerU/LiteParse) in the same switch. Test: a PHI
  project can never receive a `LlamaParseParser`; `build_model` is uninvolved.
- [ ] **Step 4 — `project_is_phi` source of truth:** introduce the PHI policy
  flag as a single project/org column (Alembic migration, revision id ≤ 32 chars)
  and thread it from the parsing Celery task (Task 1.5) into
  `create_document_parser()`. Default missing/unknown → PHI (fail-closed). Hard
  prerequisite — the gate is inert until this lands (today `project_is_phi` exists
  only in ADR/plan prose, zero code).
- [ ] **Step 5 — deps:** add `llama-cloud >= 2.1` (latest 2.9.0) as an
  **optional** cloud extra in `backend/pyproject.toml` so self-hosted-only
  deployments skip it; lazy-import inside the adapter (like the bake-off runner).
  The legacy `llama_cloud_services` / `llama-parse` SDK is deprecated (2026-05-01)
  — do not pin it.
- [ ] **Step 6 — markdown co-product (defer to the ADR-0013 follow-up plan):**
  capture LlamaParse's `expand=["markdown"]` payload as a build-time merge aid
  only; the canonical viewer/prompt markdown stays `render_blocks_to_markdown`
  over blocks. Do not persist native markdown.
- [ ] **Step 7 — run → PASS.** Commit `feat(parsing): optional LlamaParse cloud
  backend (grounded, PHI-gated)`.

**Before any prod default flips to `llamaparse`:** finish
`_map_llamaparse_result` in `scripts/parsing_bakeoff/parsers.py` against the live
SDK (`LLAMA_CLOUD_API_KEY` set, real Phase-0 run) reusing the **exact** same
items + sidecar + Y-flip mapping the adapter uses (one mapper, not two), and gate
on the Phase-0 quality/cost sign-off (Task 0.3). Recommended posture (per
ADR-0011's split-default): the non-PHI default `PARSER_BACKEND` is LlamaParse
`agentic`; the Phase-0 bake-off (Task 0.3) is the confirm-or-fallback gate — keep
LlamaParse as the non-PHI default unless it loses to the self-hosted winner on
quality/cost/latency, in which case fall back to that winner. PHI projects always
resolve to the self-hosted parser via the fail-closed factory gate (zero egress),
independent of `PARSER_BACKEND`. Also update the runner's `est_cost_per_page_usd`
0.03 → 0.0125 (pricing rationale in the Task 1.6 preamble and `parsers.py`).

---

## Phase 2 — Source routing: JATS fast-path, OCR, supplementary

### Task 2.1: PMC JATS fast-path

**Files:** `backend/app/infrastructure/parsing/jats_parser.py`, `app/services/document_parsing_service.py`

- [ ] **Step 1:** Failing test: when a JATS/PMC XML source is present, blocks are
  built from the XML (sections, headings, table cells, references) with stable
  per-page-equivalent ordering; the service still records that the PDF is the
  bbox-anchor surface (XML blocks carry `bbox=null`/sentinel, page mapped by the
  PDF pass when available).
- [ ] **Step 2:** Implement the JATS parser + a `choose_source()` step that reads
  the already-populated `Article.ingestion_source` / `source_lineage` (set by
  `article_source_normalization`) to detect PMC/JATS — no new detector. XML gives
  the cleanest text/structure but no native bbox; the PDF bbox pass is **lazy**
  (run it only for pages backing extracted values, or on first highlighter open —
  not eagerly for every JATS article). XML-only anchoring falls back to
  text-range until that lazy pass supplies regions.
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

### Task 3.1: Provider doorway — add Anthropic + Gemini behind build_model

**Files:** `backend/app/llm/provider.py`, `backend/app/core/config.py`,
`backend/app/services/api_key_service.py`

- [ ] **Step 1:** Failing test: `build_model(provider='anthropic',
  model_name=...)` returns an Anthropic pydantic-ai model; `provider='openai'`
  (default) unchanged; `APIKeyService` resolves an `anthropic` BYOK key with the
  same precedence as `openai`.
- [ ] **Step 2:** Add the `provider` arg + Anthropic/Gemini branches in
  `build_model` only (install the `pydantic-ai-slim[anthropic]` / `[google]`
  extras); add `ANTHROPIC_API_KEY`/`ANTHROPIC_DEFAULT_MODEL` (and Gemini
  equivalents) to `config.py`; teach `APIKeyService` the new providers. Services
  keep calling `extract_structured()` unchanged.
- [ ] **Step 3:** Run → PASS. Commit `feat(llm): add Anthropic provider behind build_model`.

### Task 3.2: Vision table/formula pass via pydantic-ai multimodal

**Files:** `backend/app/llm/extractor.py`, `backend/app/llm/vision_table_pass.py`, `backend/app/infrastructure/parsing/page_render.py`

- [ ] **Step 1:** Failing unit test: `extract_structured` accepts an optional
  `attachments: Sequence[BinaryContent | ImageUrl | DocumentUrl]` appended to the
  `agent.run([...])` input (text-only callers unchanged); a stubbed model receives
  the image part alongside the prompt.
- [ ] **Step 2:** Failing test (stubbed model): given a rendered page-region
  image, `table_pass` calls `extract_structured` with a table-output Pydantic
  model + the page-image `BinaryContent`, and reconciles the result onto the
  parser's `table_cell` blocks (replaces text, keeps bboxes). OpenAI chat uses a
  vision model + image; Anthropic/Gemini may take a PDF page `BinaryContent`
  directly.
- [ ] **Step 3:** Implement; render each page **once** at a fixed DPI
  (`page_render.py`, PyMuPDF/pdfium2) and crop all its table/formula regions from
  that raster; dispatch the per-region `extract_structured` vision calls
  **concurrently** (bounded gather); cap regions per article for cost; gate behind
  `VISION_TABLE_PASS`. Wire into `DocumentParsingService` after the layout parse,
  table/formula regions only. Run → PASS. Commit
  `feat(parsing): vision table pass via pydantic-ai multimodal`.

---

## Follow-up plan

Everything that *consumes* the blocks this plan produces lives in
`docs/superpowers/plans/2026-06-19-grounded-extraction-and-hitl-highlight.md`:
extraction sourcing from blocks (retiring the 15k truncation), evidence anchoring and
verbatim verification, the backfill of already-ingested articles, the
dead-schema/`pdf-lib` cleanup, the reviewer click-to-highlight UI, and flipping
ADR 0011 to `accepted`. That plan depends on this one having populated
`article_text_blocks`.

---

## Self-Review

- **Spec coverage (the decisions this plan owns):** all input types → Phases 1–2
  (PDF, OCR, JATS, supplementary); vision/Claude → Phase 3; cost tradeoff → the
  Phase 0 bake-off + budget gate; extract-once-at-ingest + persist → Phase 1;
  self-host on Railway (PHI) → in-worker parser, no egress except the gated,
  region-scoped vision call. The bbox-anchoring, verbatim-verification, and
  highlight-UI decisions are delivered by the follow-up plan, on top of the blocks
  produced here.
- **Reuse:** writes the existing `ArticleTextBlock` schema; no new tables (status
  on `ArticleFile.extraction_status`); the read path is untouched.
- **Layering/risk:** the parser is a `DocumentParser` adapter in
  `infrastructure/parsing/` (mirroring `StorageAdapter`), built by
  `create_document_parser()` and injected into the worker-side service; the vision
  pass adds no SDK divergence — it rides `extract_structured()` via pydantic-ai
  multimodal input (verified on the pinned 1.107). Char offsets are per-page in
  `block_index` order (single source of truth in `concat_page_text`, reused
  downstream). The optional LlamaParse backend is the only cloud-egress path and is
  privacy-gated by the factory to non-PHI / BAA.
- **Gated/live:** Phase 0 needs real (possibly PHI) papers — handle on an approved
  data surface, not a public bucket.
- **Ordering:** Phase 0 gates parser-specific code in Phase 1; Phases 2–3 layer
  onto Phase 1's service. The follow-up plan begins once blocks are populated.

## Markdown co-product (ADR-0013)

Markdown is a co-product of the SAME parse, not a second pipeline — full decision
in **ADR-0013**. This plan's hooks:

- **Phase 0 (Task 0.2):** add the free block-projection (PyMuPDF / `pymupdf4llm`
  reference) to the bake-off slate, judged on structure per Task 0.2's metric.
- **Capture native markdown for free** where the locked backend already emits it:
  LlamaParse `markdown` from the `expand=['markdown']` Task 1.6 fetches (today
  discarded), or Docling `export_to_markdown()` off the same `convert()` — kept as
  a merge aid for assembling blocks, which stay the offset/`bbox` source of truth.
- The "No new tables required" line above holds for BLOCKS; the enriched markdown
  tier's one `article_files` column is specced in the grounded-extraction plan.
