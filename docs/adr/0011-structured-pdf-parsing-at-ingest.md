---
status: proposed
last_reviewed: 2026-06-18
owner: '@raphaelfh'
adr_number: '0011'
---

# Structured PDF parsing at ingest with grounded extraction evidence

> **Status:** Proposed · Date: 2026-06-18 · Deciders: @raphaelfh
> **Supersedes:** N/A · **Superseded by:** N/A

## Context and Problem Statement

prumo extracts structured fields from clinical and medical research papers
with a human-in-the-loop (HITL) reviewer in the loop. Today the document path
is lossy at both ends. Ingestion (Zotero only — there is no direct-upload
endpoint) stores the PDF as a blob in Supabase Storage and nothing else. Text
is then extracted *lazily inside the extraction Celery task* with
`pypdf.PdfReader.extract_text()`, producing a flat string with `[Page N]`
separators that is **discarded after the run**
(`app/services/pdf_processor.py`, `app/services/section_extraction_service.py`).
That string is **truncated at 15,000 characters** before the prompt at three
sites (`section_extraction`, `quality_assessment`, `model_identification` via
`app/llm/prompts/__init__.py`) and sent to OpenAI `gpt-4o-mini`
(`app/llm/provider.py`). There is no OCR, no table or figure structure, no
layout, and no retrieval — `extract_text_chunked()` and `detect_sections()`
exist but have no callers.

The HITL side is equally thin. Each extracted value carries an
`ExtractionEvidence` row with `text_content` + `page_number`, but `position`
is written as `{}` and the only validation
(`evidence_is_plausible` in `app/llm/validators.py`) checks non-emptiness — it
never verifies the quoted text actually appears in the source, so hallucinated
citations pass. The reviewer sees the quote as a blockquote with a page badge
and **no way to jump to or highlight** the source location.

A substrate for fixing this already exists but is unused. The
2026-04-28 PDF-viewer database spec landed `article_text_blocks` (per-page
blocks with `char_start`/`char_end`, `bbox`, and a closed `block_type` set;
migration `0006`), the `PositionV1` citation-anchor schemas
(`PDFRect`, `PDFTextRange`, `Text`/`Region`/`HybridCitationAnchor` in
`app/schemas/extraction.py`), and `citation_read_service.py` — all fully
implemented and wired for the *read* path. What is missing is the **populating step**
(nothing fills `article_text_blocks`) and the **writer** of `position`. We need
a document representation that is faithful enough for accurate extraction from
data-dense clinical tables, IMRaD structure, figures, references and equations,
*and* carries the pixel-level provenance a reviewer needs to verify a value
against the page — for born-digital PDFs, scanned/image PDFs, PubMed Central
JATS XML, and supplementary files.

## Decision Drivers

- Extraction accuracy leads. The answer often lives in a results table that
  flat `pypdf` text destroys; the model must see structured tables, section
  hierarchy, figures and captions, references, and equations.
- Reviewer verifiability. Each value must anchor to a pixel `bbox` on the page
  for highlight-in-document review, and AI evidence must be verbatim-verified.
- PHI / data privacy. Clinical PDFs are sensitive; a path with no third-party
  data egress is strongly preferred, otherwise a BAA-gated vendor.
- Cost and latency matter, but at the per-paper scale ops burden and data
  egress dominate dollars; absolute per-article cost is deferred to the
  Validation cost model rather than asserted here.
- Reuse, don't reinvent. The `article_text_blocks` + `PositionV1` contract and
  its read path are already merged; this decision completes them.
- Architectural fit. Four-layer flow (API → Service → Repository → Model),
  Alembic-owned schema, the single `build_model()` provider doorway, and the
  Celery `worker_session()` pattern must be respected.
- All input classes in scope: born-digital, scanned (OCR), JATS/PMC XML,
  supplementary files.

## Considered Options

- Option A — Incremental text-only. Keep `pypdf`, drop the 15k truncation, add
  section-aware selection. Cheapest; no fidelity gain and no `bbox`.
- Option B — Single-pass vision LLM. Feed page images to a vision model
  (Claude / Gemini / GPT-4o) to produce markdown and extraction together.
- Option C — Commercial parse/OCR API (LlamaParse, Reducto, Mathpix, Textract,
  Azure Document Intelligence). Turnkey blocks + `bbox` + per-field provenance.
- Option D — Hybrid: a self-hosted layout parser at ingest, plus a targeted
  vision/Mathpix pass on detected table and formula regions, populating
  `article_text_blocks` with `bbox`es; a JATS/PMC fast-path; evidence anchored
  and verbatim-verified.

## Decision Outcome

