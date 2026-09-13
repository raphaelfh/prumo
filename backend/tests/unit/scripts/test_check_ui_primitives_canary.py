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
    (
        "icon-button",
        "frontend/components/a/X.tsx",
        '<Button onClick={() => a >= b} size="icon"><X/></Button>',
    ),
    ("icon-button", "frontend/components/a/X.tsx", "<Button size={'icon-xs'} />"),
    (
        "tooltip-provider",
        "frontend/components/a/X.tsx",
        "<TooltipProvider delayDuration={0}><div/></TooltipProvider>",
    ),
    ("cursor-class", "frontend/components/a/x.ts", 'export const c = cn("cursor-pointer");'),
    ("cursor-class", "frontend/components/a/X.tsx", '<div className="hover:cursor-default" />'),
    (
        "overlay-size",
        "frontend/components/a/X.tsx",
        '<DialogContent className="sm:max-w-md">x</DialogContent>',
    ),
    (
        "overlay-size",
        "frontend/components/a/X.tsx",
        '<AlertDialogContent className={cn("p-0")}>x</AlertDialogContent>',
    ),
    (
        "overlay-size",
        "frontend/components/a/X.tsx",
        '<SheetContent side="left" className="w-[320px]">x</SheetContent>',
    ),
]

ALLOWED = [
    ("frontend/components/patterns/IconButton.tsx", '<Button size="icon" />'),
    ("frontend/components/a/X.tsx", '<ButtonGroup size="icon" />'),
    ("frontend/App.tsx", "<TooltipProvider><App/></TooltipProvider>"),
    ("frontend/components/ui/tooltip.tsx", "<TooltipProvider>{root}</TooltipProvider>"),
    (
        "frontend/test/helpers/render.tsx",
        "<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>",
    ),
    ("frontend/components/a/X.tsx", "// <TooltipProvider> in a comment\nexport const a = 1;"),
    ("frontend/components/a/X.tsx", '<Label className="peer-disabled:cursor-not-allowed" />'),
    ("frontend/components/a/X.tsx", '<div className="cursor-col-resize cursor-grabbing" />'),
    ("frontend/components/a/X.test.tsx", '<Button size="icon" className="cursor-pointer" />'),
    (
        "frontend/components/a/X.tsx",
        '<DialogContent size="lg" data-testid="d" className="flex flex-col">x</DialogContent>',
    ),
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
