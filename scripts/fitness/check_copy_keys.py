#!/usr/bin/env python3
"""check_copy_keys.py — prumo fitness function (ratchet).

All user-facing text lives in ``frontend/lib/copy/*.ts`` as flat ``as const``
object literals read through ``t(namespace, key)``. Keys go dead when their
consumer is deleted or rewritten, and nothing notices: knip reports unused
*exports*, never unused *members* of an exported object literal, so a copy
catalogue can rot indefinitely. ``extraction.ts`` reached 768 keys with 192
unreferenced before a manual sweep, which is what this check exists to prevent
recurring (CLAUDE.md, "No dead code ships — CI gates it").

A key is LIVE when its name appears in ``frontend/**/*.{ts,tsx}`` either quoted
(``'key'`` — the ``t(ns, 'key')`` and map-value forms) or as a property access
(``.key`` — the ``import { qa } from '@/lib/copy/qa'`` then ``qa.key`` form).
27 keys are live only through the second form, so both are required.

TWO LOAD-BEARING PRECONDITIONS, both verified across all 19 namespaces:

1. No copy key is assembled at runtime. Every one of the 53 non-literal
   ``t()`` call sites resolves through a lookup table whose VALUES are quoted
   literals (``MATCH_HINT_COPY``, ``VERDICT_CHIP``, ``ATTRIBUTE_COPY``, …), so
   the literal is always present in source. There is no template-literal key,
   no concatenation, and no ``as keyof typeof <ns>`` widening from ``string``.
   Introducing one would make live keys look dead here — and ``tsc`` could not
   catch it either, because the cast defeats the key union. If that ever
   happens, baseline the key and note the escape hatch at the call site. Note
   the asymmetry: a ``ns.key`` destructure (``const {key} = qa``) also reads as
   dead here, but ``tsc`` catches the resulting deletion; a ``keyof typeof``
   cast is caught by NOTHING — not this gate, not ``tsc``, not the suite.
2. ``frontend/lib/copy/**`` is excluded from the reference scan. A key's own
   definition must not count as its reference, and
   ``__tests__/extraction.legacyKeys.test.ts`` lists deleted key NAMES as bare
   string literals — in scope, re-adding any of them would read as referenced
   and be permanently un-flaggable.

Matching is namespace-blind: 22 key names exist in more than one namespace, so
``t('common', 'save')`` also keeps ``consensus.save`` alive. That direction is
safe — leniency retains a dead key, it never deletes a live one.

CLEARING BASELINE ENTRIES IS THE DANGEROUS DIRECTION, not adding them. ``t()``
returns ``''`` for a missing key, so a wrongly-deleted key ships as a blank
string in the UI rather than an error. A deletion PR must run, in this order:
``npm run typecheck`` (catches all three reference forms — verified against this
repo: ``TS2551`` on ``ns.key``, ``TS2345`` on ``t(ns, 'key')``, ``TS2820`` on a
typed map value; the "did you mean" variants, because copy namespaces are full
of near-identical names), THEN
``npm run test:run`` — typecheck green is NOT suite green, because
``__tests__/extraction.legacyKeys.test.ts`` and ``frontend/test/copyRuns.test.ts``
assert key PRESENCE at runtime, which no type check sees.

Baseline format: one ``path:key`` per currently-unreferenced key. Permissive
downward — a baselined key that becomes referenced passes, and the entry is
reported as tightenable. A key not in the baseline fails.

Usage:
  python check_copy_keys.py [--repo-root P] [--baseline P]
                            [--jsonl-out P] [--emit-telemetry P]
  python check_copy_keys.py --update-baseline

Exit codes: 0 (no new dead keys) | 1 (regression) | 2 (internal).
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
DEFAULT_BASELINE = SCRIPT_DIR / "check_copy_keys.baseline"

COPY_DIR = "frontend/lib/copy"
SCAN_ROOT = "frontend"
SCAN_EXTS = {".ts", ".tsx"}
SKIP_DIR_NAMES = {"node_modules", "dist", "build", ".git", "coverage"}
# The top-level index.ts re-exports the namespaces and names no individual key.
# Matched by PATH, not by name: a `copy/qa/index.ts` barrel IS a namespace, and
# excluding it by name made one invisible in both directions.
NOT_A_NAMESPACE = "index.ts"
IS_TEST = re.compile(r"/__tests__/|\.test\.tsx?$|\.spec\.tsx?$")

# Two reference forms, extracted as token SETS in one pass per file: matching
# 2000+ keys individually against the corpus takes minutes and blows the ≤2 s
# budget in README.md; set-intersection is ~0.4 s. Tokenising also gives word
# boundaries for free, which matters because 179 keys are a substring of
# another key (`back` is a prefix of `backToProjects`).
QUOTED = re.compile(r"['\"`]([A-Za-z_$][\w$]*)['\"`]")
DOTTED = re.compile(r"\.([A-Za-z_$][\w$]*)")

# Used per top-level construct inside parse_namespace's walk.
KEY_AT = re.compile(r"([A-Za-z_$][\w$]*)\s*:")
WORD_AT = re.compile(r"[A-Za-z_$][\w$]*")


class ParseError(Exception):
    """A namespace file whose shape this parser cannot vouch for.

    Raised rather than skipped ON PURPOSE. This gate's characteristic failure
    is silence: a namespace that fails to parse reports zero dead keys and the
    ratchet stays green forever, which is worse than no gate at all because it
    reads as assurance. Anchoring on indent would be the same bug by another
    route — ``qa.ts``, ``runs.ts`` and ``templateConfig.ts`` indent keys by 2
    while the rest use 4, so a ``^ {4}`` parser drops 363 keys silently.
    """


def parse_namespace(path: Path) -> list[str]:
    """Return the top-level keys of one ``export const <ns> = {...} as const;``.

    A brace-depth walk that understands strings, template literals and
    comments. A line regex is exact on today's tree but only accidentally: 93+
    keys wrap their value onto the next line, so one future template-literal
    value containing a line like ``  note: x`` would mint a phantom key.
    """
    src = path.read_text(encoding="utf-8")
    headers = list(re.finditer(r"^export const [A-Za-z_$][\w$]* = \{", src, re.M))
    if not headers:
        raise ParseError(f"{path}: no `export const <ns> = {{` header")
    if len(headers) > 1:
        # Parsing only the first would silently drop every key of the second —
        # and an icon/aria helper map declared above the namespace is an
        # ordinary thing to write. Refuse; the fix is one namespace per file.
        raise ParseError(
            f"{path}: {len(headers)} top-level `export const … = {{` declarations; "
            "a namespace file must hold exactly one"
        )
    header = headers[0]

    keys: list[str] = []
    # The namespace literal is entered exactly once and any nested `{` raises,
    # so this is a flag, not a depth counter.
    inside = False
    bracket = 0
    # True only where a KEY may legally start: right after `{` or after the
    # `,` that ended the previous entry. Without this, a value's own contents
    # (`importGuidanceRules: [...]` in templateConfig.ts is an array, not a
    # string) get misread as malformed keys.
    expecting_key = False
    i = header.end() - 1  # position of the opening brace
    n = len(src)
    while i < n:
        ch = src[i]

        # --- skip over anything that can contain a brace or a colon ---
        if ch == "/" and i + 1 < n and src[i + 1] == "/":
            i = src.find("\n", i)
            if i == -1:
                break
            continue
        if ch == "/" and i + 1 < n and src[i + 1] == "*":
            end = src.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        if ch in "\"'`":
            quote, i = ch, i + 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == quote:
                    i += 1
                    break
                i += 1
            continue

        if ch == "{":
            if inside:
                # Keys of a nested object would never be collected — ungated
                # copy, reported as zero dead keys.
                raise ParseError(f"{path}: nested object value at offset {i}")
            inside = True
            expecting_key = True
            i += 1
            continue
        if ch == "}":
            inside = False
            break
        if ch == "[":
            bracket += 1
            i += 1
            continue
        if ch == "]":
            bracket -= 1
            i += 1
            continue
        if ch == "," and bracket == 0:
            expecting_key = True
            i += 1
            continue

        # --- where a key may start, it must be `<identifier>:` and nothing else ---
        if expecting_key and bracket == 0 and not ch.isspace():
            m = KEY_AT.match(src, i)
            if m is None:
                # A spread (`...base`), a computed key (`['x']:`) or a quoted
                # key (`'x':`) would all be silently ungated, so refuse to guess.
                word = WORD_AT.match(src, i)
                raise ParseError(
                    f"{path}: unclassifiable top-level construct "
                    f"{(word.group(0) if word else ch)!r} at offset {i}"
                )
            keys.append(m.group(1))
            expecting_key = False
            i = m.end()
            continue

        i += 1

    if inside:
        raise ParseError(f"{path}: the namespace literal never closes")
    if not keys:
        raise ParseError(f"{path}: parsed zero keys")
    dupes = {k for k in keys if keys.count(k) > 1}
    if dupes:
        raise ParseError(f"{path}: duplicate keys {sorted(dupes)}")
    return keys


def namespace_files(root: Path) -> list[Path]:
    """Every namespace module under the copy directory.

    Searched RECURSIVELY and across module suffixes on purpose. A
    non-recursive ``glob('*.ts')`` misses ``copy/domain/nested.ts`` and
    ``copy/en/qa.ts`` — and because the copy directory is also excluded from
    the reference scan, such a file is invisible in BOTH directions: its keys
    are never gated and never counted, forever green. ``copy/__tests__/``
    already exists, so subdirectories here are an established pattern.
    """
    copy_dir = root / COPY_DIR
    if not copy_dir.is_dir():
        raise ParseError(f"{copy_dir}: copy directory not found")
    files = sorted(
        p
        for p in copy_dir.rglob("*")
        if p.suffix in SCAN_EXTS
        and p.is_file()
        and p != copy_dir / NOT_A_NAMESPACE
        and not p.name.endswith(".d.ts")
        and not IS_TEST.search(p.as_posix())
    )
    if not files:
        # The empty-set case the shape guards cannot see: zero namespaces
        # yields zero dead keys and a green OK. Reads as assurance, protects
        # nothing — exactly what this check exists to prevent.
        raise ParseError(f"{copy_dir}: no namespace modules found")
    return files


def referenced_tokens(root: Path) -> set[str]:
    """Every identifier that appears quoted or after a dot in frontend code."""
    tokens: set[str] = set()
    scan_root = (root / SCAN_ROOT).resolve()
    copy_dir = (root / COPY_DIR).resolve()
    if not scan_root.is_dir():
        raise ParseError(f"{scan_root}: scan root not found")
    # Unsorted: the result is a set, so iteration order cannot reach it. The
    # check's determinism comes from `sorted(dead)` in unreferenced().
    for path in scan_root.rglob("*"):
        if path.suffix not in SCAN_EXTS or not path.is_file():
            continue
        # Relative to the scan root: `path.parts` includes every ancestor up
        # to `/`, so a checkout under a directory named `build` or `coverage`
        # would skip every file and report all ~2100 live keys as dead. In the
        # other ratchets a skipped file only loses findings; here it MANUFACTURES
        # them, each one reading "delete this live copy".
        if any(part in SKIP_DIR_NAMES for part in path.relative_to(scan_root).parts):
            continue
        # Precondition 2: a key's own catalogue is never its own reference.
        if path.resolve().is_relative_to(copy_dir):
            continue
        try:
            src = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        tokens.update(QUOTED.findall(src))
        tokens.update(DOTTED.findall(src))
    return tokens


def unreferenced(root: Path) -> list[str]:
    """Sorted ``path:key`` for every copy key with no reference in frontend/."""
    live = referenced_tokens(root)
    dead: list[str] = []
    for path in namespace_files(root):
        rel = path.relative_to(root).as_posix()
        for key in parse_namespace(path):
            if key not in live:
                dead.append(f"{rel}:{key}")
    return sorted(dead)


def read_baseline(path: Path) -> dict[str, str]:
    """Map each baselined ``path:key`` to its optional inline ``# reason``."""
    if not path.is_file():
        return {}
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        # An inline `# reason` is the documented way to accept a regression
        # (.github/workflows/ci.yml, and check_scope_guards.baseline uses it).
        # Without stripping it the entry never matches and the check reports
        # the baselined key as NEW.
        entry, _, reason = line.partition("#")
        entry = entry.strip()
        if not entry:
            continue
        rel, _, key = entry.rpartition(":")
        if rel and key:
            out[f"{rel}:{key}"] = reason.strip()
    return out


