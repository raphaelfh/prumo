---
status: shipped
last_reviewed: 2026-09-13
owner: '@raphaelfh'
---

# Interaction Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One cursor rule, one tooltip timing and look, an `IconButton` with a required label, and one overlay frame for Dialog/AlertDialog/Sheet, each held at zero by a fitness gate.

**Architecture:** Primitives change first (`frontend/components/ui/*`, a new `components/patterns/IconButton.tsx`, a base-layer cursor block), guarded by a new ratchet `scripts/fitness/check_ui_primitives.py` whose baseline starts at today's violations. Call sites then migrate in four PRs; each PR shrinks one rule of the baseline to zero, and the last deletes the baseline.

**Tech Stack:** React 19, TypeScript strict, Tailwind v4 + `tailwindcss-animate`, Radix (`react-tooltip` 1.2.16, `react-dialog`, `react-alert-dialog`), class-variance-authority, vitest + RTL, Python 3 fitness scripts tested with pytest.

**Spec:** `docs/superpowers/specs/2026-09-12-interaction-primitives-design.md` (read it; § 9 "Amendments from planning" records where this plan corrects it).

## Global Constraints

- Frontend tooling runs from the **repo root** (`npm run …`, `npx vitest run <file>`). Never `cd frontend`.
- All user-facing text through `frontend/lib/copy/*` via `t(ns, key)`; `{{x}}` placeholders are filled with `.replace('{{x}}', value)`.
- Button heights come from the size scale only (`check_button_scale.py`). No `h-*` on a `<Button>`.
- Tooltip delay: `delayDuration={400}`, `skipDelayDuration={300}`, owned by one `TooltipProvider` in `frontend/App.tsx`.
- Dialog sizes: `sm` 400px, `md` 560px (default Dialog), `lg` 800px with fixed `85dvh`; `AlertDialogContent` defaults to `sm`. Sheet widths: `default` 420px, `narrow` 320px.
- Overlay motion: dialog 150ms in / 100ms out; sheet 200ms in / 150ms out; tooltip 100ms fade; every animation carries `motion-reduce:animate-none`.
- Cursor: arrow on every control, hand only on `a[href]`, `not-allowed` on disabled. Only `peer-*`/`group-*` relational `cursor-not-allowed` classes may remain in components; `cursor-col-resize`/`cursor-grabbing` stay as classes.
- knip at zero in both `npx knip` and `npx knip --production`; copy-key ratchet (`check_copy_keys.py`) must stay green — delete a key the moment it loses its last reference.
- Commits: conventional, ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. PRs target `dev`, squash-merged, one armed auto-merge at a time.
- Before every PR: `npm run typecheck && npm run lint && npm run test:run && npx knip && npx knip --production && bash scripts/fitness/run_all.sh`, then the `code-review` skill.

## Delivery

| PR | Tasks | Gate rules at zero after merge |
|---|---|---|
| 1 Foundations | 1–5 | none (baseline armed) |
| 2 Icon buttons | 6–9 | `icon-button`, `tooltip-provider` |
| 3 Cursor | 10 | `cursor-class` |
| 4 Overlay frame | 11–15 | `overlay-size`; baseline file deleted |

Work in one worktree (`superpowers:using-git-worktrees`), branch `feat/interaction-primitives-<n>` per PR, each cut from `dev` after the previous PR merged.

## File map

| File | Responsibility | Task |
|---|---|---|
| `scripts/fitness/check_ui_primitives.py` (new) | four-rule ratchet | 1 |
| `scripts/fitness/check_ui_primitives.baseline` (new, deleted in 15) | today's violations | 1 |
| `scripts/fitness/check_button_scale.py` | gains generic `attr_text()` reused by the new gate | 1 |
| `backend/tests/unit/scripts/test_check_ui_primitives{,_canary}.py` (new) | green + canary tests | 1, 15 |
| `frontend/components/ui/tooltip.tsx` | provider with defaults, provider fallback, inverted pill look | 2 |
| `frontend/components/patterns/IconButton.tsx` (new) | the one icon-only control | 3 |
| `frontend/components/ui/button.tsx` | ghost active fill, `duration-75` | 3 |
| `frontend/components/layout/HeaderIconButton.tsx`, `frontend/pdf-viewer/ui/ToolbarIconButton.tsx` | deleted; callers move to `IconButton` | 4 |
| `frontend/index.css` | cursor block in `@layer base`; `--shadow-overlay` token | 5, 11 |
| `frontend/components/ui/overlay-frame.ts` (new) | shared overlay class strings + size cva | 11 |
| `frontend/components/ui/{dialog,alert-dialog,sheet}.tsx` | frame, `size`, `DialogBody`/`AlertDialogBody`, `showCloseButton` | 11–13 |
| `frontend/components/patterns/AppDialog.tsx` | rewritten on the frame | 14 |
| `.claude/skills/frontend-ux/SKILL.md`, `.claude/skills/ui-styling/SKILL.md`, `.claude/rules/frontend.md` | rules the gate enforces | 5, 15 |

---

## PR 1 — Foundations

### Task 1: `check_ui_primitives.py` ratchet

**Files:**
- Modify: `scripts/fitness/check_button_scale.py` (replace `class_text`, lines ~119–180)
- Create: `scripts/fitness/check_ui_primitives.py`, `scripts/fitness/check_ui_primitives.baseline`
- Create: `backend/tests/unit/scripts/test_check_ui_primitives_canary.py`, `backend/tests/unit/scripts/test_check_ui_primitives.py`
- Modify: `scripts/fitness/run_all.sh` (after the `check_button_scale.py` block), `scripts/fitness/README.md` (check list)

**Interfaces:**
- Produces: `attr_text(tag_src: str, attr: str) -> str` in `check_button_scale.py`; CLI `python3 scripts/fitness/check_ui_primitives.py [--repo-root P] [--baseline P] [--update-baseline]`, exit 0/1/2; baseline lines `path:rule:count` with rules `icon-button`, `tooltip-provider`, `cursor-class`, `overlay-size`.

- [ ] **Step 1: Write the canary test**

`backend/tests/unit/scripts/test_check_ui_primitives_canary.py`:

```python
"""Canary for scripts/fitness/check_ui_primitives.py.

Each planted violation MUST fail the check, and each allowed shape MUST pass,
or the gate lies (scripts/fitness/README.md: a check without a canary is
decorative).
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_ui_primitives.py"


def _run(root: Path, baseline: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(CHECK), "--repo-root", str(root), "--baseline", str(baseline), *extra],
        capture_output=True,
        text=True,
        timeout=20,
    )


def _plant(root: Path, rel: str, body: str) -> None:
    f = root / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(body)


VIOLATIONS = [
    ("icon-button", "frontend/components/a/X.tsx", '<Button onClick={() => a >= b} size="icon"><X/></Button>'),
    ("icon-button", "frontend/components/a/X.tsx", "<Button size={'icon-xs'} />"),
    ("tooltip-provider", "frontend/components/a/X.tsx", "<TooltipProvider delayDuration={0}><div/></TooltipProvider>"),
    ("cursor-class", "frontend/components/a/x.ts", 'export const c = cn("cursor-pointer");'),
    ("cursor-class", "frontend/components/a/X.tsx", '<div className="hover:cursor-default" />'),
    ("overlay-size", "frontend/components/a/X.tsx", '<DialogContent className="sm:max-w-md">x</DialogContent>'),
    ("overlay-size", "frontend/components/a/X.tsx", '<AlertDialogContent className={cn("p-0")}>x</AlertDialogContent>'),
    ("overlay-size", "frontend/components/a/X.tsx", '<SheetContent side="left" className="w-[320px]">x</SheetContent>'),
]

ALLOWED = [
    ("frontend/components/patterns/IconButton.tsx", '<Button size="icon" />'),
    ("frontend/components/a/X.tsx", '<ButtonGroup size="icon" />'),
    ("frontend/App.tsx", "<TooltipProvider><App/></TooltipProvider>"),
    ("frontend/components/ui/tooltip.tsx", "<TooltipProvider>{root}</TooltipProvider>"),
    ("frontend/test/helpers/render.tsx", "<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>"),
    ("frontend/components/a/X.tsx", "// <TooltipProvider> in a comment\nexport const a = 1;"),
    ("frontend/components/a/X.tsx", '<Label className="peer-disabled:cursor-not-allowed" />'),
    ("frontend/components/a/X.tsx", '<div className="cursor-col-resize cursor-grabbing" />'),
    ("frontend/components/a/X.test.tsx", '<Button size="icon" className="cursor-pointer" />'),
    ("frontend/components/a/X.tsx", '<DialogContent size="lg" data-testid="d" className="flex flex-col">x</DialogContent>'),
]


@pytest.mark.parametrize(("rule", "rel", "body"), VIOLATIONS)
def test_violation_fails(tmp_path: Path, rule: str, rel: str, body: str) -> None:
    _plant(tmp_path, rel, body)
    proc = _run(tmp_path, tmp_path / "none.baseline")
    assert proc.returncode == 1, proc.stdout
    assert rule in proc.stdout


@pytest.mark.parametrize(("rel", "body"), ALLOWED)
def test_allowed_shape_passes(tmp_path: Path, rel: str, body: str) -> None:
    _plant(tmp_path, rel, body)
    proc = _run(tmp_path, tmp_path / "none.baseline")
    assert proc.returncode == 0, proc.stdout


def test_baselined_count_passes_and_growth_fails(tmp_path: Path) -> None:
    rel = "frontend/components/a/X.tsx"
    baseline = tmp_path / "b.baseline"
    baseline.write_text(f"{rel}:icon-button:1\n")
    _plant(tmp_path, rel, '<Button size="icon" />')
    assert _run(tmp_path, baseline).returncode == 0
    _plant(tmp_path, rel, '<Button size="icon" /><Button size="icon" />')
    proc = _run(tmp_path, baseline)
    assert proc.returncode == 1
    assert "GREW" in proc.stdout


def test_update_baseline_writes_counts(tmp_path: Path) -> None:
    rel = "frontend/components/a/X.tsx"
    _plant(tmp_path, rel, '<Button size="icon" /><div className="cursor-pointer" />')
    baseline = tmp_path / "b.baseline"
    assert _run(tmp_path, baseline, "--update-baseline").returncode == 0
    text = baseline.read_text()
    assert f"{rel}:icon-button:1" in text
    assert f"{rel}:cursor-class:1" in text
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && uv run pytest tests/unit/scripts/test_check_ui_primitives_canary.py -q`
Expected: every case FAILS (the script does not exist: returncode 2).

- [ ] **Step 3: Generalise `class_text` in `check_button_scale.py`**

Replace the whole `class_text` function with:

```python
def _attr_value_start(tag_src: str, attr: str) -> int:
    """Index of the first char of `attr`'s value in an opening tag, or -1.

    Skips names that merely contain `attr` (`iconSize`, `data-size`) and
    occurrences not followed by `=`.
    """
    n = len(tag_src)
    pos = 0
    while True:
        idx = tag_src.find(attr, pos)
        if idx == -1:
            return -1
        pos = idx + len(attr)
        if idx > 0 and (tag_src[idx - 1].isalnum() or tag_src[idx - 1] in "_-"):
            continue
        i = pos
        while i < n and tag_src[i] in " \t\n":
            i += 1
        if i >= n or tag_src[i] != "=":
            continue
        i += 1
        while i < n and tag_src[i] in " \t\n":
            i += 1
        return i if i < n else -1


def attr_text(tag_src: str, attr: str) -> str:
    """Every string literal a JSX attribute's value can carry.

    Handles `attr="…"`, `attr='…'`, and `attr={…}` — pulling every literal out
    of the braced expression so `cn("h-8", cond && "h-6")` and template
    literals are both covered.
    """
    i = _attr_value_start(tag_src, attr)
    if i == -1:
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


def class_text(tag_src: str) -> str:
    """Every class-name string literal an opening tag's className can carry."""
    return attr_text(tag_src, "className")
```

Run: `cd backend && uv run pytest tests/unit/scripts/test_check_button_scale.py tests/unit/scripts/test_check_button_scale_canary.py -q`
Expected: PASS (the refactor changes no verdict).

- [ ] **Step 4: Write `check_ui_primitives.py`**

```python
#!/usr/bin/env python3
"""check_ui_primitives.py — prumo fitness function (ratchet).

Four interaction-primitive rules (docs/superpowers/specs/
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
    IDENT_CHARS,
    attr_text,
    class_text,
    split_variants,
    strip_comments,
    tag_end,
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
    "w-", "min-w-", "max-w-", "h-", "min-h-", "max-h-", "size-",
    "p-", "px-", "py-", "pt-", "pb-", "pl-", "pr-", "ps-", "pe-",
)
CURSOR_BANNED = {"cursor-pointer", "cursor-default", "cursor-not-allowed"}
RELATIONAL_PREFIXES = ("peer-", "group-")
TOKEN = re.compile(r"[^\s\"'`{}(),;]+")

GUIDANCE = {
    "icon-button": "use <IconButton label=…> from components/patterns/IconButton.tsx",
    "tooltip-provider": "delete the provider; App.tsx owns the only one",
    "cursor-class": "delete the class; index.css @layer base owns the cursor",
    "overlay-size": "use the size prop (sm|md|lg, or narrow on SheetContent)",
}


def _tags(src: str, name: str):
    pos = 0
    while True:
        idx = src.find(name, pos)
        if idx == -1:
            return
        after = idx + len(name)
        pos = after
        if after < len(src) and src[after] in IDENT_CHARS:
            continue
        end = tag_end(src, after)
        if end != -1:
            yield src[after:end]


