---
status: accepted
last_reviewed: 2026-06-19
owner: '@raphaelfh'
---

# Parsing bake-off — pilot (8 OA papers; PyMuPDF vs Docling)

First multi-paper run of the Phase 0 harness (ADR-0011) and the first
self-hosted layout-parser comparison — without waiting on a labelled clinical
eval set.

- **Set:** 8 open-access PLOS ONE RCTs (CC-BY), born-digital PDFs from PLOS.
- **Gold:** sections + table cells + references **auto-built from PMC JATS XML**
  via `parsing_bakeoff.jats_gold` (reproducible from open access; prumo's
  documents are published articles, not PHI).
- **DOIs:** `10.1371/journal.pone.` `0345292`, `0349793`, `0337817`, `0344538`,
  `0317950`, `0345784`, `0350008`, `0345974`.

## Result

| Parser | Docs | Errors | Table-cell F1 | Bbox F1 | Section recall | Mean latency (s) | Cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pymupdf | 8 | 0 | **0.989** | n/a | 0.816 | **1.06** | $0 |
| docling | 8 | 0 | **0.768** | n/a | 0.816 | 21.0 | $0 |

## Key finding: do **not** pick a parser on this content metric

On the same paper, Docling produced a **structurally correct** markdown table
matching the gold rows × columns:

```text
| Scale/ Subscale                                  | Pre-test | Post-test |
| Patient Compliance Scale ... (Total)             |    0.791 |     0.918 |
| Attitudes and emotional factors                  |    0.757 |     0.821 |
```

…yet Docling scores **lower** (0.768) than PyMuPDF (0.989) on the multiset
cell-content F1. The reason: the proxy compares cell *strings* as a multiset.
PyMuPDF's flat `find_tables` dump happens to overlap the JATS cell tokens more,
while Docling's *structured* cells (header detection, merged-cell handling)
group/normalise differently from the JATS `td/th` set — so the **better-structured
output scores worse**. The proxy measures content overlap, **not structure**.

A higher content-F1 therefore does **not** mean a better table. The parser
decision needs a **structure-aware metric (TEDS + an LLM-judge)** — this run is
concrete evidence that, without one, the bake-off can mis-rank parsers.

## What Docling adds (qualitative, demonstrated)

- Clean **structured markdown** (`##` headings, lists, tables as real grids) —
  ~52 KB for a 14-page paper.
- Real `DocItem` **labels** (section_header, list_item, caption, table,
  footnote, picture) + per-item **bboxes** (provenance).
- Built-in **OCR** (RapidOCR) → handles scanned PDFs. **PyMuPDF has none.**

Trade-off: PyMuPDF is ~1 s/paper, `$0`, bboxes, but flat blocks, no OCR, no table
structure. Docling is structured + OCR, `$0` self-hosted, but **~20× slower**
(21 s/paper on CPU) with heavy deps (torch + models; GPU would speed it up).

## LlamaParse (optional)

Wired (agentic tier + granular bboxes) but needs `LLAMA_CLOUD_API_KEY` and
egresses to a cloud API — **not run here** (no key). Viable for published OA
papers (not PHI); a candidate for the next round.

## Caveats

8 born-digital papers; `bbox_f1` unscored (JATS has no coordinates); `table_f1`
is the content proxy shown inadequate above; Docling latency is CPU-bound.

## Next (in priority order)

1. **Add a TEDS + LLM-judge table metric** (structure, not content) — the gating
   piece; without it the bake-off mis-ranks (as shown).
2. **Add scanned / image-only papers** — where Docling's OCR vs PyMuPDF's none
   becomes decisive.
3. Re-rank **Docling vs MinerU vs LlamaParse** on structure + scanned fidelity,
   on a GPU-capable environment.
