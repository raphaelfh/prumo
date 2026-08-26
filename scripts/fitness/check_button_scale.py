#!/usr/bin/env python3
"""check_button_scale.py — prumo fitness function (ratchet).

The button scale in ``frontend/components/ui/button.tsx`` owns button heights.
A ``h-*`` utility in a ``<Button>`` className means the call site is fighting
the scale — the drift that let five different heights coexist across 254
buttons. Baselined files may not GROW; no new file may introduce an override.
Shrinking is always allowed (re-run ``--update-baseline`` to tighten).

Why this is a parser and not a regex: an adversarial review of the naive
version (``<Button\\b(.*?)>`` + ``className="([^"]*)"``) proved it misses ~20%
of real drift. Two failure modes, both live in this repo:

* the non-greedy tag match stops at the first ``>``, which ``onClick={() =>
  …}`` or ``disabled={page >= n}`` supplies BEFORE ``className``;
* ``className={cn("h-8")}`` — the house idiom — is not a quoted literal.

Either one is a one-keystroke escape hatch, so the gate has to walk the tag.

Baseline format: one ``path:count`` per currently-offending file.

Usage:
  python check_button_scale.py [--repo-root P] [--baseline P]
                               [--jsonl-out P] [--emit-telemetry P]
  python check_button_scale.py --update-baseline

Exit codes: 0 (no growth, no new offender) | 1 (regression) | 2 (internal).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_REPO_ROOT = SCRIPT_DIR.parent.parent
DEFAULT_BASELINE = SCRIPT_DIR / "check_button_scale.baseline"

SCAN_ROOT = "frontend"
SKIP_DIR_NAMES = {"node_modules", "dist", "build", ".git", "coverage"}
TAG = "<Button"
# A char right after "<Button" that means this is a DIFFERENT component
# (<ButtonGroup, <Button.Root) rather than the Button itself.
IDENT_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-")
QUOTES = "\"'`"


def strip_comments(src: str) -> str:
    """Blank out // and /* */ comments, preserving length and newlines.

    A `<Button className="h-8">` inside a JSDoc usage example is documentation,
    not drift (frontend/components/patterns/PageHeader.tsx has one).
    """
    out = list(src)
    i, n = 0, len(src)
    while i < n:
        ch = src[i]
        if ch in QUOTES:
            quote = ch
            i += 1
            while i < n and src[i] != quote:
                if src[i] == "\\":
                    i += 1
                i += 1
            i += 1
            continue
        if ch == "/" and i + 1 < n and src[i + 1] == "/":
            while i < n and src[i] != "\n":
                out[i] = " "
                i += 1
            continue
        if ch == "/" and i + 1 < n and src[i + 1] == "*":
            while i < n and not (src[i] == "*" and i + 1 < n and src[i + 1] == "/"):
                if src[i] != "\n":
                    out[i] = " "
                i += 1
            for j in range(i, min(i + 2, n)):
                out[j] = " "
            i += 2
            continue
        i += 1
    return "".join(out)


def tag_end(src: str, start: int) -> int:
    """Index of the `>` closing the tag opened at `start`, or -1.

    Walks past braces, parens, brackets and every string flavour, so a `>` in
    `() =>` or `a >= b` does not end the tag early.
    """
    i, n = start, len(src)
    depth = 0
    while i < n:
        ch = src[i]
        if ch in QUOTES:
            quote = ch
            i += 1
            while i < n and src[i] != quote:
                if src[i] == "\\":
                    i += 1
                i += 1
            i += 1
            continue
        if ch in "{([":
            depth += 1
        elif ch in "})]":
            depth -= 1
        elif ch == ">" and depth == 0:
            return i
        i += 1
    return -1


def class_text(tag_src: str) -> str:
    """Every class-name string literal an opening tag's className can carry.

    Handles `className="…"`, `className='…'`, and `className={…}` — pulling
    every literal out of the braced expression so `cn("h-8", cond && "h-6")`
    and template literals are both covered.
    """
    idx = tag_src.find("className")
    if idx == -1:
        return ""
    i = idx + len("className")
    while i < len(tag_src) and tag_src[i] in " \t\n":
        i += 1
    if i >= len(tag_src) or tag_src[i] != "=":
        return ""
    i += 1
    while i < len(tag_src) and tag_src[i] in " \t\n":
        i += 1
    if i >= len(tag_src):
        return ""

    if tag_src[i] in "\"'":
        quote = tag_src[i]
        end = tag_src.find(quote, i + 1)
        return tag_src[i + 1 : end] if end != -1 else ""

    if tag_src[i] != "{":
        return ""
    depth = 0
    start = i
    while i < len(tag_src):
        ch = tag_src[i]
        if ch in QUOTES:
            quote = ch
            i += 1
            while i < len(tag_src) and tag_src[i] != quote:
                if tag_src[i] == "\\":
                    i += 1
                i += 1
            i += 1
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    expr = tag_src[start : i + 1]

    parts: list[str] = []
    j = 0
    while j < len(expr):
        if expr[j] in QUOTES:
            quote = expr[j]
            j += 1
            buf = []
            while j < len(expr) and expr[j] != quote:
                if expr[j] == "\\":
                    j += 1
                buf.append(expr[j])
                j += 1
            parts.append("".join(buf))
        j += 1
    return " ".join(parts)


def split_variants(token: str) -> tuple[list[str], str]:
    """`sm:h-8` → (['sm'], 'h-8'); `[@media(pointer:coarse)]:h-11` → (['[@media(pointer:coarse)]'], 'h-11')."""
    parts: list[str] = []
    depth = 0
    current: list[str] = []
    for ch in token:
        if ch in "[(":
            depth += 1
        elif ch in "])":
            depth -= 1
        if ch == ":" and depth == 0:
            parts.append("".join(current))
            current = []
            continue
        current.append(ch)
    parts.append("".join(current))
    return parts[:-1], parts[-1]


def is_button_height(token: str) -> bool:
    """True for a utility that sets the BUTTON's own height.

    `min-h-9`/`max-h-96` are not height overrides. `[&_svg]:h-3.5` targets a
    descendant, not the button box. `sm:h-8` IS an override — a breakpoint
    does not excuse it.
    """
    variants, base = split_variants(token)
    if any("&" in v for v in variants):
        return False
    return base.startswith("h-") and len(base) > 2


def scan_file(text: str) -> int:
    src = strip_comments(text)
    count = 0
    pos = 0
    while True:
        idx = src.find(TAG, pos)
        if idx == -1:
            return count
        after = idx + len(TAG)
        pos = after
        if after < len(src) and src[after] in IDENT_CHARS:
            continue  # <ButtonGroup, <Button.Root — a different component
        end = tag_end(src, after)
        if end == -1:
            continue
        classes = class_text(src[after:end])
        if any(is_button_height(tok) for tok in classes.split()):
            count += 1


def offenders(repo_root: Path) -> dict[str, int]:
    found: dict[str, int] = {}
    base = repo_root / SCAN_ROOT
    if not base.exists():
        return found
    for path in sorted(base.rglob("*.tsx")):
        if any(part in SKIP_DIR_NAMES for part in path.parts):
            continue
        if ".test." in path.name:
            continue
        count = scan_file(path.read_text(encoding="utf-8", errors="replace"))
        if count:
            found[path.relative_to(repo_root).as_posix()] = count
    return found


def read_baseline(path: Path) -> dict[str, int]:
    if not path.exists():
        return {}
    out: dict[str, int] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        rel, _, count = line.rpartition(":")
        if rel and count.isdigit():
            out[rel] = int(count)
    return out


def write_baseline(path: Path, found: dict[str, int]) -> None:
    lines = [
        "# button-scale ratchet baseline — files still overriding button height.",
        "# May shrink (re-run --update-baseline to tighten), never grow.",
        "# The scale owns height: see .claude/skills/frontend-ux/SKILL.md.",
    ]
    lines += [f"{rel}:{n}" for rel, n in sorted(found.items())]
    path.write_text("\n".join(lines) + "\n")


def main() -> int:
    started = time.time()
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", type=Path, default=DEFAULT_REPO_ROOT)
    ap.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    ap.add_argument("--jsonl-out", type=Path, default=None)
    ap.add_argument("--emit-telemetry", type=Path, default=None)
    ap.add_argument("--update-baseline", action="store_true")
    args = ap.parse_args()

    found = offenders(args.repo_root)

    if args.update_baseline:
        write_baseline(args.baseline, found)
        print(f"button-scale baseline updated: {len(found)} file(s)")
        return 0

    baseline = read_baseline(args.baseline)
    failures: list[tuple[str, str, int]] = []
    for rel, count in sorted(found.items()):
        allowed = baseline.get(rel)
        if allowed is None:
            failures.append((rel, "new-offender", count))
        elif count > allowed:
            failures.append((rel, "grew", count))

    if args.jsonl_out:
        with args.jsonl_out.open("w", encoding="utf-8") as fh:
            for rel, rule, count in failures:
                fh.write(
                    json.dumps(
                        {
                            "source": f"fitness:check_button_scale.py:{rule}",
                            "path": rel,
                            "count": count,
                            "message": f"{count} button height override(s) in {rel}",
                        }
                    )
                    + "\n"
                )

    exit_code = 1 if failures else 0

    if args.emit_telemetry:
        with args.emit_telemetry.open("a", encoding="utf-8") as fh:
            fh.write(
                json.dumps(
                    {
                        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "phase": "fitness",
                        "gate": "check_button_scale.py",
                        "duration_ms": int((time.time() - started) * 1000),
                        "exit_code": exit_code,
                    }
                )
                + "\n"
            )

    if failures:
        print("check_button_scale: button height overrides regressed")
        for rel, rule, count in failures:
            label = "NEW " if rule == "new-offender" else "GREW"
            print(f"  {label} {rel}: {count} button height override(s)")
        print("\nUse a named size instead of a height class.")
        print("See .claude/skills/frontend-ux/SKILL.md (Buttons).")
        return 1

    print(f"check_button_scale: OK ({len(found)} baselined file(s))")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - the harness contract wants exit 2
        print(f"check_button_scale: internal error: {exc}")
        sys.exit(2)
