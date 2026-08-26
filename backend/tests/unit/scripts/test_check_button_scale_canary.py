"""Canary for the button-scale ratchet in scripts/fitness/check_button_scale.py.

A check without a canary is decorative (scripts/fitness/README.md). The cases
below are the ones an adversarial review proved a naive
`<Button\\b(.*?)>` + `className="([^"]*)"` regex silently misses — 20% of the
real drift. Each MUST fail the check, or the gate lies green.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_button_scale.py"


def _mk(root: Path, rel: str, body: str) -> None:
    f = root / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(body)


def _run(root: Path, baseline: Path, *extra: str):
    return subprocess.run(
        [
            sys.executable,
            str(CHECK),
            "--repo-root",
            str(root),
            "--baseline",
            str(baseline),
            *extra,
        ],
        capture_output=True,
        text=True,
        timeout=20,
    )


def _empty_baseline(tmp_path: Path) -> Path:
    baseline = tmp_path / "bl"
    baseline.write_text("")
    return baseline


# --------------------------------------------------------------------------
# Core ratchet behaviour
# --------------------------------------------------------------------------


def test_new_offender_fails(tmp_path: Path) -> None:
    _mk(tmp_path, "frontend/x/New.tsx", '<Button size="sm" className="h-8 gap-2">Go</Button>\n')
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 1, proc.stdout
    assert "New.tsx" in proc.stdout


def test_clean_tree_passes(tmp_path: Path) -> None:
    _mk(tmp_path, "frontend/x/Clean.tsx", '<Button size="sm" variant="ghost">Go</Button>\n')
    assert _run(tmp_path, _empty_baseline(tmp_path)).returncode == 0


def test_baselined_file_may_not_grow(tmp_path: Path) -> None:
    _mk(tmp_path, "frontend/x/Old.tsx", '<Button className="h-8">A</Button>\n' * 3)
    baseline = tmp_path / "bl"
    baseline.write_text("frontend/x/Old.tsx:2\n")
    assert _run(tmp_path, baseline).returncode == 1


def test_shrinking_is_allowed(tmp_path: Path) -> None:
    _mk(tmp_path, "frontend/x/Old.tsx", '<Button className="h-8">A</Button>\n')
    baseline = tmp_path / "bl"
    baseline.write_text("frontend/x/Old.tsx:5\n")
    assert _run(tmp_path, baseline).returncode == 0


# --------------------------------------------------------------------------
# The forms a naive regex misses. Each of these is live in the real tree.
# --------------------------------------------------------------------------


def test_classname_in_cn_call_is_caught(tmp_path: Path) -> None:
    """The house idiom. `className={cn("h-8")}` must not be an escape hatch."""
    _mk(
        tmp_path,
        "frontend/x/Cn.tsx",
        '<Button size="icon" className={cn("h-7 w-7", other)}>A</Button>\n',
    )
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 1, proc.stdout
    assert "Cn.tsx" in proc.stdout


def test_arrow_function_before_classname_is_caught(tmp_path: Path) -> None:
    """`() =>` supplies a `>` that truncates a non-greedy tag match."""
    _mk(
        tmp_path,
        "frontend/x/Arrow.tsx",
        '<Button onClick={() => setOpen(true)} className="h-8">A</Button>\n',
    )
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 1, proc.stdout


def test_comparison_operator_before_classname_is_caught(tmp_path: Path) -> None:
    _mk(
        tmp_path,
        "frontend/x/Cmp.tsx",
        '<Button disabled={page >= total} className="h-8">A</Button>\n',
    )
    assert _run(tmp_path, _empty_baseline(tmp_path)).returncode == 1


def test_single_quoted_classname_is_caught(tmp_path: Path) -> None:
    _mk(tmp_path, "frontend/x/Sq.tsx", "<Button className='h-8'>A</Button>\n")
    assert _run(tmp_path, _empty_baseline(tmp_path)).returncode == 1


def test_template_literal_classname_is_caught(tmp_path: Path) -> None:
    _mk(tmp_path, "frontend/x/Tpl.tsx", "<Button className={`h-8 ${extra}`}>A</Button>\n")
    assert _run(tmp_path, _empty_baseline(tmp_path)).returncode == 1


def test_multiline_tag_is_caught(tmp_path: Path) -> None:
    _mk(
        tmp_path,
        "frontend/x/Multi.tsx",
        '<Button\n  size="sm"\n  onClick={() => go()}\n  className="h-8 px-2"\n>\n  A\n</Button>\n',
    )
    assert _run(tmp_path, _empty_baseline(tmp_path)).returncode == 1


# --------------------------------------------------------------------------
# Things that must NOT be flagged.
# --------------------------------------------------------------------------


def test_child_icon_height_is_not_flagged(tmp_path: Path) -> None:
    """`h-4 w-4` on a child <svg> is not the Button's own height."""
    _mk(
        tmp_path,
        "frontend/x/Icon.tsx",
        '<Button size="sm"><Check className="h-4 w-4" /></Button>\n',
    )
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 0, proc.stdout


def test_min_and_max_height_are_not_flagged(tmp_path: Path) -> None:
    _mk(tmp_path, "frontend/x/MinMax.tsx", '<Button className="min-h-9 max-h-96">A</Button>\n')
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 0, proc.stdout


def test_descendant_variant_height_is_not_flagged(tmp_path: Path) -> None:
    """`[&_svg]:h-3.5` targets a child element, not the button box."""
    _mk(tmp_path, "frontend/x/Desc.tsx", '<Button className="[&_svg]:h-3.5 px-2">A</Button>\n')
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 0, proc.stdout


def test_responsive_height_variant_is_flagged(tmp_path: Path) -> None:
    """`sm:h-8` IS a button height override — a breakpoint does not excuse it."""
    _mk(tmp_path, "frontend/x/Resp.tsx", '<Button className="sm:h-8">A</Button>\n')
    assert _run(tmp_path, _empty_baseline(tmp_path)).returncode == 1


def test_button_inside_a_comment_is_not_flagged(tmp_path: Path) -> None:
    _mk(
        tmp_path,
        "frontend/x/Doc.tsx",
        '/**\n * Usage: <Button className="h-8">Add</Button>\n */\nexport const x = 1;\n',
    )
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 0, proc.stdout


def test_other_components_are_not_flagged(tmp_path: Path) -> None:
    _mk(
        tmp_path,
        "frontend/x/Other.tsx",
        '<ButtonGroup className="h-8"><div className="h-8" /></ButtonGroup>\n',
    )
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 0, proc.stdout


# --------------------------------------------------------------------------
# Robustness
# --------------------------------------------------------------------------


def test_malformed_baseline_line_does_not_crash(tmp_path: Path) -> None:
    _mk(tmp_path, "frontend/x/Clean.tsx", '<Button size="sm">A</Button>\n')
    baseline = tmp_path / "bl"
    baseline.write_text("garbage-without-a-count\n\n# a comment\n")
    proc = _run(tmp_path, baseline)
    assert proc.returncode == 0, proc.stdout


def test_jsonl_out_emits_one_line_per_finding(tmp_path: Path) -> None:
    _mk(tmp_path, "frontend/x/A.tsx", '<Button className="h-8">A</Button>\n')
    out = tmp_path / "findings.jsonl"
    _run(tmp_path, _empty_baseline(tmp_path), "--jsonl-out", str(out))
    lines = [ln for ln in out.read_text().splitlines() if ln.strip()]
    assert len(lines) == 1
    assert "fitness:check_button_scale.py" in lines[0]