Chosen option: **Option D (hybrid self-hosted parse at ingest + targeted vision
table pass)**, because the two leading requirements pull toward different
solution classes and only a hybrid satisfies both. The default parser splits on
PHI: **non-PHI projects default to LlamaParse `agentic`** (cloud,
confirmed-or-overturned by the Phase-0 bake-off, falling back to the
self-hosted winner if it loses on quality/cost/latency); **PHI projects
always use the self-hosted hybrid parser** with zero egress (fail-closed).
On the available 2024–2026 benchmarks — OmniDocBench (CVPR 2025) and recent
table/formula benchmarks, which
under-represent scanned clinical PDFs and publisher clinical-trial tables — the
pattern is consistent: general
vision LLMs lead on table, formula, and scanned-page *content* fidelity but emit
weak, unreliable spatial `bbox` provenance, while layout parsers (MinerU,
Docling) lead on `bbox` + reading order + born-digital layout but degrade on
complex merged-cell tables. Self-hosting the parser keeps PHI in-house with no egress;
the high-fidelity vision pass is scoped to detected table and formula regions
only, bounding both cost and the surface that leaves the box (and can itself be
a self-hosted open model).

Concretely, respecting the existing layering:

- **Ingest-time parse.** A new Celery task `app/worker/tasks/parsing_tasks.py`
  runs after `ArticleFile` creation (the Zotero flow today, any upload path
  later), using `worker_session()` + `run_task()` and resolving keys via
  `APIKeyService`. Parser model weights ship in the worker image or load once
  onto a Railway volume on cold start (never per task); on the self-hosted path
  (PHI projects and the non-PHI fallback) the parse runs CPU-first (Docling) and
  only adds a GPU if the bake-off shows MinerU materially wins, so the ops
  footprint is itself part of the bake-off scoring.
- **Parsing service.** `app/services/document_parsing_service.py` orchestrates:
  pick the source (JATS/PMC XML when present, else the PDF), run the **injected**
  parser to emit blocks with `bbox` + reading order + `block_type`, run the
  vision pass on table/formula regions, and write `ArticleTextBlock` rows via a
  new `BaseRepository` subclass
  (`app/repositories/article_text_block_repository.py`, `flush()` not `commit()`)
  — which becomes the table's single persistence owner, with the existing
  `article_text_block_read_service` delegating its ordered read to it. Parser
  adapters wrap external libs/APIs, so — like `StorageAdapter` — they live in
  `app/infrastructure/parsing/` (a `DocumentParser` port + concrete adapters) and
  are built by a `create_document_parser()` factory in `app/core/factories.py`
  that owns the `PARSER_BACKEND` switch and the PHI gate; the service receives the
  parser by injection. `char_start`/`char_end` are offsets **within the page's**
  concatenated text (not global); `bbox` is PDF user space matching the frontend
  `PDFRect`; unknown block types map to `paragraph`.
- **Extraction reads persisted blocks** instead of re-running `pypdf`, and
  assembles section-aware context — retiring the 15k blind truncation at all
  three prompt sites. `char_start`/`char_end` index each page's text
  concatenated in `block_index` order, and the parsing service owns that
  ordering as the single source of truth. For each value, evidence is anchored
  by locating the model's quote in a block under a defined match — Unicode NFKC
  normalization plus white-space folding, not raw byte equality (which OCR
  ligatures and smart quotes would break) — then writing a `PositionV1`
  (`TextCitationAnchor` char range, or `HybridCitationAnchor` with a `rect`)
  into `ExtractionEvidence.position`. A quote that fails to match is **flagged
  for the reviewer, not silently dropped**, extending `evidence_is_plausible`
  from its current non-emptiness check. `text_content`/`page_number` stay
  denormalized in sync with the anchor at the service layer, as
  `citation_read_service.py` already expects.
- **Provider & vision.** The pin is `pydantic-ai-slim[openai] 1.107`, which
  **already supports multimodal input**, so the table/formula vision pass rides
  the *same* `extract_structured()` path: append a page-image or PDF
  `BinaryContent` (or `ImageUrl` / `DocumentUrl`) to the run input and keep
  `NativeOutput` structured output — no direct-SDK adapter and no v2 migration.
  `build_model()` gains a `provider` argument with branches for OpenAI (current),
  Anthropic, and Google Gemini (add the `pydantic-ai-slim` `[anthropic]` /
  `[google]` extras); `ANTHROPIC_API_KEY` + a default-model setting join
  `app/core/config.py` (mirroring `OPENAI_*`) and `APIKeyService` learns an
  `anthropic` key, preserving BYOK. Native PDF-as-document input works on
  Anthropic and Gemini; for OpenAI chat, render the table region to an image.
  Services stay provider-agnostic via the single doorway.
