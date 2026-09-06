#!/usr/bin/env python3
"""check_retired_symbols.py — prumo fitness function (absolute, not a ratchet).

Names the entry-group trees train removed, and fails if one comes back.

Every other dead-code gate here answers "is this reachable?" — knip, vulture,
the copy-key ratchet. None of them answers "should this concept exist at
all?", so a re-added `role` column or a resurrected `POST /extraction/models`
would pass all three the moment something imported it. That is the gap this
closes: the retirement is the contract, and a symbol that is dead by
accident is indistinguishable from one that was never meant to return.

Absolute, deliberately. There is no baseline to grow: a legitimate reason to
bring one of these back is a spec change, and a spec change edits RETIRED
below with the reason in the diff.

The pattern is matched as a WORD, and only in the paths a live reference
could occupy — the migrations that dropped these objects necessarily name
them, and so do the docs that record why.

Usage:
  python check_retired_symbols.py [--repo-root P]

Exit codes: 0 (clean) | 1 (a retired symbol is back) | 2 (internal).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path

# --------------------------------------------------------------------------
# The contract
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Retired:
    """One symbol the train removed, and why it must not return."""

    symbol: str
    slice_: str
    why: str


RETIRED: tuple[Retired, ...] = (
    # B5 — structure is `parent_entity_type_id` + `cardinality` (0069).
    Retired(
        "ExtractionEntityRole",
        "B5",
        "structure is the parent link plus cardinality; the ENUM is dropped",
    ),
    Retired(
        "extraction_entity_role",
        "B5",
        "the Postgres ENUM 0069 dropped",
    ),
    Retired(
        "ck_extraction_entity_types_role_parent",
        "B5",
        "the CHECK that capped the tree at two levels",
    ),
    Retired(
        "check_model_section_parent_role",
        "B5",
        "the trigger that forced a child's parent to be THE container",
    ),
    Retired(
        "check_cardinality_one",
        "B5",
        "a SECURITY DEFINER function granted to `authenticated` with no caller",
    ),
    Retired(
        "get_by_role",
        "B5",
        "replaced by ExtractionEntityTypeRepository.get_root_group",
    ),
    Retired(
        "OneContainerError",
        "B5",
        "a template may hold several root groups, so there is no second container to refuse",
    ),
    Retired(
        "ContainerSwapUnsupportedError",
        "B5",
        "it reported the partial unique index 0069 dropped",
    ),
    # B6 — the model identification pipeline.
    Retired(
        "ModelExtractionService",
        "B6",
        "generalized into entry_group_extraction.extract_into_instances",
    ),
    Retired(
        "ModelExtractionRequest",
        "B6",
        "identification is a section extraction against the group",
    ),
    Retired(
        "ModelExtractionResult",
        "B6",
        "identification is a section extraction against the group",
    ),
    Retired(
        "useModelExtraction",
        "B6",
        "EntrySection identifies through useSectionExtraction, per group",
    ),
    Retired(
        "extract_models_task",
        "B6",
        "a dead Celery entry point with no enqueue site",
    ),
    Retired(
        "modelExtractionClient",
        "B6",
        "the API client helper the retired route needed",
    ),
    # B2 — model-only manual creation.
    Retired(
        "ModelHierarchyService",
        "B2",
        "replaced by EntryHierarchyService, which creates an entry of ANY group",
    ),
)

# Where a LIVE reference could sit. Everything else — migrations, docs, this
# file — necessarily names these symbols to record their removal.
SCAN_ROOTS: tuple[str, ...] = (
    "backend/app",
    "backend/tests",
    "frontend",
)

SCAN_SUFFIXES: tuple[str, ...] = (".py", ".ts", ".tsx")

# Generated from the backend, so they cannot reintroduce anything on their
# own: if a retired name appears here, the source it was generated from is
# already failing above.
EXCLUDED_DIRS: frozenset[str] = frozenset(
    {"node_modules", "__pycache__", ".git", "dist", "coverage"}
)
EXCLUDED_PATHS: tuple[str, ...] = (
    "frontend/types/api/",
    "frontend/integrations/supabase/types.ts",
    # The migration that DROPS an object names it; so does its round-trip test.
    "backend/alembic/",
    # These two ASSERT the absence — they have to name the object in SQL to
    # ask the catalogue whether it is gone. They are the retirement's own
    # guard, so forbidding the name here would forbid checking it.
    "backend/tests/integration/test_schema_drift.py",
    "backend/tests/integration/test_migration_0069_entry_group_trees.py",
)


PY_MARKERS = ('"""', "'''", "#")


