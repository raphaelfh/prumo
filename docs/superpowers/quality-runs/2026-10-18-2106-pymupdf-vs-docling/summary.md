---
status: accepted
last_reviewed: 2026-10-18
owner: '@raphaelfh'
---

# Parsing bake-off — PyMuPDF vs Docling on 14 PMC open-access papers

Second Phase 0 run of ADR-0011, after the
[8-paper pilot](../2026-06-19-parsing-bakeoff-pilot.md). It compares the two
self-hosted parsers ingest can select today, each exactly as ingest runs it:

- **pymupdf** — `PymupdfParser` + `normalize_blocks` (PyMuPDF 1.27.2.3): chrome
  typing, column-aware reading order, `find_tables` cells.
- **docling** — `DoclingParser` + `normalize_blocks` (Docling 2.104.0, OCR off,
  TableFormer FAST, CPU).

Raw output: [`bakeoff-results.csv`](bakeoff-results.csv) (one row per parser
and paper) and [`bakeoff-summary.md`](bakeoff-summary.md) (the harness's own
per-parser table).

## Set

14 born-digital research articles from the PMC Open Access subset, all CC BY,
PDF and JATS XML fetched from PMC's official open-data bucket. 9 are
two-column, 5 single-column (classified visually). Gold (table cells, section
headings, abstract + body paragraphs) is built from the JATS by
`parsing_bakeoff.jats_gold`; no manual labelling.

| PMCID | Journal | DOI | Layout |
| --- | --- | --- | --- |
| PMC11658635 | PLoS One | 10.1371/journal.pone.0314361 | single |
| PMC11660560 | Trials | 10.1186/s13063-024-08613-9 | two |
| PMC11666086 | Glob Health Sci Pract | 10.9745/GHSP-D-23-00483 | two |
| PMC11667339 | BMJ Open | 10.1136/bmjopen-2024-091355 | two |
| PMC11674089 | BMC Psychiatry | 10.1186/s12888-024-06365-z | two |
| PMC11685242 | Eur J Nutr | 10.1007/s00394-024-03563-z | two |
| PMC11685319 | Mediators Inflamm | 10.1155/mi/5520987 | two |
| PMC11685923 | Sci Rep | 10.1038/s41598-024-83643-6 | single |
| PMC11706452 | PLoS Med | 10.1371/journal.pmed.1004505 | single |
| PMC11722837 | Nutrients | 10.3390/nu17010138 | single |
| PMC11735114 | Epidemiol Psychiatr Sci | 10.1017/S2045796024000817 | two |
| PMC11766591 | Medicina (Kaunas) | 10.3390/medicina61010043 | single |
| PMC11794317 | Front Public Health | 10.3389/fpubh.2024.1423716 | two |
| PMC11821620 | Front Public Health | 10.3389/fpubh.2024.1484210 | two |

## Result

| Metric | pymupdf | docling |
| --- | ---: | ---: |
| Table-cell F1 (mean, 14 docs) | 0.364 | **0.866** |
| Papers with no table recovered (F1 = 0) | 7 / 14 | **0 / 14** |
| Section-heading recall (mean) | 0.373 | **0.734** |
| Gold paragraphs matched by a block start | 329 / 741 (44%) | **630 / 741 (85%)** |
| Order breaks (backward jumps in reading order) | 19 | **5** |
| Column inversions (pairs out of order) | **86** | 142 |
| Chrome leakage (running heads typed as body) | 0 | 0 |
| Invisible characters left in text | 0 | 0 |
| Median parse time per paper (s) | **1.39** | 5.43 |
| p95 parse time (s) | **1.92** | 30.53 |
| Peak RSS of the parser process (MB) | **356** | 5750 |
| Errors | 0 | 0 |
| Cost | $0 | $0 |

Two-column subset (9 papers): table F1 0.244 vs **0.856** (pymupdf finds no
table in 5 of 9), section recall 0.328 vs **0.680**, paragraphs matched
241/519 vs **437/519**, order breaks 17 vs **4**.

Single-column subset (5 papers): table F1 0.578 vs **0.885**, section recall
0.453 vs **0.831**, order breaks 2 vs **1**.

## Reading the numbers

- **Tables.** When `find_tables` detects a table, PyMuPDF's cells are near
  exact (F1 0.91–0.98 on 5 papers, matching the pilot's 0.989 on PLOS ONE). On
  7 papers it detects no table at all — these publishers draw tables without
  full rulings. Docling's TableFormer recovers every paper's tables at F1
  0.70–0.95. Table-cell F1 is a content proxy that mis-ranks structure (see the
  pilot), so it shows *recovery*, not grid fidelity.
- **Reading order.** The two order metrics disagree, and order breaks is the
  fairer one here. Column inversions count every pair out of order, so one
  displaced run of paragraphs counts once per paragraph it jumped: 111 of
  Docling's 142 inversions are a single paper (PMC11674089) with 3 breaks.
  Inversions also scale with how many paragraphs matched, and Docling matched
  nearly twice as many. Per matched paragraph, Docling breaks order about
  once per 126 paragraphs, PyMuPDF once per 17.
- **Paragraph segmentation.** A block matches a gold paragraph only when it
  starts at that paragraph. PyMuPDF matches 44% of gold paragraphs, so its
  blocks more often merge paragraphs or split mid-paragraph; that also lowers
  how precisely an evidence citation can point at a paragraph.
- **Chrome and invisible characters.** Both are clean: page chrome typing and
  the ingest normalization pass apply to both parsers' blocks.
- **Cost of Docling.** About 4× slower per paper at the median. The p95 is the
  first paper of the run, which includes loading the layout and TableFormer
  models (30.5 s); the slowest later paper took 8.0 s. Peak memory is ~5.7 GB
  against ~0.36 GB, which sets the worker size if Docling becomes a default.

## Not measured

- **Reference recall** reads 0.000 for both parsers and is omitted above:
  neither runner emits a reference list, so the metric is not wired for these
  parsers, not a parse failure.
- **Bbox correctness** — JATS gold has no coordinates.
- **Scanned PDFs** — OCR was off for Docling and the set is all born-digital.

## Run

Host: Apple M5 Pro (48 GB), macOS 27.0.1, Python 3.14.7, CPU only; Docling
models from a warm local cache, no network during the run.

```bash
cd backend
PYTHONPATH=scripts uv run python -m parsing_bakeoff.run \
    --manifest <manifest.json> \
    --parsers pymupdf,docling \
    --out ../docs/superpowers/quality-runs/2026-10-18-2106-pymupdf-vs-docling
```

The manifest (gold from `jats_gold`) and the papers are not committed; the
PMCIDs above reproduce the set.

## Decision

Recorded in ADR-0011's 2026-10 amendment: the parser policy is **pending the
maintainer's ruling**. This run changes no parser selection.
