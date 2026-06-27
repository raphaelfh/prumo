---
status: draft
last_reviewed: 2026-06-27
owner: '@raphaelfh'
---

# Grounded citation & provenance for AI extraction — design

> **Status:** Draft · Date: 2026-06-27 · Deciders: @raphaelfh
> **Relation to existing design:** Refines ADR-0011 (structured parsing at
> ingest) and ADR-0013 (dual-tier markdown), and builds on the shipped
> stored-markdown ingestion + deterministic citation highlight
> ([2026-06-24 spec](2026-06-24-markdown-ingestion-and-citation-highlight-design.md)).
> It adds (1) an **evidence-support (entailment) verification layer**, (2)
> **multiple citations per value** (primary + corroborating), (3) **table
> cell-level** and **figure-caption** provenance, and (4) a **citation eval
> harness**. This document supersedes an earlier internal proposal (block_id
> made authoritative, deterministic surface-match corroboration, pymupdf4llm
> parser, retries lowered to 0–1) that an adversarial review reversed; the
> reversals are recorded in [§9](#9-rejected-and-revised-from-the-first-proposal).

## 1. Context and problem

prumo extracts structured fields from scientific/clinical PDFs in a
human-in-the-loop (HITL) review product. For every extracted value the
reviewer must be able to see **exactly where it came from**, and trust that
the cited source actually **supports** the value.

Today (verified in code):

- Each field returns a single `evidence: {text, page_number}`
  ([`schema.py`](../../../backend/app/llm/schema.py)).
- `build_anchor()` fuzzy-matches the quote to a block and produces a
  `PositionV1` anchor (text | region | hybrid) carrying `block_ids`
  ([`evidence_anchor_service.py`](../../../backend/app/services/evidence_anchor_service.py)).
- The `verified` flag is derived by `evidence_is_grounded()` and means only
  **"the quote anchors to a block"** — i.e. the characters exist on the page
  ([`validators.py`](../../../backend/app/llm/validators.py)).
- The reader (`frontend/pdf-viewer/`) locates by `(page, block_index)` first,
  then fuzzy quote; the highlight is **block-level flash**
  ([`readerLocate.ts`](../../../frontend/pdf-viewer/primitives/readerLocate.ts)).
- The default parser is raw PyMuPDF (`fitz`), **text-only**: it drops images
  and collapses tables to paragraph text via a heuristic column guesser
  ([`pymupdf_parser.py`](../../../backend/app/infrastructure/parsing/pymupdf_parser.py),
  [`base.py`](../../../backend/app/infrastructure/parsing/base.py)).
- `extraction_evidence` is already 1:N per proposal (FK `proposal_record_id`)
  ([`extraction.py`](../../../backend/app/models/extraction.py)).

**The core problem the adversarial review surfaced:** "the quote exists in the
source" is not "the source supports the value." In a clinical HITL tool the
highlight *is* the safety mechanism, so a green `verified` that only means
"characters are on the page" launders wrong extractions. This is the gap the
entire attributed-generation literature exists to close (ALCE, AIS/AutoAIS,
VeriCite, FActScore).

## 2. Goals and non-goals

**Goals**

- Every extracted value carries verifiable provenance whose `verified` flag
  means **the cited source entails the value**, not merely "quote exists."
- Support **multiple citations** per value: one primary (where the model read
  it) plus corroborating spans when they genuinely support the value.
- Provenance for **prose, tables (cell-level), and figures (caption-level)**.
- A **citation eval harness** that makes "better/SOTA citation" falsifiable and
  gates every quality-affecting change.
- Stay on the current stack: pydantic-ai + NativeOutput on OpenAI
  `gpt-4o-mini`; structured output preserved; moderate added cost/latency.

**Non-goals (this cycle)**

- Reading values out of figure **content** (vision/multimodal) — deferred; we
  ship figure **provenance** only.
- Switching LLM provider or framework.
- A CPU NLI cross-encoder (DeBERTa/MiniCheck) — deferred to avoid the
  torch/lean-image bloat class; the entailment gate uses an LLM judge first.
- Cross-file corroboration beyond the single main PDF (documented limitation).

## 3. Decisions (adversarially reviewed)

| # | Decision | Call |
|---|----------|------|
| D1 | Keep pydantic-ai + NativeOutput; do not adopt Instructor | Keep |
| D2 | Verbatim quote is authoritative for location; block_id is an advisory hint + agreement check; `output_retries ≥ 1`; block_id input-injection behind an OFF-by-default flag | Revised |
| D3 | Multiple citations: LLM emits primary; corroboration is **entailment-gated** or shipped primary-only in v1 (never co-occurrence-as-agreement) | Revised |
| D4 | `verified` means **entailed**; add an entailment gate; "quote exists" is only a pre-filter | New |
| D5 | Stop heuristic table columns; carry the parser's native cell grid; cite tables by `(block_id, row, col)` | Revised |
| D6 | Figures: caption-level citation + an un-groundable-value flag; vision deferred | Revised |
| D7 | Drop pymupdf4llm; extend in-house `fitz` for geometry (T1); Docling/LlamaParse for table/figure-heavy docs (T2) | Revised |
| D8 | Config: Pydantic-validated reads (no silent coercion), snapshot resolved config onto the run, parser provenance on the article, PHI gate binds tier | Revised |
| D9 | Highlight via CSS Custom Highlight API; locate the quote in the **rendered DOM** (never project offsets); block-flash floor | Revised |
| — | Abstention first-class (`found` / `not_found` / `ambiguous`); abstain, do not hard-fail-and-reask | New |
| — | Build the citation eval harness first; gate every quality change on it | New |

## 4. Architecture

### 4.1 Verification layers (the heart)

Three layers, cheapest first; the trust flag is set only by the last:

1. **Existence pre-filter (keep):** `build_anchor()` confirms the quote
   anchors to a block and self-corrects it to the exact matched substring.
   Kills fabricated locations. Cheap, deterministic, no LLM.
2. **Entailment gate (new):** a separate non-structured `gpt-4o-mini` judge
   call — premise = the cited block + immediate neighbours, hypothesis =
   `"{field_label} = {value}"` — returns `entailed | weak | unsupported` plus
   the minimal supporting span. Runs **outside** the extraction retry loop,
   fanned out under pydantic-ai `max_concurrency`.
3. **Deterministic value check (new, for numeric/date/unit fields):** a
   normalized-equality check that the value actually appears in the cited
   span/cell (e.g. `12.5%` ≡ `0.125` ≡ `12.5 percent`). NLI alone is
   unreliable on exact numbers; this is the dominant clinical field class.

`verified` (and the reader's green state) is set **only when the entailment
gate returns `entailed`** (and, for numeric fields, the value check passes).
`weak`/`unsupported` surface in amber and route to HITL — never a green check
on a located-only span.

### 4.2 Evidence data model

`extraction_evidence` is already 1:N. Add columns (one Alembic migration, id
≤ 32 chars, `server_default` backfilling legacy rows):

- `evidence_role` enum: `primary | corroborating`.
- `attribution_label` enum: `entailed | weak | unsupported`.
- `evidence_kind` enum: `verbatim | derived | absent` (figure/derived spans).
- `match_method` text: `llm | anchor | deterministic` (provenance-of-provenance).
- `rank` int: display order within a value.
- Optional table coords (see [§4.6](#46-tables)): `row_index`, `col_index`,
  `row_span`, `col_span`, `is_header` — on `ArticleTextBlock`, not on evidence.

Confirm corroborating rows still satisfy the existing `workflow_target_present`
CHECK. Update
[`extraction-hitl-architecture.md`](../../reference/extraction-hitl-architecture.md)
and bump the head-pin in `test_migration_roundtrip`.

### 4.3 LLM output contract

```python
class Evidence(BaseModel):
    quote: str               # short verbatim span (≤ ~125 chars); AUTHORITATIVE for location
    block_id: str | None     # advisory hint, only when block_id injection is ON (validated ∈ injected set)
    page_number: int | None  # resolved from the anchored block when omitted

class FieldExtraction(BaseModel):
    status: Literal["found", "not_found", "ambiguous"]
    value: ... | None        # null when not found
    confidence: float
    reasoning: str
    evidence: list[Evidence]  # 0 when not_found; 1..N (cap ~3) when found
```

- **Abstention is first-class.** When the model cannot find the value it
  returns `status="not_found"`, `value=null`, `evidence=[]`. When zero
  evidence survives verification we **abstain → `not_found`/flag**, we do not
  hard-fail-and-reask.
- `output_retries` stays **≥ 1** — the existing `evidence_is_plausible`
  `ModelRetry` still catches empty/unfindable quotes.
- The big article text re-sent per call already benefits from OpenAI prefix
  caching; keep the article a stable prefix.

### 4.4 Anchoring and resolution (quote-authoritative)

- The verbatim `quote` (run through `build_anchor()`) is the **source of
  truth** for location. `block_id` is an advisory hint and an **agreement
  check**: if the quote anchors to a different block than the model named,
  lower confidence / flag for HITL.
- **block_id input injection** (prefix each block with a collision-checked
  marker so the model can name a block) ships behind a `citation.strategy`
  flag, **OFF by default**, pending an offline ablation on the eval harness.
  Returned ids are validated against the exact injected set (prompt-injection
  hardening: strip literal marker syntax from raw block text; reject unknown
  ids; add a data-not-instructions system note).

### 4.5 Corroboration (multiple citations)

- The LLM emits the **primary** span(s). Corroborating spans are **not**
  attached by raw surface match — that manufactures the exact ALCE precision
  defect (the same `12`, `p<0.05`, `[12]` appearing in unrelated contexts).
- Two acceptable shapes; pick per phase:
  - **v1 (simplest, recommended start): primary-only.** Defer corroboration
    until reviewers ask.
  - **v2: entailment-gated corroboration.** A deterministic candidate search
    (normalized value/quote across other blocks) **feeds** the entailment gate
    ([§4.1](#41-verification-layers-the-heart)); only `entailed` candidates
    become `corroborating` rows.
- Dedupe by `(block_id, char-range overlap)`; rank primary-then-corroborating
  by value-match exactness + `block_type` priority (table/abstract > mention).
- When a corroborating candidate's normalized value **differs** from the
  primary beyond tolerance, record it as **conflicting** (a high-value
  reviewer signal: abstract "12 months" vs table "11.8"), not corroborating.

### 4.6 Tables

- Stop reconstructing columns with `_infer_column_count`. Thread the parser's
  **native cell grid** into the block model: `row_index`, `col_index`,
  `row_span`, `col_span`, `is_header` on `ArticleTextBlock`.
- Serialize tables for the LLM as HTML or cell-addressed key/value (better
  extraction than GFM pipe tables for merged/multi-row headers); keep a GFM
  rendering for the reader.
- Cite a table value by `(block_id, row, col)`; the verifier checks the cited
  cell contains the value (normalized). Highlight the **cell**, not the table.

### 4.7 Figures

- Rename the scope to **figure-caption citation** until an image/figure block
  type and a region-overlay primitive exist. Caption text is real, citable
  text and is what humans cite.
- Add an **un-groundable-value flag**: when a value plausibly lives only in a
  figure ("value lives in a figure; not text-grounded — human verification
  required"), surface it explicitly instead of pretending a text citation.
- Figure **content** extraction (vision) stays deferred behind named gates.

### 4.8 Parser

- **Drop pymupdf4llm** — its only net-new feature is a markdown serializer
  that breaks the ADR-0013 byte-identical "one serializer shared by prompt and
  reader" invariant (already rejected in ADR-0013).
- **T1 (default):** extend the in-house `PymupdfParser` with native `fitz`
  geometry — `find_tables` (text-strategy fallback), `get_image_rects`,
  `get_drawings`/`cluster_drawings` (vector flowchart regions), `rawdict` for
  word-level bbox — while keeping `render_blocks_to_markdown` as the **sole**
  serializer. Zero new dependency, PHI-safe (local).
- **T2:** the already-wired Docling / LlamaParse tiers for table/figure-heavy
  docs (cell grid + granular bboxes). Validate on a clinical-table corpus
  before changing any default — silent collapse-to-text is the failure mode.

### 4.9 Config

- A validated, project-level default for citation/parser config lives in
  `Project.settings`, but reads go through a **Pydantic v2 model**
  (explicit default / error — no silent JSONB coercion as in
  `parser_settings_service.py` today).
- **Snapshot the resolved config onto the run** (reuse `hitl_config_snapshot`)
  so the editable default never equals "what actually ran" — a clinical-audit
  requirement.
- Record **parser provenance** (`parser_tier`, parser version) on the article
  / parse record — parser selection is per-article-ingest, not per-run.
- The existing fail-closed **PHI gate binds tier selection**: a PHI project
  cannot select a cloud tier regardless of `Project.settings`. block_id
  injection and corroboration search are 100% local. Add a test asserting a
  PHI project rejects cloud tiers.

### 4.10 Frontend highlight

- Adopt the **CSS Custom Highlight API** (`Highlight` + `Range` +
  `::highlight()`) — no DOM mutation, safe with the no-raw markdown renderer,
  works around KaTeX/mermaid subtrees. Baseline since mid-2025; keep the
  existing **block-flash as the always-correct floor**.
- Compute `Range`s by locating the verbatim `quote` in the **rendered DOM**
  (TreeWalker + an offset table, identical normalization on both sides).
  **Never** map projection/source offsets to the rendered DOM.
- Char-span highlight for prose; cell highlight for tables; region overlay
  (existing `PrumoPdfViewer`) for figures. Invariant test: the shown span's
  `textContent` equals the stored quote, else fall back to block-flash.

### 4.11 Eval harness (gate)

- Reuse the `parsing_bakeoff` scaffold. Gold-label 20–50 open-access PMC/PLOS
  papers (no PHI) with `(field → value + supporting span)`.
- Metrics: value accuracy, **citation precision** (ALCE leave-one-out
  entailment), citation **recall**, anchor-resolution rate, corroboration
  false-positive rate, abstention correctness.
- Produce an old-path vs new-path delta table; wire a smoke subset into CI.
- **Every quality-affecting change** (entailment gate, block_id flag,
  multi-evidence, table grid, parser geometry) is gated on this harness —
  per the CLAUDE.md Iron Law (evidence before "done").

## 5. Phasing

Each phase ships value independently and is gated on the eval harness.

- **Phase 0 — measurement + trust boundary (the SOTA core).** Eval harness
  ([§4.11](#411-eval-harness-gate)) + entailment gate
  ([§4.1](#41-verification-layers-the-heart)) + redefine `verified` = entailed
  + abstention contract ([§4.3](#43-llm-output-contract)). No new provenance
  surface; this is the highest-leverage correctness fix.
- **Phase 1 — multiple citations (prose).** Evidence→list + role/label/kind
  columns + migration/backfill ([§4.2](#42-evidence-data-model)) + primary
  citations end-to-end + UI multi-citation render + config hardening
  ([§4.9](#49-config)). Corroboration starts **primary-only**; entailment-gated
  corroboration is the opt-in v2.
- **Phase 2 — block_id grounding + precise highlight (prose).** block_id
  advisory + agreement check ([§4.4](#44-anchoring-and-resolution-quote-authoritative))
  behind the flag, validated on the harness + CSS Custom Highlight API span
  highlight ([§4.10](#410-frontend-highlight)).
- **Phase 3 — tables.** Native cell grid + `(block_id, row, col)` citation +
  cell highlight ([§4.6](#46-tables)); parser geometry T1
  ([§4.8](#48-parser)).
- **Phase 4 — figures.** Figure-caption citation + un-groundable-value flag +
  region overlay ([§4.7](#47-figures)); T2 parser for figure-heavy docs.

## 6. Testing strategy

- Backend (pytest, interleaved per layer): entailment-gate judge wiring (mock
  the LLM judge; assert flag mapping `entailed/weak/unsupported`); deterministic
  numeric value check; evidence-list persistence with role/label/kind + N rows;
  migration + backfill of legacy rows to `primary`; abstention path
  (`not_found`, no hard-fail); PHI project rejects cloud tiers; corroboration
  conflict detection.
- Frontend (Vitest/MSW): multi-citation render (primary + "also cited (n)");
  `readerLocate` per block type; CSS-highlight invariant (shown span ==
  stored quote, else block-flash); legacy single-evidence rows render as a
  length-1 list.
- Eval harness: ALCE precision/recall + accuracy delta, old vs new, as the
  ship gate; smoke subset in CI.

## 7. Risks and open questions

- **Entailment-judge latency/cost:** one extra `gpt-4o-mini` call per
  verified field. Mitigate with `max_concurrency`, batch by article, and only
  judge fields with a found value. Measure on the harness before enabling by
  default.
- **Corroboration latency** on the CPU-only worker: build one normalized
  inverted index per article (value-token → block_ids), reuse across fields,
  short-circuit on exact-normalized match before fuzzy, hard iteration ceiling
  that degrades to primary-only; add a Logfire span.
- **Backward compatibility** single→list across read service, API envelope,
  reader, export: return list-always (length 1 for legacy); typed response
  model (no `ApiResponse[dict]`); bump the TanStack query key if cached state
  would be stale.
- **Recall blind spot:** the assembler silently drops whole sections under
  budget and 14-field chunking has no cross-chunk coverage check. Surface
  `AssemblyInfo.truncated/dropped` per field; assert every required field lands
  in exactly one chunk; track null-rate per field.
- **Multi-file articles:** `build_prompt_input` anchors a single
  `get_latest_pdf`; cross-file corroboration is out of scope this cycle —
  namespace block ids by file (`f3:b12`) later, or document single-main-file
  as the limitation.
- **Confidence calibration:** verbalized confidence is poorly calibrated;
  prefer grounding-derived signals (entailment label) for HITL triage; treat
  self-consistency only as a tie-breaker, not a displayed score.

## 8. What held up (kept with confidence)

- pydantic-ai + NativeOutput (100% schema compliance lane); Anthropic
  Citations correctly ruled out (incompatible with structured output).
- The 1:N `extraction_evidence` model + primary/corroborating concept — only
  the *population* mechanism needed revision.
- **Block-level** locate as the citation granularity (finer spans degrade
  attribution quality); char-span is presentation-only.
- Deferring figure-content vision on `gpt-4o-mini`.
- Markdown-for-prose + deterministic resolution over the model's say-so; the
  existence check as a pre-filter.
- The single shared serialization codepath (ADR-0013).

## 9. Rejected and revised from the first proposal

- **block_id authoritative → reversed.** Quote stays authoritative for
  location; block_id is advisory + agreement check.
- **`output_retries` 0–1 → kept ≥ 1.**
- **Deterministic surface-match corroboration by default → removed.**
  Corroboration is entailment-gated or deferred; co-occurrence is never shown
  as agreement.
- **"quote exists" as grounding → replaced** by the entailment gate
  ([§4.1](#41-verification-layers-the-heart)).
- **pymupdf4llm parser → dropped** (breaks the ADR-0013 single-serializer
  invariant); extend in-house `fitz` instead.
- **GFM heuristic table columns → dropped** in favour of the native cell grid.
- **"figure provenance" → narrowed** to figure-caption citation +
  un-groundable-value flag.

## 10. Sources

- ALCE — [Enabling Large Language Models to Generate Text with Citations](https://arxiv.org/abs/2305.14627)
- VeriCite — [arxiv 2510.11394](https://arxiv.org/abs/2510.11394)
- AttributionBench — [arxiv 2402.15089](https://arxiv.org/abs/2402.15089)
- "Are Finer Citations Always Better?" — [arxiv 2604.01432](https://arxiv.org/abs/2604.01432)
- Table-format impact — [Table Meets LLM, arxiv 2305.13062](https://arxiv.org/abs/2305.13062)
- MiniCheck (deferred CPU option) — [arxiv 2404.10774](https://arxiv.org/abs/2404.10774)
- [Anthropic Citations API](https://platform.claude.com/docs/en/build-with-claude/citations)
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
