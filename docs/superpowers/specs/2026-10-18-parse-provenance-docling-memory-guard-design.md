---
status: approved
last_reviewed: 2026-10-18
owner: '@raphaelfh'
---

# Docling: decide by bake-off, then isolate or remove — design

> The brief was "optimize how prumo converts PDFs with docling and where to
> host it". The measured answer is that **docling does not run in production**:
> every project is on `auto`, which resolves to LlamaParse (keyed) or PyMuPDF.
> Docling is an opt-in path with zero traffic that still costs ~1.7 GB of torch
> and model weights in every image, and would need 3–6.5 GB of RAM per document
> if anyone opted in. Tuning or re-hosting a path nobody uses is premature. This
> spec instead (1) records parse provenance, which is missing for every parser
> today (constitution §IX), (2) runs a pre-registered PyMuPDF-vs-docling bake-off
> on structure-aware metrics, and (3) takes exactly one of two pre-written
> branches on the result: **isolate docling in its own service** or **delete it**.

## 1. Measured baseline

### 1.1 Production (Supabase `prumo`, Railway `prumo/production`, 2026-10-18)

| Fact | Value |
| --- | --- |
| Projects / parser preference | 5 / all unset → `auto` |
| `llm_connections` with `llama_cloud` | 1 of 2 |
| `article_files` by status | 23 `parsed`, 0 `parse_failed`, 0 `pending` (last 2026-09-16) |
| Pages per parsed file | 4–23 (18 of 23 in 10–17) |
| `table_cell` blocks with native grid | 1,574 |
| Worker, last 7 days | RAM avg 0.45 GB / max 0.51 GB; CPU avg ≈ 0 |
| Web, last 7 days | RAM avg 0.32 GB / max 0.33 GB |
| Timeouts (600 s) / OOM attributable to parsing | none observed |

Which parser produced each of the 23 files is **unknowable**: `article_files`
records no parser, version or options. That is the first defect this spec fixes.
The 2026-10-16 outage is not explained by parsing load (worker idles at
~0.5 GB); its cause stays with the session that restored the stack.

### 1.2 Local benchmark (Apple M5 Pro, 18 cores; docling 2.104.0, OCR off, CPU)

Script: one fresh process per row; "1st" includes model load, "warm" reuses the
same `DocumentConverter`. Railway shared vCPUs are expected to be 2–3× slower;
memory is the transferable number.

| PDF | Pages | PyMuPDF (text + `find_tables`) | docling FAST 1st / warm | docling peak RSS |
| --- | ---: | ---: | ---: | ---: |
| J Gen Intern Med (11606) | 5 | 1.1 s | 4.1 / 2.5 s | 3.1 GB |
| BMJ 2023 | 14 | 2.8 s | 9.2 / 8.0 s | 3.3 GB |
| Nature 2024 (41586) | 23 | 5.8 s | 14.9 / 13.7 s | 5.5 GB |
| npj Digit Med (48 p) | 48 | 5.1 s | 18.4 / 16.7 s | 6.5 GB |
| Scanned (6 BMJ pages rasterized @150 dpi) | 6 | 0 chars | 0 text items | 3.1 GB |

Option sweep on the BMJ paper (docling, warm convert):

| Variant | Warm convert | Δ vs FAST/4 threads |
| --- | ---: | ---: |
| FAST, `num_threads=1` | 9.2 s | +15% |
| FAST, `num_threads=4` (baseline) | 8.0 s | — |
| FAST, `num_threads=8` | 8.4 s | +5% |
| ACCURATE TableFormer | 10.8 s | +35% |
| No table structure | 4.9 s | −39% (and tables lose their grid) |

Cold `import docling` + pipeline build: 3–22 s (22 s on a cold disk cache).

**Reading.** Wall time is not the bottleneck: the longest paper is ~20 s
locally, ~60 s at a pessimistic 3× on Railway, against a 600 s soft limit.
**Memory is.** Prefork concurrency 2 means two children can each hold 3–6.5 GB,
so a docling opt-in on the current 8 GB worker can OOM-kill the container that
also runs extractions, imports and exports. Thread count barely matters; a
per-process converter singleton saves 1–2 s per document; TableFormer is ~40%
of the cost and is the reason docling exists here. Neither parser recovers text
from an image-only PDF with OCR off — PyMuPDF yields nothing, docling yields
nothing and `DoclingParser.parse` raises `"docling produced no text blocks"`.

