#!/usr/bin/env python3
"""check_glossary_sync.py — prumo fitness function.

Asserts every term defined in the skill's glossary mirror
(`.claude/skills/architectural-quality-loop/references/concept-glossary.md`)
also appears in the canonical architecture doc
(`docs/reference/extraction-hitl-architecture.md`).

The skill mirror is a sealed copy of the canonical doc's §6 Glossary. If the
two diverge, the loop's `concept-drift` subagent operates on a stale glossary
and emits false negatives. This check fires the moment the canonical doc edits
a term name without updating the mirror.

Exit codes: 0 (in sync) | 1 (drift) | 2 (input file missing).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_REPO_ROOT = SCRIPT_DIR.parent.parent

GLOSSARY_MIRROR = ".claude/skills/architectural-quality-loop/references/concept-glossary.md"
CANONICAL_DOC = "docs/reference/extraction-hitl-architecture.md"

# Mirror lists each term as a top-level bullet starting with `- **Term** —`.
TERM_RE = re.compile(r"^\s*-\s+\*\*([^*]+)\*\*\s*—", re.MULTILINE)


def extract_terms(text: str) -> list[str]:
    return [m.group(1).strip() for m in TERM_RE.finditer(text)]


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="prumo glossary-sync fitness check")
    p.add_argument("--repo-root", default=None)
    p.add_argument("--emit-telemetry", default=None)
    p.add_argument("--jsonl-out", default=None)
    args = p.parse_args(argv)

    root = Path(args.repo_root).resolve() if args.repo_root else DEFAULT_REPO_ROOT
    mirror = root / GLOSSARY_MIRROR
    canonical = root / CANONICAL_DOC

    if not mirror.is_file():
        print(f"ERROR: glossary mirror not found: {mirror}", file=sys.stderr)
        return 2
    if not canonical.is_file():
        print(f"ERROR: canonical architecture doc not found: {canonical}", file=sys.stderr)
        return 2

    started = time.time()
    mirror_terms = extract_terms(mirror.read_text(encoding="utf-8"))
    canonical_text = canonical.read_text(encoding="utf-8")
    missing = [t for t in mirror_terms if t not in canonical_text]
    duration_ms = int((time.time() - started) * 1000)
    exit_code = 1 if missing else 0

    if args.jsonl_out:
        rows = []
        for term in missing:
            rows.append(
                {
                    "category": "concept-drift",
                    "severity": "high",
                    "confidence": 1.0,
                    "file": GLOSSARY_MIRROR,
                    "line": 0,
                    "evidence": f"glossary term '{term}' not found in {CANONICAL_DOC}",
                    "suggested_action": "Update the mirror to match the canonical doc, or fix the canonical doc.",
                    "source": "fitness:check_glossary_sync",
                    "glossary_term": term,
                }
            )
        Path(args.jsonl_out).write_text(
            "\n".join(json.dumps(r) for r in rows) + ("\n" if rows else "")
        )

    if args.emit_telemetry:
        line = json.dumps(
            {
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "phase": "fitness",
                "gate": "check_glossary_sync",
                "duration_ms": duration_ms,
                "exit_code": exit_code,
                "finding_count": len(missing),
                "term_count": len(mirror_terms),
            }
        )
        with open(args.emit_telemetry, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")

    if missing:
        print(
            f"check_glossary_sync.py: FAIL ({duration_ms} ms; {len(missing)}/{len(mirror_terms)} terms drifted)"
        )
        print("Terms in mirror but missing from canonical doc:")
        for term in missing:
            print(f"  - {term}")
        print(f"Fix: update {GLOSSARY_MIRROR} to match {CANONICAL_DOC} §6 Glossary.")
    else:
        print(
            f"check_glossary_sync.py: OK ({duration_ms} ms; {len(mirror_terms)}/{len(mirror_terms)} terms in sync)"
        )

    return exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