def scan_file(rel: str, text: str) -> dict[str, int]:
    src = strip_comments(text)
    counts: dict[str, int] = {}

    def bump(rule: str) -> None:
        counts[rule] = counts.get(rule, 0) + 1

    if rel.endswith(".tsx"):
        if rel != ICON_BUTTON_HOME:
            for tag in _tags(src, "<Button"):
                if set(attr_text(tag, "size").split()) & ICON_SIZES:
                    bump("icon-button")
        if rel not in PROVIDER_ALLOWED_FILES and not rel.startswith(PROVIDER_ALLOWED_DIRS):
            for _ in _tags(src, "<TooltipProvider"):
                bump("tooltip-provider")
        for name in OVERLAY_TAGS:
            for tag in _tags(src, name):
                bases = (split_variants(tok)[1] for tok in class_text(tag).split())
                if any(b.startswith(OVERLAY_BANNED_PREFIXES) for b in bases):
                    bump("overlay-size")

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
```

Run: `cd backend && uv run pytest tests/unit/scripts/test_check_ui_primitives_canary.py -q`
Expected: PASS (all 20 cases).

- [ ] **Step 5: Arm the baseline on the real tree**

Run: `python3 scripts/fitness/check_ui_primitives.py --update-baseline && grep -v '^#' scripts/fitness/check_ui_primitives.baseline | awk -F: '{s[$2]+=$3} END {for (r in s) print r, s[r]}'`
Expected: four rules, with totals near the survey: `icon-button` 72, `tooltip-provider` 36 (38 minus `App.tsx` and the test helper), `cursor-class` about 50 (`col-resize`, `grabbing` and the `peer-disabled` label are not counted), `overlay-size` about 23 (`AppDialog`'s className has no literal and all alert dialogs are unstyled). A rule that sums to 0 means the scanner is broken; stop and debug.

- [ ] **Step 6: Green-path test**

`backend/tests/unit/scripts/test_check_ui_primitives.py`:

```python
"""Green-path test for the ui-primitives ratchet.

Runs with no flags (exercising the default --repo-root/--baseline wiring) and
proves the scanner sees the real tree, so exit 0 cannot mean "saw nothing".
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_ui_primitives.py"


def test_current_tree_matches_baseline() -> None:
    proc = subprocess.run([sys.executable, str(CHECK)], capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stdout


def test_scanner_sees_real_offenders_without_a_baseline() -> None:
    """Removed in Task 15, when the tree reaches zero."""
    proc = subprocess.run(
        [sys.executable, str(CHECK), "--baseline", "/dev/null"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 1, "no offenders found in the real tree — the parser is broken"
    assert "frontend/" in proc.stdout
```

- [ ] **Step 7: Wire into `run_all.sh` and the README**

In `scripts/fitness/run_all.sh`, directly after the `check_button_scale.py` block, add:

```bash
run_check "check_ui_primitives.py" \
  python3 "${SCRIPT_DIR}/check_ui_primitives.py"
```

In `scripts/fitness/README.md`, add a row for `check_ui_primitives.py` next to `check_button_scale.py`, copying that row's format, with the description "four interaction-primitive rules (icon label, one tooltip provider, cursor in CSS, overlay size prop); ratchet".

Run: `cd backend && uv run pytest tests/unit/scripts/test_check_ui_primitives.py tests/unit/scripts/test_fitness_run_all.py -q && cd .. && bash scripts/fitness/run_all.sh | grep ui_primitives`
Expected: PASS; `check_ui_primitives.py: OK`.

- [ ] **Step 8: Commit**

```bash
git add scripts/fitness/check_ui_primitives.py scripts/fitness/check_ui_primitives.baseline scripts/fitness/check_button_scale.py scripts/fitness/run_all.sh scripts/fitness/README.md backend/tests/unit/scripts/test_check_ui_primitives.py backend/tests/unit/scripts/test_check_ui_primitives_canary.py
git commit -m "chore(fitness): ui-primitives ratchet for icon labels, tooltip provider, cursor and overlay size

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 2: Tooltip provider, fallback and look

**Files:**
- Modify: `frontend/components/ui/tooltip.tsx` (whole file)
- Create: `frontend/components/ui/tooltip.test.tsx`
- Modify: every `TooltipContent` child that uses `text-muted-foreground` (found in Step 5)

**Interfaces:**
- Produces: `TooltipProvider` (defaults `delayDuration=400`, `skipDelayDuration=300`), `Tooltip` (renders its own provider only when no `TooltipProvider` is above it), `TooltipTrigger`, `TooltipContent` (default `sideOffset=6`). Same export names as today, so no import changes anywhere.

- [ ] **Step 1: Write the failing test**

`frontend/components/ui/tooltip.test.tsx`:

```tsx
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';

import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from './tooltip';

function Tip() {
  return (
    <Tooltip>
      <TooltipTrigger>trigger</TooltipTrigger>
      <TooltipContent>Add author</TooltipContent>
    </Tooltip>
  );
}

describe('Tooltip', () => {
  it('renders without an app-level provider (a component rendered alone in a test)', async () => {
    render(<Tip />);
    await userEvent.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Add author');
  });

  it('defers to the mounted provider instead of nesting its own', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tip />
      </TooltipProvider>,
    );
    await userEvent.hover(screen.getByText('trigger'));
    // Synchronous: a nested fallback provider would impose the 400 ms default.
    expect(screen.getByRole('tooltip')).toHaveTextContent('Add author');
  });

  it('defaults the provider to a 400 ms first delay', async () => {
    render(
      <TooltipProvider>
        <Tip />
      </TooltipProvider>,
    );
    await userEvent.hover(screen.getByText('trigger'));
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Add author');
  });

  it('draws an inverted pill with no border and a plain fade', async () => {
    render(<Tip />);
    await userEvent.tab();
    const content = (await screen.findByRole('tooltip')).parentElement!;
    const classes = content.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['bg-foreground', 'text-background', 'motion-reduce:animate-none']));
    expect(classes).not.toContain('border');
    expect(classes.some((c) => c.includes('zoom-') || c.includes('slide-in'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run frontend/components/ui/tooltip.test.tsx`
Expected: FAIL — the first test throws "`Tooltip` must be used within `TooltipProvider`"; the look test fails on `bg-foreground`.

- [ ] **Step 3: Rewrite `tooltip.tsx`**

```tsx
import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import {cn} from '@/lib/utils';

// One timing for the whole app (spec 2026-09-12 § 3): the first tooltip waits
// long enough not to flicker under a sweeping mouse; its peers open at once.
const DELAY_MS = 400;
const SKIP_DELAY_MS = 300;

const ProviderMounted = React.createContext(false);

function TooltipProvider({
  delayDuration = DELAY_MS,
  skipDelayDuration = SKIP_DELAY_MS,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <ProviderMounted.Provider value>
      <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} {...props} />
    </ProviderMounted.Provider>
  );
}

/**
 * App.tsx mounts the one provider. A component rendered on its own (a unit
 * test, a storybook-style harness) has none, and Radix throws without one —
 * which is why 38 call sites used to mount their own. Falling back here keeps
 * those renders working without a provider per call site.
 */
function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const mounted = React.useContext(ProviderMounted);
  const root = <TooltipPrimitive.Root {...props} />;
  return mounted ? root : <TooltipProvider>{root}</TooltipProvider>;
}

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({className, sideOffset = 6, ...props}, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-xs rounded-md bg-foreground px-2 py-1 text-[12px] leading-4 text-background shadow-elev-popover dark:shadow-none',
        'duration-100 animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export {Tooltip, TooltipTrigger, TooltipContent, TooltipProvider};
```

Note the added `Portal`: an inverted pill inside a scroll container with `overflow-hidden` is clipped otherwise. If a test in Step 4 queries a tooltip with `within(container)`, switch it to `screen`.

- [ ] **Step 4: Run the new test and the suite**

Run: `npx vitest run frontend/components/ui/tooltip.test.tsx && npm run test:run`
Expected: PASS. A failing test whose assertion reads tooltip text through `within(...)` gets `screen` instead; one that reads it synchronously after a hover gets its render wrapped in `<TooltipProvider delayDuration={0}>` (the pattern `frontend/test/TemplateVersionHistory.test.tsx:50` already uses).

- [ ] **Step 5: Fix muted text inside the inverted pill**

`text-muted-foreground` is dark grey on a near-black pill in light mode. Run:

```bash
grep -rn -A8 "<TooltipContent" frontend --include='*.tsx' | grep -v '\.test\.tsx' | grep "text-muted-foreground"
```

In each hit that lies inside a `TooltipContent`, replace `text-muted-foreground` with `text-background/70`. Re-run the command; expected output: empty.

- [ ] **Step 6: Confirm nothing imports Radix tooltip directly**

Run: `grep -rln "@radix-ui/react-tooltip" frontend --include='*.tsx' --include='*.ts'`
Expected: only `frontend/components/ui/tooltip.tsx`.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/ui/tooltip.tsx frontend/components/ui/tooltip.test.tsx
git add -u frontend
git commit -m "feat(ui): one tooltip timing, a provider fallback and the inverted pill

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 3: `IconButton` and the ghost button

**Files:**
- Create: `frontend/components/patterns/IconButton.tsx`, `frontend/components/patterns/IconButton.test.tsx`
- Modify: `frontend/components/ui/button.tsx` (base string and `ghost` variant), `frontend/components/ui/button.test.tsx` (append a `describe`)

**Interfaces:**
- Consumes: `Tooltip*` from Task 2; `KbdBadge`, `KbdKey` from `@/components/ui/kbd-badge`; `ariaKeyShortcuts` from `@/lib/platform`.
- Produces: `IconButton` (forwardRef to `HTMLButtonElement`) with props: every `ButtonProps` except `size | children | aria-label | asChild`, plus `label: string` (required), `icon: React.ReactNode` (required), `shortcut?: readonly KbdKey[]`, `shortcutVariant?: 'chord' | 'sequence'`, `size?: 'icon' | 'icon-xs'` (default `icon`), `tooltip?: React.ReactNode | false` (override text, or `false` to suppress), `hint?: React.ReactNode` (muted second line), `side?: 'top' | 'right' | 'bottom' | 'left'`. `variant` defaults to `ghost`.

- [ ] **Step 1: Write the failing tests**

`frontend/components/patterns/IconButton.test.tsx`:

```tsx
import type {ReactElement} from 'react';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {TooltipProvider} from '@/components/ui/tooltip';

import {IconButton} from './IconButton';

const Glyph = () => <svg data-testid="glyph" />;
const renderNow = (ui: ReactElement) => render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);

describe('IconButton', () => {
  it('names itself and renders its glyph', () => {
    renderNow(<IconButton label="Add author" icon={<Glyph />} onClick={vi.fn()} />);
    const button = screen.getByRole('button', {name: 'Add author'});
    expect(button).toContainElement(screen.getByTestId('glyph'));
    expect(button).toHaveAttribute('type', 'button');
  });

  it('shows the label on hover', async () => {
    renderNow(<IconButton label="Add author" icon={<Glyph />} />);
    await userEvent.hover(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Add author');
  });

  it('renders the shortcut as a chip and announces it', async () => {
    renderNow(<IconButton label="Toggle sidebar" icon={<Glyph />} shortcut={['mod', 'B']} />);
    const button = screen.getByRole('button', {name: 'Toggle sidebar'});
    // jsdom is not a Mac: `mod` is Control.
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+B');
    await userEvent.hover(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Toggle sidebar');
    expect(document.querySelector('kbd')).toHaveTextContent('CtrlB');
  });

  it('lets the tooltip differ from the accessible name and adds a hint line', async () => {
    renderNow(<IconButton label="Reader mode" tooltip="Show reader" hint="Typography view" icon={<Glyph />} />);
    await userEvent.hover(screen.getByRole('button', {name: 'Reader mode'}));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Show reader');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Typography view');
  });

  it('suppresses the tooltip with tooltip={false} but keeps the name', async () => {
    renderNow(<IconButton label="Close" tooltip={false} icon={<Glyph />} />);
    await userEvent.hover(screen.getByRole('button', {name: 'Close'}));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('still explains a disabled button on hover', async () => {
    renderNow(<IconButton label="Remove member" tooltip="The last manager cannot be removed" disabled icon={<Glyph />} />);
    const button = screen.getByRole('button', {name: 'Remove member'});
    expect(button).toBeDisabled();
    await userEvent.hover(button.parentElement!);
    expect(screen.getByRole('tooltip')).toHaveTextContent('The last manager cannot be removed');
  });

  it('works as the asChild child of a Radix trigger', async () => {
    renderNow(
      <Popover>
        <PopoverTrigger asChild>
          <IconButton label="Open filters" icon={<Glyph />} />
        </PopoverTrigger>
        <PopoverContent>filter panel</PopoverContent>
      </Popover>,
    );
    const button = screen.getByRole('button', {name: 'Open filters'});
    await userEvent.click(button);
    expect(screen.getByText('filter panel')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('is a ghost button with a muted glyph by default', () => {
    renderNow(<IconButton label="More" icon={<Glyph />} />);
    const classes = screen.getByRole('button').className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['text-muted-foreground', 'hover:text-foreground', 'h-7', 'w-7']));
    expect(classes).not.toContain('border');
  });
});
```

Append to `frontend/components/ui/button.test.tsx`:

```tsx
describe('button interaction feel', () => {
  it('ghost shows a fill on hover and a stronger one while pressed, never a border', () => {
    render(<Button variant="ghost">Go</Button>);
    const classes = classesOf('Go');
    expect(classes).toEqual(expect.arrayContaining(['hover:bg-accent', 'active:bg-accent/80']));
    expect(classes).not.toContain('border');
  });

  it('changes colour silently (75 ms)', () => {
    render(<Button>Go</Button>);
    expect(classesOf('Go')).toContain('duration-75');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run frontend/components/patterns/IconButton.test.tsx frontend/components/ui/button.test.tsx`
Expected: IconButton file fails to resolve `./IconButton`; the two new button tests fail on `active:bg-accent/80` and `duration-75`.

- [ ] **Step 3: Update `button.tsx`**

In the `cva` base string, replace `transition-colors` with `transition-colors duration-75`. Replace the `ghost` variant with:

```ts
        ghost: "hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
```

- [ ] **Step 4: Write `IconButton.tsx`**

```tsx
import * as React from 'react';

import {Button, type ButtonProps} from '@/components/ui/button';
import {KbdBadge, type KbdKey} from '@/components/ui/kbd-badge';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {ariaKeyShortcuts} from '@/lib/platform';
import {cn} from '@/lib/utils';

interface IconButtonProps extends Omit<ButtonProps, 'size' | 'children' | 'aria-label' | 'asChild'> {
  /** What the button does: its accessible name and, unless `tooltip` overrides it, its tooltip. Copy via lib/copy. */
  label: string;
  icon: React.ReactNode;
  /** KbdBadge keys of a shortcut this screen really binds. Shown as a chip and announced. Never infer one. */
  shortcut?: readonly KbdKey[];
  shortcutVariant?: 'chord' | 'sequence';
  size?: 'icon' | 'icon-xs';
  /** Tooltip text when it must differ from the stable name (a toggle naming its next action), or `false` when the name is already visible. */
  tooltip?: React.ReactNode | false;
  /** A muted second tooltip line. */
  hint?: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * The one icon-only control (spec 2026-09-12 § 4.3). The label is required,
 * so an icon button cannot ship without a name or a tooltip;
 * scripts/fitness/check_ui_primitives.py bans icon-sized Buttons elsewhere.
 *
 * Forwards ref and props to the Button, so it works as the `asChild` child of
 * any Radix trigger. A disabled button receives no pointer events, so its
 * tooltip is hung on a wrapping span instead.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {label, icon, shortcut, shortcutVariant = 'chord', size = 'icon', tooltip, hint, side, variant = 'ghost', className, disabled, ...props},
    ref,
  ) => {
    const button = (
      <Button
        ref={ref}
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        aria-label={label}
        aria-keyshortcuts={shortcut ? ariaKeyShortcuts(shortcut) : undefined}
        className={cn('shrink-0 text-muted-foreground hover:bg-muted/60 hover:text-foreground active:bg-muted', className)}
        {...props}
      >
        {icon}
      </Button>
    );
    if (tooltip === false) return button;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{disabled ? <span className="inline-flex">{button}</span> : button}</TooltipTrigger>
        <TooltipContent side={side}>
          <span className="flex items-center gap-1.5">
            <span>{tooltip ?? label}</span>
            {shortcut ? (
              <KbdBadge
                keys={[...shortcut]}
                variant={shortcutVariant}
                className="border-background/20 bg-background/10 text-background/80"
              />
            ) : null}
          </span>
          {hint ? <span className="block text-background/70">{hint}</span> : null}
        </TooltipContent>
      </Tooltip>
    );
  },
);
IconButton.displayName = 'IconButton';
```

If `KbdBadge`'s `className` only lands on the `sequence` wrapper, not the `chord` `<kbd>`, check `kbd-badge.tsx` lines 40–45: the chord branch already merges `className` into the `<kbd>`, so no change is needed there.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run frontend/components/patterns/IconButton.test.tsx frontend/components/ui/button.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit** (knip runs after Task 4, which gives `IconButton` its production callers)

```bash
git add frontend/components/patterns/IconButton.tsx frontend/components/patterns/IconButton.test.tsx frontend/components/ui/button.tsx frontend/components/ui/button.test.tsx
git commit -m "feat(ui): IconButton with a required label, and a pressed state on ghost buttons

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 4: Retire `HeaderIconButton` and `ToolbarIconButton`

**Files:**
- Delete: `frontend/components/layout/HeaderIconButton.tsx`, `frontend/pdf-viewer/ui/ToolbarIconButton.tsx`
- Modify: `frontend/components/layout/PanelToggleButton.tsx`, `frontend/components/articles/ArticlesList.tsx` (`ToolbarAction`, lines ~235–262), `frontend/components/navigation/NotificationCenter.tsx` (~220), `frontend/components/navigation/Topbar.tsx` (~63), `frontend/components/feedback/FeedbackButton.tsx`, `frontend/components/project/ProjectRow.tsx` (~86), `frontend/components/runs/SectionNavLayout.tsx` (~108–128), `frontend/components/runs/header/{MobileNav,Worklist,Breadcrumb,Menu,Help}.tsx`, `frontend/pdf-viewer/ui/{Toolbar,ZoomControls,NavigationControls}.tsx`
- Modify: `scripts/fitness/check_ui_primitives.baseline` (shrinks)

**Interfaces:**
- Consumes: `IconButton` from Task 3 (`@/components/patterns/IconButton`).
- Produces: no new names. `PanelToggleButton`'s props are unchanged.

Every replacement below keeps the existing `aria-*`, `data-*`, `onClick` and `className` props; they pass through `IconButton` to the button. Remove each file's now-unused `HeaderIconButton`, `ToolbarIconButton`, `Tooltip*` and `KbdBadge` imports, and add `import {IconButton} from '@/components/patterns/IconButton';`.

- [ ] **Step 1: Pin the behaviour that must survive**

Run: `npx vitest run frontend/components/layout frontend/components/runs frontend/components/navigation frontend/pdf-viewer frontend/components/articles frontend/components/project frontend/test/ProjectRow.test.tsx frontend/test/ArticlesList.toolbar.test.tsx`
Expected: PASS. Record the pass count; Step 5 must match it.

- [ ] **Step 2: `PanelToggleButton.tsx`**

Replace the returned JSX (and delete the local `TooltipProvider` and its comment) with:

```tsx
  return (
    <IconButton
      label={ariaLabel}
      shortcut={shortcut}
      side="bottom"
      onClick={onToggle}
      aria-pressed={pressed}
      className={cn('relative', className)}
      icon={
        <span className="relative block h-4 w-4">
          <Close
            strokeWidth={1.5}
            className={cn('absolute inset-0 h-4 w-4 transition-opacity duration-150 ease-out motion-reduce:duration-0', pressed ? 'opacity-100' : 'opacity-0')}
            aria-hidden="true"
          />
          <Open
            strokeWidth={1.5}
            className={cn('absolute inset-0 h-4 w-4 transition-opacity duration-150 ease-out motion-reduce:duration-0', pressed ? 'opacity-0' : 'opacity-100')}
            aria-hidden="true"
          />
        </span>
      }
    />
  );
```

Delete the now-unused `ariaKeyShortcuts` import (`IconButton` sets `aria-keyshortcuts`).

- [ ] **Step 3: The other `HeaderIconButton` callers**

`ArticlesList.tsx` — `ToolbarAction` body becomes:

```tsx
    const button = (
        <IconButton
            label={label}
            side="bottom"
            onClick={onClick}
            disabled={disabled}
            className={className}
            icon={<Icon className="h-4 w-4" strokeWidth={1.5}/>}
        />
    );
    return <>{children ? children(button) : button}</>;
```

`NotificationCenter.tsx` bell (inside `DropdownMenuTrigger asChild`): replace `<HeaderIconButton … aria-label={bellLabel}>…children…</HeaderIconButton>` with `<IconButton label={bellLabel} side="bottom" className={cn('relative', hasActiveBackgroundJobs && 'text-foreground/90 [&_svg]:opacity-90')} aria-busy={hasActiveBackgroundJobs} icon={<>…the same children, unchanged…</>} />`.

`Topbar.tsx` and `runs/header/MobileNav.tsx`:

```tsx
<IconButton
  label={t('navigation', 'ariaOpenMenu')}
  onClick={toggleMobile /* MobileNav: onOpen */}
  className="lg:hidden"
  icon={<Menu strokeWidth={1.5} aria-hidden="true" />}
/>
```

`FeedbackButton.tsx` — the `Tooltip` block becomes:

```tsx
      <IconButton
        label={t('navigation', 'sendFeedback')}
        onClick={() => setDialogOpen(true)}
        icon={<Bug strokeWidth={1.5} aria-hidden="true" />}
      />
```

Update its header comment: "composes IconButton" instead of "composes HeaderIconButton".

`ProjectRow.tsx` (inside `DropdownMenuTrigger asChild`):

```tsx
              <IconButton
                label={t('pages', 'dashboardRowActionsAria')}
                className="opacity-0 transition-opacity duration-75 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 motion-reduce:transition-none"
                icon={<MoreHorizontal strokeWidth={1.5} aria-hidden="true" />}
              />
```

`runs/SectionNavLayout.tsx` — the whole `TooltipProvider` block becomes:

```tsx
            <IconButton
              label={toggleLabel}
              shortcut={TOGGLE_KEYS}
              side="right"
              onClick={toggleRail}
              aria-expanded={railOpen}
              className={cn(railOpen && 'text-foreground')}
              icon={<ListTree strokeWidth={1.5} />}
            />
```

`runs/header/Worklist.tsx` — each `Tooltip` block becomes (next button mirrors it with `articleNext`, `ARTICLE_NEXT_KEY`, `hasNext`, `idx + 1`, `ChevronRight`):

```tsx
      <IconButton
        label={t('runs', 'articlePrevious')}
        shortcut={[ARTICLE_PREV_KEY]}
        aria-disabled={!hasPrev || undefined}
        className={!hasPrev ? 'pointer-events-none opacity-50' : undefined}
        onClick={() => hasPrev && onNavigate(articles[idx - 1].id)}
        icon={<ChevronLeft strokeWidth={1.5} aria-hidden="true" />}
      />
```

`runs/header/Breadcrumb.tsx`:

```tsx
      <IconButton
        label={t('common', 'back')}
        onClick={onBack}
        // Lowest-priority identity affordance, so the back arrow folds first.
        className="hidden @[42rem]/headerbar:inline-flex"
        icon={<ArrowLeft strokeWidth={1.5} aria-hidden="true" />}
      />
```

`runs/header/Menu.tsx` (inside `DropdownMenuTrigger asChild`): `<IconButton label={t('runs', 'more')} icon={<MoreHorizontal strokeWidth={1.5} aria-hidden="true" />} />`.

`runs/header/Help.tsx` (inside `PopoverTrigger asChild`): `<IconButton label={t('runs', 'helpButton')} icon={<HelpCircle strokeWidth={1.5} aria-hidden="true" />} />`.

- [ ] **Step 4: The `ToolbarIconButton` callers**

`pdf-viewer/ui/Toolbar.tsx`: delete the `<TooltipProvider delayDuration={300}>` wrapper (keep its child `div`), and replace both buttons:

```tsx
              <IconButton
                label={t('pdf', 'viewerReaderToggle')}
                tooltip={t('pdf', isReader ? 'viewerReaderHide' : 'viewerReaderShow')}
                hint={t('pdf', isReader ? 'viewerReaderHideHint' : 'viewerReaderShowHint')}
                side="bottom"
                onClick={toggleMode}
                aria-pressed={isReader}
                className="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                data-testid="viewer-mode-toggle"
                icon={<BookOpenText strokeWidth={1.5} />}
              />
```

```tsx
              <IconButton
                label={t('pdf', 'viewerSearch')}
                hint={t('pdf', 'viewerSearchHint')}
                side="bottom"
                onClick={onSearchToggle}
                icon={<Search strokeWidth={1.5} />}
              />
```

`ZoomControls.tsx` and `NavigationControls.tsx`: each `<ToolbarIconButton label={X} {...rest}><Glyph strokeWidth={1.5} /></ToolbarIconButton>` becomes `<IconButton label={X} side="bottom" {...rest} icon={<Glyph strokeWidth={1.5} />} />`, keeping `onClick`, `disabled` and `data-viewer-step=""`.

Delete both wrapper files:

```bash
git rm frontend/components/layout/HeaderIconButton.tsx frontend/pdf-viewer/ui/ToolbarIconButton.tsx
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npx vitest run frontend/components/layout frontend/components/runs frontend/components/navigation frontend/pdf-viewer frontend/components/articles frontend/components/project frontend/test/ProjectRow.test.tsx frontend/test/ArticlesList.toolbar.test.tsx && npx knip && npx knip --production`
Expected: typecheck clean; same pass count as Step 1; knip zero findings in both modes.

Run: `grep -rn "HeaderIconButton\|ToolbarIconButton" frontend`
Expected: empty.

- [ ] **Step 6: Shrink the baseline**

Run: `python3 scripts/fitness/check_ui_primitives.py && python3 scripts/fitness/check_ui_primitives.py --update-baseline && git diff --stat scripts/fitness/check_ui_primitives.baseline`
Expected: the check passes BEFORE the rewrite (never rewrite a baseline over a failure); the diff only removes lines or lowers counts.

- [ ] **Step 7: Commit**

```bash
git add -A frontend scripts/fitness/check_ui_primitives.baseline
git commit -m "refactor(ui): chrome and pdf toolbar icon buttons compose IconButton

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 5: Cursor rule and the written rules

**Files:**
- Modify: `frontend/index.css` (the second `@layer base` block, line ~306)
- Modify: `.claude/skills/frontend-ux/SKILL.md` (§ 3 Buttons, § 4 items 4 and new 7, § 7 checklist)
- Modify: `.claude/rules/frontend.md` (the "Every icon-only…" bullet, line ~46)
- Modify: `.claude/skills/ui-styling/SKILL.md` (§ "Accessibility")

**Interfaces:** none (CSS and prose).

- [ ] **Step 1: Add the cursor block**

Inside the second `@layer base { … }` block of `frontend/index.css`, after the `h1, …, h6` rule, add:

```css
    /* Cursor (spec 2026-09-12 § 4.1): controls keep the arrow, and only a link
       that navigates shows the hand. Tailwind v4's preflight already gives
       <button> the default cursor; ARIA widgets and labels would otherwise
       show the text I-beam over their text. */
    [role="button"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"],
    [role="menuitemradio"], [role="option"], [role="checkbox"], [role="radio"],
    [role="switch"], [role="slider"], label, summary {
        cursor: default;
    }

    a[href] {
        cursor: pointer;
    }

    :disabled, [aria-disabled="true"] {
        cursor: not-allowed;
    }
```

`@layer base` loses to utilities, so the remaining `cursor-col-resize` and `cursor-grabbing` classes still win.

- [ ] **Step 2: Verify in the browser**

Start the app (`preview_start` with the dev-server config in `.claude/launch.json`; read `reference_local_servers_are_older_than_your_branch` in memory first) and sign in with the test account. On `/projects`, evaluate:

```js
({
  tab: getComputedStyle(document.querySelector('[role="tab"], [role="menuitem"], button')).cursor,
  link: getComputedStyle(document.querySelector('a[href]')).cursor,
})
```

Expected: `{tab: "default", link: "pointer"}`. On an article's side panel, hover a disabled tab and confirm `not-allowed`.

- [ ] **Step 3: Update `frontend-ux` SKILL.md**

In § 3 Buttons, after the size table, add:

```markdown
| Variant | Use |
|---|---|
| `ghost` | **Every chrome and row action.** No border ever; `hover:bg-accent`, `active:bg-accent/80`. |
| `outline` | Only the secondary action beside a primary in a dialog footer. |
| `default` / `destructive` | The one primary action of a footer or an empty state. |
```

Replace § 4 item 4 with:

```markdown
4. **Buttons explain themselves on hover.** An icon-only control is always
   `IconButton` (`components/patterns/IconButton.tsx`): `label` is required
   and becomes both the accessible name and the tooltip, `shortcut` adds a
   kbd chip only for a key the screen really binds. A text button gets a
   tooltip only when it says something the label does not. Tooltip copy is
   one fragment, sentence case, verb first, no period ("Add author").
   Timing is global (400 ms, peers instant) — never mount a
   `TooltipProvider`. `check_ui_primitives.py` gates both.
```

Append § 4 item 7:

```markdown
7. **The arrow is the cursor.** Buttons, tabs, menu items, rows and labels
   keep the arrow; only an `a[href]` shows the hand; disabled shows
   `not-allowed`. The rule lives in `index.css` `@layer base` — never write
   `cursor-pointer`, `cursor-default` or `cursor-not-allowed` on an element
   (`check_ui_primitives.py`). The hover fill is the click affordance, so a
   clickable row must have one.
```

Append to § 7 Implementation Checklist:

```markdown
- [ ] Icon-only controls are `IconButton` with a real `label`; shortcuts only where bound.
- [ ] No `TooltipProvider` outside `App.tsx`; no `cursor-*` class except `peer-`/`group-` relations, `col-resize`, `grabbing`.
```

- [ ] **Step 4: Update `.claude/rules/frontend.md`**

Replace the "Every icon-only or short-label button…" bullet with:

```markdown
- **Every icon-only control is `IconButton`** (`components/patterns/IconButton.tsx`):
  its required `label`, routed through `lib/copy/`, is the accessible name
  and the tooltip. Text buttons get a tooltip only when it adds information.
  A bare icon or terse label must never leave the user guessing what it does.
  Gated by `scripts/fitness/check_ui_primitives.py`.
```

- [ ] **Step 5: Update `ui-styling` SKILL.md**

At the end of § "Accessibility", add:

```markdown
- **Tooltips on disabled controls.** A disabled button has
  `pointer-events-none`, so nothing on it can open a tooltip. `IconButton`
  hangs the tooltip on a wrapping `span` when `disabled`; do the same by hand
  for a disabled text button that must explain itself.
- **One tooltip provider.** `Tooltip` renders its own provider when none is
  mounted, so a component rendered alone in a test works without one. A test
  that asserts tooltip text synchronously wraps the render in
  `<TooltipProvider delayDuration={0}>`.
```

- [ ] **Step 6: Verify and commit**

Run: `bash scripts/fitness/run_all.sh | tail -25 && npm run lint`
Expected: every check OK (`check_skill_router_sync.py` included).

```bash
git add frontend/index.css .claude/skills/frontend-ux/SKILL.md .claude/skills/ui-styling/SKILL.md .claude/rules/frontend.md
git commit -m "feat(ui): arrow cursor on controls, hand on links, and the rules that go with it

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Open PR 1**

Run the Global Constraints pre-PR command, then the `code-review` skill. Push `feat/interaction-primitives-1` and open a PR to `dev` titled `feat(ui): interaction primitives — tooltip, IconButton, cursor, ratchet`. The body lists the four gate rules and the baseline counts from Task 1 Step 5.

---

## PR 2 — Icon buttons

Cut `feat/interaction-primitives-2` from `dev` after PR 1 merged.

### The migration recipe (used by Tasks 6–8)

Before:

```tsx
<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={onRemove} aria-label={t('articles', 'authorRemoveAria')} title="…">
        <Minus className="h-4 w-4" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>{t('articles', 'authorRemoveAria')}</TooltipContent>
  </Tooltip>
</TooltipProvider>
```

After:

```tsx
<IconButton label={t('articles', 'authorRemoveAria')} onClick={onRemove} className="hover:text-destructive" icon={<Minus />} />
```

Rules, applied to every row of the tables below:

1. `label` is the text in the table's **label** column. Delete `aria-label` and `title`.
2. Delete `variant="ghost"` and `size="icon"`. Keep `size="icon-xs"`, and keep `variant="outline"` where the table says **outline**.
3. Delete sizing and look classes that `IconButton` owns: `h-*`, `w-*`, `p-0`, `rounded-md`, `text-muted-foreground`, `hover:bg-muted/*`, `transition-colors`. Keep semantic colour (`text-destructive`, `text-success`, `text-primary`), visibility (`opacity-0 group-hover:opacity-100`), `rounded-full`, `relative`, and positioning.
4. Glyph `className="h-4 w-4"` goes: the button sizes its svg. Keep other glyph classes (`animate-spin`).
5. Delete the wrapping `Tooltip`/`TooltipTrigger`/`TooltipContent` (and a `TooltipProvider` that only wrapped this button). When the tooltip text differs from the label, pass it as `tooltip={…}`.
6. A Radix trigger around the button (`DropdownMenuTrigger asChild`, `PopoverTrigger asChild`, `AlertDialogTrigger asChild`, a `trigger={…}` prop) stays, with `IconButton` as its child.
7. Keep every other prop (`onClick`, `disabled`, `data-*`, `tabIndex`, `type="submit"`, `aria-pressed`, `aria-expanded`, refs).
8. Remove imports that became unused.

### Task 6: Icon buttons in articles, settings, lists and shell

**Files:** every file in the table, `frontend/lib/copy/{ui,articles,navigation,shared}.ts`, `frontend/components/hitl/HITLArticleTable.tsx` (~427), `frontend/components/extraction/ArticleExtractionTable.tsx` (~689), `frontend/lib/copy/extraction.ts` (delete one key), new `frontend/components/shared/list/FilterButtonWithPopover.test.tsx`, `scripts/fitness/check_ui_primitives.baseline`.

**Interfaces:**
- Consumes: `IconButton` (Task 3).
- Produces (prop changes other code sees): `FilterButtonWithPopover` replaces `tooltipLabel` + `ariaLabel` with one required `label: string`; `ListDisplaySortPopover`'s `tooltipLabel` and `ariaLabel` become required (literal defaults deleted); `ActiveFilterChips`' `removeFilterAriaLabel` becomes required; `SortIconHeader` loses its unused `ariaLabel` prop. New copy keys: `ui.multiSelectRemoveOther`, `articles.listRowActions`, `navigation.notificationDismiss`, `shared.listSortBy`, `shared.listToggleSortDirection`, `shared.listFilter`. Deleted: `extraction.tableShortcutFilter`.

| file:line | label | extra |
|---|---|---|
| `components/ui/MultiSelectWithOther.tsx:153` | `t('ui', 'multiSelectRemoveOther')` (new) | glyph `"×"` → `<X />` |
| `components/settings/TagInput.tsx:84` | `t('common', 'remove')` | `size="icon-xs"`, keep `rounded-full` |
| `components/settings/TagInput.tsx:133` | `t('common', 'remove')` | `size="icon-xs"` |
| `components/quality/QualityAssessmentInterface.tsx:252` | `t('extraction', 'exportButton')` | delete the `TooltipProvider` at :247; keep `data-testid` |
| `components/layout/ThemeToggle.tsx:22` | `t('layout', 'themeToggleAriaLabel')` | glyph still switches with theme |
| `components/articles/ArticleKeywordsField.tsx:67` | `t('articles', 'keywordsAddFocusAria')` | |
| `components/articles/ArticleKeywordsField.tsx:84` | `t('articles', 'keywordsRemoveAria')` | keep `hover:text-destructive` |
| `components/articles/ArticleKeywordsField.tsx:116` | `t('articles', 'keywordsClearDraftAria')` | keep `hover:text-destructive` |
| `components/articles/ArticleFileUploadDialogNew.tsx:568` | `t('extraction', 'removeFileAria')` | |
| `components/articles/ArticlesList.tsx:1002` | `t('articles', 'listRowActions')` (new) | inside `DropdownMenuTrigger asChild`; keep the hover-reveal classes |
| `components/articles/ArticleAuthorsField.tsx:141` | `t('articles', 'authorToggleModeAria')` | `tooltip=` the current mode text (`authorSwitchToSingle` / `authorSwitchToPerson`); delete the `TooltipProvider` at :135 |
| `components/articles/ArticleAuthorsField.tsx:164` | `t('articles', 'authorRemoveAria')` | keep `hover:text-destructive` |
| `components/articles/ArticleAuthorsField.tsx:175` | `t('articles', 'authorAddBelowAria')` | |
| `components/articles/ArticleFilesSection.tsx:125` | `t('articles', 'stagedRemoveAria')` | `className="text-destructive hover:text-destructive"` |
| `components/articles/ArticleFilesSection.tsx:182` | `t('articles', 'removeFile')` | `className="text-destructive hover:text-destructive"` |
| `components/navigation/NotificationCenter.tsx:333` | `t('navigation', 'notificationDismiss')` (new) | `size="icon-xs"` (was `h-5 w-5`); keep hover-reveal |
| `components/user/ApiKeysSection.tsx:371` | `t('user', 'apiKeysTitleRevalidate')` | spinner glyph while validating |
| `components/user/ApiKeysSection.tsx:386` | `t('user', 'apiKeysTitleSetDefault')` | |
| `components/user/ApiKeysSection.tsx:398` | `t('user', 'apiKeysTitleRemove')` | inside `AlertDialogTrigger asChild`; keep `hover:text-destructive` |
| `components/shared/list/ActiveFilterChips.tsx:35` | `removeFilterAriaLabel(label)` | `size="icon-xs"`; make the prop required, delete the literal fallback |
| `components/shared/ai-suggestions/AISuggestionActions.tsx:34` | accepted ? `t('shared', 'suggestionAccepted')` : `t('shared', 'acceptSuggestion')` | keep ring/`text-success` classes |
| `components/shared/ai-suggestions/AISuggestionActions.tsx:57` | rejected ? `t('shared', 'suggestionRejected')` : `t('shared', 'rejectSuggestion')` | keep `text-destructive` and ring |
| `components/shared/list/SortIconHeader.tsx:38` | `t('shared', 'listSortBy').replace('{{label}}', label)` (new) | `size="icon-xs"`; delete the `ariaLabel` prop |
| `components/shared/list/ListDisplaySortPopover.tsx:62` | `ariaLabel` | `tooltip={tooltipLabel}`; inside `PopoverTrigger asChild`; delete the `TooltipProvider` at :56; props now required |
| `components/shared/list/ListDisplaySortPopover.tsx:95` | `t('shared', 'listToggleSortDirection')` (new) | `variant="outline"` |
| `components/shared/list/FilterButtonWithPopover.tsx:32` | `label` | see Step 3 |
| `components/project/settings/PICOTSItemEditor.tsx:67` | `t('project', 'picotsHelpAria')` | `tooltip={infoTooltip}`, `size="icon-xs"`, keep `rounded-full`; delete the `TooltipProvider` at :62 |
| `components/project/settings/TeamMembersSection.tsx:288` | `t('project', 'teamAriaSaveChange')` | `className="text-success"` |
| `components/project/settings/TeamMembersSection.tsx:297` | `t('project', 'teamAriaCancel')` | |
| `components/project/settings/TeamMembersSection.tsx:313` | `t('project', 'teamAriaEditRole')` | |
| `components/project/settings/TeamMembersSection.tsx:326` | `t('project', 'teamAriaRemoveMember')` | `disabled tooltip={t('project', 'teamLastManagerGuard')}`; delete the `<span tabIndex={0}>` and its `Tooltip` (IconButton wraps a disabled button itself) |
| `components/project/settings/TeamMembersSection.tsx:342` | `t('project', 'teamAriaRemoveMember')` | |

- [ ] **Step 1: Make the gate the failing test for this area**

```bash
grep -v -E '^frontend/components/(ui|settings|quality|layout|articles|navigation|user|shared|project)/[^:]+:icon-button:' scripts/fitness/check_ui_primitives.baseline > "$TMPDIR/ui6.baseline"
python3 scripts/fitness/check_ui_primitives.py --baseline "$TMPDIR/ui6.baseline"
```

Expected: exit 1, listing `icon-button` for the files in the table.

- [ ] **Step 2: Write the FilterButton test**

`frontend/components/shared/list/FilterButtonWithPopover.test.tsx`:

```tsx
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {TooltipProvider} from '@/components/ui/tooltip';

import {FilterButtonWithPopover} from './FilterButtonWithPopover';

function renderButton(activeCount: number) {
  return render(
    <TooltipProvider delayDuration={0}>
      <FilterButtonWithPopover open={false} onOpenChange={vi.fn()} activeCount={activeCount} label="Filter">
        <div>panel</div>
      </FilterButtonWithPopover>
    </TooltipProvider>,
  );
}

describe('FilterButtonWithPopover', () => {
  it('names itself, announces the F shortcut and shows it as a chip', async () => {
    renderButton(0);
    const button = screen.getByRole('button', {name: 'Filter'});
    expect(button).toHaveAttribute('aria-keyshortcuts', 'F');
    await userEvent.hover(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Filter');
    expect(document.querySelector('kbd')).toHaveTextContent('F');
  });

  it('shows the active filter count on the button', () => {
    renderButton(2);
    expect(screen.getByRole('button', {name: 'Filter'})).toHaveTextContent('2');
  });
});
```

Run: `npx vitest run frontend/components/shared/list/FilterButtonWithPopover.test.tsx`
Expected: FAIL (`label` prop does not exist; no `aria-keyshortcuts`).

- [ ] **Step 3: Rewrite `FilterButtonWithPopover`**

```tsx
import * as React from 'react';
import {Filter} from 'lucide-react';

import {IconButton} from '@/components/patterns/IconButton';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {cn} from '@/lib/utils';

interface FilterButtonWithPopoverProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    activeCount: number;
    /** Accessible name and tooltip. The F chip is added here: every caller mounts useListKeyboardShortcuts, which binds F. */
    label: string;
    children: React.ReactNode;
}

export function FilterButtonWithPopover({open, onOpenChange, activeCount, label, children}: FilterButtonWithPopoverProps) {
    return (
        <Popover open={open} onOpenChange={onOpenChange} modal={false}>
            <PopoverTrigger asChild>
                <IconButton
                    label={label}
                    shortcut={['F']}
                    side="bottom"
                    className={cn('relative', activeCount > 0 && 'text-primary')}
                    icon={
                        <>
                            <Filter />
                            {activeCount > 0 && (
                                <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary/15 px-0.5 text-[10px] font-semibold text-primary">
                                    {activeCount}
                                </span>
                            )}
                        </>
                    }
                />
            </PopoverTrigger>
            <PopoverContent
                className="p-0 border-border/50 shadow-elev-popover max-h-[min(85vh,28rem)] overflow-y-auto overflow-x-hidden"
                align="end"
                sideOffset={6}
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                {children}
            </PopoverContent>
        </Popover>
    );
}
```

Callers: `ArticlesList.tsx` (grep `FilterButtonWithPopover`), `HITLArticleTable.tsx:427`, `ArticleExtractionTable.tsx:689` each replace their `tooltipLabel`/`ariaLabel` pair with `label={t('shared', 'listFilter')}`.

- [ ] **Step 4: Add the copy keys**

- `frontend/lib/copy/ui.ts`: `multiSelectRemoveOther: 'Remove option',`
- `frontend/lib/copy/articles.ts`: `listRowActions: 'Article actions',`
- `frontend/lib/copy/navigation.ts`: `notificationDismiss: 'Dismiss notification',`
- `frontend/lib/copy/shared.ts`, in a `// List toolbar` group: `listSortBy: 'Sort by {{label}}',`, `listToggleSortDirection: 'Toggle sort direction',`, `listFilter: 'Filter',`

Then run `grep -rn "tableShortcutFilter" frontend --include='*.ts' --include='*.tsx' | grep -v lib/copy`. Expected after Step 3: empty; delete `tableShortcutFilter` from `frontend/lib/copy/extraction.ts`.

- [ ] **Step 5: Migrate every row of the table** using the recipe.

- [ ] **Step 6: Verify**

Run: `python3 scripts/fitness/check_ui_primitives.py --baseline "$TMPDIR/ui6.baseline" && npm run typecheck && npx vitest run frontend/components/shared frontend/components/articles frontend/components/project frontend/components/user frontend/components/settings frontend/components/navigation frontend/components/quality frontend/components/layout frontend/components/ui frontend/test/ArticlesList.toolbar.test.tsx frontend/test/QualityAssessmentInterface.test.tsx frontend/test/UserSettings.test.tsx && python3 scripts/fitness/check_copy_keys.py`
Expected: all exit 0. A test that found a button by `title` finds it by role and name instead; one that asserted tooltip text synchronously wraps its render in `<TooltipProvider delayDuration={0}>`.

- [ ] **Step 7: Shrink the baseline and commit**

```bash
python3 scripts/fitness/check_ui_primitives.py && python3 scripts/fitness/check_ui_primitives.py --update-baseline
git add -A frontend scripts/fitness/check_ui_primitives.baseline
git commit -m "refactor(ui): icon buttons in articles, settings, lists and shell name themselves

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 7: Icon buttons in extraction

**Files:** every file in the table, `frontend/lib/copy/extraction.ts`, `scripts/fitness/check_ui_primitives.baseline`, new `frontend/components/extraction/ai/AISuggestionEvidence.copy.test.tsx`.

**Interfaces:**
- Consumes: `IconButton` (Task 3).
- Produces: new copy keys `extraction.unitAdd`, `extraction.optionAdd`, `extraction.optionRemove`.

All paths under `frontend/components/extraction/`.

| file:line | label | extra |
|---|---|---|
| `InstanceCard.tsx:118` | `renameActionLabel` | delete the `TooltipProvider` at :102 |
| `InstanceCard.tsx:140` | `removeActionLabel` | `className="text-destructive hover:bg-destructive/10 hover:text-destructive"` |
| `LlmEndpointsDialog.tsx:422` | `t('llmEngine', 'endpointVerifyAria')` | |
| `LlmEndpointsDialog.tsx:445` | `t('llmEngine', 'endpointEditAria')` | |
| `LlmEndpointsDialog.tsx:463` | `t('llmEngine', 'endpointDeleteAria')` | inside `AlertDialogTrigger asChild`; keep `hover:text-destructive` |
| `LlmEndpointsDialog.tsx:635` | `t('llmEngine', 'endpointModelRemoveAria').replace('{{model}}', model)` | `size="icon-xs"`; the `TooltipProvider` at :317 goes in Task 9 |
| `DocumentSwitcher.tsx:162` | `t('pdf', 'docReparse')` | `tooltip={<>…today's TooltipContent children…</>}`; keep the sr-only status; keep conditional `text-destructive`; `AlertDialogTrigger asChild` branch unchanged |
| `ExtractionInterface.tsx:317` | `t('extraction', 'exportButton')` | delete the `TooltipProvider` at :312; keep `data-testid` |
| `FieldInput.tsx:286` | `t('extraction', 'reviewTitle')` | passed as `trigger`; delete the outer div's `Tooltip` and the `title` |
| `ArticleExtractionTable.tsx:992` | `t('extraction', 'tableStart')` | `variant="outline"`, keep `rounded-full`; delete the `TooltipProvider` at :985 |
| `ArticleExtractionTable.tsx:1015` | completed ? `t('extraction', 'tableView')` : `t('extraction', 'tableContinue')` | `variant="outline"`, keep info colour classes; delete the `TooltipProvider` at :1009 |
| `ArticleExtractionTable.tsx:1075` | `t('extraction', 'tableStart')` | as :992; delete the `TooltipProvider` at :1069 |
| `ArticleExtractionTable.tsx:1095` | as :1015 | as :1015; delete the `TooltipProvider` at :1089 |
| `LlmEngineSettingsDialog.tsx:254` | `t('llmEngine', 'alternatesRemoveAria')` | `size="icon-xs"` |
| `FullAIExtractionProgress.tsx:60` | `t('extraction', 'fullAIProgressRestore')` | `size="icon-xs"` |
| `FullAIExtractionProgress.tsx:70` | `t('extraction', 'fullAIProgressClose')` | `size="icon-xs"` |
| `FullAIExtractionProgress.tsx:99` | `t('extraction', 'fullAIProgressMinimize')` | |
| `FullAIExtractionProgress.tsx:110` | `t('extraction', 'fullAIProgressClose')` | |
| `template-config/TemplateGridFieldRow.tsx:381` | `t('extraction', 'gridAiCellAria').replace('{{label}}', field.label)` (match today's replace argument) | `size="icon-xs"`; keep `data-cell-*` and `tabIndex` |
| `template-config/TemplateGridFieldRow.tsx:412` | `t('extraction', 'actionsForFieldAria').replace('{{label}}', …)` | `tooltip={t('extraction', 'gridRowActions')}`, `size="icon-xs"`; inside `DropdownMenuTrigger asChild` |
| `ai/AISuggestionEvidence.tsx:141` | copied ? `t('extraction', 'copyCopied')` : `t('extraction', 'copySnippet')` | see Step 2 |
| `ai/shared/GenerationDetailsDialog.tsx:94` | copied ? `t('extraction', 'provenanceCopied')` : `t('extraction', 'provenanceCopyPrompt')` | `size="icon-xs"` |
| `ai/shared/GenerationDetailsDialog.tsx:193` | same as :94 | `size="icon-xs"`, keep positioning classes |
| `ai/shared/SectionAIExtractButton.tsx:93` | `label` (the state-dependent string already computed) | delete `title`; delete the `TooltipProvider` at :87 |
| `dialogs/ProjectTemplatesList.tsx:135` | `t('templateConfig', 'projectTemplateDelete')` | keep `hover:text-destructive` |
| `dialogs/AllowedUnitsList.tsx:199` | `t('extraction', 'unitAdd')` (new) | `variant="outline"` |
| `dialogs/AllowedUnitsList.tsx:254` | `t('extraction', 'unitMoveUp')` | `size="icon-xs"`, glyph `"↑"` → `<ArrowUp />` |
| `dialogs/AllowedUnitsList.tsx:264` | `t('extraction', 'unitMoveDown')` | `size="icon-xs"`, glyph `"↓"` → `<ArrowDown />` |
| `dialogs/AllowedUnitsList.tsx:274` | `t('extraction', 'unitRemove')` | `size="icon-xs"`, `className="text-destructive hover:text-destructive"` |
| `dialogs/AllowedValuesList.tsx:98` | `t('extraction', 'optionRemove')` (new) | `size="icon-xs"`, keep hover-reveal |
| `dialogs/AllowedValuesList.tsx:201` | `t('extraction', 'optionAdd')` (new) | `variant="outline"` |
| `dialogs/AllowedValuesList.tsx:256` | `t('extraction', 'optionRemove')` | `size="icon-xs"`, keep hover-reveal |

- [ ] **Step 1: Make the gate the failing test**

```bash
grep -v -E '^frontend/components/extraction/[^:]+:icon-button:' scripts/fitness/check_ui_primitives.baseline > "$TMPDIR/ui7.baseline"
python3 scripts/fitness/check_ui_primitives.py --baseline "$TMPDIR/ui7.baseline"
```

Expected: exit 1, listing the extraction files.

- [ ] **Step 2: Pin the copy button's new behaviour, then simplify it**

`AISuggestionEvidence` drove a controlled tooltip with `showTooltip` state and mouse handlers. The label now carries the state. Write `frontend/components/extraction/ai/AISuggestionEvidence.copy.test.tsx` first. Read the component's props at the top of `AISuggestionEvidence.tsx` and build the smallest valid render (copy the fixture from an existing `AISuggestionEvidence*.test.tsx` if one exists: `ls frontend/components/extraction/ai/ | grep Evidence`). The test:

```tsx
it('names the copy button by its state', async () => {
  Object.assign(navigator, {clipboard: {writeText: vi.fn().mockResolvedValue(undefined)}});
  renderEvidence(); // the minimal render built from the component's props
  const button = screen.getByRole('button', {name: t('extraction', 'copySnippet')});
  await userEvent.click(button);
  expect(await screen.findByRole('button', {name: t('extraction', 'copyCopied')})).toBeInTheDocument();
});
```

Run it: expected PASS before the change (the aria-label already switches) — it is the regression net. Then migrate the button per the table and delete `showTooltip`, its setter, `onMouseEnter`/`onMouseLeave` and the controlled `open`. Run it again: PASS.

- [ ] **Step 3: Add the copy keys**

In `frontend/lib/copy/extraction.ts`, next to `unitRemove`: `unitAdd: 'Add unit',`, `optionAdd: 'Add option',`, `optionRemove: 'Remove option',`.

- [ ] **Step 4: Migrate every other row** using the recipe.

- [ ] **Step 5: Verify**

Run: `python3 scripts/fitness/check_ui_primitives.py --baseline "$TMPDIR/ui7.baseline" && npm run typecheck && npx vitest run frontend/components/extraction frontend/test/LlmEndpointsDialog.test.tsx frontend/test/LlmEngineSettingsDialog.test.tsx frontend/test/FieldInput.density.test.tsx frontend/test/components/DocumentSwitcher.test.tsx frontend/test/TemplateConfigPublish.test.tsx frontend/test/ExtractionFormView.test.tsx && python3 scripts/fitness/check_copy_keys.py`
Expected: all exit 0 (same test-fix rules as Task 6 Step 6).

- [ ] **Step 6: Shrink the baseline and commit**

```bash
python3 scripts/fitness/check_ui_primitives.py && python3 scripts/fitness/check_ui_primitives.py --update-baseline
git add -A frontend scripts/fitness/check_ui_primitives.baseline
git commit -m "refactor(extraction): icon buttons name themselves through IconButton

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 8: Icon buttons in runs and the PDF search bar

**Files:** the table's files, `frontend/lib/copy/pdf.ts`, `scripts/fitness/check_ui_primitives.baseline`.

**Interfaces:**
- Consumes: `IconButton` (Task 3).
- Produces: new copy keys `pdf.viewerSearchPrevMatch`, `pdf.viewerSearchNextMatch`, `pdf.viewerSearchClose`.

| file:line | label | extra |
|---|---|---|
| `frontend/components/runs/FieldAITrace.tsx:80` | `t('consensus', 'fieldTraceAria')` (today's `label`) | passed as `trigger`; delete the outer span's `Tooltip` |
| `frontend/components/runs/header/AIActions.tsx:39` | `ariaLabel` (today's state-dependent string) | inside `DropdownMenuTrigger asChild`; the pending badge moves into `icon={<>…</>}` with `className="relative"`; delete the outer `Tooltip` |
| `frontend/components/runs/ReviewerAITrace.tsx:94` | `title` (today's `traceTitle` replace) | passed as `trigger`; delete the outer div's `Tooltip` |
| `frontend/pdf-viewer/ui/SearchBar.tsx:134` | `t('pdf', 'viewerSearchPrevMatch')` (new) | keep `disabled` |
| `frontend/pdf-viewer/ui/SearchBar.tsx:144` | `t('pdf', 'viewerSearchNextMatch')` (new) | keep `disabled` |
| `frontend/pdf-viewer/ui/SearchBar.tsx:170` | `t('pdf', 'viewerSearchClose')` (new) | keep `ml-auto` |

- [ ] **Step 1: Failing gate**

```bash
grep -v -E '^frontend/(components/runs|pdf-viewer)/[^:]+:icon-button:' scripts/fitness/check_ui_primitives.baseline > "$TMPDIR/ui8.baseline"
python3 scripts/fitness/check_ui_primitives.py --baseline "$TMPDIR/ui8.baseline"
```

Expected: exit 1 listing the four files.

- [ ] **Step 2: Add the copy keys** to `frontend/lib/copy/pdf.ts` after `viewerSearchHint`: `viewerSearchPrevMatch: 'Previous match',`, `viewerSearchNextMatch: 'Next match',`, `viewerSearchClose: 'Close search',`.

- [ ] **Step 3: Migrate the rows** using the recipe.

- [ ] **Step 4: Verify the gate is at zero for icon buttons**

Run: `python3 scripts/fitness/check_ui_primitives.py --baseline /dev/null | grep -c icon-button || true`
Expected: `0`.

Run: `npm run typecheck && npx vitest run frontend/components/runs frontend/pdf-viewer frontend/test/RunReviewerComparison.resolve.test.tsx frontend/test/RunWorkspaceShell.test.tsx && python3 scripts/fitness/check_copy_keys.py`
Expected: exit 0.

- [ ] **Step 5: Shrink the baseline and commit**

```bash
python3 scripts/fitness/check_ui_primitives.py && python3 scripts/fitness/check_ui_primitives.py --update-baseline
git add -A frontend scripts/fitness/check_ui_primitives.baseline
git commit -m "refactor(runs,pdf): icon buttons name themselves through IconButton

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 9: Delete the remaining nested tooltip providers

**Files:** every file the gate lists under `tooltip-provider`; test files that turn red; `scripts/fitness/check_ui_primitives.baseline`.

**Interfaces:** none.

- [ ] **Step 1: List what is left**

Run: `python3 scripts/fitness/check_ui_primitives.py --baseline /dev/null | grep tooltip-provider`
Expected: the providers Tasks 4, 6, 7 and 8 did not already delete (from the original 38: `Breadcrumb.tsx:89`, `StatusRing.tsx:30`, `ReviewDetailsSection.tsx:187`, `DispositionRow.tsx:103`, `LlmEngineChip.tsx:110`, `SectionNavRail.tsx:93`, `LlmEngineSettingsDialog.tsx:155`, `LlmEndpointsDialog.tsx:317`, `ArticleExtractionTable.tsx:771,861,953`, `EntrySelector.tsx:93,184,252`, `AISuggestionReviewPopover.tsx:469`, `RunReviewerComparison.tsx:340,471`, `RunHeader.tsx:76`, `ArticlesList.tsx:858,939,1178`, `ArticleForm.tsx:710`).

- [ ] **Step 2: Delete each one**

Replace `<TooltipProvider …>{children}</TooltipProvider>` with its children. When it wrapped several siblings at a spot that needs one element (a JSX return, a `DialogContent` child), use `<>…</>`. Remove the import. The per-site delays (0/200/300 ms) are intentionally dropped: the app has one timing.

- [ ] **Step 3: Verify**

Run: `python3 scripts/fitness/check_ui_primitives.py --baseline /dev/null | grep -c tooltip-provider || true`
Expected: `0`.

Run: `npm run typecheck && npm run test:run`
Expected: PASS. A test that now fails because a tooltip is read synchronously after hover wraps its render in `<TooltipProvider delayDuration={0}>`; never re-add a provider to the component.

- [ ] **Step 4: Shrink the baseline, commit and open PR 2**

```bash
python3 scripts/fitness/check_ui_primitives.py && python3 scripts/fitness/check_ui_primitives.py --update-baseline
git add -A frontend scripts/fitness/check_ui_primitives.baseline
git commit -m "refactor(ui): one tooltip provider for the whole app

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Run the Global Constraints pre-PR command and the `code-review` skill. Then a `design-review` pass at 1280 px on the articles list, the run header and a template config grid: hover three icon buttons each and confirm the pill, the label and (run header toggles, list filter) the chip. Open the PR to `dev`, titled `refactor(ui): every icon button names itself; one tooltip provider`, with the screenshots.

---

## PR 3 — Cursor

Cut `feat/interaction-primitives-3` from `dev` after PR 2 merged.

### Task 10: Delete the cursor classes

**Files:** the files below; `scripts/fitness/check_ui_primitives.baseline`.

**Interfaces:** none. Depends on Task 5's base-layer rule being on `dev`.

| file:line | class | action |
|---|---|---|
| `frontend/components/ui/switch.tsx:25`, `checkbox.tsx:14`, `textarea.tsx:11`, `input.tsx:11`, `select.tsx:19`, `radio-group.tsx:23`, `command.tsx:47` | `disabled:cursor-not-allowed` (or `data-[disabled]:…`) | delete; `:disabled`/`[aria-disabled]` in `@layer base` covers it |
| `frontend/components/ui/select.tsx:38,52,107`, `dropdown-menu.tsx:25,80,96,119`, `command.tsx:108` | `cursor-default` | delete; `[role="option"]`/`[role="menuitem*"]` covers it |
| `frontend/components/ui/label.tsx:7` | `peer-disabled:cursor-not-allowed` | **keep** (relational; the gate allows it) |
| `frontend/components/articles/ArticleSidePanel.tsx:163` | `cursor-not-allowed` | `disabled && 'opacity-50'`; the button already sets `aria-disabled` |
| `frontend/components/shared/list/ListDisplaySortPopover.tsx:120` | `cursor-default` | delete |
| every other `cursor-pointer` in the gate's list (ErrorBoundary, ArticleFileUploadDialogNew, ArticlesExportDialog ×4, ArticlesList ×2, HITLExportDialog ×8, ZoteroImportDialog ×4, ListRowCard, FilterCategoricalField, NotificationCenter, SectionAccordion, LlmEngineSettingsDialog, FeedbackDialog ×5, ArticleExtractionTable:937, TemplateGridFieldRow:355, AllowedUnitsList:177, AISuggestionDisplay, ImportTemplateFilePane, ImportTemplateDialog ×2) | `cursor-pointer` | delete (see Step 3 for rows) |
| `cursor-col-resize`, `cursor-grabbing` anywhere | — | **keep** |

- [ ] **Step 1: Failing gate**

```bash
grep -v ':cursor-class:' scripts/fitness/check_ui_primitives.baseline > "$TMPDIR/ui10.baseline"
python3 scripts/fitness/check_ui_primitives.py --baseline "$TMPDIR/ui10.baseline"
```

Expected: exit 1, listing every file in the table except `label.tsx`.

- [ ] **Step 2: Delete the classes per the table**

- [ ] **Step 3: Keep a click affordance on clickable non-buttons**

With the arrow cursor, the hover fill is what says "clickable". For each element whose `cursor-pointer` you deleted that is not a `<button>`, `<label>` or `<summary>` (in practice `ListRowCard.tsx:57`, `SectionAccordion.tsx:170`, `ArticlesList.tsx:784,801`, `ArticleExtractionTable.tsx:937`, `NotificationCenter.tsx:313`, `AISuggestionDisplay.tsx:87`, `TemplateGridFieldRow.tsx:355`, `AllowedUnitsList.tsx:177`), confirm the same element or its row carries a `hover:bg-*` class. Where none exists, add `hover:bg-muted/50`.

- [ ] **Step 4: Verify**

Run: `python3 scripts/fitness/check_ui_primitives.py --baseline "$TMPDIR/ui10.baseline" && npm run typecheck && npm run test:run`
Expected: exit 0; suite green (no test asserts a cursor class; `grep -rn "cursor-" frontend --include='*.test.tsx'` confirms).

In the browser (as in Task 5 Step 2), open the Feedback dialog and the articles list and evaluate:

```js
[...document.querySelectorAll('label, [role="option"], tr, [role="button"]')]
  .slice(0, 20)
  .map((el) => getComputedStyle(el).cursor)
```

Expected: only `default` (and `not-allowed` for disabled ones).

- [ ] **Step 5: Shrink the baseline, commit, open PR 3**

```bash
python3 scripts/fitness/check_ui_primitives.py && python3 scripts/fitness/check_ui_primitives.py --update-baseline
git add -A frontend scripts/fitness/check_ui_primitives.baseline
git commit -m "refactor(ui): the cursor comes from the base layer, not per-element classes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Pre-PR command, `code-review`, then a PR to `dev`: `refactor(ui): arrow cursor everywhere, hover fill as the affordance`.

---

## PR 4 — Overlay frame

Cut `feat/interaction-primitives-4` from `dev` after PR 3 merged. Tasks 11–14 leave dialogs visually inconsistent between commits; the PR as a whole does not.

### Task 11: The frame, and `Dialog` on it

**Files:**
- Modify: `frontend/index.css` (light `:root` shadow tokens ~line 211, dark ~285, `@theme inline` ~117)
- Create: `frontend/components/ui/overlay-frame.ts`, `frontend/components/ui/dialog.test.tsx`
- Modify: `frontend/components/ui/dialog.tsx` (whole file)

**Interfaces:**
- Produces from `overlay-frame.ts`: `overlayBackdrop`, `overlayHeader`, `overlayTitle`, `overlayDescription`, `overlayBody`, `overlayFooter`, `overlayCloseButton` (strings); `dialogFrame` (cva, `size: 'sm' | 'md' | 'lg'`, default `md`); `sheetFrame` (cva, `side: 'left' | 'right'`, `size: 'default' | 'narrow'`).
- Produces from `dialog.tsx`: `Dialog`, `DialogContent` (new props `size?: 'sm' | 'md' | 'lg'`, `showCloseButton?: boolean` default `true`), `DialogHeader`, `DialogBody` (new), `DialogFooter`, `DialogTitle`, `DialogDescription`.

- [ ] **Step 1: Write the failing test**

`frontend/components/ui/dialog.test.tsx`:

```tsx
import type {ReactElement} from 'react';
import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from './dialog';

function open(content: ReactElement) {
  render(<Dialog open>{content}</Dialog>);
  return screen.getByRole('dialog');
}

const classesOf = (el: Element) => el.className.split(/\s+/);

describe('DialogContent frame', () => {
  it.each([
    [undefined, 'sm:max-w-[560px]', 'sm:max-h-[85dvh]'],
    ['sm', 'sm:max-w-[400px]', 'sm:max-h-[85dvh]'],
    ['md', 'sm:max-w-[560px]', 'sm:max-h-[85dvh]'],
    ['lg', 'sm:max-w-[800px]', 'sm:h-[85dvh]'],
  ] as const)('size=%s is %s wide and %s tall', (size, width, height) => {
    const dialog = open(
      <DialogContent size={size}>
        <DialogTitle>T</DialogTitle>
        <DialogDescription>D</DialogDescription>
      </DialogContent>,
    );
    expect(classesOf(dialog)).toEqual(expect.arrayContaining([width, height]));
  });

  it('is a bottom sheet below sm and honours reduced motion', () => {
    const dialog = open(
      <DialogContent>
        <DialogTitle>T</DialogTitle>
        <DialogDescription>D</DialogDescription>
      </DialogContent>,
    );
    expect(classesOf(dialog)).toEqual(
      expect.arrayContaining(['bottom-0', 'rounded-t-xl', 'max-sm:data-[state=open]:slide-in-from-bottom', 'motion-reduce:animate-none', 'p-0']),
    );
    expect(classesOf(dialog).some((c) => c.startsWith('translate-') || c.startsWith('-translate-'))).toBe(false);
  });

  it('owns padding in header, body and footer, and the body scrolls', () => {
    open(
      <DialogContent>
        <DialogHeader data-testid="h"><DialogTitle>T</DialogTitle><DialogDescription>D</DialogDescription></DialogHeader>
        <DialogBody data-testid="b">body</DialogBody>
        <DialogFooter data-testid="f">footer</DialogFooter>
      </DialogContent>,
    );
    expect(classesOf(screen.getByTestId('h'))).toEqual(expect.arrayContaining(['px-5', 'pt-5']));
    expect(classesOf(screen.getByTestId('b'))).toEqual(expect.arrayContaining(['min-h-0', 'flex-1', 'overflow-y-auto', 'px-5']));
    expect(classesOf(screen.getByTestId('f'))).toEqual(expect.arrayContaining(['px-5', 'pb-5', 'sm:justify-end']));
  });

  it('has a named close button that can be turned off', () => {
    const {unmount} = render(
      <Dialog open>
        <DialogContent><DialogTitle>T</DialogTitle><DialogDescription>D</DialogDescription></DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('button', {name: 'Close'})).toBeInTheDocument();
    unmount();
    open(
      <DialogContent showCloseButton={false}>
        <DialogTitle>T</DialogTitle>
        <DialogDescription>D</DialogDescription>
      </DialogContent>,
    );
    expect(screen.queryByRole('button', {name: 'Close'})).toBeNull();
  });
});
```


Run: `npx vitest run frontend/components/ui/dialog.test.tsx`
Expected: FAIL (no `size`, no `DialogBody`, `p-6` frame).

- [ ] **Step 2: Add the overlay shadow token**

In `frontend/index.css`: in the light `:root` next to `--shadow-header`, add `--shadow-overlay: 0 1px 2px rgb(0 0 0 / 0.04), 0 16px 48px rgb(0 0 0 / 0.12);`. In the dark block next to its `--shadow-header`, add `--shadow-overlay: none;` (dark depth comes from the `bg-popover` surface step, not elevation). In `@theme inline` next to `--shadow-elev-header`, add `--shadow-elev-overlay: var(--shadow-overlay);`.

- [ ] **Step 3: Write `overlay-frame.ts`**

```ts
/**
 * The one overlay frame (spec 2026-09-12 § 4.5 and § 9.5), shared by Dialog,
 * AlertDialog and Sheet so the three cannot drift apart. Classes only.
 *
 * Centring uses `inset-0 m-auto`, not translate: Tailwind v4's `translate`
 * property and tailwindcss-animate's keyframe `transform` compose
 * differently than in v3, and a translate-centred dialog jumps as it animates.
 */
import {cva} from 'class-variance-authority';

const surface =
  'z-50 flex flex-col gap-0 overflow-hidden border border-border/40 bg-background p-0 shadow-elev-overlay outline-none dark:bg-popover';

const motion = 'ease-out data-[state=open]:animate-in data-[state=closed]:animate-out motion-reduce:animate-none';

export const overlayBackdrop =
  'fixed inset-0 z-50 bg-black/60 duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 motion-reduce:animate-none';

export const overlayHeader = 'flex shrink-0 flex-col gap-1 px-5 pt-5 pb-3 pr-12 text-left';
export const overlayTitle = 'text-[15px] font-medium leading-5 text-foreground';
export const overlayDescription = 'text-[13px] text-muted-foreground';
export const overlayBody = 'min-h-0 flex-1 overflow-y-auto px-5 py-2 first:pt-5 last:pb-5';
export const overlayFooter = 'flex shrink-0 flex-col-reverse gap-2 px-5 pt-3 pb-5 sm:flex-row sm:justify-end';
export const overlayCloseButton = 'absolute right-3 top-3 text-muted-foreground hover:text-foreground';

export const dialogFrame = cva(
  [
    surface,
    motion,
    'fixed inset-x-0 bottom-0 max-h-[92dvh] w-full rounded-t-xl',
    'sm:inset-0 sm:m-auto sm:w-[calc(100vw-2rem)] sm:rounded-lg',
    'data-[state=open]:duration-150 data-[state=closed]:duration-100 data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
    'max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom',
    'sm:data-[state=open]:zoom-in-[0.98] sm:data-[state=closed]:zoom-out-[0.98]',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'sm:h-fit sm:max-h-[85dvh] sm:max-w-[400px]',
        md: 'sm:h-fit sm:max-h-[85dvh] sm:max-w-[560px]',
        lg: 'sm:h-[85dvh] sm:max-w-[800px]',
      },
    },
    defaultVariants: {size: 'md'},
  },
);

export const sheetFrame = cva(
  [surface, motion, 'fixed inset-y-0 h-full max-w-[calc(100vw-2rem)] border-y-0', 'data-[state=open]:duration-200 data-[state=closed]:duration-150'].join(' '),
  {
    variants: {
      side: {
        left: 'left-0 border-l-0 data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
        right: 'right-0 border-r-0 data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
      },
      size: {
        default: 'w-[420px]',
        narrow: 'w-[320px]',
      },
    },
    defaultVariants: {side: 'right', size: 'default'},
  },
);
```

- [ ] **Step 4: Rewrite `dialog.tsx`**

```tsx
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type {VariantProps} from 'class-variance-authority';
import {X} from 'lucide-react';

import {buttonVariants} from '@/components/ui/button';
import {
  dialogFrame,
  overlayBackdrop,
  overlayBody,
  overlayCloseButton,
  overlayDescription,
  overlayFooter,
  overlayHeader,
  overlayTitle,
} from '@/components/ui/overlay-frame';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

const Dialog = DialogPrimitive.Root;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({className, ...props}, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn(overlayBackdrop, className)} {...props} />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof dialogFrame> {
  /** Hide the corner close control (a command palette closes on Escape). */
  showCloseButton?: boolean;
}

/**
 * Sizes (spec 2026-09-12 § 4.5): `sm` confirmations and one-field forms,
 * `md` forms (default), `lg` lists, pickers and imports at a fixed height.
 * Never size the frame with a className — check_ui_primitives.py gates it.
 * Compose `DialogHeader` / `DialogBody` / `DialogFooter`: the content has no
 * padding of its own, so the body can scroll under a fixed header and footer.
 */
const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  ({className, children, size, showCloseButton = true, ...props}, ref) => (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content ref={ref} className={cn(dialogFrame({size}), className)} {...props}>
        {children}
        {showCloseButton && (
          // No tooltip: autofocus would pop it the moment the dialog opens.
          <DialogPrimitive.Close
            aria-label={t('common', 'close')}
            className={cn(buttonVariants({variant: 'ghost', size: 'icon-xs'}), overlayCloseButton)}
          >
            <X />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  ),
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(overlayHeader, className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogBody = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(overlayBody, className)} {...props} />
);
DialogBody.displayName = 'DialogBody';

const DialogFooter = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(overlayFooter, className)} {...props} />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({className, ...props}, ref) => <DialogPrimitive.Title ref={ref} className={cn(overlayTitle, className)} {...props} />);
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({className, ...props}, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn(overlayDescription, className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription};
```

- [ ] **Step 5: Run the test and prove the arbitrary zoom compiles**

Run: `npx vitest run frontend/components/ui/dialog.test.tsx && npm run typecheck`
Expected: PASS.

Run: `npm run build && grep -l -- '--tw-enter-scale:.98' dist/assets/*.css`
Expected: one CSS file listed. If none, replace both `[0.98]` arbitrary values in `overlay-frame.ts` with `95` and update the spec's § 9 in the same commit.

- [ ] **Step 6: Commit**

```bash
git add frontend/index.css frontend/components/ui/overlay-frame.ts frontend/components/ui/dialog.tsx frontend/components/ui/dialog.test.tsx
git commit -m "feat(ui): one overlay frame with three dialog sizes and a bottom sheet below sm

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 12: `AlertDialog` on the frame, and its 15 callers

**Files:**
- Modify: `frontend/components/ui/alert-dialog.tsx`
- Create: `frontend/components/ui/alert-dialog.test.tsx`
- Modify: the 15 callers listed in Step 4

**Interfaces:**
- Consumes: `dialogFrame`, `overlay*` from Task 11.
- Produces: `AlertDialogContent` (`size?: 'sm' | 'md' | 'lg'`, default `sm`), `AlertDialogBody` (new), `AlertDialogAction` (`variant?: ButtonProps['variant']`, renders `size: 'sm'`), `AlertDialogCancel` (outline, `size: 'sm'`). Other exports unchanged.

- [ ] **Step 1: Write the failing test**

`frontend/components/ui/alert-dialog.test.tsx`:

```tsx
import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog';

function Confirm() {
  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete article?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

describe('AlertDialog', () => {
  it('sits on the sm frame', () => {
    render(<Confirm />);
    expect(screen.getByRole('alertdialog').className.split(/\s+/)).toEqual(
      expect.arrayContaining(['sm:max-w-[400px]', 'p-0', 'motion-reduce:animate-none']),
    );
  });

  it('focuses Cancel on open, so Enter never fires the destructive action', () => {
    render(<Confirm />);
    expect(screen.getByRole('button', {name: 'Cancel'})).toHaveFocus();
  });

  it('renders the destructive action at chrome density', () => {
    render(<Confirm />);
    const classes = screen.getByRole('button', {name: 'Delete'}).className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['bg-destructive', 'h-7']));
  });
});
```

Run: `npx vitest run frontend/components/ui/alert-dialog.test.tsx`
Expected: the frame and density tests FAIL; the focus test PASSES already (Radix behaviour — it is the pin, spec § 9.2).

- [ ] **Step 2: Rewrite `alert-dialog.tsx`**

Keep `AlertDialog`, `AlertDialogTrigger`, `AlertDialogPortal`. Replace the rest with:

```tsx
const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({className, ...props}, ref) => (
  <AlertDialogPrimitive.Overlay ref={ref} className={cn(overlayBackdrop, className)} {...props} />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

interface AlertDialogContentProps
  extends React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>,
    VariantProps<typeof dialogFrame> {}

const AlertDialogContent = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Content>, AlertDialogContentProps>(
  ({className, size = 'sm', ...props}, ref) => (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content ref={ref} className={cn(dialogFrame({size}), className)} {...props} />
    </AlertDialogPortal>
  ),
);
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(overlayHeader, 'pr-5', className)} {...props} />
);
AlertDialogHeader.displayName = 'AlertDialogHeader';

const AlertDialogBody = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(overlayBody, className)} {...props} />
);
AlertDialogBody.displayName = 'AlertDialogBody';

const AlertDialogFooter = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(overlayFooter, className)} {...props} />
);
AlertDialogFooter.displayName = 'AlertDialogFooter';

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({className, ...props}, ref) => <AlertDialogPrimitive.Title ref={ref} className={cn(overlayTitle, className)} {...props} />);
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({className, ...props}, ref) => (
  <AlertDialogPrimitive.Description ref={ref} className={cn(overlayDescription, className)} {...props} />
));
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

interface AlertDialogActionProps extends React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action> {
  variant?: ButtonProps['variant'];
}

const AlertDialogAction = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Action>, AlertDialogActionProps>(
  ({className, variant, ...props}, ref) => (
    <AlertDialogPrimitive.Action ref={ref} className={cn(buttonVariants({variant, size: 'sm'}), className)} {...props} />
  ),
);
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({className, ...props}, ref) => (
  <AlertDialogPrimitive.Cancel ref={ref} className={cn(buttonVariants({variant: 'outline', size: 'sm'}), className)} {...props} />
));
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;
```

Imports: `import type {VariantProps} from 'class-variance-authority';`, `import {buttonVariants, type ButtonProps} from '@/components/ui/button';` and the `overlay-frame` names. Export `AlertDialogBody` alongside the existing names. (No close button: an alert dialog is answered, not dismissed.)

Run: `npx vitest run frontend/components/ui/alert-dialog.test.tsx`
Expected: PASS.

- [ ] **Step 3: Knip gate for the new export**

`AlertDialogBody` is consumed in Step 4 (`TemplateDiscardDialog`). Do not run knip until Step 4 is done.

- [ ] **Step 4: Migrate the callers**

| file:line | change |
|---|---|
| `frontend/components/articles/ArticlesListDialogs.tsx:44,66`, `ArticleFilesSection.tsx:205`, `frontend/components/user/ApiKeysSection.tsx:405`, `frontend/components/project/settings/AdvancedSettingsSection.tsx:301`, `frontend/components/extraction/LlmEndpointsDialog.tsx:475` | on `AlertDialogAction`, replace `className="bg-destructive text-destructive-foreground hover:bg-destructive/90"` with `variant="destructive"` |
| `frontend/components/extraction/template-config/TemplateDiscardDialog.tsx:191` | `size="md"`; action `className="bg-destructive hover:bg-destructive/90"` → `variant="destructive"`; move `AlertDialogDescription asChild > div` out of `AlertDialogHeader` into a new `<AlertDialogBody>` placed between header and footer (the header keeps only the title) |
| `frontend/components/extraction/dialogs/ReopenExtractionDialog.tsx:58` | action `className={hasDiscard ? 'bg-destructive hover:bg-destructive/90' : undefined}` → `variant={hasDiscard ? 'destructive' : 'default'}`; loader icon `mr-2 h-4 w-4 animate-spin` → `animate-spin` |
| `frontend/components/extraction/entries/EntrySelector.tsx:327` | the action deletes an entry: add `variant="destructive"` |
| `frontend/components/articles/ZoteroImportDialog.tsx:533` | drop `mr-2 h-4 w-4` from the icons inside Cancel and Action (`gap-2` and `[&_svg]:size-4` own it) |
| `ArticlesSplitShell.tsx:197`, `ZoteroIntegrationSection.tsx:138`, `DocumentSwitcher.tsx:204`, `TemplateExportButton.tsx:82`, `ProjectTemplatesList.tsx:166` | no change (default frame, default action); confirm `data-testid`s are untouched |

Run: `npm run typecheck && npx vitest run frontend/test/ReopenExtractionDialog.test.tsx frontend/test/LlmEndpointsDialog.test.tsx frontend/test/TemplateConfigPublish.test.tsx frontend/test/components/DocumentSwitcher.test.tsx frontend/components/extraction frontend/components/articles`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/components
git commit -m "feat(ui): alert dialogs on the overlay frame with a destructive action variant

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 13: `Sheet` on the frame, and its 4 callers

**Files:**
- Modify: `frontend/components/ui/sheet.tsx`
- Create: `frontend/components/ui/sheet.test.tsx`
- Modify: `frontend/components/layout/MobileSidebar.tsx:46`, `frontend/components/extraction/template-config/TemplateConfigDiffSheet.tsx:453`, `TemplateVersionHistorySheet.tsx:196`, `TemplateConfigGridPanel.tsx:755`

**Interfaces:**
- Consumes: `sheetFrame`, `overlay*` from Task 11.
- Produces: `SheetContent` props `side?: 'left' | 'right'` (default `right`; `top`/`bottom` removed), `size?: 'default' | 'narrow'`, `showCloseButton?: boolean`. Exports unchanged: `Sheet`, `SheetContent`, `SheetDescription`, `SheetHeader`, `SheetTitle`. The unused, unexported `SheetFooter` is deleted.

- [ ] **Step 1: Write the failing test**

`frontend/components/ui/sheet.test.tsx`:

```tsx
import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {Sheet, SheetContent, SheetDescription, SheetTitle} from './sheet';

function openSheet(props: {side?: 'left' | 'right'; size?: 'default' | 'narrow'}) {
  render(
    <Sheet open>
      <SheetContent {...props}>
        <SheetTitle>T</SheetTitle>
        <SheetDescription>D</SheetDescription>
      </SheetContent>
    </Sheet>,
  );
  return screen.getByRole('dialog').className.split(/\s+/);
}

describe('SheetContent frame', () => {
  it('defaults to a 420px right sheet with the 200/150 ms motion', () => {
    expect(openSheet({})).toEqual(
      expect.arrayContaining(['w-[420px]', 'right-0', 'data-[state=open]:duration-200', 'data-[state=closed]:duration-150', 'motion-reduce:animate-none']),
    );
  });

  it('has a narrow 320px variant for rails and inspectors', () => {
    expect(openSheet({side: 'left', size: 'narrow'})).toEqual(expect.arrayContaining(['w-[320px]', 'left-0']));
  });

  it('has a named close button', () => {
    openSheet({});
    expect(screen.getByRole('button', {name: 'Close'})).toBeInTheDocument();
  });
});
```

Run: `npx vitest run frontend/components/ui/sheet.test.tsx`
Expected: FAIL (`w-3/4`, `duration-500`).

- [ ] **Step 2: Rewrite `sheet.tsx`**

```tsx
import * as SheetPrimitive from '@radix-ui/react-dialog';
import type {VariantProps} from 'class-variance-authority';
import {X} from 'lucide-react';
import * as React from 'react';

import {buttonVariants} from '@/components/ui/button';
import {overlayBackdrop, overlayCloseButton, overlayDescription, overlayHeader, overlayTitle, sheetFrame} from '@/components/ui/overlay-frame';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

const Sheet = SheetPrimitive.Root;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({className, ...props}, ref) => <SheetPrimitive.Overlay ref={ref} className={cn(overlayBackdrop, className)} {...props} />);
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetFrame> {
  /** When false, hides the built-in corner close control (e.g. when the child provides its own dismiss UI). */
  showCloseButton?: boolean;
}

/** `default` (420px) holds persistent context beside the page; `narrow` (320px) is for navigation rails and inspectors. */
const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({side, size, className, children, showCloseButton = true, ...props}, ref) => (
    <SheetPrimitive.Portal>
      <SheetOverlay />
      <SheetPrimitive.Content ref={ref} className={cn(sheetFrame({side, size}), className)} {...props}>
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            aria-label={t('common', 'close')}
            className={cn(buttonVariants({variant: 'ghost', size: 'icon-xs'}), overlayCloseButton)}
          >
            <X />
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  ),
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(overlayHeader, className)} {...props} />
);
SheetHeader.displayName = 'SheetHeader';

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({className, ...props}, ref) => <SheetPrimitive.Title ref={ref} className={cn(overlayTitle, className)} {...props} />);
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({className, ...props}, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn(overlayDescription, className)} {...props} />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle};
```

- [ ] **Step 3: Migrate the four callers**

| file:line | change |
|---|---|
| `frontend/components/layout/MobileSidebar.tsx:46` | `<SheetContent side="left" size="narrow">` — delete `className="w-[280px] max-w-[85vw] p-0"` (280 → 320px is intentional: one narrow width) |
| `frontend/components/extraction/template-config/TemplateConfigDiffSheet.tsx:453` | delete `className="flex w-full flex-col gap-0 p-0 sm:max-w-[26rem]"` (the frame is already a padding-free flex column; 416 → 420px) |
| `frontend/components/extraction/template-config/TemplateVersionHistorySheet.tsx:196` | same as the diff sheet |
| `frontend/components/extraction/template-config/TemplateConfigGridPanel.tsx:755` | `<SheetContent side="right" size="narrow">` — delete `className="w-[320px] p-0 sm:max-w-[320px]"` |

Their own `SheetHeader` classes (`border-b px-5 py-4 text-left`, `px-3 py-3 pr-12 …`, `sr-only`) merge over `overlayHeader` and stay.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run frontend/components/ui/sheet.test.tsx frontend/test/TemplateConfigDiffSheet.test.tsx frontend/test/TemplateVersionHistory.test.tsx frontend/components/layout && npm run typecheck`
Expected: PASS.

```bash
git add -A frontend/components
git commit -m "feat(ui): sheets on the overlay frame with default and narrow widths

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 14: `AppDialog` and the 20 dialogs on the frame

**Files:** `frontend/components/patterns/AppDialog.tsx` (rewrite) and every file in the Step 3 table; `scripts/fitness/check_ui_primitives.baseline`.

**Interfaces:**
- Consumes: `DialogContent` `size`/`showCloseButton`, `DialogBody` (Task 11).
- Produces: `AppDialog` `size?: 'sm' | 'md' | 'lg'` (default `md`); every other `AppDialog` prop unchanged.

The shape every dialog ends in:

```tsx
<DialogContent size="md">
  <DialogHeader>
    <DialogTitle>…</DialogTitle>
    <DialogDescription>…</DialogDescription>
  </DialogHeader>
  <DialogBody className="space-y-4">…</DialogBody>
  <DialogFooter>
    <Button variant="outline" size="sm">Cancel</Button>
    <Button size="sm">Save</Button>
  </DialogFooter>
</DialogContent>
```

Rules for the table:

1. Delete every class on `DialogContent`; keep `data-testid`, `aria-*` and event props. Add the table's `size`.
2. Delete padding, border and `shrink-0` classes from `DialogHeader`/`DialogFooter`; keep layout classes the table names (a left slot uses `className="sm:justify-between"` on the footer).
3. What sits between header and footer goes inside one `DialogBody`; its spacing class (`space-y-4`, `grid gap-6`) moves onto the body, and its `py-*`/`px-*`/`overflow-y-auto`/`flex-1`/`min-h-0` go.
4. A `<form>` that wraps header, body and footer gets `className="contents"`, so the frame's flex column reaches the body. A form that wraps only fields and the footer does the same, with the fields inside a `DialogBody`.
5. `Button`s in a footer carry `size="sm"`.

- [ ] **Step 1: Failing gate**

```bash
grep -v ':overlay-size:' scripts/fitness/check_ui_primitives.baseline > "$TMPDIR/ui14.baseline"
python3 scripts/fitness/check_ui_primitives.py --baseline "$TMPDIR/ui14.baseline"
```

Expected: exit 1, listing the dialog files below (sheets were fixed in Task 13; alert dialogs had no classes).

- [ ] **Step 2: Rewrite `AppDialog.tsx`**

Keep the file's usage comment (update `size="sm"`). Replace `size` in the props with `size?: 'sm' | 'md' | 'lg';`, delete `sizeClasses`, and replace the returned JSX with:

```tsx
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={size}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
        {showFooter && (
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={handleCancel} disabled={isLoading}>
              {cancelLabel}
            </Button>
            {onConfirm && (
              <Button variant={confirmVariant} size="sm" onClick={onConfirm} disabled={isLoading}>
                {confirmLabel}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
```

Add `DialogBody` to the import; drop the `cn` import if unused. Its only caller, `AddProjectDialog.tsx:74`, passes `size="md"` and needs no change.

- [ ] **Step 3: Migrate the dialogs**

| file:line | size | change beyond the rules |
|---|---|---|
| `frontend/components/ui/command.tsx:29` (`CommandDialog`) | `md` | `showCloseButton={false}`; `Command` stays the only child |
| `frontend/components/articles/ArticleFileUploadDialogNew.tsx:409` | `lg` | body div → `DialogBody`; footer keeps its status slot: `className="items-stretch sm:items-center sm:justify-between"`; buttons keep `w-full sm:w-auto` |
| `frontend/components/articles/RISImportDialog.tsx:137` | `md` | body `div.space-y-4` → `DialogBody className="space-y-4"` |
| `frontend/components/articles/ZoteroImportDialog.tsx:224` | `lg` | the outer `ScrollArea` (`flex-1 -mx-6 px-6`) and its `div.space-y-4.py-2` become one `DialogBody className="space-y-4"`; the nested collections `ScrollArea` stays; the plain footer div becomes `DialogFooter className="sm:justify-between"` with Back on the left and the right-hand buttons in a `div className="flex gap-2"`; all footer buttons `size="sm"` |
| `frontend/components/articles/ArticlesExportDialog.tsx:132` | `md` | body → `DialogBody className="grid gap-6"` |
| `frontend/components/hitl/HITLExportDialog.tsx:381` | `md` | body → `DialogBody className="grid gap-6"`; keep `data-testid="extraction-export-submit"` |
| `frontend/components/feedback/FeedbackDialog.tsx:117` | `md` | form `className="contents"`; body → `DialogBody className="space-y-4"` |
| `frontend/components/project/AiConfigDialog.tsx:228` | `lg` | header: delete all classes; `PANE_CLASS` (line 61): `h-[min(60dvh,28rem)]` → `flex-1`; the `Tabs` root it renders gets `className="flex min-h-0 flex-1 flex-col"` (keep existing classes); in the panes, `px-4` → `px-5` on footers and on the picots scroll body, `pb-4` → `pb-5` |
| `frontend/components/extraction/LlmEndpointsDialog.tsx:316` | `md` | wrap everything after `DialogHeader` (error, list or states, add button or inline form) in `DialogBody className="space-y-3"` |
| `frontend/components/extraction/AddEntryDialog.tsx:172` | `sm` | form `className="contents"`; body → `DialogBody className="space-y-4"`; e2e reads `#entry-key` — keep ids |
| `frontend/components/extraction/AddEntryDialog.tsx:301` | `md` | as :172; keep `#entry-rename-label`, `#entry-rename-key` |
| `frontend/components/extraction/LlmEngineSettingsDialog.tsx:144` | `md` | keep `data-testid`; the three `section`s go inside `DialogBody className="space-y-4"` |
| `frontend/components/extraction/entries/RemoveEntryDialog.tsx:89` | `sm` | body → `DialogBody className="space-y-4"` |
| `frontend/components/extraction/template-config/MoveToSectionDialog.tsx:63` | `sm` | `showCloseButton={false}`; keep `aria-describedby={undefined}` and `onCloseAutoFocus` |
| `frontend/components/extraction/dialogs/CreateCustomTemplateDialog.tsx:112` | `md` | `<form className="space-y-4">` → `<form className="contents">`; the `FormField`s go inside `DialogBody className="space-y-4"`; `DialogFooter` stays inside the form after the body |
| `frontend/components/extraction/ai/shared/GenerationDetailsDialog.tsx:258` | `md` | header: delete its classes; body div → `DialogBody className="space-y-5"` |
| `frontend/components/extraction/dialogs/ImportTemplateDialog.tsx:124` | `lg` | keep `data-testid="import-template-dialog"`; wrap `Tabs` in `DialogBody className="flex flex-col overflow-hidden"`; footer drops `shrink-0`; keep every `import-template-*` test id |
| `frontend/components/extraction/dialogs/AddSectionDialog.tsx:223` | `md` | as `CreateCustomTemplateDialog` |
| `frontend/components/runs/header/Help.tsx:79` | `sm` | `<HelpContent />` goes inside `DialogBody className="space-y-2 text-[13px]"` |

- [ ] **Step 4: Verify the rule is at zero**

Run: `python3 scripts/fitness/check_ui_primitives.py --baseline /dev/null`
Expected: exit 0, `OK (0 baselined entr(y/ies))` — every rule is now at zero.

Run: `npm run typecheck && npm run lint && npm run test:run && npx knip && npx knip --production`
Expected: all green.

- [ ] **Step 5: The e2e flows that open these dialogs**

With the local stack up (`make start`; read `reference_e2e_suite_is_stateful_reruns_lie` and `reference_worktree_e2e_env_and_port_trap` in memory first):

Run: `npx playwright test frontend/e2e/flows/template-import.ui.e2e.ts frontend/e2e/flows/template-portable.ui.e2e.ts frontend/e2e/flows/extraction-entry-identity.ui.e2e.ts frontend/e2e/flows/extraction-reopen-to-extract.ui.e2e.ts --project=local-ui --workers 1`
Expected: PASS.

- [ ] **Step 6: Visual check at two widths**

Run the `design-review` skill on: the LLM endpoints dialog (`md`), a delete confirmation (`sm`), the template import dialog (`lg`), the AI config dialog (`lg`) and the mobile sidebar (`narrow` sheet), each at 1280×800 and 375×812. For each confirm: the frame is centred (or a bottom sheet at 375) with no jump while it animates; header and footer stay put while the body scrolls; nothing overflows horizontally; footer buttons are 28px tall. Save the screenshots for the PR.

- [ ] **Step 7: Commit**

```bash
git add -A frontend
git commit -m "refactor(ui): every dialog on the three-size overlay frame

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 15: Close the ratchet and write down the overlay rules

**Files:**
- Delete: `scripts/fitness/check_ui_primitives.baseline`
- Modify: `backend/tests/unit/scripts/test_check_ui_primitives.py`
- Modify: `.claude/skills/frontend-ux/SKILL.md` (new § 8, checklist), `.claude/skills/ui-styling/SKILL.md` (§ "Instance editor (Dialog vs Sheet)")
- Modify: `docs/superpowers/specs/2026-09-12-interaction-primitives-design.md`, this plan (frontmatter `status`)

**Interfaces:** none.

- [ ] **Step 1: Replace the green test's offender check with the hard-zero pins**

In `backend/tests/unit/scripts/test_check_ui_primitives.py`, delete `test_scanner_sees_real_offenders_without_a_baseline` and add:

```python
BASELINE = REPO_ROOT / "scripts" / "fitness" / "check_ui_primitives.baseline"


def test_tree_is_clean_with_no_baseline() -> None:
    proc = subprocess.run(
        [sys.executable, str(CHECK), "--baseline", "/dev/null"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stdout
    assert "OK (0 " in proc.stdout


def test_baseline_file_is_gone() -> None:
    """The migration finished. A baseline file would let a violation back in unnoticed."""
    assert not BASELINE.exists(), "re-adding check_ui_primitives.baseline re-opens the ratchet"
```

(The canary still proves the parser sees violations.)

- [ ] **Step 2: Delete the baseline and run both tests**

```bash
git rm scripts/fitness/check_ui_primitives.baseline
cd backend && uv run pytest tests/unit/scripts/test_check_ui_primitives.py tests/unit/scripts/test_check_ui_primitives_canary.py tests/unit/scripts/test_fitness_run_all.py -q
```

Expected: PASS.

- [ ] **Step 3: Add § 8 to `frontend-ux` SKILL.md** (append at the end of the file, after § 7)

```markdown
## 8. Overlays (popups, confirmations, sheets)

**Prefer a view.** Anything with tabs, sections, a list, or its own save and
cancel lifecycle is a route, not a popup. A popup is right only when:

| Surface | When |
|---|---|
| `AlertDialog` | A decision blocks the page: confirm, discard, delete. |
| `Dialog` | A short, one-step form or a transient picker. |
| `Sheet` | Persistent context beside a page that stays readable (inspector, history, diff). |

**One frame, three sizes — never a width, height or padding class on the content**
(`check_ui_primitives.py` gates it):

| `size` | Width | Height | Use |
|---|---|---|---|
| `sm` | 400px | content, ≤85dvh | confirmations (the `AlertDialog` default), one field |
| `md` | 560px | content, ≤85dvh | forms (the `Dialog` default) |
| `lg` | 800px | fixed 85dvh | lists, pickers, imports — fixed so tabs and loading do not resize it |
| Sheet `default` / `narrow` | 420px / 320px | full height | context / navigation rails and inspectors |

- Compose `DialogHeader` → `DialogBody` → `DialogFooter`. The content has no
  padding; the body is the only scroll region. A `<form>` around them is
  `className="contents"`.
- Footer: Cancel (`outline`, `sm`) immediately left of the primary
  (`default` or `destructive`, `sm`), right-aligned; a tertiary action sits
  far left (`sm:justify-between`). A destructive `AlertDialogAction` takes
  `variant="destructive"`; Radix focuses Cancel, so Enter never destroys.
- Motion is 150/100 ms (sheets 200/150), fade plus a 2% scale (5% if Task 11
  Step 5 fell back to `zoom-in-95`), off under
  `prefers-reduced-motion`. Below `sm` every dialog is a bottom sheet.
- Surface: hairline `border-border/40`; light mode a soft two-layer shadow
  (`shadow-elev-overlay`), dark mode no shadow and one surface step up
  (`bg-popover`). Backdrop `bg-black/60`.
```

Append to § 7 Implementation Checklist:

```markdown
- [ ] Configuration lives in a view; a popup is a confirm, a short form or a sheet (§ 8).
- [ ] Overlays use a `size` and header/body/footer — no size or padding class on the content.
```

- [ ] **Step 4: Update `ui-styling` SKILL.md**

At the end of § "Instance editor (Dialog vs Sheet)", add:

```markdown
**Frame mechanics.** Dialog, AlertDialog and Sheet read their classes from
`components/ui/overlay-frame.ts`. Centring is `inset-0 m-auto`, never
`translate-*`: in Tailwind v4 `translate` is its own CSS property, and the
animate plugin's keyframe `transform` would compose with it and make the frame
jump. `sm`/`md` use `h-fit` + `max-h-[85dvh]`; `lg` a fixed `h-[85dvh]`. Width
and height live only in the cva variants, which is why a className on the
content is gated.
```

- [ ] **Step 5: Mark the spec and plan shipped**

In the spec and in this plan, change the frontmatter `status: approved` to `status: shipped` and `last_reviewed:` to the merge date. Run: `bash scripts/docs/check-frontmatter.sh 2>&1 | grep -i interaction-primitives || echo clean`
Expected: `clean`.

- [ ] **Step 6: Commit and open PR 4**

```bash
git add -A scripts/fitness backend/tests/unit/scripts .claude/skills docs/superpowers
git commit -m "chore(fitness): ui-primitives ratchet at hard zero; overlay rules written down

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Run the Global Constraints pre-PR command and the `code-review` skill. Open the PR to `dev`, titled `feat(ui): one overlay frame — three dialog sizes, bottom sheet on phones`, with Task 14's screenshots and the note that the ratchet is now a hard zero.

## Self-review record

- Spec § 4.1 cursor → Tasks 5, 10. § 4.2 tooltip → Tasks 2, 9. § 4.3 `IconButton` → Tasks 3, 4, 6–8. § 4.4 button variants → Tasks 3, 5. § 4.5 frame → Tasks 11–13. § 4.6 migration → Tasks 12–14. § 4.7 gate and skills → Tasks 1, 5, 15. § 5 testing → each task's tests, Task 14 Steps 5–6. § 6 delivery → the four PRs. § 9 amendments → reflected in Tasks 2, 3, 5, 11–13.
- Names used across tasks: `IconButton` props (`label`, `icon`, `shortcut`, `shortcutVariant`, `size`, `tooltip`, `hint`, `side`); `dialogFrame`/`sheetFrame`; `overlayBackdrop`/`overlayHeader`/`overlayTitle`/`overlayDescription`/`overlayBody`/`overlayFooter`/`overlayCloseButton`; gate rules `icon-button`/`tooltip-provider`/`cursor-class`/`overlay-size`.
- Out of scope, by the spec: moving configuration dialogs to views (sub-project 2); removing cards and borders on the article form and settings (sub-project 3).
