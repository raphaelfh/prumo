---
status: proposed
last_reviewed: 2026-06-21
owner: '@raphaelfh'
adr_number: '0013'
---

# Dual-tier markdown representation of a paper

> **Status:** Proposed · Date: 2026-06-19 · Deciders: @raphaelfh
> **Supersedes:** N/A · **Superseded by:** N/A

## Context and Problem Statement

ADR 0011 makes `article_text_blocks` (per-block text + `char_start`/`char_end` +
`bbox`) the canonical substrate for grounded extraction and for pixel-bbox
highlight. Separately we want a **markdown rendering** of each paper that (a) can
serve as an LLM-extraction input and (b) appears in the reader **as an option
alongside the PDF** — a clean, human-readable view that doubles as the model
input.

A tempting framing is "point an LLM at MarkItDown to get high-fidelity
markdown." That is **wrong for tables and layout**: MarkItDown's PDF path is
pdfminer plain text, and its `llm_client`/`llm_model` only *describe images* and
(via `markitdown-ocr`) OCR image regions — it does not improve table or section
structure. In our 8-paper bake-off MarkItDown emitted **no `#` headings** (section recall
0.000) and recovered only part of the table cells (see the pilot run). MarkItDown's only real
high-fidelity PDF route is `docintel_endpoint` (**Azure Document Intelligence**,
a paid cloud parse) — not an "LLM tier." High-fidelity markdown
comes from a **structure parser** (e.g. Docling `export_to_markdown`) or a
**vision-LLM pass** — the same engines ADR 0011 already evaluates.

Two facts constrain the design: the frontend has **no markdown renderer and no
HTML sanitizer** today (the app has zero `dangerouslySetInnerHTML`), and
`article_files` has only the dead `text_raw`/`text_html` columns that the
grounded-extraction plan is about to drop. This ADR decides how markdown is
produced, stored, consumed, and viewed — reusing ADR 0011's primitives rather
than building a parallel pipeline.

## Decision Drivers

- One source of truth: the markdown the LLM sees and the markdown the reviewer
  sees must be the *same string*, and must not drift from the blocks (the
  anchoring substrate).
- Free by default, pay only on opt-in: `MARKDOWN_TIER=free` (the `$0`
  block-projection tier, derived from blocks, no egress) is the default rendering
  tier — independent of `PARSER_BACKEND` (whose per-project setting defaults to
  `auto` per ADR 0011: LlamaParse cloud when a `llama_cloud` key is configured,
  the self-hosted Docling parser otherwise). The enriched tier is config-gated.
- Reuse, don't reinvent: ride ADR 0011's `DocumentParser`/`create_document_parser`
  factory, `PARSER_BACKEND` switch, per-project parser selection, provider
  doorway, and Phase-0 bake-off; reuse the block assembler's table serialization.
- Security: rendering parser/LLM markdown in the viewer is the app's **first
  raw-markup surface** — it must be sanitized.
- Correctness over a fidelity proxy: judge tiers by **structure** (TEDS /
  LLM-judge / section recall), never content cell-F1 — which in our bake-off
  ranked a flat dump *above* a structurally-correct grid and hid MarkItDown's
  empty section recall (figures under More Information).

## Considered Options

- Option A — MarkItDown (optionally with `llm_client`) as the markdown engine.
- Option B — A standalone markdown pipeline storing its own blob, parsed
  independently of the blocks.
- Option C — **Markdown as a projection of the block layer**: a free default
  rendered from blocks, an optional high-fidelity tier rendered from
  vision-enriched blocks.

## Decision Outcome

Chosen option: **Option C — markdown is a rendering of `article_text_blocks`,
never a competing source of truth for offsets/`bbox`.** This gives one artifact
contract (blocks own anchoring; markdown is a projection) and kills the
"two markdown generators drift" failure mode.

