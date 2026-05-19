#!/usr/bin/env python3
"""check_legacy_concepts.py — prumo fitness function.

Bans reintroduction of legacy concepts that were explicitly removed from the
codebase. Two tiers:

  HARD (4 patterns): hit anywhere outside the allowlist => exit 1.
  WARN (12 patterns): reported in stdout + JSONL, do not fail the gate.

Usage:
  python check_legacy_concepts.py [--scope GLOB] [--repo-root PATH]
                                  [--jsonl-out PATH] [--emit-telemetry PATH]

Exit codes: 0 (no hard violations) | 1 (hard violation) | 2 (internal error).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_REPO_ROOT = SCRIPT_DIR.parent.parent

SCAN_EXTS = {".py", ".ts", ".tsx", ".sql", ".js", ".jsx"}
SKIP_DIR_NAMES = {
    "node_modules",
    "__pycache__",
    ".git",
    ".venv",
    "venv",
    "dist",
    "build",
    ".next",
    ".pytest_cache",
    "coverage",
    "htmlcov",
    "worktrees",
}


@dataclass(frozen=True)
class Pattern:
    name: str
    tier: str  # "hard" | "warn"
    regex: re.Pattern[str]
    allowlist: tuple[str, ...]  # repo-relative path prefixes
    rationale: str
    blacklist_entry: int  # index into references/legacy-patterns.md (1..16)


HARD: tuple[Pattern, ...] = (
    Pattern(
        "prediction_models_eq_py",
        "hard",
        re.compile(r"""name\s*==\s*['"]prediction_models['"]"""),
        (
            "backend/app/seed.py",
            "backend/app/models/extraction.py",
            "backend/tests/factories/template_factory.py",
            "backend/alembic/versions/0016_entity_role_column.py",
            "backend/tests/integration/",
            "backend/tests/unit/",
            "scripts/fitness/check_legacy_concepts.py",
        ),
        "Replaced by extraction_entity_role enum. Use repository.get_by_role().",
        4,
    ),
    Pattern(
        "prediction_models_eq_ts",
        "hard",
        re.compile(r"""name\s*===\s*['"]prediction_models['"]"""),
        (
            "frontend/lib/extraction/entityTypeRoles.ts",
            "frontend/__tests__/",
            "frontend/test/",
            "backend/tests/",
            "scripts/fitness/check_legacy_concepts.py",
        ),
        "Replaced by extraction_entity_role enum on frontend. Use partitionEntityTypes.",
        4,
    ),
    Pattern(
        "extracted_values_table",
        "hard",
        re.compile(r"""\b(FROM|JOIN|INTO|TABLE|UPDATE|DELETE\s+FROM)\s+extracted_values\b""", re.I),
        (
            "backend/alembic/versions/0002_drop_extracted_values.py",
            "backend/alembic/versions/archive/",
            "backend/alembic/versions/baseline_v1.sql",
            "backend/tests/",
            "scripts/fitness/check_legacy_concepts.py",
        ),
        "Table dropped in migration 0002. Use extraction_reviewer_decisions + extraction_published_states.",
        2,
    ),
    Pattern(
        "ai_suggestions_table",
        "hard",
        re.compile(r"""\b(FROM|JOIN|INTO|TABLE|UPDATE|DELETE\s+FROM)\s+ai_suggestions\b""", re.I),
        (
            "backend/alembic/versions/archive/",
            "backend/tests/",
            "scripts/fitness/check_legacy_concepts.py",
        ),
        "Table dropped. Use extraction_proposal_records (source='ai'). aiSuggestionService.ts (camelCase) remains legitimate.",
        1,
    ),
)

