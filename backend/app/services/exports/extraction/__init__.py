"""Pure XLSX sub-builder package for extraction exports.

Every ``build_<sheet>(layout, titles) -> SheetSpec`` is a pure, no-IO
function (no DB session, no storage adapter, no network) so each sheet is
unit-testable without an openpyxl ``Workbook``. ``workbook.py`` is the
only orchestrator: it allocates every title once (``allocate_titles``) and
owns the single public ``build_workbook(layout, shape, *, include_matrix)``
signature consumed by the endpoint and the Celery worker.
"""

from __future__ import annotations

from app.services.exports.extraction.workbook import build_workbook

__all__ = ["build_workbook"]
