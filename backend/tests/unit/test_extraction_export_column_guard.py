"""§5.5 — pre-build column guard against Excel's 16,384-column hard limit.

Formalizes the guard that S4/S5 introduced in the workbook orchestrator:
``build_workbook`` rejects a layout whose matrix would exceed Excel's
16,384-column ceiling with a clear, pre-build ``ExportColumnLimitError``
instead of an opaque openpyxl crash mid-write. The error doubles as an
``AppError`` so the export endpoint surfaces it as a 422 ``error.message``
envelope (``EXPORT_COLUMN_LIMIT_EXCEEDED``).
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi import status

from app.core.error_handler import AppError
from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionFieldType,
)
from app.services.exports.extraction.workbook import (
    EXCEL_MAX_COLUMNS,
    ExportColumnLimitError,
    _matrix_column_count,
    build_workbook,
)
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    ExportNotes,
    FieldDescriptor,
    SectionDescriptor,
)


def _wide_layout(*, n_articles: int, n_subcols_each: int) -> ExportLayout:
    """A layout whose matrix needs ``n_articles * n_subcols_each`` data
    columns (+2 label columns) — used to drive the guard at/over the limit.

    The single section is ``cardinality=MANY`` so each article's
    ``section_instances`` fan out into one data column per instance, which
    is exactly what ``_article_fanout_count`` (and thus the guard) counts.
    """
    sec_id = uuid4()
    field = FieldDescriptor(
        field_id=uuid4(),
        label="F",
        type=ExtractionFieldType.TEXT,
        allowed_values=(),
        parent_section_id=sec_id,
    )
    section = SectionDescriptor(
        entity_type_id=sec_id,
        label="Sec",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(field,),
        cardinality=ExtractionCardinality.MANY,
    )
    articles = tuple(
        ArticleDescriptor(
            article_id=uuid4(),
            header_label=f"A{i}",
            run_id=uuid4(),
            run_stage=None,
            version_id=uuid4(),
            model_instances=(),
            section_instances={sec_id: tuple(uuid4() for _ in range(n_subcols_each))},
        )
        for i in range(n_articles)
    )
    return ExportLayout(
        project_name="P",
        template_name="T",
        template_version=1,
        sections=(section,),
        articles=articles,
        reviewers=(),
        mode=ExportMode.CONSENSUS,
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        notes=ExportNotes(
            omitted_articles_by_stage={},
            template_version_label="T v1",
            export_mode_label="consensus",
            generated_at=datetime(2026, 6, 14, tzinfo=UTC),
        ),
        value_map={},
    )


def test_excel_max_columns_is_the_xlsx_hard_limit() -> None:
    # Public, framework-agnostic constant the guard and its callers share.
    assert EXCEL_MAX_COLUMNS == 16_384


def test_guard_raises_when_columns_exceed_excel_limit() -> None:
    # 500 articles × 100 instance sub-columns each = 50,000 data columns > 16,384.
    layout = _wide_layout(n_articles=500, n_subcols_each=100)
    with pytest.raises(ExportColumnLimitError) as exc:
        build_workbook(layout)
    msg = str(exc.value)
    assert str(EXCEL_MAX_COLUMNS) in msg or "16,384" in msg
    # Actionable hint for the user.
    assert "columns" in msg.lower()


def test_guard_error_surfaces_as_a_422_envelope() -> None:
    # ExportColumnLimitError is also an AppError, so the endpoint's
    # app_error_handler renders it as the standard error.message envelope
    # at HTTP 422 (a user input problem, not a 400/500), with a stable code.
    layout = _wide_layout(n_articles=500, n_subcols_each=100)
    with pytest.raises(ExportColumnLimitError) as exc:
        build_workbook(layout)
    err = exc.value
    assert isinstance(err, AppError)
    assert isinstance(err, ValueError)
    assert err.code == "EXPORT_COLUMN_LIMIT_EXCEEDED"
    assert err.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert err.message == str(err)


def test_guard_counts_the_boundary_exactly() -> None:
    # 2 label cols + 16,382 data cols == 16,384 exactly → at the limit, allowed.
    # Asserting via the guard's own counter keeps this fast (a real
    # 16,382-column build is exercised by the determinism suite's boundary case).
    at_limit = _wide_layout(n_articles=1, n_subcols_each=16_382)
    assert _matrix_column_count(at_limit) == EXCEL_MAX_COLUMNS

    over_limit = _wide_layout(n_articles=1, n_subcols_each=16_383)
    assert _matrix_column_count(over_limit) == EXCEL_MAX_COLUMNS + 1


def test_guard_allows_an_in_bounds_layout() -> None:
    # A small layout well under the limit must build to valid XLSX bytes.
    layout = _wide_layout(n_articles=2, n_subcols_each=3)
    data = build_workbook(layout)
    assert data[:2] == b"PK"
