"""The orchestrator package is the single public surface for
``build_workbook`` (the legacy ``extraction_xlsx_builder`` shim has been
deleted; endpoint/worker import from the package)."""

from __future__ import annotations


def test_package_exposes_build_workbook() -> None:
    from app.services.exports.extraction import build_workbook as pkg_build

    assert callable(pkg_build)


def test_workbook_module_exposes_build_workbook() -> None:
    from app.services.exports.extraction.workbook import build_workbook as mod_build

    assert callable(mod_build)


def test_legacy_module_is_gone() -> None:
    import importlib

    import pytest

    # The legacy re-export shim was removed once every sheet became a pure
    # sub-builder; the historical import path must no longer resolve.
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("app.services.exports.extraction_xlsx_builder")
