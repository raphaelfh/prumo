---
status: accepted
last_reviewed: 2026-06-19
owner: '@raphaelfh'
---

# Parsing bake-off — pilot (8 open-access papers)

First multi-paper run of the Phase 0 harness (ADR-0011), to prove the pipeline
end to end and learn what actually differentiates parsers — **without** waiting
on a labelled clinical eval set.

- **Set:** 8 open-access PLOS ONE RCTs (CC-BY), born-digital PDFs from PLOS.
- **Gold:** section headings + table cells + references **auto-built from PMC
  JATS XML** via `parsing_bakeoff.jats_gold` — reproducible from open-access
  sources, no PHI, no manual labelling. (prumo's documents are published
  articles, not patient records, so the eval set is *not* PHI-gated.)
- **DOIs:** `10.1371/journal.pone.` `0345292`, `0349793`, `0337817`, `0344538`,
  `0317950`, `0345784`, `0350008`, `0345974`.

## Result

| Parser | Docs | Errors | Table cell F1 | Bbox F1 | Section recall | Mean latency (s) | Total cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pymupdf | 8 | 0 | **0.989** | n/a | **0.816** | 1.02 | **$0.0000** |

(Self-hosted PyMuPDF: native block bboxes + `find_tables` + a heading heuristic.)

## What this tells us about parser selection

- **Content recovery is near-saturated on born-digital PDFs.** A free, ~1 s,
  self-hosted parser recovers table *cell content* at 0.99 multiset-F1 and ~82%
  of section headings, with a bbox on every block. On born-digital OA papers,
  **content extraction is not the differentiator.**
- **The proxy measures content, not table _structure_.** A 0.99 multiset-cell-F1
  can coexist with wrong row/column/cell assignment — merged/spanning cells,
  exactly where parsers diverge (per the research). This metric therefore
  **cannot** rank Docling vs MinerU vs PyMuPDF on the thing that matters.
- **`bbox_f1` is unscored** (JATS XML carries no coordinates); section gold
  includes sub-section + abstract titles, so 0.816 reflects the heading
  heuristic's precision/recall, not a hard ceiling.

## Why we did not install Docling/MinerU here

They would also score ~0.99 on this born-digital content proxy, so the run
would not differentiate them — while costing a lot to set up (Docling resolves
to **67 packages incl. torch + runtime model downloads**; MinerU is heavier and
GPU-oriented). They earn their cost only against the metrics/data below.

## Next lane (where the comparison becomes meaningful)

1. **Add a structure-aware table metric** — TEDS + an LLM-judge (the research
   found the judge correlates better than TEDS) — and ideally bbox gold.
2. **Add scanned / image-only papers** — PyMuPDF has no OCR and will fail there;
   this is where layout-aware parsers and the vision pass earn their keep.
3. **Then** run Docling + MinerU (+ the vision table pass) on a GPU-capable
   environment and rank on structure + scanned fidelity, not born-digital content.

Harness + gold builder are ready for all three; only the metric, the scanned
inputs, and the heavy-parser environment remain.
