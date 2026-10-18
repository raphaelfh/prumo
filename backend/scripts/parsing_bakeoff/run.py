"""Bake-off orchestrator + CLI.

Runs each available candidate parser over the manifest's documents, scores
the predictions against the gold labels, and writes a CSV + a markdown
summary under ``docs/superpowers/quality-runs/``.

Usage (from backend/):
    uv run python -m parsing_bakeoff.run --manifest path/to/manifest.json \\
        --parsers docling,llamaparse --out docs/superpowers/quality-runs

    # plumbing smoke test, no real parsers/papers needed:
    uv run python -m parsing_bakeoff.run --manifest path/to/manifest.json --dry-run

Each parser runs in its own fresh subprocess so its peak RSS is its own.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import asdict
from pathlib import Path

from parsing_bakeoff.manifest import EvalDoc, EvalSet, load_manifest
from parsing_bakeoff.parsers import REGISTRY, BakeoffParser, ParseRun, StubParser
from parsing_bakeoff.scoring import (
    DocScore,
    ParserReport,
    aggregate,
    cell_set_f1,
    chrome_leakage,
    column_inversions,
    match_boxes,
    maxrss_to_mb,
    recall_set,
    zw_char_count,
)

#: ``backend/`` (so ``app`` imports) and ``backend/scripts`` (this package).
_BACKEND_DIR = Path(__file__).resolve().parents[2]
_SCRIPTS_DIR = Path(__file__).resolve().parents[1]


def score_doc(doc: EvalDoc, run: ParseRun) -> DocScore:
    """Score one parser's ``ParseRun`` against a document's gold labels."""
    has_gold_regions = bool(doc.gold.regions)
    inversions, matched = column_inversions(run.blocks, doc.gold.paragraphs)
    return DocScore(
        doc_id=doc.doc_id,
        table_f1=cell_set_f1(run.pred_cells, doc.gold.all_cells).f1,
        bbox_f1=match_boxes(run.pred_regions, doc.gold.regions).f1 if has_gold_regions else 0.0,
        bbox_scored=has_gold_regions,
        section_recall=recall_set(run.pred_sections, doc.gold.sections),
        reference_recall=recall_set(run.pred_references, doc.gold.references),
        column_inversions=inversions,
        paragraphs_matched=matched,
        chrome_leakage=chrome_leakage(run.blocks, run.page_heights),
        zw_chars=zw_char_count(run.blocks),
        parse_seconds=run.elapsed_s,
        est_cost_usd=run.est_cost_usd,
    )


def _score_parser(eval_set: EvalSet, parser: BakeoffParser) -> list[DocScore]:
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
                    parse_seconds=run.elapsed_s,
                    est_cost_usd=run.est_cost_usd,
                    error=run.error,
                )
            )
            continue
        doc_scores.append(score_doc(doc, run))
    return doc_scores


def run_bakeoff(eval_set: EvalSet, parsers: list[BakeoffParser]) -> list[ParserReport]:
    """Run every parser over every document in-process; one report per parser."""
    return [aggregate(parser.name, _score_parser(eval_set, parser)) for parser in parsers]


def run_parser_isolated(manifest: str | Path, parser_name: str, *, dry_run: bool) -> ParserReport:
    """Score one parser in a fresh child interpreter and record its peak RSS.

    ``os.wait4`` reads the rusage of that one child; a cumulative
    ``RUSAGE_CHILDREN`` would carry an earlier parser's peak into the next.
    """
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "scores.json"
        cmd = [
            sys.executable,
            "-m",
            "parsing_bakeoff.run",
            "--manifest",
            str(manifest),
            "--parsers",
            parser_name,
            "--child-out",
            str(out),
        ]
        if dry_run:
            cmd.append("--dry-run")
        pythonpath = os.pathsep.join(
            p for p in (str(_SCRIPTS_DIR), str(_BACKEND_DIR), os.environ.get("PYTHONPATH")) if p
        )
        proc = subprocess.Popen(  # noqa: S603 - fixed argv: this interpreter + this module
            cmd, cwd=_BACKEND_DIR, env={**os.environ, "PYTHONPATH": pythonpath}
        )
        _, status, usage = os.wait4(proc.pid, 0)
        proc.returncode = os.waitstatus_to_exitcode(status)
        if proc.returncode != 0:
            raise RuntimeError(f"{parser_name}: child exited {proc.returncode}")
        raw = json.loads(out.read_text(encoding="utf-8"))
    scores = [DocScore(**row) for row in raw["doc_scores"]]
    return aggregate(raw["parser"], scores, peak_rss_mb=maxrss_to_mb(usage.ru_maxrss, sys.platform))


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
        "| Parser | Docs | Errors | Table F1 | Bbox F1 | Section recall | Ref recall "
        "| Mean latency (s) | Total cost (USD) | Column inversions | Chrome leakage "
        "| ZW chars | p95 parse (s) | Peak RSS (MB) |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: "
        "| ---: | ---: | ---: | ---: | ---: |",
    ]
    for r in _ranked(reports):
        rss = "n/a" if r.peak_rss_mb is None else f"{r.peak_rss_mb:.1f}"
        lines.append(
            f"| {r.parser} | {r.n_docs} | {r.n_errors} | {r.mean_table_f1:.3f} | "
            f"{r.mean_bbox_f1:.3f} | {r.mean_section_recall:.3f} | "
            f"{r.mean_reference_recall:.3f} | {r.mean_latency_s:.2f} | "
            f"{r.total_cost_usd:.4f} | {r.total_column_inversions} | "
            f"{r.total_chrome_leakage} | {r.total_zw_chars} | "
            f"{r.p95_parse_seconds:.2f} | {rss} |"
        )
    return "\n".join(lines) + "\n"


def write_outputs(
    eval_set_name: str, reports: list[ParserReport], out_dir: str | Path
) -> tuple[Path, Path]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    csv_path = out / "bakeoff-results.csv"
    md_path = out / "bakeoff-summary.md"
    columns = [
        "parser",
        "doc_id",
        "error",
        "table_f1",
        "section_recall",
        "reference_recall",
        "column_inversions",
        "paragraphs_matched",
        "chrome_leakage",
        "zw_chars",
        "parse_seconds",
        "peak_rss_mb",
    ]
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(columns)
        for r in _ranked(reports):
            rss = "" if r.peak_rss_mb is None else f"{r.peak_rss_mb:.1f}"
            for d in r.doc_scores:
                writer.writerow(
                    [
                        r.parser,
                        d.doc_id,
                        d.error or "",
                        f"{d.table_f1:.4f}",
                        f"{d.section_recall:.4f}",
                        f"{d.reference_recall:.4f}",
                        d.column_inversions,
                        d.paragraphs_matched,
                        d.chrome_leakage,
                        d.zw_chars,
                        f"{d.parse_seconds:.3f}",
                        rss,
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
    parser.add_argument("--child-out", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    eval_set = load_manifest(args.manifest)
    parsers = _select_parsers(
        [n.strip() for n in args.parsers.split(",") if n.strip()], args.dry_run
    )
    if not parsers:
        print("error: no parsers available; install one or pass --dry-run", file=sys.stderr)
        return 2

    if args.child_out:  # one parser, scored inside run_parser_isolated's child
        [only] = parsers
        scores = _score_parser(eval_set, only)
        payload = {"parser": only.name, "doc_scores": [asdict(d) for d in scores]}
        Path(args.child_out).write_text(json.dumps(payload), encoding="utf-8")
        return 0

    reports = [run_parser_isolated(args.manifest, p.name, dry_run=args.dry_run) for p in parsers]
    csv_path, md_path = write_outputs(eval_set.name, reports, args.out)
    print(format_markdown(eval_set.name, reports))
    print(f"wrote {csv_path} and {md_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
