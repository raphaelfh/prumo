---
status: draft
last_reviewed: 2026-06-27
owner: '@raphaelfh'
---

# Grounded citation & provenance for AI extraction — design

> **Status:** Draft · Date: 2026-06-27 · Deciders: @raphaelfh
> **Relation to existing design:** Refines ADR-0011 (structured parsing at
> ingest) and ADR-0013 (dual-tier markdown); builds on the shipped
> stored-markdown ingestion + markdown-first citation highlight
> ([2026-06-24 spec](2026-06-24-markdown-ingestion-and-citation-highlight-design.md)).
> Two adversarial workflows (a 44-agent design review and a 6-agent parser
> evaluation) shaped the choices here; their reversals of an earlier internal
> proposal are in [§9](#9-reversals-from-the-first-proposal).

## 1. Problem

For every extracted value a reviewer must see **where it came from** and trust
that the source **supports** the value. Today `verified` only means "the quote
anchors to a block" (the characters exist on the page), via `build_anchor()`'s
fuzzy match ([`validators.py`](../../../backend/app/llm/validators.py),
[`evidence_anchor_service.py`](../../../backend/app/services/evidence_anchor_service.py)).
In a clinical HITL tool the highlight **is** the safety mechanism, so a green
`verified` that means "quote exists" launders wrong extractions — the gap the
attributed-generation literature exists to close.

We also want: **multiple citations** per value, provenance for **tables and
figures** (not just prose), a **selectable model** with per-run transparency,
and an **eval harness** that makes "better citation" measurable.

## 2. Goals / non-goals

**Goals**

- `verified` means **the cited source entails the value**, not "quote exists".
- **Multiple citations** per value (primary + corroborating).
- Provenance for **prose (span)**, **tables (cell)**, **figures (caption/region)**.
- **Selectable model** (default `gpt-4o-mini`) with the resolved model recorded
  per run and shown in the Excel export for extraction **and** QA.
- An **eval harness** (citation precision/recall + table structure) gating every
  quality-affecting change.

**Non-goals (this cycle)**

- Reading values from figure **content** (vision) — deferred.
- Switching provider/framework; a CPU NLI cross-encoder (torch bloat).
- Cross-file corroboration beyond the main PDF.
- Relaxing the ADR-0013 single-serializer invariant.

## 3. Decisions

| # | Decision | Call |
|---|----------|------|
| D1 | Keep pydantic-ai + NativeOutput; not Instructor (it patches clients, does not use pydantic-ai) | Keep |
| D2 | Verbatim quote authoritative for location; `block_id` advisory + agreement-check; `output_retries ≥ 1`; id-injection behind an OFF-by-default flag | Revised |
| D3 | Multiple citations: LLM emits primary; corroboration is entailment-gated or shipped primary-only (never co-occurrence-as-agreement) | Revised |
| D4 | `verified` = entailed; add an entailment gate; "quote exists" is only a pre-filter | New |
| D5 | Tables: carry the parser's native cell grid (row/col + per-cell bbox); cite by `(block_id, row, col)` | Revised |
| D6 | Figures: caption citation + a `figure` region block type + an un-groundable-value flag; vision deferred | Revised |
| D7 | Parser: **pymupdf4llm default** (consume its `page_chunks` -> blocks); **Docling** (self-hosted) and **LlamaParse** (cloud, opt-in API key) as optional high-fidelity tiers; keep ADR-0013 | Revised |
| D8 | Config: Pydantic-validated reads; snapshot resolved config onto the run; cloud tier (LlamaParse) is opt-in per project via an API key | Revised |
| D9 | Highlight: CSS Custom Highlight API; locate the quote in the **rendered DOM**; block-flash floor | Revised |
| D10 | Selectable model with per-run model recorded + surfaced in the Excel export (extraction + QA) | New |
| — | Abstention first-class (`found`/`not_found`/`ambiguous`); abstain, don't hard-fail-and-reask | New |
| — | Build the eval harness first; fix its table metric to validate the parser default + tiers | New |

## 4. Architecture

### 4.1 Verification layers (the trust boundary)

Three layers, cheapest first; the trust flag is set only by the last:

1. **Existence pre-filter (keep):** `build_anchor()` confirms the quote anchors
   to a block and rewrites it to the exact matched substring. Kills fabricated
   locations. Deterministic, no LLM.
2. **Entailment gate (new):** a separate non-structured `gpt-4o-mini` judge call
   — premise = cited block + neighbours, hypothesis = `"{field} = {value}"` —
   returns `entailed | weak | unsupported`. Runs **outside** the extraction
   retry loop, fanned out under `max_concurrency`.
3. **Deterministic value check (new, numeric/date/unit):** normalized equality
   that the value appears in the cited span/cell (`12.5%` ≡ `0.125`). NLI alone
   is unreliable on exact numbers — the dominant clinical field class.

`verified` (the reader's green state) is set **only on `entailed`** (and, for
numeric fields, a passing value check). `weak`/`unsupported` surface amber and
route to HITL — never a green check on a located-only span.

### 4.2 Evidence model + LLM contract

`extraction_evidence` is already 1:N per proposal. Additive migration (id ≤ 32
chars, `server_default` backfilling legacy rows to `primary`): `evidence_role`
(`primary|corroborating`), `attribution_label` (`entailed|weak|unsupported`),
`evidence_kind` (`verbatim|derived|absent`), `match_method`, `rank`. Confirm the
`workflow_target_present` CHECK still holds; update
[`extraction-hitl-architecture.md`](../../reference/extraction-hitl-architecture.md)
and the `test_migration_roundtrip` head-pin.

```python
class Evidence(BaseModel):
    quote: str               # short verbatim span (<= ~125 chars); AUTHORITATIVE for location
    block_id: str | None     # advisory hint, only when id-injection is ON (validated in injected set)
    page_number: int | None  # resolved from the anchored block when omitted

class FieldExtraction(BaseModel):
    status: Literal["found", "not_found", "ambiguous"]
    value: ... | None
    confidence: float
    reasoning: str
    evidence: list[Evidence]  # [] when not_found; 1..N (cap ~3) when found
```

Abstention is first-class: `not_found` -> `value=null`, `evidence=[]`. When zero
evidence survives verification, **abstain -> `not_found`/flag**, do not
hard-fail-and-reask. `output_retries` stays **>= 1** (the existing
`evidence_is_plausible` `ModelRetry` catches empty/unfindable quotes).

### 4.3 Anchoring

The verbatim `quote` (via `build_anchor()`) is the **source of truth** for
location; `block_id` is an advisory hint and an agreement check (quote anchors
to a different block than named -> lower confidence / flag). Keep the
deterministic `(page, block_index)` reader path as the primary locate — only
relax toward quote-only once the entailment gate is verified robust in code.
`block_id` input-injection ships behind a `citation.strategy` flag, **OFF by
default**, pending an eval-harness ablation; returned ids are validated against
the injected set (strip marker syntax from raw block text; reject unknown ids).

### 4.4 Multiple citations

The LLM emits the **primary** span(s). Corroboration never comes from raw
surface match (that manufactures the ALCE precision defect). Two shapes, pick
per phase:

- **v1 (start): primary-only.** Defer corroboration until reviewers ask.
- **v2: entailment-gated.** A deterministic candidate search (normalized
  value/quote across other blocks) **feeds the entailment gate**; only
  `entailed` candidates become `corroborating` rows.

Dedupe by `(block_id, range overlap)`; rank primary-then-corroborating by
value-match exactness + `block_type` priority. When a candidate's normalized
value **differs** beyond tolerance, record it as **conflicting** (a reviewer
signal: abstract "12 months" vs table "11.8"), not corroborating.

### 4.5 Tables

Stop guessing columns with `_infer_column_count`. Carry the parser's **native
cell grid** on `ArticleTextBlock`: `row_index`, `col_index`, `row_span`,
`col_span`, `is_header`, plus **per-cell bbox**. `_render_table()` builds the
grid from these (fallback to the old heuristic only for legacy blocks). Cite a
table value by `(block_id, row, col)`; the verifier checks the cited cell
contains the value (normalized). Serialize tables to the LLM as HTML or
cell-addressed KV (better than GFM for merged/multi-row headers); keep GFM for
the reader. Highlight the **cell**, not the table.

### 4.6 Figures

Add a `figure` region block type (the vocab has `figure_caption` but no figure
region). Cite the **caption** (real, citable text) and/or the **figure region**
(bbox overlay via `PrumoPdfViewer`). Add an **un-groundable-value flag** ("value
appears only in a figure — human verification required") instead of pretending a
text citation. Figure **content** extraction (vision) stays deferred.

### 4.7 Parser

**Default = pymupdf4llm.** Maintained by Artifex (same team as the PyMuPDF we
already ship, released in lockstep — actively maintained, lightweight, no
ML/torch). We consume its **structure, not its markdown**: map `page_chunks`
(text + headings in reading order, image regions with bbox, word bbox) into
`ParsedBlock`, and use the underlying `fitz` `find_tables()` grid for per-cell
`table_cell` blocks (row/col + per-cell bbox). The single serializer
`render_blocks_to_markdown` still renders both the prompt and the reader, so the
ADR-0013 byte-identical invariant holds (a parser's own `to_markdown()` is never
used). This gives richer blocks than raw fitz with minimal glue code and no new
ML surface.

- **Optional high-fidelity tiers (per-project, opt-in):**
  - **Docling** (self-hosted) — TableFormer cell grid for complex/merged tables;
    lift its `TableCell` row/col + spans + per-cell bbox (the adapter discards
    them today). Heavier (torch + model weights, pinned `docling==2.104.0`, OCR
    off, CPU-only) — select it when `find_tables` is insufficient.
  - **LlamaParse** (cloud, via the maintained `llama-cloud` SDK) — among the most
    robust for granular cell/word bbox and hard layouts; **opt-in per project via
    an API key**. Trade-offs: cloud egress + per-page cost (validate on a real
    bill before promoting). Keep the adapter pinned to the current `llama-cloud`
    SDK (the older `llama-parse`/`llama-cloud-services` client is deprecated).
- **Selection:** default backend = pymupdf4llm; Docling and LlamaParse are
  explicit per-project opt-ins (LlamaParse requires an API key). No PHI
  fail-closed gate (out of scope — no PHI; revisit if PHI projects are added).
- **Keep ADR-0013** (blocks -> our serializer). Relaxing it decouples
  `char_start/char_end` from the rendered string and breaks every char-range
  anchor — rejected.
- **Validate before locking a table-heavy default:** fix the bakeoff table metric
  ([§4.11](#411-eval-harness)) and confirm pymupdf4llm's `find_tables` tables
  suffice on real clinical papers vs Docling/LlamaParse.

### 4.8 Selectable model + transparency

- `llm_model` is a selectable default in project config (per-run override
  allowed); the **resolved** model is snapshotted onto the run (already lands in
  `extraction_runs.parameters["model"]` for extraction — extend the QA /
  `extract_for_run` path to record it too).
- The Excel export surfaces the **model used per run** in the AI-metadata sheet
  for **both** extraction and QA
  ([`services/exports/extraction/ai_metadata.py`](../../../backend/app/services/exports/extraction/ai_metadata.py)).

### 4.9 Config

Reads go through a **Pydantic v2 model** (explicit default / error — no silent
JSONB coercion as in `parser_settings_service.py` today). **Snapshot the
resolved config onto the run** (reuse `hitl_config_snapshot`) so the editable
default never equals what actually ran (audit). Record parser provenance
(`parser_tier`, version) on the article/parse record. The LlamaParse cloud tier
is opt-in per project via an API key.

### 4.10 Highlight

Adopt the **CSS Custom Highlight API** (`Highlight`/`Range`/`::highlight()`) —
no DOM mutation, safe with the no-raw renderer; keep the existing **block-flash
as the always-correct floor**. Compute `Range`s by locating the verbatim quote
in the **rendered DOM** (TreeWalker + offset table, identical normalization both
sides) — never from projection offsets. Char-span for prose; cell for tables;
region overlay for figures. Invariant test: shown span `textContent` == stored
quote, else fall back to block-flash.

### 4.11 Eval harness

Reuse `backend/scripts/parsing_bakeoff/`. **Fix the metric first**: the pilot's
`cell_set_f1` mis-ranks table structure — add **TEDS + an LLM-judge** for tables
and **bbox IoU** with pixel gold; this is the true blocker before any
parser-default change. For citations, gold-label 20–50 open-access PMC/PLOS
papers (no PHI) with `(field -> value + supporting span)` and score value
accuracy, **citation precision/recall** (ALCE leave-one-out entailment),
anchor-resolution rate, and abstention correctness. Produce an old-vs-new delta
table; wire a smoke subset into CI. Every quality change is gated on this.

## 5. Phasing

Each phase ships value independently and is gated on the harness.

- **P0 — measurement + trust boundary:** eval harness ([§4.11](#411-eval-harness),
  incl. the metric fix) + entailment gate ([§4.1](#41-verification-layers-the-trust-boundary))
  + `verified` = entailed + abstention. The highest-leverage correctness fix.
- **P1 — multiple citations (prose):** evidence->list + migration/backfill
  ([§4.2](#42-evidence-model--llm-contract)) + primary citations end-to-end + UI
  multi-citation render + selectable-model/export transparency
  ([§4.8](#48-selectable-model--transparency)) + config hardening. Corroboration
  starts primary-only.
- **P2 — block_id + precise highlight (prose):** `block_id` advisory behind the
  flag, validated on the harness, + CSS span highlight ([§4.10](#410-highlight)).
- **P3 — tables:** native cell grid + per-cell bbox + `(block_id, row, col)`
  citation ([§4.5](#45-tables)); pymupdf4llm default table cells (via
  `find_tables`) + the Docling tier adapter ([§4.7](#47-parser)).
- **P4 — figures:** `figure` region block type + caption citation +
  un-groundable flag ([§4.6](#46-figures)); LlamaParse (cloud, opt-in) for
  figure/table-heavy docs.

## 6. Testing

- Backend (pytest, per layer): entailment-gate flag mapping (mock judge);
  deterministic numeric value check; evidence-list persistence + migration
  backfill; abstention path; parser selection resolves the right tier (default
  pymupdf4llm; LlamaParse only when an API key is present); corroboration
  conflict detection; table cell grid + per-cell bbox from the pymupdf4llm/Docling
  adapters; QA run records the resolved model.
- Frontend (Vitest/MSW): multi-citation render (primary + "also cited (n)");
  `readerLocate` per block type; CSS-highlight invariant (shown == stored quote,
  else block-flash); legacy single-evidence rows render as a length-1 list.
- Eval harness: TEDS/IoU (tables) + ALCE precision/recall (citations) as the
  ship gate; smoke subset in CI.

## 7. Risks

- **Entailment-judge cost/latency:** one extra `gpt-4o-mini` call per verified
  field — `max_concurrency`, batch per article, judge only found values; measure
  before enabling by default.
- **Corroboration latency** (CPU worker): one normalized inverted index per
  article (value-token -> block_ids), exact-normalized short-circuit, hard
  iteration ceiling degrading to primary-only; Logfire span.
- **Backward compat** single->list across read service / export / reader: return
  list-always (length 1 for legacy); typed response model; bump the TanStack
  query key if cache would be stale.
- **Recall blind spot:** the assembler drops sections under budget and chunking
  has no cross-chunk coverage check — surface `AssemblyInfo.dropped` per field;
  assert every required field lands in exactly one chunk.
- **Table quality across parsers is unmeasured** until the bakeoff metric fix
  lands — validate that pymupdf4llm's `find_tables` tables suffice (vs the Docling
  tier) before relying on the default for table-heavy templates.

## 8. What held up (kept with confidence)

pydantic-ai + NativeOutput; the 1:N evidence model + primary/corroborating
concept; **block-level** locate granularity (finer spans degrade attribution);
deferring figure-content vision; markdown-for-prose + deterministic resolution;
the ADR-0013 single serializer (a parser's markdown is never adopted — we consume
its structure into blocks).

## 9. Reversals from the first proposal

- `block_id` authoritative -> **quote authoritative**, block_id advisory.
- `output_retries` 0–1 -> **kept >= 1**.
- Deterministic surface-match corroboration by default -> **removed** (gated or
  deferred; co-occurrence is never shown as agreement).
- "quote exists" as grounding -> **replaced** by the entailment gate.
- pymupdf4llm "overruled" -> **reinstated as the default** under the maintenance
  + no-PHI weighting: same maintainer as fitz (lockstep releases), light, and we
  consume its `page_chunks` **structure** (not its markdown) so the ADR-0013
  invariant still holds. Docling/LlamaParse become opt-in tiers, not a PHI split.
- GFM heuristic columns -> **native cell grid + per-cell bbox**.
- "figure provenance" -> caption citation + `figure` region block type +
  un-groundable flag.

## 10. Sources

- ALCE — [Enabling LLMs to Generate Text with Citations](https://arxiv.org/abs/2305.14627)
- VeriCite — [arxiv 2510.11394](https://arxiv.org/abs/2510.11394)
- AttributionBench — [arxiv 2402.15089](https://arxiv.org/abs/2402.15089)
- Table-format impact — [Table Meets LLM, arxiv 2305.13062](https://arxiv.org/abs/2305.13062)
- [Anthropic Citations API](https://platform.claude.com/docs/en/build-with-claude/citations)
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
