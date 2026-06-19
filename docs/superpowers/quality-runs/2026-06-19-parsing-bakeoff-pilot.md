---
status: accepted
last_reviewed: 2026-06-19
owner: '@raphaelfh'
---

# Parsing bake-off — pilot run (PyMuPDF, 1 paper)

First live run of the Phase 0 harness (ADR-0011) on a real paper, to prove the
pipeline end to end without waiting on a labelled clinical eval set.

- **Paper:** open-access PLOS ONE RCT (CC-BY), DOI `10.1371/journal.pone.0345292`
  — a type-2-diabetes insulin-initiation trial with ANCOVA results tables.
- **Source of the PDF:** PLOS printable PDF (born-digital).
- **Gold:** section headings + Table 1 (Cronbach's alpha) and Table 3 (anxiety)
  cell values, harvested from the **PMC structured full text** (PubMed Central).
- **Parser:** `PyMuPDFRunner` (self-hosted, `$0`, no model downloads).

## Result

| Parser | Docs | Errors | Table F1 | Bbox F1 | Section recall | Mean latency (s) | Total cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pymupdf | 1 | 0 | 0.217 | n/a | 1.000 | 1.05 | $0.0000 |

Raw extraction: 288 block bboxes, 287 table cells (via `find_tables`), 99
heading-ish blocks, in ~1.05 s.

## Reading

- **Section structure & bboxes are cheap and reliable here:** every gold heading
  was recovered (recall 1.000) and every block carried a bbox — PyMuPDF gives the
  provenance signal for free on a born-digital PDF.
- **Table fidelity is the weak point**, exactly as the research predicts for the
  rule-based tier. `find_tables` *did* recover Table 1 cleanly (`"Scale/ Subscale"`,
  `0.791`, `0.918`, …), but the strict multiset cell-F1 is 0.217 because (a) it
  extracted ~287 cells across *all* the paper's tables vs the ~35 cells we labelled
  (precision drag) and (b) `±` / `−` glyph mismatches in Table 3. This is also a
  finding about the **proxy metric**: per-table alignment + the real TEDS/LLM-judge
  (per the harness README) are needed for a fair table score.
- **The heading heuristic over-detects** (running headers, author/editor lines):
  recall 1.0 but low precision. A real parser's `block_type`, or a stricter
  heuristic, fixes this.

## Caveats

One born-digital paper; `bbox_f1` is unscored (publisher XML carries no pixel
coordinates); `table_f1` here is the dependency-free proxy, not TEDS.

## Next

Install Docling/MinerU for the layout-aware comparison on the same paper, then
expand the set across born-digital / scanned / JATS inputs and add TEDS + an
LLM-judge for the table score.
