"""Slice-3 package skeleton: the new orchestrator entry point exists and
is the single public surface, while the legacy module re-exports it so
endpoint/worker/tests stay untouched."""

from __future__ import annotations


def test_package_exposes_build_workbook() -> None:
    from app.services.exports.extraction import build_workbook as pkg_build

    assert callable(pkg_build)


def test_workbook_module_exposes_build_workbook() -> None:
    from app.services.exports.extraction.workbook import build_workbook as mod_build

    assert callable(mod_build)


def test_legacy_module_reexports_same_object() -> None:
    from app.services.exports.extraction.workbook import build_workbook as canonical
    from app.services.exports.extraction_xlsx_builder import build_workbook as legacy

    # The legacy import path must resolve to the exact same function object
    # so endpoint/worker imports keep working with zero behaviour drift.
    assert legacy is canonical
