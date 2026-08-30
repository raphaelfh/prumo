"""Canary for the copy-key ratchet in scripts/fitness/check_copy_keys.py.

A check without a canary is decorative (scripts/fitness/README.md). Two
failure directions matter here and they are NOT symmetric:

* calling a live key dead is the expensive one — it licenses a deletion, and
  `t()` returns '' for a missing key, so the mistake ships as a blank string in
  the UI rather than as an error. The `live_via_*` cases pin each reference
  form the matcher must honour.
* calling a dead key live is cheap (the key survives another cycle), but a
  SILENT parse failure is not: an unparsed namespace reports zero dead keys and
  the gate stays green forever. The malformed-file cases pin exit 2.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_copy_keys.py"


def _ns(root: Path, name: str, body: str) -> None:
    f = root / "frontend" / "lib" / "copy" / f"{name}.ts"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(f"export const {name} = {{\n{body}}} as const;\n")


def _consumer(root: Path, rel: str, body: str) -> None:
    f = root / "frontend" / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(body)


def _run(root: Path, baseline: Path, *extra: str):
    return subprocess.run(
        [sys.executable, str(CHECK), "--repo-root", str(root), "--baseline", str(baseline), *extra],
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


def test_unreferenced_key_fails(tmp_path: Path) -> None:
    _ns(tmp_path, "qa", "    ghost: 'nobody uses me',\n")
    _consumer(tmp_path, "x/Some.tsx", "export const x = 1;\n")
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 1, proc.stdout
    assert "qa.ts:ghost" in proc.stdout


def test_baselined_key_passes(tmp_path: Path) -> None:
    _ns(tmp_path, "qa", "    ghost: 'nobody uses me',\n")
    _consumer(tmp_path, "x/Some.tsx", "export const x = 1;\n")
    baseline = tmp_path / "bl"
    baseline.write_text("frontend/lib/copy/qa.ts:ghost\n")
    proc = _run(tmp_path, baseline)
    assert proc.returncode == 0, proc.stdout


def test_baseline_may_shrink(tmp_path: Path) -> None:
    """A baselined key that became referenced passes, and is reported as tightenable."""
    _ns(tmp_path, "qa", "    used: 'x',\n")
    _consumer(tmp_path, "x/Some.tsx", "t('qa', 'used');\n")
    baseline = tmp_path / "bl"
    baseline.write_text("frontend/lib/copy/qa.ts:used\nfrontend/lib/copy/qa.ts:gone\n")
    proc = _run(tmp_path, baseline)
    assert proc.returncode == 0, proc.stdout
    assert "tighten" in proc.stdout


# --------------------------------------------------------------------------
# Reference forms the matcher MUST honour — each one, alone, keeps a key alive
# --------------------------------------------------------------------------


def test_live_via_quoted_literal(tmp_path: Path) -> None:
    """Covers both quoted forms — `t(ns, 'key')` and the `labelKey: 'key'` map
    value that the 53 non-literal `t()` sites resolve through. They are the same
    path to the matcher: a quoted identifier."""
    _ns(tmp_path, "qa", "    alive: 'x',\n")
    _consumer(tmp_path, "x/Some.tsx", "const s = t('qa', 'alive');\n")
    assert _run(tmp_path, _empty_baseline(tmp_path)).returncode == 0


def test_live_via_property_access(tmp_path: Path) -> None:
    """27 real keys are live ONLY this way (`import { qa }` then `qa.someKey`)."""
    _ns(tmp_path, "qa", "    alive: 'x',\n")
    _consumer(tmp_path, "x/Some.tsx", "import { qa } from '@/lib/copy/qa';\nconst s = qa.alive;\n")
    assert _run(tmp_path, _empty_baseline(tmp_path)).returncode == 0


def test_live_via_backtick(tmp_path: Path) -> None:
    _ns(tmp_path, "qa", "    alive: 'x',\n")
    _consumer(tmp_path, "x/Some.tsx", "const k = `alive`;\n")
    assert _run(tmp_path, _empty_baseline(tmp_path)).returncode == 0


def test_substring_key_is_not_masked_by_a_longer_one(tmp_path: Path) -> None:
    """169 real keys are a prefix of another; a non-word-boundary match hides them all."""
    _ns(tmp_path, "qa", "    back: 'Back',\n    backToProjects: 'Back to projects',\n")
    _consumer(tmp_path, "x/Some.tsx", "t('qa', 'backToProjects');\n")
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 1, proc.stdout
    assert "qa.ts:back" in proc.stdout
    assert "qa.ts:backToProjects" not in proc.stdout


def test_copy_dir_is_not_its_own_reference(tmp_path: Path) -> None:
    """A key's definition, and a test that lists key NAMES, must not keep it alive.

    `frontend/lib/copy/__tests__/extraction.legacyKeys.test.ts` lists deleted key
    names as string literals; in scope, re-adding one would be un-flaggable.
    """
    _ns(tmp_path, "qa", "    ghost: 'x',\n")
    _consumer(tmp_path, "lib/copy/__tests__/legacy.test.ts", "const REMOVED = ['ghost'];\n")
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 1, proc.stdout
    assert "qa.ts:ghost" in proc.stdout


def test_reference_outside_frontend_does_not_count(tmp_path: Path) -> None:
    """Python cannot import the copy catalogue; a same-named symbol is a coincidence."""
    _ns(tmp_path, "qa", "    reparse: 'x',\n")
    (tmp_path / "backend").mkdir(parents=True, exist_ok=True)
    (tmp_path / "backend" / "svc.py").write_text("def reparse(self): ...\n")
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 1, proc.stdout
    assert "qa.ts:reparse" in proc.stdout


# --------------------------------------------------------------------------
# Parser shape — indent must not be load-bearing, and silence is a bug
# --------------------------------------------------------------------------


def test_two_space_and_four_space_indent_both_parse(tmp_path: Path) -> None:
    """qa/runs/templateConfig indent by 2, the rest by 4; `^ {4}` drops 363 keys silently."""
    _ns(tmp_path, "qa", "  twoSpace: 'a',\n    fourSpace: 'b',\n")
    _consumer(tmp_path, "x/Some.tsx", "export const x = 1;\n")
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 1, proc.stdout
    assert "qa.ts:twoSpace" in proc.stdout
    assert "qa.ts:fourSpace" in proc.stdout


def test_multiline_value_does_not_mint_a_phantom_key(tmp_path: Path) -> None:
    """93+ real keys wrap their value onto the next line."""
    _ns(tmp_path, "qa", "    wrapped:\n        'a value on the next line',\n")
    _consumer(tmp_path, "x/Some.tsx", "t('qa', 'wrapped');\n")
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 0, proc.stdout


def test_array_value_is_not_mistaken_for_keys(tmp_path: Path) -> None:
    """templateConfig.importGuidanceRules is an array of strings."""
    _ns(tmp_path, "qa", "    rules: [\n      'one',\n      'two',\n    ],\n")
    _consumer(tmp_path, "x/Some.tsx", "t('qa', 'rules');\n")
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 0, proc.stdout


def test_key_named_inside_a_comment_or_string_is_not_a_key(tmp_path: Path) -> None:
    _ns(tmp_path, "qa", "    // notAKey: 'commented out',\n    real: 'x',\n")
    _consumer(tmp_path, "x/Some.tsx", "t('qa', 'real');\n")
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 0, proc.stdout


def test_spread_in_a_namespace_exits_2(tmp_path: Path) -> None:
    """Refuse to guess: a spread's keys would be invisible, i.e. silently ungated."""
    _ns(tmp_path, "qa", "    ...base,\n    real: 'x',\n")
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 2, proc.stdout
    assert "internal error" in proc.stdout