- **Frontend** consumes the contract that already exists (`Reader.tsx`,
  `pdf-viewer/core/citation.ts`); wiring the canvas highlight is the remaining
  frontend task this decision unblocks (tracked separately).
- The final non-PHI parser (LlamaParse `agentic` vs the self-hosted
  Docling/MinerU/LiteParse winner) is **deferred to a bake-off** (see
  Validation). Already-ingested articles are backfilled by a
  one-off task; until a given article has blocks, extraction falls back to
  today's lazy `pypdf` path so nothing breaks (a temporary two-tier state).
  Re-uploading a file cascade-deletes its blocks (`ON DELETE CASCADE`).
- **Parser backends are pluggable and the default splits on PHI.** Via the
  `create_document_parser()` factory (above): **non-PHI projects default to
  LlamaParse (LlamaCloud) `agentic`** (cloud, v2 SDK `llama-cloud >= 2.1`),
  confirmed-or-overturned by the Phase-0 bake-off — it returns markdown plus
  *granular word/line/cell bounding boxes* that map onto `article_text_blocks` +
  `PositionV1` (provenance lives in that JSONL sidecar, not the markdown string;
  the SDK call, the top-left→bottom-left `bbox` Y-flip, and the item-local-offset
  caveat are in the ingest plan Task 1.6 Step 2). **PHI projects always resolve
  to a self-hosted parser** (Docling/MinerU, or the Apache-2.0 LiteParse — fully
  local, free, per-element `bbox`) with zero egress; that self-hosted winner is
  also the non-PHI fallback if LlamaParse loses the bake-off. A vision-LLM-native
  backend (page images/PDF through `extract_structured()`) rounds out the slate.
  **Privacy gate (fail-closed):** the factory routes PHI or unknown-status
  projects to the self-hosted parser and can never hand them a cloud backend (the
  `project_is_phi` policy flag is added by the ingest plan Task 1.6 Step 4; until
  then the gate fails closed). LlamaParse cloud egresses to LlamaCloud S3 (48 h
  retention, contractual no-train) and a BAA exists only on LlamaCloud's
  **Enterprise** plan (signed BAA / private cloud / self-hosted BYOC, all paid),
  so the default SaaS path is non-PHI-only.

### Consequences

- Good — one persisted artifact serves both the LLM (structured text) and the
  reviewer (`bbox` highlight); `bbox` anchoring and verbatim verification
  become possible; the 15k truncation and the extract-and-discard pattern are
  retired; PHI stays in-house.
- Good — this finishes an already-migrated schema and an already-working read
  path rather than designing new infrastructure.
- Bad — ingestion gains a heavier parse step (added latency and worker compute,
  possibly a GPU for MinerU) and a new ops surface (parser container / model
  weights to maintain on Railway).
- Bad — complex merged-cell tables remain imperfect even with the vision pass
  (a known-hard, still-open problem in table-structure recognition); human
  review of tables stays mandatory, now `bbox`-assisted rather than eliminated.
- Neutral — vision rides the existing `extract_structured()` path via
  `pydantic-ai` multimodal input (verified on the pinned 1.107), so there is no
  SDK divergence; the cost is the `[anthropic]` / `[google]` extras and a second
  provider branch in `build_model()`.
- Neutral — parser choice is deferred to a bake-off; until backfill completes,
  pre-existing articles keep working on the legacy `pypdf` path (a temporary
  two-tier experience); the dead text columns and the unused `pdf-lib`
  dependency are dropped by the grounded-extraction plan (Phase 3), which owns
  the exact column list.

## Validation

- **Parser bake-off.** Lock a labeled set of real prumo papers before scoring —
  at least ~50, balanced across born-digital, scanned, and JATS-available
  inputs — and score candidates (PyMuPDF baseline, Docling, MinerU, LiteParse,
  plus the LlamaParse `agentic` API) on table fidelity (TEDS plus an LLM-judge —
  content cell-F1 mis-ranks structure; see the pilot run
  `docs/superpowers/quality-runs/2026-06-19-parsing-bakeoff-pilot.md`),
  section/figure/reference/equation
  recovery, `bbox` correctness, and per-article ops cost and latency. Table
  fidelity is the primary metric; `bbox` correctness breaks ties; ground truth
  is labeled by a domain reviewer. Public leaderboards (OmniDocBench and the
  recent table benchmarks) inform but do not decide, since they under-represent
  scanned clinical PDFs and publisher clinical-trial tables.