### 1.3 Answers to the brief's questions

1. **Baseline** — §1.1–1.2. No timeouts or failures in prod; docling has no
   prod traffic; docling's risk is RAM, not time.
2. **docling tuning** — keep FAST + cell matching, OCR off for born-digital;
   threads are noise; singleton is a small win; ACCURATE costs +35% and is only
   worth it if the bake-off shows FAST loses table structure; `images_scale`
   and picture work are already minimal (no picture classifier, no page images
   kept). Applied only in branch A (§4).
3. **Output shape** — already settled by ADR-0013 and the code:
   `article_text_blocks` are the source of truth for locators and bbox;
   `article_files.content_markdown` is a projection written in the same
   transaction with `content_version`. No Markdown files in Storage. No change.
4. **Scanned PDFs** — today unsupported by every self-hosted path. The bake-off
   includes a scanned subset and a docling-with-OCR variant (onnxruntime
   RapidOCR) so the gate can decide whether OCR routing earns its place (§3.3).
5. **Hosting** — only matters if docling wins; decided in branch A (§4.3).
6. **Image slimming** — `web` RAM is unaffected (docling is lazy-imported, web
   holds 0.32 GB); the win is image size and deploy time. Branch A splits the
   images; branch B removes the weight outright.
7. **Quality bar** — §3.

## 2. Phase 1a — parse provenance (ships regardless of the gate)

Constitution §IX requires knowing which parser, version and options produced a
document's blocks. Today nothing records it, and `FallbackDocumentParser` can
silently swap LlamaParse for PyMuPDF.

- **Port.** `DocumentParser` gains a read-only `provenance` returning
  `ParseProvenance` (`backend: str`, `version: str`, `options: dict`).
  `PymupdfParser` reports `pymupdf` + `pymupdf.VersionBind`; `DoclingParser`
  reports `docling` + its package version + the pipeline options it built
  (`do_ocr`, table mode, cell matching, device); `LlamaParseParser` reports
  `llamaparse` + tier + SDK version.
- **Fallback.** `FallbackDocumentParser.provenance` reports the parser that
  actually produced the blocks, plus `fallback_from` and the primary's error
  class, set during `parse()`.
- **Schema.** One Alembic migration adds `article_files.parse_provenance JSONB
  NULL`. `DocumentParsingService` writes it in the same transaction as the
  blocks and `content_markdown`. Existing 23 rows stay `NULL` (= unknown; no
  backfill guess).
- **Read.** Exposed on the existing article-file read schema so MCP
  `get_article` and the UI can show it; regenerate `frontend/types/api`.
- **Sibling refactor commit.** `app/schemas/parser_settings.py` says `auto`
  falls back to Docling; the code falls back to PyMuPDF. Fix the comment.

Tests: unit per adapter (`provenance` shape), fallback reports the fallback
parser and `fallback_from`, integration that a parse persists
`parse_provenance` atomically with blocks (rollback leaves both unchanged).

## 3. Phase 1b — the bake-off

Extends `backend/scripts/parsing_bakeoff/` (manifest, JATS gold, runner,
scoring already exist). Runs offline on a developer machine or a one-off
container; nothing in it ships in the app image.

### 3.1 Golden set — `pmc-oa-v1`

- **30 born-digital papers** from the PMC Open Access subset, CC-BY, each with
  JATS XML. Stratified: 12 RCTs, 8 cohort/case-control, 5 diagnostic-accuracy,
  5 systematic reviews/meta-analyses; ≥ 10 with merged-cell or multi-level
  header tables; ≥ 5 two-column layouts; ≥ 3 over 30 pages. Publishers mixed
  (PLOS, BMC, BMJ Open, Frontiers, JMIR) so no single template dominates.
- **6 scanned** — 6 of the 30 rasterized at 150 dpi to image-only PDFs (gold
  reused). Recorded as `source_type: scanned_sim`; the spec accepts that real
  scans are noisier, so a scanned win is necessary, not sufficient, for OCR in
  prod (§4.4).
- Manifest + DOI list committed under `backend/scripts/parsing_bakeoff/sets/`;
  PDFs and XML are downloaded by a fetch script into a gitignored cache, not
  committed. Pinned by PMCID and file SHA-256 so reruns are comparable.

### 3.2 Metrics

