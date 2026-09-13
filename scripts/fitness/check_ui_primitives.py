#!/usr/bin/env python3
"""check_ui_primitives.py — prumo fitness function (ratchet).

Interaction-primitive rules (docs/superpowers/specs/
2026-09-12-interaction-primitives-design.md § 4.7):

* ``icon-button`` — ``<Button size="icon"|"icon-xs">`` outside
  ``components/patterns/IconButton.tsx``. An icon-only control must name
  itself, and IconButton makes the label a required prop.
* ``tooltip-provider`` — ``<TooltipProvider>`` outside ``App.tsx``,
  ``components/ui/tooltip.tsx`` and ``frontend/test/``. One root provider owns
  the delay; ``Tooltip`` supplies its own when rendered alone.
* ``cursor-class`` — ``cursor-pointer`` / ``cursor-default`` /
  ``cursor-not-allowed``. The rule lives in ``index.css`` ``@layer base``; a
  ``peer-*`` / ``group-*`` relational variant is allowed because base CSS
  cannot express it.
* ``overlay-size`` — a width, height or padding utility in the className of
  ``<DialogContent>``, ``<AlertDialogContent>`` or ``<SheetContent>``. The
  ``size`` prop owns the frame.
* ``settings-frame`` — in the settings surfaces (``SETTINGS_FRAME_SCOPE``), an
  import of ``ui/card`` or ``ui/alert`` (alias or relative, either quote), or
  one string literal holding an all-sides ``border``/``border-dashed`` token
  together with a ``rounded*`` token: the raw framed box. Settings are flat
  groups and rows (docs/superpowers/specs/2026-09-13-borderless-density-pass-
  design.md § 6).

Tags are walked, not regexed, reusing check_button_scale's parser (a ``>`` in
``() =>`` must not end a tag early). Test files are not scanned.

Baseline: one ``path:rule:count`` per offending file and rule. May shrink,
never grow. A missing baseline file means zero tolerance.

Exit codes: 0 (no growth, no new offender) | 1 (regression) | 2 (internal).
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from check_button_scale import (  # noqa: E402
    attr_text,
    class_text,
    iter_tags,
    split_variants,
    strip_comments,
)

DEFAULT_REPO_ROOT = SCRIPT_DIR.parent.parent
DEFAULT_BASELINE = SCRIPT_DIR / "check_ui_primitives.baseline"

SCAN_ROOT = "frontend"
SKIP_DIR_NAMES = {"node_modules", "dist", "build", ".git", "coverage"}
SKIP_NAME_MARKERS = (".test.", ".spec.", ".e2e.")

ICON_BUTTON_HOME = "frontend/components/patterns/IconButton.tsx"
ICON_SIZES = {"icon", "icon-xs"}
PROVIDER_ALLOWED_FILES = {"frontend/App.tsx", "frontend/components/ui/tooltip.tsx"}
PROVIDER_ALLOWED_DIRS = ("frontend/test/",)
OVERLAY_TAGS = ("<DialogContent", "<AlertDialogContent", "<SheetContent")
OVERLAY_BANNED_PREFIXES = (
    "w-",
    "min-w-",
    "max-w-",
    "h-",
    "min-h-",
    "max-h-",
    "size-",
    "p-",
    "px-",
    "py-",
    "pt-",
    "pb-",
    "pl-",
    "pr-",
    "ps-",
    "pe-",
)
CURSOR_BANNED = {"cursor-pointer", "cursor-default", "cursor-not-allowed"}
RELATIONAL_PREFIXES = ("peer-", "group-")
TOKEN = re.compile(r"[^\s\"'`{}(),;]+")
SETTINGS_FRAME_SCOPE = (
    "frontend/components/project/settings/",
    "frontend/components/user/",
    "frontend/components/settings/",
    "frontend/components/project/PicotsPane.tsx",
)
FRAME_IMPORT = re.compile(
    r"""\bfrom\s+(["'])(?:@/components/ui/|(?:\.{1,2}/)+(?:components/)?ui/)(?:card|alert)\1"""
)
STRING_LITERAL = re.compile(r""""([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`""")
BORDER_ALL_SIDES = {"border", "border-dashed"}

GUIDANCE = {
    "icon-button": "use <IconButton label=…> from components/patterns/IconButton.tsx",
    "tooltip-provider": "delete the provider; App.tsx owns the only one",
    "cursor-class": "delete the class; index.css @layer base owns the cursor",
    "overlay-size": "use the size prop (sm|md|lg, or narrow on SheetContent)",
    "settings-frame": "no card, callout or bordered box on settings surfaces; use SettingsGroup/SettingsRow",
}


def is_framed_box(literal: str) -> bool:
    """One class string with an all-sides border AND a radius: a raw frame."""
    bases = [split_variants(tok)[1] for tok in literal.split()]
    return any(b in BORDER_ALL_SIDES for b in bases) and any(
        b == "rounded" or b.startswith("rounded-") for b in bases
    )


def scan_file(rel: str, text: str) -> dict[str, int]:
    src = strip_comments(text)
    counts: dict[str, int] = {}

    def bump(rule: str) -> None:
        counts[rule] = counts.get(rule, 0) + 1

    if rel.endswith(".tsx"):
        if rel != ICON_BUTTON_HOME:
            for tag in iter_tags(src, "<Button"):
                if set(attr_text(tag, "size").split()) & ICON_SIZES:
                    bump("icon-button")
        if rel not in PROVIDER_ALLOWED_FILES and not rel.startswith(PROVIDER_ALLOWED_DIRS):
            for _ in iter_tags(src, "<TooltipProvider"):
                bump("tooltip-provider")
        for name in OVERLAY_TAGS:
            for tag in iter_tags(src, name):
                bases = (split_variants(tok)[1] for tok in class_text(tag).split())
                if any(b.startswith(OVERLAY_BANNED_PREFIXES) for b in bases):
                    bump("overlay-size")

    if rel.startswith(SETTINGS_FRAME_SCOPE):
        for _ in FRAME_IMPORT.finditer(src):
            bump("settings-frame")
        for line in src.splitlines():
            for m in STRING_LITERAL.finditer(line):
                if is_framed_box(next(g for g in m.groups() if g is not None)):
                    bump("settings-frame")

    for tok in TOKEN.findall(src):
        variants, base = split_variants(tok)
        if base in CURSOR_BANNED and not any(v.startswith(RELATIONAL_PREFIXES) for v in variants):
            bump("cursor-class")
    return counts


def offenders(repo_root: Path) -> dict[tuple[str, str], int]:
    found: dict[tuple[str, str], int] = {}
    base = repo_root / SCAN_ROOT
    if not base.exists():
        return found
    for path in sorted(base.rglob("*")):
        if path.suffix not in {".ts", ".tsx"} or not path.is_file():
            continue
        if any(part in SKIP_DIR_NAMES for part in path.parts):
            continue
        if any(marker in path.name for marker in SKIP_NAME_MARKERS):
            continue
        rel = path.relative_to(repo_root).as_posix()
        for rule, n in scan_file(rel, path.read_text(encoding="utf-8", errors="replace")).items():
            found[(rel, rule)] = n
    return found


def read_baseline(path: Path) -> dict[tuple[str, str], int]:
    out: dict[tuple[str, str], int] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        rel, rule, count = line.rsplit(":", 2)
        if count.isdigit():
            out[(rel, rule)] = int(count)
    return out


def write_baseline(path: Path, found: dict[tuple[str, str], int]) -> None:
    lines = [
        "# ui-primitives ratchet baseline — may shrink (--update-baseline), never grow.",
        "# Spec: docs/superpowers/specs/2026-09-12-interaction-primitives-design.md",
    ]
    lines += [f"{rel}:{rule}:{n}" for (rel, rule), n in sorted(found.items())]
    path.write_text("\n".join(lines) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", type=Path, default=DEFAULT_REPO_ROOT)
    ap.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    ap.add_argument("--update-baseline", action="store_true")
    args = ap.parse_args()

    found = offenders(args.repo_root)
    if args.update_baseline:
        write_baseline(args.baseline, found)
        print(f"ui-primitives baseline updated: {len(found)} entr(y/ies)")
        return 0

    baseline = read_baseline(args.baseline)
    failures = []
    for key, count in sorted(found.items()):
        allowed = baseline.get(key)
        if allowed is None:
            failures.append(("NEW ", key, count))
        elif count > allowed:
            failures.append(("GREW", key, count))

    if failures:
        print("check_ui_primitives: interaction-primitive rules regressed")
        for label, (rel, rule), count in failures:
            print(f"  {label} {rel}: {count} {rule} — {GUIDANCE[rule]}")
        print("\nSee .claude/skills/frontend-ux/SKILL.md (§ 4 and § 8).")
        return 1
    print(f"check_ui_primitives: OK ({len(found)} baselined entr(y/ies))")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - the harness contract wants exit 2
        print(f"check_ui_primitives: internal error: {exc}")
        sys.exit(2)