def test_quoted_key_exits_2(tmp_path: Path) -> None:
    _ns(tmp_path, "qa", "    'quoted-key': 'x',\n")
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 2, proc.stdout


def test_namespace_without_a_header_exits_2(tmp_path: Path) -> None:
    f = tmp_path / "frontend" / "lib" / "copy" / "broken.ts"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("const notExported = { a: 'b' };\n")
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 2, proc.stdout


def test_index_ts_is_not_treated_as_a_namespace(tmp_path: Path) -> None:
    _ns(tmp_path, "qa", "    real: 'x',\n")
    (tmp_path / "frontend" / "lib" / "copy" / "index.ts").write_text("export { qa } from './qa';\n")
    _consumer(tmp_path, "x/Some.tsx", "t('qa', 'real');\n")
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 0, proc.stdout


def test_update_baseline_writes_what_it_found(tmp_path: Path) -> None:
    _ns(tmp_path, "qa", "    ghost: 'x',\n")
    _consumer(tmp_path, "x/Some.tsx", "export const x = 1;\n")
    baseline = tmp_path / "bl"
    assert _run(tmp_path, baseline, "--update-baseline").returncode == 0
    assert "frontend/lib/copy/qa.ts:ghost" in baseline.read_text()
    assert _run(tmp_path, baseline).returncode == 0


