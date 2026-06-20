---
status: accepted
last_reviewed: 2026-06-19
owner: '@raphaelfh'
---

# Parsing bake-off — pilot (8 OA papers; PyMuPDF vs MarkItDown vs Docling)

Multi-paper Phase 0 run (ADR-0011) comparing three self-hosted parsers, without
waiting on a labelled clinical eval set.

- **Set:** 8 open-access PLOS ONE RCTs (CC-BY), born-digital PDFs from PLOS.
- **Gold:** sections + table cells + references **auto-built from PMC JATS XML**
  via `parsing_bakeoff.jats_gold` (reproducible from open access; prumo's
  documents are published articles, not PHI).
- **DOIs:** `10.1371/journal.pone.` `0345292`, `0349793`, `0337817`, `0344538`,
  `0317950`, `0345784`, `0350008`, `0345974`.

## Result

| Parser | Docs | Table-cell F1 | Section recall | Bbox | Mean latency (s) | Cost |
| --- | ---: | ---: | ---: | :--: | ---: | ---: |
| pymupdf | 8 | 0.989 | 0.816 | yes (unscored) | 1.00 | $0 |
| docling | 8 | 0.768 | 0.816 | yes (unscored) | 7.6 | $0 |
| markitdown | 8 | 0.588 | **0.000** | none | 0.55 | $0 |

`Bbox` is **unscored** — JATS gold has no pixel coordinates. PyMuPDF and Docling
emit per-block bboxes; MarkItDown emits none. (The harness now excludes
no-gold-region docs from the bbox mean, so all rows read 0.000 rather than a
misleading vacuous 1.0 for the parser that produces no boxes.)

## Reading the three parsers

- **MarkItDown (Microsoft):** fastest (0.55 s) and simplest, converts PDF →
  Markdown via pdfminer. But it emits **no `#` headings** (section recall 0.000),
  **no bboxes**, and recovers only ~60% of table cells. It's a quick
  text-to-Markdown convenience — **not** a layout/provenance parser, so it does
  not fit the grounded-extraction goal (which needs section structure + bbox
  anchoring).
- **PyMuPDF:** fast (1 s), bboxes on every block, ~82% section recall, and the
  highest *content* cell-F1 (0.989) — but see the caveat below: that number
  flatters it. No OCR; flat table cells (no real structure).
- **Docling:** structured Markdown + real table grids + DocItem labels + bboxes
  + built-in OCR (scanned support), at ~8–20 s/paper on CPU.

## The metric caveat (still the headline)

The content cell-F1 **mis-ranks structure**. On the same paper, Docling produced
a structurally-correct table (matching the gold rows × columns) yet scores
*lower* (0.768) than PyMuPDF's flat token dump (0.989), because the multiset
compares cell *strings*, not table *structure*. So this proxy ranks
PyMuPDF > Docling > MarkItDown on content overlap, which is **not** the quality
order for grounded extraction. The decision still needs a **structure-aware
metric (TEDS + an LLM-judge)** and **scanned inputs** (where MarkItDown/PyMuPDF
have no OCR and Docling does).

## LlamaParse (optional)

Wired (agentic tier + granular bboxes) but needs `LLAMA_CLOUD_API_KEY` + cloud
egress — not run here. Candidate for the next round on published (non-PHI) papers.

## Next (in priority order)

1. **TEDS + LLM-judge** table metric (structure, not content) — the gating piece.
2. **Scanned / image-only papers** — decisive for OCR (Docling) vs none.
3. Re-rank **Docling vs MinerU vs LlamaParse** on structure + scanned, on GPU.

> Per the updated ADR-0011 decision, LlamaParse `agentic` is the intended
> **non-PHI default** (cloud); this self-hosted re-rank picks the **PHI default**
> and the non-PHI fallback if LlamaParse loses on quality/cost/latency.
