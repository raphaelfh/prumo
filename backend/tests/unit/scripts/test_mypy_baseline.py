"""Unit tests for the mypy ratchet (scripts/mypy_baseline.py).

Mirrors the green-path + canary convention used by the architectural fitness
checks under the same directory: the pure parsing/diff logic is exercised in
isolation, and the gate is shown to fail on a newly-introduced error class.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[4] / "scripts" / "mypy_baseline.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("mypy_baseline", _SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mod = _load_module()


def test_parse_extracts_file_and_code_dropping_line_and_message():
    lines = [
        "app/services/foo.py:12: error: Incompatible return value type  [return-value]",
        'app/api/bar.py:3:5: error: Name "x" is not defined  [name-defined]',
        "app/api/bar.py:99: note: see https://example",
        "Found 2 errors in 2 files (checked 100 source files)",
        "",
    ]
    assert mod.parse_signatures(lines) == {
        "app/services/foo.py:return-value",
        "app/api/bar.py:name-defined",
    }


def test_same_code_twice_in_a_file_collapses_to_one_signature():
    lines = [
        "app/m.py:1: error: a  [attr-defined]",
        "app/m.py:50: error: b  [attr-defined]",
    ]
    assert mod.parse_signatures(lines) == {"app/m.py:attr-defined"}


def test_classify_splits_new_and_fixed():
    new, fixed = mod.classify({"a:x", "b:y"}, {"b:y", "c:z"})
    assert new == ["a:x"]
    assert fixed == ["c:z"]


def test_gate_passes_when_current_is_subset_of_baseline(tmp_path):
    baseline = tmp_path / ".mypy_baseline"
    mod.write_baseline(baseline, {"app/a.py:return-value", "app/b.py:arg-type"})
    mypy_out = tmp_path / "mypy.out"
    mypy_out.write_text("app/a.py:7: error: bad return  [return-value]\n")
    assert mod.main(["--baseline", str(baseline), "--input", str(mypy_out)]) == 0


def test_canary_gate_fails_on_a_new_error_class(tmp_path):
    baseline = tmp_path / ".mypy_baseline"
    mod.write_baseline(baseline, {"app/a.py:return-value"})
    mypy_out = tmp_path / "mypy.out"
    mypy_out.write_text(
        "app/a.py:7: error: bad return  [return-value]\n"
        "app/new.py:1: error: missing annotation  [var-annotated]\n"
    )
    assert mod.main(["--baseline", str(baseline), "--input", str(mypy_out)]) == 1


def test_update_writes_current_signatures(tmp_path):
    baseline = tmp_path / ".mypy_baseline"
    mypy_out = tmp_path / "mypy.out"
    mypy_out.write_text("app/a.py:7: error: bad  [return-value]\n")
    assert mod.main(["--baseline", str(baseline), "--input", str(mypy_out), "--update"]) == 0
    assert mod.load_baseline(baseline) == {"app/a.py:return-value"}


def test_missing_baseline_is_treated_as_empty_allowlist(tmp_path):
    missing = tmp_path / "nope.baseline"
    assert mod.load_baseline(missing) == set()


@pytest.mark.parametrize(
    "line",
    [
        "Found 1 error in 1 file (checked 10 source files)",
        "app/a.py:1: note: this is a note",
        "Success: no issues found in 10 source files",
    ],
)
def test_non_error_lines_are_ignored(line):
    assert mod.parse_signatures([line]) == set()
