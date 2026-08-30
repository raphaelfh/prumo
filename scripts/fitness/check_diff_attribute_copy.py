#!/usr/bin/env python3
"""check_diff_attribute_copy.py — prumo fitness function.

Asserts every attribute the publish-diff backend can put on the wire has a
human label in the frontend.

`TemplateConfigDiffSheet.tsx` maps `row.attribute` → a copy key through
`ATTRIBUTE_COPY`, and falls back to rendering the RAW WIRE KEY when the map
has no entry. That fallback is deliberate (the wire type is an open string,
so a stale frontend degrades instead of blanking) — but it means a new
backend attribute reaches users as `allows_no_information` rather than
`"No information" option`, silently, with every test green. That shipped
once; this gate is why it cannot ship twice.

Source of truth: `ATTRIBUTE_TIERS` in `backend/app/services/template_diff.py`,
which the backend's own exhaustiveness test
(`test_tier_map_is_exhaustive_over_the_snapshot_key_set`) pins to the union of
the entity + field attribute-default maps. Two more keys are emitted as bare
constants rather than through those maps (`OPTION_KEY`,
`TEMPLATE_INSTRUCTION_KEY`), so they are added explicitly.

Read via AST, never by importing: `app.services.*` constructs `Settings` on
import, which needs an env this job does not have.

Exit codes: 0 (every attribute labelled) | 1 (unlabelled) | 2 (parse failure).
"""

from __future__ import annotations

import argparse
import ast
import re
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_REPO_ROOT = SCRIPT_DIR.parent.parent

DIFF_SERVICE = "backend/app/services/template_diff.py"
DIFF_SHEET = "frontend/components/extraction/template-config/TemplateConfigDiffSheet.tsx"
COPY_FILE = "frontend/lib/copy/templateConfig.ts"

TIER_MAP = "ATTRIBUTE_TIERS"
#: Emitted with `attribute=<CONST>` instead of via the tier map, so the map
#: alone would under-report what can reach `row.attribute`.
EXTRA_KEY_CONSTANTS = ("OPTION_KEY", "TEMPLATE_INSTRUCTION_KEY")

ATTRIBUTE_COPY_OPEN = re.compile(r"^const ATTRIBUTE_COPY\b.*\{\s*$", re.MULTILINE)
ENTRY_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'([A-Za-z0-9_]+)'\s*,?\s*$")
COPY_KEY_RE = re.compile(r"^  ([A-Za-z0-9_]+)\s*:", re.MULTILINE)


def backend_attributes(source: str) -> set[str]:
    """Keys of `ATTRIBUTE_TIERS` plus the two constant-emitted keys.

    A dict key may be a `ast.Name` (`ENTRY_LABEL_KEY: ...`), so module-level
    `NAME = "literal"` assignments are resolved first.
    """
    tree = ast.parse(source)
    consts: dict[str, str] = {}
    tier_keys: list[ast.expr | None] = []

    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        names = [t.id for t in targets if isinstance(t, ast.Name)]
        if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            for name in names:
                consts[name] = node.value.value
        if TIER_MAP in names and isinstance(node.value, ast.Dict):
            tier_keys = node.value.keys

    if not tier_keys:
        raise ValueError(f"{TIER_MAP} dict literal not found in {DIFF_SERVICE}")

    out: set[str] = set()
    for key in tier_keys:
        if isinstance(key, ast.Constant) and isinstance(key.value, str):
            out.add(key.value)
        elif isinstance(key, ast.Name) and key.id in consts:
            out.add(consts[key.id])
        else:
            raise ValueError(f"{TIER_MAP} has a key this check cannot resolve: {ast.dump(key)}")

    for name in EXTRA_KEY_CONSTANTS:
        if name not in consts:
            raise ValueError(f"{name} not found in {DIFF_SERVICE}")
        out.add(consts[name])
    return out


def attribute_copy_map(source: str) -> dict[str, str]:
    """`ATTRIBUTE_COPY` entries, read from the object literal's own block."""
    open_match = ATTRIBUTE_COPY_OPEN.search(source)
    if open_match is None:
        raise ValueError(f"ATTRIBUTE_COPY object literal not found in {DIFF_SHEET}")
    out: dict[str, str] = {}
    for line in source[open_match.end() :].splitlines():
        if line.startswith("}"):
            break
        entry = ENTRY_RE.match(line)
        if entry:
            out[entry.group(1)] = entry.group(2)
    return out


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="prumo publish-diff attribute label check")
    p.add_argument("--repo-root", default=None)
    args = p.parse_args(argv)

    root = Path(args.repo_root).resolve() if args.repo_root else DEFAULT_REPO_ROOT
    started = time.time()

    try:
        paths = {name: root / name for name in (DIFF_SERVICE, DIFF_SHEET, COPY_FILE)}
        for name, path in paths.items():
            if not path.is_file():
                print(f"ERROR: {name} not found: {path}", file=sys.stderr)
                return 2
        attributes = backend_attributes(paths[DIFF_SERVICE].read_text(encoding="utf-8"))
        mapping = attribute_copy_map(paths[DIFF_SHEET].read_text(encoding="utf-8"))
        copy_keys = set(COPY_KEY_RE.findall(paths[COPY_FILE].read_text(encoding="utf-8")))
    except (OSError, SyntaxError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    unmapped = sorted(a for a in attributes if a not in mapping)
    # A mapped-but-undefined copy key renders the key name itself, which is
    # the same user-visible failure one step later.
    dangling = sorted(
        (a, mapping[a]) for a in attributes if a in mapping and mapping[a] not in copy_keys
    )
    duration_ms = int((time.time() - started) * 1000)

    if unmapped or dangling:
        print(
            f"check_diff_attribute_copy.py: FAIL ({duration_ms} ms; "
            f"{len(unmapped)} unmapped, {len(dangling)} dangling)"
        )
        for attribute in unmapped:
            print(f"  '{attribute}' has no ATTRIBUTE_COPY entry — it renders as the raw wire key")
        for attribute, key in dangling:
            print(f"  '{attribute}' → '{key}', which is not defined in {COPY_FILE}")
        print(f"Fix: add the entry in {DIFF_SHEET} and the copy key in {COPY_FILE}.")
        return 1

    print(
        f"check_diff_attribute_copy.py: OK ({duration_ms} ms; "
        f"{len(attributes)} diff attributes all labelled)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