- **Free default tier (`$0`).** A single pure
  `render_blocks_to_markdown(blocks) -> str` (GFM tables, `#` headings from
  `heading` blocks, lists, reading order) lives beside `concat_page_text` in
  `app/infrastructure/parsing/base.py`. It is **derived on demand** (cached per
  `content_version`, recomputed only when blocks change) — no column, no drift,
  deterministic, no egress. The extraction block assembler (grounded-extraction
  plan) **calls this same function** to serialize table sections, so the prompt's
  tables and the viewer's tables are byte-identical (one table-serialization
  codepath). When Phase 0 locks a parser with good native markdown (Docling
  `export_to_markdown`, LlamaParse `markdown`), the service may use it as a merge
  aid when building blocks — but the string the viewer and prompt share is always
  the block projection, and blocks remain the offset/`bbox` source of truth.
- **Enriched tier (optional, config-gated).** The *same* renderer over
  blocks already improved by ADR 0011's region-scoped vision table pass
  (`VISION_TABLE_PASS`). Because it is non-deterministic and costs egress, it is
  **stored**: a new `article_files.markdown_enriched TEXT` plus a `markdown_tier`
  discriminator, added in a SEPARATE additive Alembic migration (revision id
  ≤ 32 chars), co-sequenced with but distinct from the migration that drops the
  dead `text_raw`/`text_html` (the dead columns are **not** repurposed —
  `text_html` implies HTML, not GFM). It reuses ADR 0011's
  `PARSER_BACKEND` + per-project parser selection verbatim — the enriched engine
  is whatever `PARSER_BACKEND` resolves to per project (**LlamaParse** `agentic`
  when a `llama_cloud` key is configured and the project has opted in, or the
  self-hosted Docling parser otherwise) — so the tier reads `PARSER_BACKEND` +
  ADR 0011's per-project selection, not a second engine switch.
- **Config.** `MARKDOWN_TIER = free | enriched` (default `free`). MarkItDown is
  **not** a tier (rationale in Context); its only high-fidelity route — Azure
  Document Intelligence — is a candidate ADR 0011 `PARSER_BACKEND`, not an "LLM
  tier."
- **Extraction input.** Blocks remain the **default** extraction input
  (section-aware, token-budgeted, `bbox`-anchored). Markdown is a supplementary
  input only if the bake-off shows it beats the assembler — we do not ship two
  competing extraction inputs by default.
- **Viewer.** The reader gains a sanitized **Markdown** rendering: the existing
  `ViewerMode = 'canvas' | 'reader'` keeps two values, but `reader` renders
  sanitized markdown (the flat per-block `<p>` dump is retired as a render
  target; blocks remain the `bbox`/offset anchor substrate). Mandatory deps:
  `react-markdown` + `remark-gfm` **and a sanitizer**. Sanitize the **stored**
  enriched tier server-side at write (`nh3`/`bleach`) so every consumer is
  covered, with `rehype-sanitize` (strict allowlist) at render as defense in
  depth. Parser/LLM markdown is **untrusted**: forbid `rehype-raw` without sanitization;
  deny `<script>`/`<iframe>`/`<object>`, event-handler attributes, and
  `javascript:`/`data:` URLs. Register `@tailwindcss/typography`. Markdown is
  fetched through a typed, BOLA-safe `GET /api/v1/article-files/{id}/markdown?tier=`
  (resolve `project_id` → `ensure_project_member()` first, `ApiResponse` + typed
  model, `apiClient` — no raw Storage URL, no `supabase.from`).
- **Highlight limitation.** Pixel-`bbox` `PositionV1` highlight is **canvas-only**.
  The markdown string is a different coordinate space than `concat_page_text`
  (markdown syntax + reordering), so the anchoring service's char offsets are
  not portable into the markdown DOM and `RegionCitationAnchor`s have no geometry
  there.
  Clicking evidence in markdown mode **switches to canvas, then highlights**, or
  falls back to a best-effort quote-substring match with an "open in PDF to
  verify position" affordance. No highlight parity is promised across modes.

### Consequences