- **Quality and cost gate.** Set a table-fidelity target on the clinical subset
  (improve on the chosen parser's no-vision baseline by an agreed margin) and a
  per-article cost and latency budget; product and engineering sign off on both
  before the parser is locked.
- **Tests.** Unit/integration cover parser → `ArticleTextBlock` population
  (per-page offsets in `block_index` order, `block_type` mapping, RLS); the full
  anchoring round-trip (parse → flush → extract → anchor → read) asserting the
  anchor char range maps back to the correct block text and `PositionV1`
  validates via `parse_position` with camelCase out of `citation_read_service.py`;
  and quote-match edge cases (ligatures, smart quotes, and a planted
  hallucinated quote that must be flagged).
- **End-to-end.** A reviewer clicks an AI value and the PDF scrolls to and
  highlights the anchored `bbox`.

## Pros and Cons of the Options

### Option A — incremental text-only

- Good — minimal change; no new ops or provider surface.
- Bad — no table/figure/layout fidelity and no `bbox`; fails both leading
  drivers. Removing truncation alone cannot fix accuracy on tabular answers.

### Option B — single-pass vision LLM

- Good — best table/formula content fidelity; handles scans natively; one model
  call produces text and a first-pass extraction.
- Bad — weak, unreliable spatial provenance, so `bbox` highlighting must be
  reconstructed anyway; sends whole clinical PDFs to a third party (PHI egress)
  unless a self-hosted open VLM is run.

### Option C — commercial parse/OCR API

- Good — turnkey blocks, `bbox`, and per-field provenance (LlamaParse granular
  bounding boxes; Reducto two-way highlight); strongest table/formula results
  fastest; least engineering.
- Bad — per-page cost and vendor lock; clinical content requires a BAA and a
  data-egress review; provenance evidence is largely vendor-self-reported.

### Option D — hybrid self-hosted parse + targeted vision table pass

- Good — satisfies accuracy *and* `bbox` provenance; keeps PHI in-house; bounds
  the vision pass to table/formula regions; reuses the merged contract.
- Bad — the most moving parts (parser ops, a second provider, region routing)
  and merged-cell tables still need human review.

## More Information

- Schema-landing prerequisite (already merged):
  `docs/superpowers/specs/2026-04-28-pdf-viewer-database-requirements.md`.
- Implementation plans:
  `docs/superpowers/plans/2026-06-19-structured-pdf-parsing-at-ingest.md`
  (parse at ingest → persist blocks) and
  `docs/superpowers/plans/2026-06-19-grounded-extraction-and-hitl-highlight.md`
  (consume blocks → anchor, verify, highlight).
- Downstream artifact: the **markdown representation** of a paper (a projection
  of these blocks — free default + config-gated vision-enriched tier — used as an
  LLM-extraction input and a viewer option alongside the PDF) is **ADR 0013**
  (`docs/adr/0013-dual-tier-markdown-representation.md`). It reuses this ADR's
  parser factory, `PARSER_BACKEND` switch, and PHI gate; blocks remain the
  offset/`bbox` source of truth and markdown is downstream of them.
- Canonical schema and run lifecycle:
  `docs/reference/extraction-hitl-architecture.md`.
- Target contract in code: `ArticleTextBlock` (`app/models/article.py`),
  citation anchors + `PositionV1` + `parse_position` (`app/schemas/extraction.py`),
  `app/services/citation_read_service.py`, migration `0006`.
- Current lossy path: `app/services/pdf_processor.py`,
  `app/services/section_extraction_service.py`, `app/llm/prompts/__init__.py`
  (the 15k truncation), `app/llm/provider.py`, `app/llm/validators.py`.
- Provider doorway and worker pattern: `app/llm/provider.py`,
  `app/core/config.py`, `app/worker/tasks/extraction_tasks.py`,
  `app/worker/_session.py`.
- Library docs: pydantic-ai multimodal input, verified on the pinned 1.107
  (<https://ai.pydantic.dev/input/>); LlamaParse granular bounding boxes
  (<https://developers.llamaindex.ai/llamaparse/parse/examples/parse_granular_bboxes>).
- Research basis (state of the art, 2024–2026): OmniDocBench (CVPR 2025,
  <https://github.com/opendatalab/OmniDocBench>); LlamaParse granular bounding
  boxes (<https://www.llamaindex.ai/blog/announcing-granular-bounding-boxes-in-llamaparse>);
  Reducto per-field citations (<https://docs.reducto.ai/v/legacy/extraction/citations>);
  HITL in clinical NLP (<https://www.nature.com/articles/s41746-025-01840-7>).
- Related: ADR 0003 (HITL unification), ADR 0007 (single API read path),
  ADR 0009 (finalize completeness gate), ADR 0010 (REVIEW stage).