# --------------------------------------------------------------------------
# Silent-blindness regressions. Each of these SHIPPED green in an earlier
# revision while hiding real dead keys; adversarial review found them.
# --------------------------------------------------------------------------


def test_second_exported_const_exits_2(tmp_path: Path) -> None:
    """Parsing only the first `export const` dropped the real namespace silently.

    An icon/aria helper map declared above the namespace is ordinary to write,
    and the file still parses — to the wrong object — so no shape guard fired.
    """
    f = tmp_path / "frontend" / "lib" / "copy" / "qa.ts"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "export const QA_ICONS = {\n  warn: 'triangle',\n} as const;\n\n"
        "export const qa = {\n  ghostA: 'a',\n  ghostB: 'b',\n} as const;\n"
    )
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 2, proc.stdout


def test_namespace_in_a_subdirectory_is_gated(tmp_path: Path) -> None:
    """`glob('*.ts')` was non-recursive, so `copy/domain/x.ts` was invisible BOTH
    ways: never parsed, and excluded from the reference scan. `copy/__tests__/`
    already exists, so subdirectories here are an established pattern."""
    _ns(tmp_path, "main", "    used: 'u',\n")
    nested = tmp_path / "frontend" / "lib" / "copy" / "domain" / "nested.ts"
    nested.parent.mkdir(parents=True, exist_ok=True)
    nested.write_text("export const nested = {\n  subdirGhost: 'x',\n} as const;\n")
    _consumer(tmp_path, "x/S.tsx", "t('main', 'used');\n")
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 1, proc.stdout
    assert "domain/nested.ts:subdirGhost" in proc.stdout


def test_zero_namespaces_exits_2(tmp_path: Path) -> None:
    """The empty-SET case no shape guard could see: reorganise the catalogue one
    level down and the gate reported `OK (0 unreferenced key(s))` forever."""
    (tmp_path / "frontend" / "lib" / "copy").mkdir(parents=True, exist_ok=True)
    _consumer(tmp_path, "x/S.tsx", "export const x = 1;\n")
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 2, proc.stdout


def test_nested_object_exits_2(tmp_path: Path) -> None:
    """Nested keys live at depth 2 and were never collected — ungated copy."""
    _ns(tmp_path, "qa", "    errors: { nestedGhost: 'x' },\n")
    proc = _run(tmp_path, _empty_baseline(tmp_path))
    assert proc.returncode == 2, proc.stdout


def test_ancestor_named_build_does_not_blank_the_scan(tmp_path: Path) -> None:
    """SKIP_DIR_NAMES matched the ABSOLUTE path, so a checkout under a directory
    named `build`/`dist`/`coverage` skipped every file and reported all ~2100
    LIVE keys as dead — each line reading "delete this live copy"."""
    root = tmp_path / "build" / "repo"
    _ns(root, "qa", "    aliveKey: 'x',\n")
    _consumer(root, "x/S.tsx", "t('qa', 'aliveKey');\n")
    proc = _run(root, _empty_baseline(tmp_path))
    assert proc.returncode == 0, proc.stdout


def test_inline_reason_annotation_is_honoured_and_preserved(tmp_path: Path) -> None:
    """`# reason` on a baseline line is the CI-documented way to accept a
    regression (check_scope_guards.baseline uses it). Without stripping it the
    entry never matched and the check reported the baselined key as NEW."""
    _ns(tmp_path, "qa", "    ghost: 'x',\n")
    _consumer(tmp_path, "x/S.tsx", "export const x = 1;\n")
    baseline = tmp_path / "bl"
    baseline.write_text("frontend/lib/copy/qa.ts:ghost  # kept: flag-gated screen\n")
    assert _run(tmp_path, baseline).returncode == 0

    assert _run(tmp_path, baseline, "--update-baseline").returncode == 0
    assert "# kept: flag-gated screen" in baseline.read_text(), (
        "--update-baseline dropped the reason, which is what makes a 200-entry burn-down reviewable"
    )