WARN: tuple[Pattern, ...] = (
    Pattern(
        "suggestion_status_enum",
        "warn",
        re.compile(r"\bsuggestion_status\b"),
        ("backend/alembic/", "docs/", "scripts/fitness/"),
        "Replaced by reviewer_state.current_decision.",
        5,
    ),
    Pattern(
        "extraction_source_enum",
        "warn",
        re.compile(r"\bextraction_source\b"),
        ("backend/alembic/", "docs/", "scripts/fitness/"),
        "Replaced by extraction_proposal_source.",
        6,
    ),
    Pattern(
        "initialize_article_instances",
        "warn",
        re.compile(r"initializeArticleInstances"),
        ("docs/", "scripts/fitness/"),
        "Backend owns instance creation via hitl_session_service.",
        7,
    ),
    Pattern(
        "entity_tree_node_type",
        "warn",
        re.compile(r"\bEntityTreeNode\b"),
        ("docs/", "scripts/fitness/"),
        "Replaced by ExtractionEntityTypeWithFields.",
        9,
    ),
    Pattern(
        "qa_templates_endpoint",
        "warn",
        re.compile(r"/api/v1/projects/[^/]+/qa-templates"),
        ("docs/", "scripts/fitness/"),
        "Merged into /api/v1/hitl/sessions (kind=quality_assessment).",
        10,
    ),
    Pattern(
        "qa_assessments_endpoint",
        "warn",
        re.compile(r"/api/v1/qa-assessments"),
        ("docs/", "scripts/fitness/"),
        "Merged into /api/v1/hitl/sessions.",
        11,
    ),
    Pattern(
        "qa_template_clone_service",
        "warn",
        re.compile(r"\bqa_template_clone_service\b"),
        ("docs/", "scripts/fitness/"),
        "Merged into template_clone_service (kind-parametrized).",
        12,
    ),
    Pattern(
        "qa_assessment_session_service",
        "warn",
        re.compile(r"\bqa_assessment_session_service\b"),
        ("docs/", "scripts/fitness/"),
        "Merged into hitl_session_service.",
        13,
    ),
    Pattern(
        "react_pdf_viewer_pkg",
        "warn",
        re.compile(r"@react-pdf-viewer/"),
        ("docs/", "scripts/fitness/"),
        "Replaced by pdfjs-dist + @prumo/pdf-viewer.",
        14,
    ),
    Pattern(
        "response_formatter_module",
        "warn",
        re.compile(r"from\s+app\.utils\.response_formatter|import\s+response_formatter"),
        ("docs/", "scripts/fitness/"),
        "Dead utility removed. Endpoints handle serialization.",
        15,
    ),
    Pattern(
        "evidence_target_columns",
        "warn",
        re.compile(r"extraction_evidence\.(target_type|target_id)\b"),
        ("backend/alembic/", "docs/", "scripts/fitness/"),
        "Replaced by polymorphic CHECK constraint.",
        3,
    ),
    Pattern(
        "calculate_model_progress_dropped",
        "warn",
        re.compile(r"calculate_model_progress[\s\S]{0,500}\b(extracted_values|ai_suggestions)\b"),
        ("backend/alembic/", "docs/", "scripts/fitness/"),
        "Function silently referenced dropped tables. Locked by test_schema_drift.",
        8,
    ),
)


@dataclass
class Finding:
    pattern: Pattern
    file: str
    line: int
    evidence: str

    def to_jsonl_dict(self) -> dict:
        return {
            "category": "legacy",
            "severity": "high" if self.pattern.tier == "hard" else "medium",
            "confidence": 1.0,
            "file": self.file,
            "line": self.line,
            "evidence": self.evidence[:200],
            "suggested_action": self.pattern.rationale[:300],
            "source": f"fitness:check_legacy_concepts:{self.pattern.name}",
            "blacklist_entry": self.pattern.blacklist_entry,
            "fix_must_add": "fitness-rule" if self.pattern.tier == "hard" else None,
        }


def _allowed(rel: str, allowlist: tuple[str, ...]) -> bool:
    return any(rel.startswith(a) or rel == a.rstrip("/") for a in allowlist)


