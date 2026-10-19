# Parsing bake-off — pmc-oa-14-2026-10

Ranked by table fidelity (primary), bbox correctness (tiebreak). Quality means exclude errored docs; cost/latency include them.

| Parser | Docs | Errors | Table F1 | Bbox F1 | Section recall | Ref recall | Mean latency (s) | Total cost (USD) | Column inversions | Order breaks | Chrome leakage | ZW chars | p95 parse (s) | Peak RSS (MB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| docling | 14 | 0 | 0.866 | 0.000 | 0.734 | 0.000 | 7.06 | 0.0000 | 142 | 5 | 0 | 0 | 30.53 | 5750.3 |
| pymupdf | 14 | 0 | 0.364 | 0.000 | 0.373 | 0.000 | 1.31 | 0.0000 | 86 | 19 | 0 | 0 | 1.92 | 355.9 |
