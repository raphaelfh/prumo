"""Bake-off orchestrator + CLI.

Runs each available candidate parser over the manifest's documents, scores
the predictions against the gold labels, and writes a CSV + a markdown
summary under ``docs/superpowers/quality-runs/``.

Usage (from backend/):
    uv run python -m parsing_bakeoff.run --manifest path/to/manifest.json \\
        --parsers docling,llamaparse --out docs/superpowers/quality-runs

    # plumbing smoke test, no real parsers/papers needed:
    uv run python -m parsing_bakeoff.run --manifest path/to/manifest.json --dry-run
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from parsing_bakeoff.manifest import EvalDoc, EvalSet, load_manifest
from parsing_bakeoff.parsers import REGISTRY, BakeoffParser, ParseRun, StubParser
from parsing_bakeoff.scoring import (
    DocScore,
    ParserReport,
    aggregate,
    cell_set_f1,
    match_boxes,
    recall_set,
)


def score_doc(doc: EvalDoc, run: ParseRun) -> DocScore:
    """Score one parser's ``ParseRun`` against a document's gold labels."""
    has_gold_regions = bool(doc.gold.regions)
    return DocScore(
        doc_id=doc.doc_id,
        table_f1=cell_set_f1(run.pred_cells, doc.gold.all_cells).f1,
        bbox_f1=match_boxes(run.pred_regions, doc.gold.regions).f1 if has_gold_regions else 0.0,
        bbox_scored=has_gold_regions,
        section_recall=recall_set(run.pred_sections, doc.gold.sections),
        reference_recall=recall_set(run.pred_references, doc.gold.references),
        elapsed_s=run.elapsed_s,
        est_cost_usd=run.est_cost_usd,
    )


def run_bakeoff(eval_set: EvalSet, parsers: list[BakeoffParser]) -> list[ParserReport]:
    """Run every parser over every document; return one report per parser."""
    reports: list[ParserReport] = []
    for parser in parsers:
        doc_scores: list[DocScore] = []
        for doc in eval_set.docs:
            try:
                run = parser.parse(doc.pdf_path)
            except Exception as exc:  # expected: unwired/failed runner
                doc_scores.append(DocScore(doc_id=doc.doc_id, error=f"{type(exc).__name__}: {exc}"))
                continue
            if run.error is not None:
                doc_scores.append(
                    DocScore(
                        doc_id=doc.doc_id,
                        elapsed_s=run.elapsed_s,
                        est_cost_usd=run.est_cost_usd,
                        error=run.error,
                    )
                )
                continue
            doc_scores.append(score_doc(doc, run))
        reports.append(aggregate(parser.name, doc_scores))
    return reports


def _ranked(reports: list[ParserReport]) -> list[ParserReport]:
    # Primary metric: table fidelity; bbox correctness breaks ties (ADR-0011).
    return sorted(reports, key=lambda r: (r.mean_table_f1, r.mean_bbox_f1), reverse=True)


def format_markdown(eval_set_name: str, reports: list[ParserReport]) -> str:
    lines = [
        f"# Parsing bake-off — {eval_set_name}",
        "",
        "Ranked by table fidelity (primary), bbox correctness (tiebreak). "
        "Quality means exclude errored docs; cost/latency include them.",
        "",
        "| Parser | Docs | Errors | Table F1 | Bbox F1 | Section recall | Ref recall | Mean latency (s) | Total cost (USD) |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for r in _ranked(reports):
        lines.append(
            f"| {r.parser} | {r.n_docs} | {r.n_errors} | {r.mean_table_f1:.3f} | "
            f"{r.mean_bbox_f1:.3f} | {r.mean_section_recall:.3f} | "
            f"{r.mean_reference_recall:.3f} | {r.mean_latency_s:.2f} | "
            f"{r.total_cost_usd:.4f} |"
        )
    return "\n".join(lines) + "\n"


def write_outputs(
    eval_set_name: str, reports: list[ParserReport], out_dir: str | Path
) -> tuple[Path, Path]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    csv_path = out / "bakeoff-results.csv"
    md_path = out / "bakeoff-summary.md"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(
            [
                "parser",
                "n_docs",
                "n_errors",
                "mean_table_f1",
                "mean_bbox_f1",
                "mean_section_recall",
                "mean_reference_recall",
                "mean_latency_s",
                "total_cost_usd",
            ]
        )
        for r in _ranked(reports):
            writer.writerow(
                [
                    r.parser,
                    r.n_docs,
                    r.n_errors,
                    f"{r.mean_table_f1:.4f}",
                    f"{r.mean_bbox_f1:.4f}",
                    f"{r.mean_section_recall:.4f}",
                    f"{r.mean_reference_recall:.4f}",
                    f"{r.mean_latency_s:.3f}",
                    f"{r.total_cost_usd:.4f}",
                ]
            )
    md_path.write_text(format_markdown(eval_set_name, reports), encoding="utf-8")
    return csv_path, md_path


def _select_parsers(names: list[str], dry_run: bool) -> list[BakeoffParser]:
    if dry_run:
        return [StubParser()]
    selected: list[BakeoffParser] = []
    for name in names:
        cls = REGISTRY.get(name)
        if cls is None:
            print(f"skip: unknown parser {name!r} (known: {sorted(REGISTRY)})", file=sys.stderr)
            continue
        inst = cls()
        if not inst.available():
            print(f"skip: {name} not available (lib not installed / key not set)", file=sys.stderr)
            continue
        selected.append(inst)
    return selected


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the PDF parsing bake-off.")
    parser.add_argument("--manifest", required=True, help="path to the eval-set manifest JSON")
    parser.add_argument(
        "--parsers",
        default=",".join(sorted(REGISTRY)),
        help="comma-separated parser names (default: all registered)",
    )
    parser.add_argument("--out", default="docs/superpowers/quality-runs", help="output directory")
    parser.add_argument(
        "--dry-run", action="store_true", help="use the stub parser (plumbing only)"
    )
    args = parser.parse_args(argv)

    eval_set = load_manifest(args.manifest)
    parsers = _select_parsers(
        [n.strip() for n in args.parsers.split(",") if n.strip()], args.dry_run
    )
    if not parsers:
        print("error: no parsers available; install one or pass --dry-run", file=sys.stderr)
        return 2

    reports = run_bakeoff(eval_set, parsers)
    csv_path, md_path = write_outputs(eval_set.name, reports, args.out)
    print(format_markdown(eval_set.name, reports))
    print(f"wrote {csv_path} and {md_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