| Metric | How | Why |
| --- | --- | --- |
| **Table TEDS** (gating) | Tree-edit-distance similarity between the parser's table grid (rebuilt from `table_cell` blocks' `row_index`/`col_index`/spans) and the JATS `<table>` grid, per table, matched by caption/position; mean over gold tables, unmatched gold table = 0 | Structure, not the cell-string multiset that mis-ranked the pilot |
| Section recall | Existing `sections` scorer vs JATS `<sec><title>` | Heading recovery for section-aware prompts |
| Reading order | Kendall τ between gold paragraph order and the order of their best-matching blocks | Prompt assembly reads blocks in `block_index` order |
| Anchorability | Share of 200 sampled gold sentences (per paper ≤ 10) that match inside one block under the production NFKC + whitespace-fold rule | What the evidence anchor actually needs; this is "locator stability" made measurable |
| Text recall (scanned) | Token recall of JATS body text | Whether OCR recovers anything |
| Cost | Wall time and peak RSS per paper, on a 2-vCPU / 8 GB container | Sizing for branch A |

The existing `table_f1` proxy is still reported but never gates. An LLM-judge
pass is out of scope for v1 (YAGNI); TEDS + anchorability carry the decision.

### 3.3 Candidates

1. `pymupdf` — production `PymupdfParser`.
2. `docling-fast` — production `DoclingParser` (FAST, cell matching, OCR off).
3. `docling-accurate` — same, TableFormer ACCURATE.
4. `docling-ocr` — scanned subset only: OCR on with RapidOCR on the
   onnxruntime backend (avoids the torch PP-OCRv6 crash noted in
   `docling_parser.py`).

All candidates run through `DocumentParsingService`'s block → offset → markdown
path, so scores reflect what extraction would see.

### 3.4 Pre-registered gate

Written into the run report before the run:

- **Docling wins** if (mean TEDS of the better docling variant ≥ PyMuPDF + 0.10
  **or** `docling-ocr` text recall on `scanned_sim` ≥ 0.80 where PyMuPDF is
  ≈ 0) **and** neither section recall, reading-order τ nor anchorability
  regresses by more than 0.05 versus PyMuPDF.
- Otherwise **PyMuPDF wins**.
- Result recorded as `docs/superpowers/quality-runs/<date>-parsing-bakeoff-pmc-oa-v1.md`
  and in ADR-0011's Validation section (ADR status → accepted).

## 4. Branch A — docling wins: isolate it

### 4.1 Process

- New Celery queue `parsing`; `app.worker.tasks.parsing_tasks.*` routes there
  (today: `celery`). The general `worker` stops consuming it.
- New Railway service **`parser`**: same repo, its own image (§4.2), start
  command `celery -A app.worker.celery_app worker -Q parsing --concurrency=1
  --max-tasks-per-child=20`, memory limit sized from the bake-off's p95 peak
  RSS + 1 GB (expected 8 GB). Concurrency 1 because docling already uses
  several threads per document and RAM, not CPU, is the limit;
  `max-tasks-per-child` returns torch's arena to the OS.
- `DoclingParser` builds its `DocumentConverter` once per process (module-level
  cache keyed by the options tuple) instead of per `parse()`.
- Soft/hard limits stay 600/660 s; the bake-off's p99 wall time on the 2-vCPU
  container must be ≤ 300 s or the limits are revisited in the plan.
- `DocumentParsingService` pages through the PDF in 50-page windows via
  docling's `page_range` only if the bake-off's peak RSS on the > 30-page papers
  exceeds the service's limit; otherwise not built (YAGNI).

### 4.2 Images

- `docling` (and the `transformers` CVE floor) move to a `parser` optional
  dependency group in `backend/pyproject.toml`.
- `backend/Dockerfile` takes `ARG WITH_PARSER=0`; only `=1` installs the extra,
  pins torch to the CPU index, prefetches models to `/opt/docling-models`, and
  installs the libGL/xcb apt libs. `web` and `worker` build with `0`; `parser`
  with `1`.
- Factory guard: `create_document_parser` raises a clear configuration error
  if `docling` is requested in a process without the extra (it can only happen
  through mis-routing).
- CI builds both variants; the slim image must not import `docling` (smoke test
  `python -c "import app.main, app.worker.celery_app"` with docling absent).
- Measure: slim image size and `web` cold-deploy time before/after, recorded in
  the PR.

