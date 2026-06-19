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

## It ships no documents

The harness contains **no papers and no manifest**. The evaluation set is
clinical/medical PDFs — likely **PHI** — so it must live on an approved,
non-public surface (not this repo, not a public bucket). You point the
harness at a manifest you provide.

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
    --parsers docling,mineru,llamaparse \
    --out docs/superpowers/quality-runs
```

Outputs `bakeoff-results.csv` + `bakeoff-summary.md` (ranked by table
fidelity, bbox correctness as the tiebreak). Parsers whose library/key is
missing are **skipped with a logged note** — never silently dropped.

## Metrics

| Metric | What it measures | Notes |
| --- | --- | --- |
| `table_f1` | multiset F1 over normalised table cells | a fast, dependency-free **proxy**. Run true TEDS + an LLM-judge (which the research found correlates better than TEDS) alongside it for the real decision. |
| `bbox_f1` | greedy IoU-matched precision/recall of table/figure regions | the provenance signal — can a reviewer's highlight land correctly? |
| `section_recall` / `reference_recall` | IMRaD headings / reference list recovery | normalised (NFKC + whitespace + casefold). |
| `mean_latency_s`, `total_cost_usd` | per-article ops cost | quality means exclude errored docs; cost/latency include them. |

## Wiring status (parser runners)

| Runner | `available()` | `parse()` |
| --- | --- | --- |
| `StubParser` | ✅ | ✅ (tests + `--dry-run`) |
| `LlamaParseRunner` | ✅ (lib + `LLAMA_CLOUD_API_KEY`) | grounded against the `llama_cloud` agentic-tier + granular-bbox API; finish `_map_llamaparse_result` against the live SDK |
| `DoclingRunner` | ✅ (import check) | wire `DocumentConverter` output → `ParseRun` |
| `MinerURunner` | ✅ (import check) | wire MinerU middle-JSON → `ParseRun` (GPU recommended) |
| `OpenDataLoaderRunner` | ✅ (import check) | wire OpenDataLoader-PDF output → `ParseRun` |

The lib-output → `ParseRun` mapping is the one integration point left per
runner, finished when the library is installed during the run (we don't ship
unverified third-party API calls). `LlamaParseRunner` egresses to a cloud
API — **non-PHI / BAA / self-hosted LlamaCloud only.**

## Adding a parser

Implement `available()` + `parse(pdf_path) -> ParseRun` (set `error` for
expected per-doc failures rather than raising), then add it to `REGISTRY` in
`parsers.py`. Scoring, reporting, and the CLI pick it up automatically.