def _iter_files(root: Path, scope: str | None) -> Iterable[Path]:
    base = root
    if scope:
        # Allow scope to be a glob pattern relative to root.
        for p in root.glob(scope):
            if p.is_file() and p.suffix in SCAN_EXTS:
                yield p
            elif p.is_dir():
                yield from _walk(p)
        return
    yield from _walk(base)


def _walk(start: Path) -> Iterable[Path]:
    for dirpath, dirnames, filenames in os.walk(start):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIR_NAMES]
        for fn in filenames:
            p = Path(dirpath) / fn
            if p.suffix in SCAN_EXTS:
                yield p


def scan(root: Path, scope: str | None) -> list[Finding]:
    findings: list[Finding] = []
    for path in _iter_files(root, scope):
        rel = str(path.relative_to(root))
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        lines = text.splitlines()
        for pat in (*HARD, *WARN):
            if _allowed(rel, pat.allowlist):
                continue
            for m in pat.regex.finditer(text):
                line_no = text.count("\n", 0, m.start()) + 1
                line_text = lines[line_no - 1] if 0 < line_no <= len(lines) else m.group()
                # Universal comment-line skip: if the match lives entirely
                # inside a comment, it is documentation referring to the legacy
                # pattern, not live code. Inline comments after code are NOT
                # skipped (the comment marker is mid-line, not at the start).
                stripped = line_text.lstrip()
                if stripped.startswith(("#", "//", "*", "/*", '"""', "'''")):
                    continue
                findings.append(Finding(pat, rel, line_no, line_text.strip()))
    return findings


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="prumo legacy-concepts fitness check")
    p.add_argument(
        "--scope", default=None, help="Glob relative to --repo-root (default: whole repo)"
    )
    p.add_argument(
        "--repo-root", default=None, help="Repo root (default: derived from script location)"
    )
    p.add_argument("--jsonl-out", default=None, help="Write per-finding JSONL to this path")
    p.add_argument(
        "--emit-telemetry", default=None, help="Append a telemetry JSONL line to this path"
    )
    args = p.parse_args(argv)

    root = Path(args.repo_root).resolve() if args.repo_root else DEFAULT_REPO_ROOT
    if not root.is_dir():
        print(f"ERROR: repo root not a directory: {root}", file=sys.stderr)
        return 2

    started = time.time()
    findings = scan(root, args.scope)
    duration_ms = int((time.time() - started) * 1000)
    hard = [f for f in findings if f.pattern.tier == "hard"]
    warn = [f for f in findings if f.pattern.tier == "warn"]
    exit_code = 1 if hard else 0

    if args.jsonl_out:
        body = "\n".join(json.dumps(f.to_jsonl_dict()) for f in findings)
        Path(args.jsonl_out).write_text(body + ("\n" if body else ""))

    if args.emit_telemetry:
        line = json.dumps(
            {
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "phase": "fitness",
                "gate": "check_legacy_concepts",
                "duration_ms": duration_ms,
                "exit_code": exit_code,
                "finding_count": len(findings),
                "hard_tier_count": len(hard),
                "warn_tier_count": len(warn),
            }
        )
        with open(args.emit_telemetry, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")

    if hard:
        print(
            f"check_legacy_concepts.py: FAIL ({duration_ms} ms; {len(hard)} hard, {len(warn)} warn)"
        )
        print("HARD-TIER VIOLATIONS (these fail the gate):")
        for f in hard:
            print(f"  {f.file}:{f.line}  [{f.pattern.name}]")
            print(f"    evidence: {f.evidence[:120]}")
            print(f"    fix:      {f.pattern.rationale[:120]}")
    else:
        print(
            f"check_legacy_concepts.py: OK ({duration_ms} ms; {len(hard)} hard, {len(warn)} warn)"
        )
        for f in warn[:5]:
            print(f"  WARN {f.file}:{f.line}  [{f.pattern.name}]")
        if len(warn) > 5:
            print(f"  WARN  ... ({len(warn) - 5} more; use --jsonl-out to capture all)")

    return exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