def _strip_prose(text: str, suffix: str) -> list[str]:
    """Blank out comments and docstrings, keeping line numbers intact.

    A retired symbol is welcome in PROSE — half the value of a retirement is
    the note saying what used to be there and why it went. What is forbidden
    is a live REFERENCE. So the scan reads code only, and the line numbering
    survives the strip so a finding still points at the right line.
    """
    out: list[str] = []
    if suffix == ".py":
        in_doc = False
        delim = ""
        for line in text.splitlines():
            rest, kept = line, ""
            while rest:
                if in_doc:
                    end = rest.find(delim)
                    if end == -1:
                        break
                    rest, in_doc = rest[end + 3 :], False
                    continue
                hits = [i for i in (rest.find(m) for m in PY_MARKERS) if i != -1]
                if not hits:
                    kept += rest
                    break
                nxt = min(hits)
                kept += rest[:nxt]
                if rest[nxt] == "#":
                    break
                delim = rest[nxt : nxt + 3]
                rest, in_doc = rest[nxt + 3 :], True
            out.append(kept)
        return out

    in_block = False
    for line in text.splitlines():
        rest, kept = line, ""
        while rest:
            if in_block:
                end = rest.find("*/")
                if end == -1:
                    break
                rest, in_block = rest[end + 2 :], False
                continue
            line_c, block_c = rest.find("//"), rest.find("/*")
            if line_c != -1 and (block_c == -1 or line_c < block_c):
                kept += rest[:line_c]
                break
            if block_c != -1:
                kept += rest[:block_c]
                rest, in_block = rest[block_c + 2 :], True
                continue
            kept += rest
            break
        out.append(kept)
    return out


def _iter_files(repo_root: Path):
    for root_name in SCAN_ROOTS:
        root = repo_root / root_name
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIRS]
            for name in filenames:
                if not name.endswith(SCAN_SUFFIXES):
                    continue
                path = Path(dirpath) / name
                rel = path.relative_to(repo_root).as_posix()
                if any(rel.startswith(p) for p in EXCLUDED_PATHS):
                    continue
                yield path, rel


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    repo_root: Path = args.repo_root.resolve()

    started = time.time()
    patterns = {r: re.compile(rf"\b{re.escape(r.symbol)}\b") for r in RETIRED}
    findings: list[str] = []

    for path, rel in _iter_files(repo_root):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        code_lines = _strip_prose(text, path.suffix)
        for retired, pattern in patterns.items():
            for lineno, line in enumerate(code_lines, start=1):
                if pattern.search(line):
                    findings.append(
                        f"{rel}:{lineno}  {retired.symbol}  "
                        f"(retired in trees {retired.slice_}: {retired.why})"
                    )

    duration_ms = int((time.time() - started) * 1000)

    telemetry_out = os.environ.get("PRUMO_TELEMETRY_OUT")
    if telemetry_out:
        with open(telemetry_out, "a", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {
                        "check": "check_retired_symbols.py",
                        "duration_ms": duration_ms,
                        "exit_code": 1 if findings else 0,
                        "finding_count": len(findings),
                    }
                )
                + "\n"
            )

    if findings:
        print("check_retired_symbols.py: FAIL — a retired symbol is back")
        for f in findings:
            print(f"  {f}")
        print(
            "\nThese were removed by the entry-group trees train, and there is "
            "no baseline to add to. If a spec change genuinely brings one back, "
            "edit RETIRED in this file in the same diff, with the reason."
        )
        return 1

    print(
        f"check_retired_symbols: OK ({duration_ms} ms; "
        f"{len(RETIRED)} retired symbols, none present)"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # pragma: no cover - internal failure path
        print(f"check_retired_symbols.py: internal error: {exc}", file=sys.stderr)
        sys.exit(2)
