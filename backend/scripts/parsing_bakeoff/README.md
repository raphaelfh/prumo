# Parsing bake-off (Phase 0 of ADR-0011)

A standalone harness that scores candidate PDF parsers on **real, labelled
papers** so the concrete parser for `app/infrastructure/parsing` is chosen
from data — public leaderboards (OmniDocBench etc.) do not cover scanned
clinical PDFs.

> **Location note:** ADR-0011's plan sketched this at repo-root
> `scripts/parsing_bakeoff/`. It lives under `backend/scripts/` instead so it
> runs inside the backend `uv` environment (it imports candidate parser
> libraries and shares the `ParsedBlock` contract). Tests live in
> `backend/tests/unit/` and import it via `pythonpath = ["scripts"]`.

## Provisioning the evaluation set

The harness ships **no papers and no manifest**. prumo's documents are
*published* research articles (not patient records), so the eval set can be
self-sourced from open access: `parsing_bakeoff.jats_gold` builds gold
(sections + table cells + references) from **PMC JATS XML**, and PLOS / Europe
PMC provide born-digital PDFs — no PHI, no manual labelling. (If you instead
evaluate private/unpublished PDFs, keep them on an approved, non-public surface.)

See `docs/superpowers/quality-runs/2026-06-19-parsing-bakeoff-pilot.md` for the
first 8-paper run built exactly this way.

## Manifest schema

```json
{
  "name": "clinical-eval-v1",
  "docs": [
    {
      "doc_id": "paper-001",
      "pdf_path": "/secure/papers/paper-001.pdf",
      "source_type": "born_digital",          // born_digital | scanned | jats
      "gold": {
        "tables": [["arm", "n", "events"], ["control", "98", "7"]],
        "sections": ["Methods", "Results"],
        "references": ["Smith 2021"],
        "paragraphs": ["Abstract paragraph …", "First body paragraph …"],
        "regions": [{"x": 72, "y": 540, "width": 451, "height": 96}]
      }
    }
  ]
}
```

`gold` is optional per doc; a metric with no gold scores as vacuously perfect
(it does not penalise a parser for content you did not label). Balance the set
across `source_type`s and include data-dense / merged-cell tables.

## Running

```bash
cd backend

# Plumbing smoke test — no real parsers or papers needed:
PYTHONPATH=scripts uv run python -m parsing_bakeoff.run --manifest /secure/manifest.json --dry-run

# Real run (install the parser extras you want to compare first):
PYTHONPATH=scripts uv run python -m parsing_bakeoff.run \
    --manifest /secure/manifest.json \
    --parsers pymupdf,markitdown,docling,llamaparse \
    --out docs/superpowers/quality-runs
    # mineru still needs result→ParseRun wiring; opendataloader is an unwired stub
```

Outputs `bakeoff-results.csv` (one row per parser and paper) +
`bakeoff-summary.md` (one row per parser, ranked by table fidelity, bbox
correctness as the tiebreak). Each parser runs in its own fresh subprocess so
its peak RSS is its own. Parsers whose library/key is missing are **skipped
with a logged note** — never silently dropped.

## Metrics

| Metric | What it measures | Notes |
| --- | --- | --- |
| `table_f1` | multiset F1 over normalised table cells | a fast, dependency-free **proxy** that MIS-RANKS structure (a flat token dump can outrank a structurally-correct grid — see the pilot run); it must **not** gate the parser choice. The gating metric is TEDS + an LLM-judge plus scanned inputs. |
| `bbox_f1` | greedy IoU-matched precision/recall of table/figure regions | the provenance signal — can a reviewer's highlight land correctly? |
| `section_recall` / `reference_recall` | IMRaD headings / reference list recovery | normalised (NFKC + whitespace + casefold). |
| `mean_latency_s`, `total_cost_usd` | per-article ops cost | quality means exclude errored docs; cost/latency include them. |
| `column_inversions` (+ `paragraphs_matched`) | pairs of gold paragraphs read in the wrong order | body blocks matched to the JATS abstract+body `<p>` sequence (`gold.paragraphs`) by their first 24 normalized alphanumeric characters; a block starting mid-paragraph matches nothing. |
| `order_breaks` | places the reading order jumps backwards | adjacent descents in the same matched sequence; one displaced paragraph is one break, while `column_inversions` counts it once per paragraph it jumped. |
| `chrome_leakage` | running heads/footers left typed as content | non-`header`/`footer` blocks in the top/bottom 8% band whose digit-masked text recurs there on ≥ 3 pages (the PyMuPDF chrome rule, over each parser's own blocks). |
| `zw_chars` | invisible characters in stored text | U+200B–U+200D, U+2060, U+FEFF, U+00AD after the ingest normalization pass. |
| `parse_seconds`, `p95_parse_seconds`, `peak_rss_mb` | per-paper time, its nearest-rank p95, the parser subprocess's peak RSS | RSS from `os.wait4` (macOS bytes and Linux KiB both normalized to MB). |

## Wiring status (parser runners)

| Runner | `available()` | `parse()` |
| --- | --- | --- |
| `StubParser` | ✅ | ✅ (tests + `--dry-run`) |
| `PyMuPDFRunner` | ✅ (backend dependency) | ✅ — the app's `PymupdfParser` + `normalize_blocks`, i.e. the blocks ingest stores (chrome typing, column-aware order, `find_tables` cells). |
| `MarkItDownRunner` | ✅ (`markitdown[pdf]`) | ✅ — pdfminer text; **no `#` headings / no bboxes**; ran the 8-paper pilot |
| `DoclingRunner` | ✅ (backend dependency) | ✅ — the app's `DoclingParser` (OCR off, TableFormer FAST, CPU) + `normalize_blocks`; bottom-left boxes flipped for the chrome band. |
| `LlamaParseRunner` | ✅ (lib + `LLAMA_CLOUD_API_KEY`) | grounded against the `llama_cloud` agentic-tier + granular-bbox API; finish `_map_llamaparse_result` against the live SDK |
| `MinerURunner` | ✅ (import check) | wire MinerU middle-JSON → `ParseRun` (GPU recommended) |
| `OpenDataLoaderRunner` | — | legacy old-spec name — unwired stub, not in the active slate; raises `ParserNotWiredError` |

The lib-output → `ParseRun` mapping is the one integration point left per
runner, finished when the library is installed during the run (we don't ship
unverified third-party API calls). `LlamaParseRunner` egresses to a cloud
API — **non-PHI / BAA / self-hosted LlamaCloud only.**

## Adding a parser

Implement `available()` + `parse(pdf_path) -> ParseRun` (set `error` for
expected per-doc failures rather than raising), then add it to `REGISTRY` in
`parsers.py`. Scoring, reporting, and the CLI pick it up automatically.