def write_baseline(path: Path, found: list[str], reasons: dict[str, str]) -> None:
    lines = [
        "# copy-key ratchet baseline — UI copy keys with no reference in frontend/**.",
        "# Format: <namespace-file>:<key>. May shrink (re-run --update-baseline to",
        "# tighten), never grow. Clearing an entry DELETES user-facing copy: run",
        "# `npm run typecheck` AND `npm run test:run` — t() returns '' for a missing",
        "# key, so a wrong deletion ships as a blank string, not an error.",
    ]
    # Carry each entry's `# reason` forward — losing the per-entry why is what
    # makes a 200-entry burn-down unreviewable.
    lines += [f"{e}  # {reasons[e]}" if reasons.get(e) else e for e in found]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    started = time.time()
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", type=Path, default=DEFAULT_REPO_ROOT)
    ap.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    ap.add_argument("--jsonl-out", type=Path, default=None)
    ap.add_argument("--emit-telemetry", type=Path, default=None)
    ap.add_argument("--update-baseline", action="store_true")
    args = ap.parse_args()

    found = unreferenced(args.repo_root.resolve())

    if args.update_baseline:
        write_baseline(args.baseline, found, read_baseline(args.baseline))
        print(f"copy-key baseline updated: {len(found)} unreferenced key(s)")
        return 0

    baseline = read_baseline(args.baseline)
    regressions = [entry for entry in found if entry not in baseline]
    tightenable = len(baseline) - len([e for e in found if e in baseline])

    if args.jsonl_out:
        with args.jsonl_out.open("w", encoding="utf-8") as fh:
            for entry in regressions:
                rel, _, key = entry.rpartition(":")
                fh.write(
                    json.dumps(
                        {
                            "category": "dead-code",
                            "severity": "medium",
                            "confidence": "high",
                            "file": rel,
                            "line": 0,
                            "evidence": f"copy key {key!r} has no reference in frontend/**",
                            "suggested_action": (
                                f"delete {key!r} from {rel}, or baseline it with a `# reason`"
                            ),
                            "source": "fitness:check_copy_keys:unreferenced-key",
                        }
                    )
                    + "\n"
                )

    duration_ms = int((time.time() - started) * 1000)
    exit_code = 1 if regressions else 0

    if args.emit_telemetry:
        with args.emit_telemetry.open("a", encoding="utf-8") as fh:
            fh.write(
                json.dumps(
                    {
                        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "phase": "fitness",
                        "gate": "check_copy_keys",
                        "duration_ms": duration_ms,
                        "exit_code": exit_code,
                    }
                )
                + "\n"
            )

    if regressions:
        print(
            f"check_copy_keys.py: FAIL ({duration_ms} ms; "
            f"{len(regressions)} newly unreferenced key(s))"
        )
        for entry in regressions:
            print(f"  NEW {entry}")
        print(
            "Delete the key, or (only if intentional) run --update-baseline and "
            f"commit {args.baseline.name}."
        )
        return 1

    msg = (
        f"check_copy_keys.py: OK ({duration_ms} ms; "
        f"{len(found)} unreferenced key(s), all baselined)"
    )
    if tightenable:
        msg += f"; {tightenable} baseline entry(ies) now clean — --update-baseline to tighten"
    print(msg)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - the harness contract wants exit 2
        print(f"check_copy_keys: internal error: {exc}")
        sys.exit(2)