### 4.3 Hosting decision inside branch A

Before the plan for branch A is written, run `core:decidir-com-evidencia` with
the bake-off's measured per-page time and RSS, comparing: (b) Railway `parser`
service (default above), (c) `docling-serve` container, (d) GPU serverless
(Modal, RunPod), (e) managed parsers (LlamaParse already wired; Reducto, Mistral
OCR, Azure DI). Axes: cost per 1k pages at current volume (~25 papers/month) and
at 100×, p95 latency, cold start, table TEDS where published, data egress, ops.
At today's volume the default is (b); a different answer must beat it on the
measured numbers.

### 4.4 Default parser

If docling wins on born-digital tables, `auto` without a LlamaParse key
resolves to `docling` (today `pymupdf`), with `FallbackDocumentParser(primary=
docling, fallback=pymupdf)` so a docling crash or OOM-retry still produces
blocks — the fallback is recorded in `parse_provenance` (§2). If docling wins
only on the scanned subset, `auto` stays `pymupdf` and a text-layer probe routes
just the image-only documents (median < 50 extractable chars/page via PyMuPDF)
to `docling-ocr`; that routing is gated on a follow-up check against 5 real
scanned papers.

## 5. Branch B — PyMuPDF wins: delete docling

Dead code is deleted, not parked:

- Remove `DoclingParser`, its factory branch, the `docling` / `standard`
  values from `ParserType` and `ParserSettingsService` (stored values: none in
  prod; unknown values already normalize to `auto`), and the docling unit and
  integration tests.
- Remove `docling` and the `transformers` CVE floor from `pyproject.toml`
  (re-lock), the model prefetch, `DOCLING_ARTIFACTS_PATH` / `HF_*` env and the
  libGL apt layer from the Dockerfile, docling entries in `dependabot.yml`,
  `security-audit.yml`, `ci.yml`, `cspell-words.txt`; regenerate
  `frontend/types/api`. Tighten `backend/.vulture_baseline` in the same PR.
- Keep the bake-off harness and the `docling` candidate in it (dev-only extra),
  so the decision can be re-run.
- ADR-0011 records docling as evaluated and rejected; the self-hosted tier is
  PyMuPDF, the high-fidelity tier is LlamaParse (BYOK). Scanned PDFs stay
  unsupported without a LlamaParse key — said so in the parser-settings copy.
- Measure image size and deploy time before/after in the PR.
- Railway: worker and web limits can return from 8 vCPU / 8 GB to what §1.1
  shows they use (≤ 1 GB each) — an ops follow-up, not code.

## 6. Rollout

1. PR 1 — §2 provenance (migration, port, fallback, read schema) + sibling
   comment fix. Ships to `dev` → `main` on the normal train.
2. PR 2 — bake-off extensions (`pmc-oa-v1` set + fetch script, TEDS,
   reading-order, anchorability, `scanned_sim` rasterizer, docling variants),
   dev-only. Run it; commit the quality-run report with the gate outcome.
3. Gate decision recorded (ADR-0011 → accepted). Then exactly one of:
   - Branch A: `decidir-com-evidencia` hosting note → PR 3a (queue + service +
     image split + singleton) → PR 4a (`auto` default, if §4.4 says so).
     Railway `parser` service created before PR 3a deploys, so the `parsing`
     queue has a consumer from the first enqueue.
   - Branch B: PR 3b (deletion).

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| PMC OA papers are cleaner than what users upload | Mixed publishers, merged-cell quota; branch A §4.4 rechecks scans on real papers before OCR routing |
| `scanned_sim` rasterization is kinder than real scans | Scanned win is necessary, not sufficient (§4.4) |
| TEDS table matching between parser and JATS mis-pairs tables | Match by caption text first, page order second; report unmatched counts per parser |
| Local M5 numbers mislead sizing | Cost metric is taken on a 2-vCPU / 8 GB container (§3.2) |
| Routing parsing to a queue with no consumer | Service before code (§6); the existing startup check for unknown queues covers mis-routing |
| Branch B removes the only self-hosted OCR path | It is already disabled; nothing is lost that runs today |

## 8. Out of scope

LLM-judge table scoring; MinerU / Marker / LiteParse candidates; the vision
table pass of ADR-0011; changes to `article_text_blocks`, locators or
`content_markdown`; LlamaParse tuning.