- Good — one block-projection renderer feeds both the LLM prompt's tables and the
  viewer (no drift); the free tier is `$0`, self-hosted, no egress; reuses ADR
  0011's factory, per-project selection, bake-off, and the assembler.
- Good — ADR 0011 stays focused on the blocks/`bbox` artifact; this is a thin,
  referenced second artifact.
- Bad — the viewer markdown surface adds frontend deps (`react-markdown` +
  `remark-gfm` + a sanitizer) and the app's **first** raw-markup/XSS surface;
  sanitization + an XSS test are mandatory, not optional.
- Bad — the enriched tier adds a stored column, a cloud-egress path (opt-in),
  and non-determinism.
- Neutral — highlight is canvas-only; markdown mode degrades to switch-to-canvas
  or a best-effort quote match.

## Validation

- Tier fidelity is judged by **TEDS + an LLM-judge + section recall**, not
  content cell-F1 (which mis-ranked a flat dump above a correct grid in the
  8-paper bake-off; see `docs/superpowers/quality-runs/2026-06-19-parsing-bakeoff-pilot.md`).
  Add the free block-projection (PyMuPDF/`pymupdf4llm` reference) to the Phase-0
  bake-off slate; the enriched engine choice is gated on that same bake-off
  (likely the same engine emitting both blocks and markdown).
- Tests: `render_blocks_to_markdown` unit (deterministic GFM tables, headings,
  reading order); the assembler reuses it (one table-serialization codepath);
  a planted `<img onerror>` / `<script>` / `javascript:` link in markdown does
  **not** execute (frontend); the markdown endpoint returns 403 for a non-member
  (BOLA); axe over the markdown surface.

## Pros and Cons of the Options

### Option A — MarkItDown (± `llm_client`)

- Good — trivial to call; fast; one library for many formats.
- Bad — pdfminer text loses tables/headings (0.000 section recall in the
  bake-off); `llm_client` only captions/OCRs images, not structure; the only real
  fidelity path is paid Azure DI (cloud egress). Wrong engine for this goal.

### Option B — standalone markdown pipeline + blob

- Good — decoupled from blocks.
- Bad — a second copy that drifts from blocks; re-parses the PDF; two table
  renderings (prompt vs viewer) diverge.

### Option C — markdown as a projection of blocks

- Good — one source of truth; free tier is `$0`/derived; reuses ADR 0011 + the
  assembler; no drift between LLM input and viewer.
- Bad — pure block→markdown can merge complex cells less well than a parser's
  native markdown (mitigated: keep native markdown as an optional secondary).

## More Information

- Builds on **ADR 0011** (`docs/adr/0011-structured-pdf-parsing-at-ingest.md`):
  reuses its `DocumentParser` / `create_document_parser` factory, `PARSER_BACKEND`
  switch, per-project parser selection, provider doorway, and Phase-0 bake-off;
  the `article_text_blocks` substrate is its decision, this ADR only projects
  from it.
- Implementation plans:
  `docs/superpowers/plans/2026-06-19-structured-pdf-parsing-at-ingest.md`
  (parser emits markdown as a co-product) and
  `docs/superpowers/plans/2026-06-19-grounded-extraction-and-hitl-highlight.md`
  (renderer, storage, endpoint, viewer + sanitizer).
- Empirical basis: `docs/superpowers/quality-runs/2026-06-19-parsing-bakeoff-pilot.md`
  (the 8-paper PyMuPDF/Docling/MarkItDown run — the full bake-off scoreboard and
  the content-F1-mis-ranks-structure lesson).
- Library docs: `pymupdf4llm.to_markdown` (<https://pymupdf.readthedocs.io/en/latest/pymupdf4llm/>);
  MarkItDown `llm_client` is image-only, `docintel_endpoint` = Azure Document
  Intelligence (<https://github.com/microsoft/markitdown>).
- Related: ADR 0011 (structured parsing), ADR 0012 (manager blind review),
  ADR 0007 (single API read path), ADR 0008 (typed response payloads).
