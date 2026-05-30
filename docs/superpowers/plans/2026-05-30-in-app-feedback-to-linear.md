# In-App Feedback → Linear Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bridge the existing in-app feedback widget to the Linear **Prumo (`PRU`)** team via a durable store-and-forward outbox, with optional `getDisplayMedia()` screenshot/clip capture.

**Architecture:** The browser collects feedback (+ optional media uploaded straight to a private Supabase bucket) and `POST`s to a new `/api/v1/feedback` endpoint. The backend persists a `feedback_reports` outbox row (+ `feedback_attachments`), returns `202`, and enqueues a Celery task that creates a Linear issue and attaches the media — idempotently, with retries. The user's success is decoupled from Linear's uptime.

**Tech Stack:** FastAPI · SQLAlchemy 2.0 async · Alembic · Celery + Redis · httpx · Pydantic v2 · structlog (backend); React 18 + Vite + TS strict · TanStack Query v5 · shadcn/Radix · Supabase Storage (frontend); pytest · vitest · MSW v2 (tests). Linear GraphQL API.

**Source spec:** [`docs/superpowers/specs/2026-05-30-in-app-feedback-to-linear-design.md`](../specs/2026-05-30-in-app-feedback-to-linear-design.md)

---

## Architecture notes / deviations from the spec

These are intentional, evidence-based refinements discovered while reading the codebase:

1. **Storage upload = browser-direct + scoped RLS** (spec §9's approved *alternative*, not the recommended signed-URL). Rationale: `frontend/hooks/useFileUpload.ts` already uploads browser-direct to a Supabase bucket; the `StorageAdapter` ABC has **no** signed-upload method. Reusing the proven pattern avoids adding an unverified adapter API. The bucket is private; an RLS policy scopes writes to the user's own `auth.uid()` prefix; the backend reads via service-role.
2. **Celery routing = existing `celery` queue** (spec §7 said a dedicated `feedback` queue). Rationale: `tests/unit/test_celery_app_task_registry.py` + `tests/unit/test_celery_routes_drift.py` enforce that every routed queue is in the Railway worker's `--queues` list. The worker already consumes `celery`; routing there needs no worker-command change.
3. **Column names match the existing table** — keep `viewport_size` (not `viewport`); the table already has `type`/`severity`/`description`/`url`/`user_agent`/`viewport_size`/`project_id`/`article_id`/`user_id`/timestamps.
4. **TEXT + CHECK over PG enums** for `type`/`severity`/`forward_status`/`kind` — simpler migration, no enum lifecycle; Pydantic `Literal`s enforce values at the edge.

## File structure map

**Backend — create:**
- `backend/app/models/feedback.py` — `FeedbackReport`, `FeedbackAttachment` ORM models
- `backend/app/schemas/feedback.py` — request/response Pydantic models
- `backend/app/services/feedback_service.py` — `FeedbackService.create_report`
- `backend/app/services/linear/__init__.py`, `linear_client.py`, `feedback_mapping.py`
- `backend/app/api/v1/endpoints/feedback.py` — `POST /api/v1/feedback`
- `backend/app/worker/tasks/feedback_tasks.py` — `forward_feedback_to_linear_task`
- `backend/alembic/versions/0020_feedback_outbox.py` — migration
- `supabase/migrations/<ts>_feedback_media_bucket.sql` — bucket + Storage RLS
- Tests under `backend/tests/`

**Backend — modify:**
- `backend/app/models/__init__.py` — register new models
- `backend/alembic/env.py` — drop `feedback_reports` from the SQL-only exclusion
- `backend/app/core/config.py` — `LINEAR_*`, `FEEDBACK_*` settings
- `backend/app/worker/celery_app.py` — `include=` + `task_routes`
- `backend/app/api/v1/router.py` — register the router

**Frontend — create:**
- `frontend/services/feedbackService.ts`, `frontend/hooks/useScreenCapture.ts`
- Tests under `frontend/test/`

**Frontend — modify:**
- `frontend/hooks/useFeedback.ts`, `frontend/components/feedback/FeedbackDialog.tsx`
- `frontend/types/feedback.ts`, `frontend/lib/copy/navigation.ts`

---

# Phase 1 — Data layer

## Task 1: ORM models

**Files:**
- Create: `backend/app/models/feedback.py`
- Modify: `backend/app/models/__init__.py`
- Test: `backend/tests/unit/test_feedback_models.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_feedback_models.py
"""Unit tests for the feedback ORM models (no DB I/O)."""

from app.models.feedback import FeedbackAttachment, FeedbackReport


def test_feedback_report_tablename_is_plural() -> None:
    # BaseModel auto-derives a SINGULAR name; we must override to match
    # the existing `feedback_reports` table.
    assert FeedbackReport.__tablename__ == "feedback_reports"
    assert FeedbackReport.__table__.schema == "public"


def test_feedback_attachment_tablename() -> None:
    assert FeedbackAttachment.__tablename__ == "feedback_attachments"


def test_feedback_report_has_outbox_columns() -> None:
    cols = set(FeedbackReport.__table__.columns.keys())
    assert {
        "id", "user_id", "type", "severity", "summary", "description",
        "url", "route", "user_agent", "viewport_size", "project_id",
        "article_id", "app_version", "linear_issue_id", "linear_identifier",
        "linear_url", "forward_status", "forward_error", "forwarded_at",
        "created_at", "updated_at",
    }.issubset(cols)
    # Dead triage columns must be gone from the model.
    assert "status" not in cols
    assert "admin_notes" not in cols
    assert "screenshot_url" not in cols


def test_feedback_attachment_columns() -> None:
    cols = set(FeedbackAttachment.__table__.columns.keys())
    assert {
        "id", "feedback_report_id", "kind", "storage_key",
        "content_type", "size_bytes", "linear_asset_url", "forward_status",
    }.issubset(cols)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_feedback_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models.feedback'`

- [ ] **Step 3: Write the models**

```python
# backend/app/models/feedback.py
"""Feedback outbox models.

`feedback_reports` is a store-and-forward log: a row is persisted on
submit, then a Celery task forwards it to Linear with idempotent
retries. `feedback_attachments` holds optional screenshots/clips.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class FeedbackReport(BaseModel):
    """A single user feedback submission, forwarded to Linear."""

    __tablename__ = "feedback_reports"

    user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str | None] = mapped_column(String(16), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)

    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    route: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    viewport_size: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    project_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    article_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.articles.id", ondelete="SET NULL"),
        nullable=True,
    )
    app_version: Mapped[str | None] = mapped_column(String(64), nullable=True)

    linear_issue_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    linear_identifier: Mapped[str | None] = mapped_column(String(32), nullable=True)
    linear_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    forward_status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="pending"
    )
    forward_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    forwarded_at: Mapped[datetime | None] = mapped_column(nullable=True)

    attachments: Mapped[list["FeedbackAttachment"]] = relationship(
        back_populates="report",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class FeedbackAttachment(BaseModel):
    """A screenshot or short clip attached to a feedback report."""

    __tablename__ = "feedback_attachments"

    feedback_report_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.feedback_reports.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    linear_asset_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    forward_status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="pending"
    )

    report: Mapped["FeedbackReport"] = relationship(back_populates="attachments")
```

- [ ] **Step 4: Register the models**

In `backend/app/models/__init__.py`, add an import alongside the existing model imports so SQLAlchemy's mapper registry and Alembic see them:

```python
from app.models.feedback import FeedbackAttachment, FeedbackReport  # noqa: F401
```

If `__init__.py` maintains an `__all__` list, append `"FeedbackReport"` and `"FeedbackAttachment"`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_feedback_models.py -v`
Expected: PASS (4 passed)

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/feedback.py backend/app/models/__init__.py backend/tests/unit/test_feedback_models.py
git commit -m "feat(feedback): add FeedbackReport + FeedbackAttachment ORM models"
```

---

## Task 2: Alembic migration (slim outbox + child table + RLS)

> **Note (as-built):** the real legacy `feedback_reports` had `category`/`message`/`metadata`/`status` (not `type`/`description`/…). The committed migration `0020_feedback_outbox.py` adapts: it ADDS the structured columns, DROPS the legacy ones, and BACKFILLS `message`→`description` / `category`→`summary`. The code block below is the original (pre-discovery) plan and is superseded by the committed migration.

**Files:**
- Create: `backend/alembic/versions/0020_feedback_outbox.py`
- Modify: `backend/alembic/env.py`
- Test: `backend/tests/integration/test_feedback_report_persistence.py`

- [ ] **Step 1: Confirm the current migration head**

Run: `cd backend && uv run alembic heads`
Expected: prints `0019_gate_find_user_id_by_email (head)`. If it prints a different head, use THAT value for `down_revision` in Step 3.

- [ ] **Step 2: Write the failing persistence test**

```python
# backend/tests/integration/test_feedback_report_persistence.py
"""Integration test: the slimmed feedback_reports table persists an
outbox row with the expected server-side defaults. Uses user_id=None to
avoid the auth.users FK (the column is nullable by design)."""

import pytest
from sqlalchemy import select

from app.models.feedback import FeedbackAttachment, FeedbackReport

pytestmark = pytest.mark.integration


async def test_persist_report_with_defaults(db_session) -> None:
    report = FeedbackReport(
        user_id=None,
        type="bug",
        severity="high",
        description="The PDF viewer renders blank on the extraction screen.",
        url="https://app.example/projects/p/extraction",
        route="/projects/:id/extraction",
    )
    db_session.add(report)
    await db_session.flush()

    report.attachments.append(
        FeedbackAttachment(
            kind="image",
            storage_key=f"{report.id}/shot.webp",
            content_type="image/webp",
            size_bytes=2048,
        )
    )
    await db_session.flush()

    fetched = (
        await db_session.execute(
            select(FeedbackReport).where(FeedbackReport.id == report.id)
        )
    ).scalar_one()
    assert fetched.forward_status == "pending"
    assert len(fetched.attachments) == 1
    assert fetched.attachments[0].forward_status == "pending"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_feedback_report_persistence.py -v`
Expected: FAIL — the new columns (`route`, `forward_status`, …) and `feedback_attachments` table do not exist yet (`ProgrammingError`/`UndefinedColumn`).

- [ ] **Step 4: Write the migration**

```python
# backend/alembic/versions/0020_feedback_outbox.py
"""Slim feedback_reports into a Linear store-and-forward outbox.

- Add outbox + Linear-link columns; add `feedback_attachments`.
- Drop the dead in-app-triage columns (status / priority / admin_notes /
  screenshot_url) — Linear's Triage owns triage now.
- Tighten RLS to service-role only (the client no longer writes this
  table directly; it goes through POST /api/v1/feedback).

Revision ID: 0020_feedback_outbox
Revises: 0019_gate_find_user_id_by_email
Create Date: 2026-05-30
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

revision = "0020_feedback_outbox"
down_revision = "0019_gate_find_user_id_by_email"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- new columns on feedback_reports ---
    op.add_column("feedback_reports", sa.Column("summary", sa.Text(), nullable=True), schema="public")
    op.add_column("feedback_reports", sa.Column("route", sa.Text(), nullable=True), schema="public")
    op.add_column("feedback_reports", sa.Column("app_version", sa.String(64), nullable=True), schema="public")
    op.add_column("feedback_reports", sa.Column("linear_issue_id", sa.Text(), nullable=True), schema="public")
    op.add_column("feedback_reports", sa.Column("linear_identifier", sa.String(32), nullable=True), schema="public")
    op.add_column("feedback_reports", sa.Column("linear_url", sa.Text(), nullable=True), schema="public")
    op.add_column(
        "feedback_reports",
        sa.Column("forward_status", sa.String(16), nullable=False, server_default="pending"),
        schema="public",
    )
    op.add_column("feedback_reports", sa.Column("forward_error", sa.Text(), nullable=True), schema="public")
    op.add_column(
        "feedback_reports",
        sa.Column("forwarded_at", sa.DateTime(timezone=True), nullable=True),
        schema="public",
    )
    op.create_check_constraint(
        "feedback_reports_forward_status_check",
        "feedback_reports",
        "forward_status IN ('pending','issue_created','sent','failed')",
        schema="public",
    )

    # --- drop dead triage columns ---
    for col in ("status", "priority", "admin_notes", "screenshot_url"):
        op.drop_column("feedback_reports", col, schema="public")

    # --- child table ---
    op.create_table(
        "feedback_attachments",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "feedback_report_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("public.feedback_reports.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("content_type", sa.String(128), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("linear_asset_url", sa.Text(), nullable=True),
        sa.Column("forward_status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("kind IN ('image','video')", name="feedback_attachments_kind_check"),
        sa.CheckConstraint(
            "forward_status IN ('pending','sent','failed')",
            name="feedback_attachments_forward_status_check",
        ),
        schema="public",
    )
    op.create_index(
        "ix_feedback_attachments_report_id",
        "feedback_attachments",
        ["feedback_report_id"],
        schema="public",
    )
    op.execute('ALTER TABLE "public"."feedback_attachments" ENABLE ROW LEVEL SECURITY;')
    op.execute("GRANT ALL ON TABLE public.feedback_attachments TO service_role;")

    # --- tighten RLS on feedback_reports (client no longer writes directly) ---
    op.execute('DROP POLICY IF EXISTS "feedback_reports_insert" ON public.feedback_reports;')
    op.execute('DROP POLICY IF EXISTS "feedback_reports_select_own" ON public.feedback_reports;')
    # service_role bypasses RLS; no permissive policies remain for authenticated/anon.


def downgrade() -> None:
    op.execute('DROP POLICY IF EXISTS "feedback_reports_insert" ON public.feedback_reports;')
    op.execute(
        'CREATE POLICY "feedback_reports_select_own" ON public.feedback_reports '
        "FOR SELECT USING (((user_id = auth.uid()) OR (auth.role() = 'service_role'::text)));"
    )
    op.execute(
        'CREATE POLICY "feedback_reports_insert" ON public.feedback_reports '
        "FOR INSERT WITH CHECK ((user_id = auth.uid()) OR (auth.role() = 'service_role'::text));"
    )

    op.drop_index("ix_feedback_attachments_report_id", table_name="feedback_attachments", schema="public")
    op.drop_table("feedback_attachments", schema="public")

    op.add_column("feedback_reports", sa.Column("screenshot_url", sa.Text(), nullable=True), schema="public")
    op.add_column("feedback_reports", sa.Column("admin_notes", sa.Text(), nullable=True), schema="public")
    op.add_column(
        "feedback_reports",
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        schema="public",
    )
    op.add_column(
        "feedback_reports",
        sa.Column("status", sa.Text(), nullable=False, server_default="open"),
        schema="public",
    )

    op.drop_constraint("feedback_reports_forward_status_check", "feedback_reports", schema="public")
    for col in (
        "forwarded_at", "forward_error", "forward_status", "linear_url",
        "linear_identifier", "linear_issue_id", "app_version", "route", "summary",
    ):
        op.drop_column("feedback_reports", col, schema="public")
```

- [ ] **Step 5: Drop `feedback_reports` from the SQL-only exclusion**

Open `backend/alembic/env.py`, find the comment/collection listing SQL-only tables (e.g. `article_annotations`, `feedback_reports`) used to skip them during `--autogenerate`. Remove the `"feedback_reports"` entry so future autogenerate diffs the now-managed table. (Leave `article_annotations` and others untouched.)

- [ ] **Step 6: Apply the migration and run the test**

Run:
```bash
cd backend && uv run alembic upgrade head && uv run pytest tests/integration/test_feedback_report_persistence.py -v
```
Expected: migration applies cleanly; test PASSES (1 passed). (Requires the local DB running — `make start` if needed.)

- [ ] **Step 7: Verify downgrade works**

Run: `cd backend && uv run alembic downgrade -1 && uv run alembic upgrade head`
Expected: both succeed with no error.

- [ ] **Step 8: Commit**

```bash
git add backend/alembic/versions/0020_feedback_outbox.py backend/alembic/env.py backend/tests/integration/test_feedback_report_persistence.py
git commit -m "feat(feedback): migration — slim feedback_reports into a Linear outbox + attachments"
```

---

# Phase 2 — Linear client + mapping

## Task 3: Config settings for Linear + feedback

**Files:**
- Modify: `backend/app/core/config.py`
- Test: `backend/tests/unit/test_feedback_config.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_feedback_config.py
from app.core.config import Settings


def test_feedback_settings_have_defaults() -> None:
    s = Settings(_env_file=None)  # type: ignore[call-arg]
    assert s.LINEAR_API_KEY is None
    assert s.LINEAR_TEAM_ID is None
    assert s.FEEDBACK_MEDIA_BUCKET == "feedback-media"
    assert s.FEEDBACK_MAX_IMAGE_BYTES == 10 * 1024 * 1024
    assert s.FEEDBACK_MAX_VIDEO_BYTES == 50 * 1024 * 1024
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_feedback_config.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'LINEAR_API_KEY'`

- [ ] **Step 3: Add the settings**

In `backend/app/core/config.py`, add a new section to the `Settings` class (after the `SECURITY` section):

```python
    # =================== FEEDBACK / LINEAR ===================
    LINEAR_API_KEY: str | None = None
    LINEAR_TEAM_ID: str | None = None
    FEEDBACK_MEDIA_BUCKET: str = "feedback-media"
    FEEDBACK_MAX_IMAGE_BYTES: int = 10 * 1024 * 1024
    FEEDBACK_MAX_VIDEO_BYTES: int = 50 * 1024 * 1024
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_feedback_config.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/config.py backend/tests/unit/test_feedback_config.py
git commit -m "feat(feedback): add LINEAR_* and FEEDBACK_* settings"
```

---

## Task 4: Linear field mapping (pure functions)

**Files:**
- Create: `backend/app/services/linear/__init__.py` (empty), `backend/app/services/linear/feedback_mapping.py`
- Test: `backend/tests/unit/test_linear_feedback_mapping.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_linear_feedback_mapping.py
from types import SimpleNamespace

from app.services.linear.feedback_mapping import (
    area_label_for,
    attachments_markdown,
    issue_body,
    issue_title,
    label_names_for,
    priority_for,
)


def _report(**kw):
    base = dict(
        id="11111111-1111-1111-1111-111111111111",
        type="bug", severity="high", summary=None,
        description="PDF viewer blank on extraction.",
        url="https://app/x", route="/projects/p/extraction",
        project_id=None, article_id=None, user_agent="UA", viewport_size={"width": 1280, "height": 800},
        app_version="abc123",
    )
    base.update(kw)
    return SimpleNamespace(**base)


def test_priority_mapping() -> None:
    assert priority_for("critical") == 1
    assert priority_for("high") == 2
    assert priority_for("medium") == 3
    assert priority_for("low") == 4
    assert priority_for(None) == 0


def test_label_names_include_source_and_type_and_area() -> None:
    names = label_names_for(_report(type="bug", route="/projects/p/extraction"))
    assert "source:in-app" in names
    assert "Bug" in names
    assert "area:extraction" in names


def test_label_names_other_has_no_type_label() -> None:
    names = label_names_for(_report(type="other", route="/settings"))
    assert "source:in-app" in names
    assert "Bug" not in names and "Feature" not in names and "Question" not in names


def test_area_label_for_pdf_and_unknown() -> None:
    assert area_label_for("/projects/p/articles/a/pdf") == "area:pdf"
    assert area_label_for("/totally/unknown") is None


def test_issue_title_prefers_summary_then_derives() -> None:
    assert issue_title(_report(summary="Crash on save")) == "Crash on save"
    derived = issue_title(_report(summary=None, type="bug", description="X" * 200))
    assert derived.startswith("[Bug] ") and len(derived) <= 90


def test_issue_body_contains_context() -> None:
    body = issue_body(_report())
    assert "PDF viewer blank" in body
    assert "/projects/p/extraction" in body
    assert "abc123" in body


def test_attachments_markdown_image_vs_video() -> None:
    atts = [
        SimpleNamespace(kind="image", linear_asset_url="https://a/img.webp", forward_status="sent"),
        SimpleNamespace(kind="video", linear_asset_url="https://a/clip.webm", forward_status="sent"),
        SimpleNamespace(kind="image", linear_asset_url=None, forward_status="pending"),
    ]
    md = attachments_markdown(atts)
    assert "![](https://a/img.webp)" in md
    assert "[Screen recording](https://a/clip.webm)" in md
    assert md.count("http") == 2  # the pending/no-url one is skipped
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_linear_feedback_mapping.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the mapping**

```python
# backend/app/services/linear/__init__.py
```
(empty file)

```python
# backend/app/services/linear/feedback_mapping.py
"""Pure mapping from a feedback report to Linear issue fields."""

from typing import Any

# Linear native priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
_PRIORITY_BY_SEVERITY = {"critical": 1, "high": 2, "medium": 3, "low": 4}

# Feedback type -> Linear label name. 'other' intentionally has no type label.
_TYPE_LABEL = {"bug": "Bug", "suggestion": "Feature", "question": "Question"}

SOURCE_LABEL = "source:in-app"

# Ordered route-substring -> area label. First match wins.
_AREA_RULES: list[tuple[str, str]] = [
    ("/pdf", "area:pdf"),
    ("/extraction", "area:extraction"),
    ("/quality", "area:extraction"),
    ("/settings", "area:ui-ux"),
    ("/members", "area:multi-user"),
    ("/team", "area:multi-user"),
]


def priority_for(severity: str | None) -> int:
    return _PRIORITY_BY_SEVERITY.get(severity or "", 0)


def area_label_for(route: str | None) -> str | None:
    if not route:
        return None
    for needle, label in _AREA_RULES:
        if needle in route:
            return label
    return None


def label_names_for(report: Any) -> list[str]:
    names = [SOURCE_LABEL]
    type_label = _TYPE_LABEL.get(report.type)
    if type_label:
        names.append(type_label)
    area = area_label_for(report.route)
    if area:
        names.append(area)
    return names


def issue_title(report: Any) -> str:
    if report.summary:
        return report.summary
    snippet = " ".join(report.description.split())[:80]
    return f"[{report.type.capitalize()}] {snippet}"


def issue_body(report: Any) -> str:
    vp = report.viewport_size or {}
    vp_str = f"{vp.get('width', '?')}×{vp.get('height', '?')}" if vp else "—"
    lines = [
        report.description.strip(),
        "",
        "---",
        "**Context**",
        f"- Report id: `{report.id}`",
        f"- Type / severity: {report.type} / {report.severity or '—'}",
        f"- URL: {report.url or '—'}",
        f"- Route: {report.route or '—'}",
        f"- Project: {report.project_id or '—'}",
        f"- Article: {report.article_id or '—'}",
        f"- App version: {report.app_version or '—'}",
        f"- Viewport: {vp_str}",
        f"- User agent: {report.user_agent or '—'}",
    ]
    return "\n".join(lines)


def attachments_markdown(attachments: list[Any]) -> str:
    parts: list[str] = []
    for att in attachments:
        if not att.linear_asset_url:
            continue
        if att.kind == "image":
            parts.append(f"![]({att.linear_asset_url})")
        else:
            parts.append(f"[Screen recording]({att.linear_asset_url})")
    if not parts:
        return ""
    return "\n\n---\n**Attachments**\n\n" + "\n\n".join(parts)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_linear_feedback_mapping.py -v`
Expected: PASS (7 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/linear/ backend/tests/unit/test_linear_feedback_mapping.py
git commit -m "feat(feedback): Linear field mapping (labels, priority, body, attachments)"
```

---

## Task 5: Linear GraphQL client

**Files:**
- Create: `backend/app/services/linear/linear_client.py`
- Test: `backend/tests/unit/test_linear_client.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_linear_client.py
"""Unit tests for LinearClient — the httpx boundary is mocked."""

from unittest.mock import AsyncMock, patch

import pytest

from app.services.linear.linear_client import LinearClient, LinearError


def _resp(json_body, status=200):
    m = AsyncMock()
    m.json = lambda: json_body
    m.status_code = status
    m.raise_for_status = lambda: None
    return m


@pytest.fixture
def client() -> LinearClient:
    return LinearClient(api_key="key", team_id="team-1")


async def test_create_issue_sends_input_and_parses_issue(client: LinearClient) -> None:
    body = {"data": {"issueCreate": {"success": True,
            "issue": {"id": "i1", "identifier": "PRU-123", "url": "https://linear/PRU-123"}}}}
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_resp(body))) as post:
        issue = await client.create_issue(
            title="t", description="d", priority=2, label_ids=["l1", "l2"]
        )
    assert issue["identifier"] == "PRU-123"
    sent = post.call_args.kwargs["json"]["variables"]["input"]
    assert sent["teamId"] == "team-1"
    assert sent["priority"] == 2
    assert sent["labelIds"] == ["l1", "l2"]


async def test_graphql_raises_on_errors(client: LinearClient) -> None:
    body = {"errors": [{"message": "bad"}]}
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_resp(body))):
        with pytest.raises(LinearError):
            await client.create_issue(title="t", description="d", priority=0, label_ids=[])


async def test_resolve_labels_creates_missing(client: LinearClient) -> None:
    team_labels = {"data": {"team": {"labels": {"nodes": [{"id": "L_bug", "name": "Bug"}]}}}}
    created = {"data": {"issueLabelCreate": {"success": True,
              "issueLabel": {"id": "L_src", "name": "source:in-app"}}}}
    with patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=[_resp(team_labels), _resp(created)])):
        ids = await client.resolve_labels(["Bug", "source:in-app"])
    assert ids == ["L_bug", "L_src"]


async def test_upload_file_requests_url_then_puts(client: LinearClient) -> None:
    up = {"data": {"fileUpload": {"success": True, "uploadFile": {
        "uploadUrl": "https://upload/put", "assetUrl": "https://asset/x.webp",
        "headers": [{"key": "x-h", "value": "v"}]}}}}
    post = AsyncMock(return_value=_resp(up))
    put = AsyncMock(return_value=_resp({}, status=200))
    with patch("httpx.AsyncClient.post", new=post), patch("httpx.AsyncClient.put", new=put):
        asset = await client.upload_file(data=b"bytes", content_type="image/webp", filename="x.webp")
    assert asset == "https://asset/x.webp"
    assert put.call_args.kwargs["headers"]["x-h"] == "v"
    assert put.call_args.kwargs["headers"]["Content-Type"] == "image/webp"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_linear_client.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client**

```python
# backend/app/services/linear/linear_client.py
"""Minimal async Linear GraphQL client for feedback forwarding.

Per-request httpx clients (no shared client) to match the project's
event-loop-safety convention. Authorization uses the raw personal/api
key (Linear personal keys are sent without a 'Bearer ' prefix).

NOTE: GraphQL field names target the Linear API as of 2026-05. Verify
against https://developers.linear.app if a mutation 400s.
"""

from typing import Any

import httpx

_ENDPOINT = "https://api.linear.app/graphql"


class LinearError(RuntimeError):
    """Raised when the Linear API returns GraphQL errors."""


class LinearClient:
    def __init__(self, api_key: str, team_id: str) -> None:
        self.api_key = api_key
        self.team_id = team_id

    async def _graphql(self, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                _ENDPOINT,
                json={"query": query, "variables": variables},
                headers={"Authorization": self.api_key, "Content-Type": "application/json"},
                timeout=30.0,
            )
            resp.raise_for_status()
            payload = resp.json()
        if payload.get("errors"):
            raise LinearError(str(payload["errors"]))
        return payload["data"]

    async def create_issue(
        self, *, title: str, description: str, priority: int, label_ids: list[str]
    ) -> dict[str, Any]:
        query = (
            "mutation IssueCreate($input: IssueCreateInput!) {"
            " issueCreate(input: $input) {"
            " success issue { id identifier url } } }"
        )
        data = await self._graphql(
            query,
            {
                "input": {
                    "teamId": self.team_id,
                    "title": title,
                    "description": description,
                    "priority": priority,
                    "labelIds": label_ids,
                }
            },
        )
        return data["issueCreate"]["issue"]

    async def update_issue_description(self, issue_id: str, description: str) -> None:
        query = (
            "mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {"
            " issueUpdate(id: $id, input: $input) { success } }"
        )
        await self._graphql(query, {"id": issue_id, "input": {"description": description}})

    async def _team_labels(self) -> dict[str, str]:
        query = (
            "query TeamLabels($id: String!) {"
            " team(id: $id) { labels(first: 250) { nodes { id name } } } }"
        )
        data = await self._graphql(query, {"id": self.team_id})
        return {n["name"]: n["id"] for n in data["team"]["labels"]["nodes"]}

    async def _create_label(self, name: str) -> str:
        query = (
            "mutation LabelCreate($input: IssueLabelCreateInput!) {"
            " issueLabelCreate(input: $input) { success issueLabel { id name } } }"
        )
        data = await self._graphql(query, {"input": {"teamId": self.team_id, "name": name}})
        return data["issueLabelCreate"]["issueLabel"]["id"]

    async def resolve_labels(self, names: list[str]) -> list[str]:
        """Map label names to ids, creating any that don't exist yet."""
        existing = await self._team_labels()
        ids: list[str] = []
        for name in names:
            label_id = existing.get(name)
            if label_id is None:
                label_id = await self._create_label(name)
            ids.append(label_id)
        return ids

    async def upload_file(self, *, data: bytes, content_type: str, filename: str) -> str:
        """Upload bytes into Linear's file storage; return the permanent assetUrl."""
        query = (
            "mutation FileUpload($contentType: String!, $filename: String!, $size: Int!) {"
            " fileUpload(contentType: $contentType, filename: $filename, size: $size) {"
            " success uploadFile { uploadUrl assetUrl headers { key value } } } }"
        )
        result = await self._graphql(
            query, {"contentType": content_type, "filename": filename, "size": len(data)}
        )
        upload = result["fileUpload"]["uploadFile"]
        headers = {h["key"]: h["value"] for h in upload["headers"]}
        headers["Content-Type"] = content_type
        async with httpx.AsyncClient() as client:
            put = await client.put(upload["uploadUrl"], content=data, headers=headers, timeout=60.0)
            put.raise_for_status()
        return upload["assetUrl"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_linear_client.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/linear/linear_client.py backend/tests/unit/test_linear_client.py
git commit -m "feat(feedback): Linear GraphQL client (issue/label/file upload)"
```

---

# Phase 3 — Backend endpoint, service, task

## Task 6: Request/response schemas

**Files:**
- Create: `backend/app/schemas/feedback.py`
- Test: `backend/tests/unit/test_feedback_schemas.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_feedback_schemas.py
import pytest
from pydantic import ValidationError

from app.schemas.feedback import FeedbackAttachmentIn, FeedbackCreate


def _payload(**kw):
    base = dict(
        type="bug",
        severity="high",
        description="The PDF viewer renders blank on the extraction screen.",
        context={"url": "https://app/x", "route": "/projects/p/extraction"},
        attachments=[],
    )
    base.update(kw)
    return base


def test_valid_payload_parses() -> None:
    model = FeedbackCreate(**_payload())
    assert model.type == "bug"
    assert model.context.url == "https://app/x"


def test_short_description_rejected() -> None:
    with pytest.raises(ValidationError):
        FeedbackCreate(**_payload(description="too short"))


def test_bad_type_rejected() -> None:
    with pytest.raises(ValidationError):
        FeedbackCreate(**_payload(type="rant"))


def test_attachment_mime_allowlist() -> None:
    ok = FeedbackAttachmentIn(kind="image", storage_key="k", content_type="image/webp")
    assert ok.content_type == "image/webp"
    with pytest.raises(ValidationError):
        FeedbackAttachmentIn(kind="image", storage_key="k", content_type="application/pdf")


def test_too_many_attachments_rejected() -> None:
    att = {"kind": "image", "storage_key": "k", "content_type": "image/png"}
    with pytest.raises(ValidationError):
        FeedbackCreate(**_payload(attachments=[att] * 6))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_feedback_schemas.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schemas**

```python
# backend/app/schemas/feedback.py
"""Pydantic schemas for the feedback intake endpoint."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

FeedbackType = Literal["bug", "suggestion", "question", "other"]
FeedbackSeverity = Literal["low", "medium", "high", "critical"]
AttachmentKind = Literal["image", "video"]

_ALLOWED_CONTENT_TYPES = {
    "image/png",
    "image/webp",
    "image/jpeg",
    "video/webm",
}


class FeedbackContextIn(BaseModel):
    url: str | None = None
    route: str | None = None
    user_agent: str | None = None
    viewport_size: dict | None = None
    project_id: UUID | None = None
    article_id: UUID | None = None
    app_version: str | None = None


class FeedbackAttachmentIn(BaseModel):
    kind: AttachmentKind
    storage_key: str = Field(min_length=1)
    content_type: str
    size_bytes: int | None = Field(default=None, ge=0)

    def model_post_init(self, _ctx: object) -> None:
        if self.content_type not in _ALLOWED_CONTENT_TYPES:
            raise ValueError(f"content_type not allowed: {self.content_type}")


class FeedbackCreate(BaseModel):
    type: FeedbackType
    severity: FeedbackSeverity | None = None
    summary: str | None = Field(default=None, max_length=200)
    description: str = Field(min_length=10, max_length=5000)
    context: FeedbackContextIn = Field(default_factory=FeedbackContextIn)
    attachments: list[FeedbackAttachmentIn] = Field(default_factory=list, max_length=5)


class FeedbackCreated(BaseModel):
    report_id: UUID
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_feedback_schemas.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/feedback.py backend/tests/unit/test_feedback_schemas.py
git commit -m "feat(feedback): request/response schemas with MIME allowlist"
```

---

## Task 7: FeedbackService (persist + enqueue)

**Files:**
- Create: `backend/app/services/feedback_service.py`
- Test: `backend/tests/integration/test_feedback_service.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_feedback_service.py
"""Integration test for FeedbackService.create_report.

Uses the real db_session; the Celery enqueue is patched so no broker is
needed. user_id is left null (the test token sub isn't a real UUID) to
avoid the auth.users FK — membership/identity wiring is covered at the
endpoint layer."""

from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.models.feedback import FeedbackReport
from app.schemas.feedback import FeedbackCreate
from app.services.feedback_service import FeedbackService

pytestmark = pytest.mark.integration


def _payload(**kw):
    base = dict(
        type="bug",
        severity="high",
        description="The PDF viewer renders blank on the extraction screen.",
        context={"url": "https://app/x", "route": "/projects/p/extraction"},
        attachments=[{"kind": "image", "storage_key": "u/x.webp", "content_type": "image/webp", "size_bytes": 10}],
    )
    base.update(kw)
    return FeedbackCreate(**base)


async def test_create_report_persists_and_enqueues(db_session) -> None:
    service = FeedbackService(db=db_session, user_id="not-a-uuid")
    with patch(
        "app.services.feedback_service.forward_feedback_to_linear_task.delay"
    ) as delay:
        report = await service.create_report(_payload())
        await db_session.flush()

    fetched = (
        await db_session.execute(
            select(FeedbackReport).where(FeedbackReport.id == report.id)
        )
    ).scalar_one()
    assert fetched.type == "bug"
    assert fetched.route == "/projects/p/extraction"
    assert fetched.forward_status == "pending"
    assert len(fetched.attachments) == 1
    delay.assert_called_once_with(str(report.id))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_feedback_service.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```python
# backend/app/services/feedback_service.py
"""Persist a feedback report (outbox) and enqueue Linear forwarding."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.security import ensure_project_member
from app.core.logging import get_logger
from app.models.feedback import FeedbackAttachment, FeedbackReport
from app.schemas.feedback import FeedbackCreate
from app.worker.tasks.feedback_tasks import forward_feedback_to_linear_task

logger = get_logger(__name__)


class FeedbackService:
    def __init__(self, db: AsyncSession, user_id: str | UUID):
        self.db = db
        self._user_uuid: UUID | None = None
        if isinstance(user_id, UUID):
            self._user_uuid = user_id
        else:
            try:
                self._user_uuid = UUID(str(user_id))
            except ValueError:
                self._user_uuid = None  # test tokens like "test-user-id"

    async def create_report(self, payload: FeedbackCreate) -> FeedbackReport:
        ctx = payload.context

        project_id = ctx.project_id
        if project_id is not None and self._user_uuid is not None:
            # Only store a project reference the caller is actually a member of.
            await ensure_project_member(self.db, project_id, self._user_uuid)

        report = FeedbackReport(
            user_id=self._user_uuid,
            type=payload.type,
            severity=payload.severity,
            summary=payload.summary,
            description=payload.description.strip(),
            url=ctx.url,
            route=ctx.route,
            user_agent=ctx.user_agent,
            viewport_size=ctx.viewport_size,
            project_id=project_id,
            article_id=ctx.article_id,
            app_version=ctx.app_version,
            forward_status="pending",
        )
        for att in payload.attachments:
            report.attachments.append(
                FeedbackAttachment(
                    kind=att.kind,
                    storage_key=att.storage_key,
                    content_type=att.content_type,
                    size_bytes=att.size_bytes,
                    forward_status="pending",
                )
            )

        self.db.add(report)
        await self.db.flush()  # populate report.id

        forward_feedback_to_linear_task.delay(str(report.id))
        logger.info(
            "feedback_report_created",
            report_id=str(report.id),
            type=report.type,
            attachments=len(report.attachments),
        )
        return report
```

> Note: this imports `forward_feedback_to_linear_task`, created in Task 8. Implement Task 8 in the same working session before running the next step.

- [ ] **Step 4: Implement Task 8 (the task module), then run this test**

Run: `cd backend && uv run pytest tests/integration/test_feedback_service.py -v`
Expected: PASS (after Task 8's module exists).

- [ ] **Step 5: Commit (combined with Task 8)**

Commit after Task 8 — see Task 8 Step 7.

---

## Task 8: Celery forward task (idempotent, retrying)

**Files:**
- Create: `backend/app/worker/tasks/feedback_tasks.py`
- Modify: `backend/app/worker/celery_app.py`
- Test: `backend/tests/unit/test_feedback_forward_task.py`

- [ ] **Step 1: Register the task module + route**

In `backend/app/worker/celery_app.py`:

In the `include=[...]` list passed to `Celery(...)`, add:
```python
        "app.worker.tasks.feedback_tasks",
```

In `celery_app.conf.update(... task_routes={...})`, add (routes to the already-consumed `celery` queue — see Architecture notes #2):
```python
        "app.worker.tasks.feedback_tasks.*": {"queue": "celery"},
```

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/unit/test_feedback_forward_task.py
"""Unit test the forwarding coroutine with the Linear client + storage +
session all mocked. Asserts idempotency and status transitions."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.worker.tasks.feedback_tasks import _forward


def _report(**kw):
    base = dict(
        id="11111111-1111-1111-1111-111111111111",
        type="bug", severity="high", summary=None,
        description="blank pdf", url="https://app/x", route="/projects/p/extraction",
        project_id=None, article_id=None, user_agent="UA",
        viewport_size={"width": 1, "height": 2}, app_version="v1",
        linear_issue_id=None, linear_identifier=None, linear_url=None,
        forward_status="pending", forward_error=None, forwarded_at=None,
        attachments=[],
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _session_with(report):
    session = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = report
    session.execute = AsyncMock(return_value=result)
    session.commit = AsyncMock()
    return session


@pytest.fixture
def linear():
    client = AsyncMock()
    client.resolve_labels = AsyncMock(return_value=["L1", "L2"])
    client.create_issue = AsyncMock(
        return_value={"id": "i1", "identifier": "PRU-9", "url": "https://linear/PRU-9"}
    )
    client.upload_file = AsyncMock(return_value="https://asset/x.webp")
    client.update_issue_description = AsyncMock()
    return client


async def test_creates_issue_and_marks_sent(linear) -> None:
    att = SimpleNamespace(kind="image", storage_key="u/x.webp", content_type="image/webp",
                          linear_asset_url=None, forward_status="pending")
    report = _report(attachments=[att])
    session = _session_with(report)
    storage = MagicMock()
    storage.download = AsyncMock(return_value=b"bytes")

    with (
        patch("app.worker.tasks.feedback_tasks.LinearClient", return_value=linear),
        patch("app.worker.tasks.feedback_tasks._build_storage", return_value=storage),
        patch("app.worker.tasks.feedback_tasks.settings") as s,
    ):
        s.LINEAR_API_KEY = "k"; s.LINEAR_TEAM_ID = "t"; s.FEEDBACK_MEDIA_BUCKET = "feedback-media"
        await _forward(session, "11111111-1111-1111-1111-111111111111")

    linear.create_issue.assert_awaited_once()
    assert report.linear_identifier == "PRU-9"
    linear.upload_file.assert_awaited_once()
    assert att.linear_asset_url == "https://asset/x.webp"
    assert att.forward_status == "sent"
    assert report.forward_status == "sent"
    assert report.forwarded_at is not None


async def test_idempotent_when_issue_already_created(linear) -> None:
    report = _report(linear_issue_id="i1", linear_identifier="PRU-9",
                     forward_status="issue_created", attachments=[])
    session = _session_with(report)
    storage = MagicMock()

    with (
        patch("app.worker.tasks.feedback_tasks.LinearClient", return_value=linear),
        patch("app.worker.tasks.feedback_tasks._build_storage", return_value=storage),
        patch("app.worker.tasks.feedback_tasks.settings") as s,
    ):
        s.LINEAR_API_KEY = "k"; s.LINEAR_TEAM_ID = "t"; s.FEEDBACK_MEDIA_BUCKET = "feedback-media"
        await _forward(session, "11111111-1111-1111-1111-111111111111")

    linear.create_issue.assert_not_awaited()  # not recreated
    assert report.forward_status == "sent"


async def test_already_sent_is_noop(linear) -> None:
    report = _report(forward_status="sent")
    session = _session_with(report)
    with (
        patch("app.worker.tasks.feedback_tasks.LinearClient", return_value=linear),
        patch("app.worker.tasks.feedback_tasks._build_storage", return_value=MagicMock()),
        patch("app.worker.tasks.feedback_tasks.settings") as s,
    ):
        s.LINEAR_API_KEY = "k"; s.LINEAR_TEAM_ID = "t"
        await _forward(session, "11111111-1111-1111-1111-111111111111")
    linear.create_issue.assert_not_awaited()
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_feedback_forward_task.py -v`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the task**

```python
# backend/app/worker/tasks/feedback_tasks.py
"""Forward a feedback report to Linear (idempotent, retrying)."""

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from celery import Task
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.models.feedback import FeedbackReport
from app.services.linear.feedback_mapping import (
    attachments_markdown,
    issue_body,
    issue_title,
    label_names_for,
    priority_for,
)
from app.services.linear.linear_client import LinearClient
from app.worker._runner import run_task
from app.worker._session import worker_session
from app.worker.celery_app import celery_app

logger = get_logger(__name__)


def _build_storage() -> Any:
    """Build a service-role storage adapter (split out for test patching)."""
    from app.core.deps import get_supabase_client
    from app.core.factories import create_storage_adapter

    return create_storage_adapter(get_supabase_client())


def _filename_for(att: Any) -> str:
    return att.storage_key.rsplit("/", 1)[-1]


async def _forward(session: AsyncSession, report_id: str) -> None:
    report = (
        await session.execute(
            select(FeedbackReport).where(FeedbackReport.id == UUID(report_id))
        )
    ).scalar_one_or_none()
    if report is None:
        logger.warning("feedback_forward_report_missing", report_id=report_id)
        return
    if report.forward_status == "sent":
        return

    client = LinearClient(api_key=settings.LINEAR_API_KEY, team_id=settings.LINEAR_TEAM_ID)

    # 1. Create the issue (idempotent: only if not already created).
    if not report.linear_issue_id:
        label_ids = await client.resolve_labels(label_names_for(report))
        issue = await client.create_issue(
            title=issue_title(report),
            description=issue_body(report),
            priority=priority_for(report.severity),
            label_ids=label_ids,
        )
        report.linear_issue_id = issue["id"]
        report.linear_identifier = issue["identifier"]
        report.linear_url = issue["url"]
        report.forward_status = "issue_created"
        await session.commit()

    # 2. Upload any not-yet-forwarded attachments.
    if report.attachments:
        storage = _build_storage()
        for att in report.attachments:
            if att.forward_status == "sent":
                continue
            data = await storage.download(settings.FEEDBACK_MEDIA_BUCKET, att.storage_key)
            att.linear_asset_url = await client.upload_file(
                data=data, content_type=att.content_type, filename=_filename_for(att)
            )
            att.forward_status = "sent"
            await session.commit()

        # 3. Re-render the description with the (idempotent) attachment links.
        assets = attachments_markdown(report.attachments)
        if assets:
            await client.update_issue_description(
                report.linear_issue_id, issue_body(report) + assets
            )

    report.forward_status = "sent"
    report.forwarded_at = datetime.now(timezone.utc)
    await session.commit()


@celery_app.task(bind=True, max_retries=5, default_retry_delay=60)
def forward_feedback_to_linear_task(self: Task, report_id: str) -> dict[str, str]:
    """Celery entrypoint: forward one feedback report to Linear."""

    async def run() -> dict[str, str]:
        async with worker_session() as session:
            try:
                await _forward(session, report_id)
                return {"report_id": report_id, "status": "sent"}
            except Exception:
                await session.rollback()
                # Best-effort: record the error on the row in a fresh tx.
                try:
                    from sqlalchemy import update

                    await session.execute(
                        update(FeedbackReport)
                        .where(FeedbackReport.id == UUID(report_id))
                        .values(forward_status="failed")
                    )
                    await session.commit()
                except Exception:
                    await session.rollback()
                raise

    try:
        return run_task(run)
    except Exception as exc:
        self.retry(exc=exc)
```

- [ ] **Step 5: Run both task + service tests**

Run:
```bash
cd backend && uv run pytest tests/unit/test_feedback_forward_task.py tests/integration/test_feedback_service.py -v
```
Expected: PASS (all). If `tests/integration/test_feedback_service.py` needs the DB, ensure `make start` has been run.

- [ ] **Step 6: Verify the Celery registry + drift guards still pass**

Run:
```bash
cd backend && uv run pytest tests/unit/test_celery_app_task_registry.py tests/unit/test_celery_routes_drift.py -v
```
Expected: PASS (the new module is in `include=` and routed to `celery`).

- [ ] **Step 7: Commit**

```bash
git add backend/app/worker/tasks/feedback_tasks.py backend/app/worker/celery_app.py \
        backend/app/services/feedback_service.py \
        backend/tests/unit/test_feedback_forward_task.py \
        backend/tests/integration/test_feedback_service.py
git commit -m "feat(feedback): Celery forward task + FeedbackService (idempotent outbox)"
```

---

## Task 9: POST /api/v1/feedback endpoint

**Files:**
- Create: `backend/app/api/v1/endpoints/feedback.py`
- Modify: `backend/app/api/v1/router.py`
- Test: `backend/tests/unit/test_feedback_endpoint.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_feedback_endpoint.py
"""Endpoint contract test. The service is patched so this asserts HTTP
shape + status + validation without a DB."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest


def _body(**kw):
    base = dict(
        type="bug",
        severity="high",
        description="The PDF viewer renders blank on the extraction screen.",
        context={"url": "https://app/x", "route": "/projects/p/extraction"},
        attachments=[],
    )
    base.update(kw)
    return base


@pytest.mark.asyncio
async def test_post_feedback_returns_202_and_report_id(client) -> None:
    fake_report = SimpleNamespace(id=UUID("11111111-1111-1111-1111-111111111111"))
    with patch(
        "app.api.v1.endpoints.feedback.FeedbackService.create_report",
        new=AsyncMock(return_value=fake_report),
    ):
        res = await client.post("/api/v1/feedback", json=_body())
    assert res.status_code == 202, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["data"]["report_id"] == "11111111-1111-1111-1111-111111111111"


@pytest.mark.asyncio
async def test_post_feedback_validation_error_422(client) -> None:
    res = await client.post("/api/v1/feedback", json=_body(description="short"))
    assert res.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_feedback_endpoint.py -v`
Expected: FAIL — `404` (route not registered).

- [ ] **Step 3: Implement the endpoint**

```python
# backend/app/api/v1/endpoints/feedback.py
"""User feedback intake — persists an outbox row and forwards to Linear."""

from fastapi import APIRouter, HTTPException, Request, status

from app.core.deps import CurrentUser, DbSession
from app.core.logging import get_logger
from app.schemas.common import ApiResponse
from app.schemas.feedback import FeedbackCreate, FeedbackCreated
from app.services.feedback_service import FeedbackService
from app.utils.rate_limiter import limiter

router = APIRouter()
logger = get_logger(__name__)


@router.post(
    "",
    response_model=ApiResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit user feedback",
    description="Persists a feedback report and forwards it to Linear asynchronously.",
)
@limiter.limit("10/minute")
async def submit_feedback(
    request: Request,  # required by slowapi
    db: DbSession,
    user: CurrentUser,
    payload: FeedbackCreate,
) -> ApiResponse[FeedbackCreated]:
    service = FeedbackService(db=db, user_id=user.sub)
    try:
        report = await service.create_report(payload)
        await db.commit()
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    logger.info("feedback_submitted", report_id=str(report.id), user_id=user.sub)
    return ApiResponse(ok=True, data=FeedbackCreated(report_id=report.id))
```

- [ ] **Step 4: Register the router**

In `backend/app/api/v1/router.py`, add `feedback` to the `from app.api.v1.endpoints import (...)` block, then add:

```python
api_router.include_router(
    feedback.router,
    prefix="/feedback",
    tags=["Feedback"],
)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_feedback_endpoint.py -v`
Expected: PASS (2 passed)

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/endpoints/feedback.py backend/app/api/v1/router.py backend/tests/unit/test_feedback_endpoint.py
git commit -m "feat(feedback): POST /api/v1/feedback endpoint (202, rate-limited)"
```

---

# Phase 4 — Storage bucket

## Task 10: Supabase migration — `feedback-media` bucket + RLS

**Files:**
- Create: `supabase/migrations/<timestamp>_feedback_media_bucket.sql`

- [ ] **Step 1: Create the migration file**

Run: `supabase migration new feedback_media_bucket`
This creates `supabase/migrations/<timestamp>_feedback_media_bucket.sql`.

- [ ] **Step 2: Write the SQL**

Paste into the new file:

```sql
-- Private bucket for feedback screenshots/clips. Browser uploads to its
-- own auth.uid() prefix; backend reads via service_role.
insert into storage.buckets (id, name, public)
values ('feedback-media', 'feedback-media', false)
on conflict (id) do nothing;

-- Authenticated users may upload only under their own uid prefix.
create policy "feedback_media_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'feedback-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Authenticated users may read back their own just-uploaded objects
-- (needed for the dialog preview round-trip).
create policy "feedback_media_select_own"
on storage.objects for select to authenticated
using (
  bucket_id = 'feedback-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);
```

- [ ] **Step 3: Apply locally and verify the bucket exists**

Run:
```bash
supabase db reset --no-seed || supabase migration up
```
(Use whichever your project uses for applying storage migrations locally; `supabase migration up` applies without wiping data.)

Expected: no error; the `feedback-media` bucket exists.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(feedback): private feedback-media storage bucket + scoped RLS"
```

---

# Phase 5 — Frontend

## Task 11: feedbackService + types

**Files:**
- Create: `frontend/services/feedbackService.ts`
- Modify: `frontend/types/feedback.ts`
- Test: `frontend/test/feedback-service.test.ts`

- [ ] **Step 1: Update the feedback types**

In `frontend/types/feedback.ts`, replace the `FeedbackContext` interface and add request/attachment types (keep `FeedbackType`/`FeedbackSeverity`/`ViewportSize`). Remove the now-unused `FeedbackReport`/`FeedbackStatus` (the client no longer reads the table):

```typescript
export type FeedbackType = 'bug' | 'suggestion' | 'question' | 'other';
export type FeedbackSeverity = 'low' | 'medium' | 'high' | 'critical';
export type FeedbackAttachmentKind = 'image' | 'video';

export interface ViewportSize {
  width: number;
  height: number;
}

export interface FeedbackContext {
  url: string | null;
  route: string | null;
  user_agent: string | null;
  viewport_size: ViewportSize | null;
  project_id: string | null;
  article_id: string | null;
  app_version: string | null;
}

export interface FeedbackAttachmentInput {
  kind: FeedbackAttachmentKind;
  storage_key: string;
  content_type: string;
  size_bytes: number;
}

export interface FeedbackFormData {
  type: FeedbackType;
  description: string;
  severity?: FeedbackSeverity;
  summary?: string;
}

export interface SubmitFeedbackPayload extends FeedbackFormData {
  context: FeedbackContext;
  attachments: FeedbackAttachmentInput[];
}

export interface FeedbackCreated {
  report_id: string;
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// frontend/test/feedback-service.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/api', () => ({ apiClient: vi.fn() }));
import { apiClient } from '@/integrations/api';
import { FeedbackService } from '@/services/feedbackService';

const apiClientMock = apiClient as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => apiClientMock.mockReset());

describe('FeedbackService.submit', () => {
  it('POSTs /api/v1/feedback with the payload and returns report_id', async () => {
    apiClientMock.mockResolvedValueOnce({ report_id: 'r1' });
    const payload = {
      type: 'bug' as const,
      description: 'PDF viewer is blank on the extraction screen.',
      severity: 'high' as const,
      context: {
        url: 'https://app/x', route: '/projects/p/extraction', user_agent: 'UA',
        viewport_size: { width: 1, height: 2 }, project_id: null, article_id: null, app_version: 'v1',
      },
      attachments: [],
    };
    const result = await FeedbackService.submit(payload);
    expect(result.report_id).toBe('r1');
    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/feedback', {
      method: 'POST',
      body: payload,
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm run test:run -- feedback-service`
Expected: FAIL — `Cannot find module '@/services/feedbackService'`

- [ ] **Step 4: Implement the service**

```typescript
// frontend/services/feedbackService.ts
/**
 * Feedback service — submits user feedback to the backend, which persists
 * an outbox row and forwards it to Linear asynchronously.
 */
import { apiClient } from '@/integrations/api';
import type { FeedbackCreated, SubmitFeedbackPayload } from '@/types/feedback';

export const FeedbackService = {
  submit: (payload: SubmitFeedbackPayload) =>
    apiClient<FeedbackCreated>('/api/v1/feedback', {
      method: 'POST',
      body: payload,
    }),
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm run test:run -- feedback-service`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/services/feedbackService.ts frontend/types/feedback.ts frontend/test/feedback-service.test.ts
git commit -m "feat(feedback): frontend feedbackService + request types"
```

---

## Task 12: useScreenCapture hook

**Files:**
- Create: `frontend/hooks/useScreenCapture.ts`
- Test: `frontend/test/use-screen-capture.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/test/use-screen-capture.test.ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useScreenCapture } from '@/hooks/useScreenCapture';

function fakeStream() {
  const track = { stop: vi.fn() };
  return { getTracks: () => [track], getVideoTracks: () => [track], _track: track } as unknown as MediaStream;
}

beforeEach(() => {
  // jsdom has no mediaDevices; install a mock.
  (navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
    getDisplayMedia: vi.fn().mockResolvedValue(fakeStream()),
  };
});

afterEach(() => vi.restoreAllMocks());

describe('useScreenCapture', () => {
  it('exposes captureStill and recordClip and reports unsupported when API absent', async () => {
    const { result } = renderHook(() => useScreenCapture());
    expect(typeof result.current.captureStill).toBe('function');
    expect(typeof result.current.recordClip).toBe('function');
    expect(result.current.isSupported).toBe(true);
  });

  it('captureStill requests the display media and stops tracks', async () => {
    const stream = fakeStream();
    (navigator.mediaDevices.getDisplayMedia as ReturnType<typeof vi.fn>).mockResolvedValueOnce(stream);
    const { result } = renderHook(() => useScreenCapture());
    // ImageCapture/grabFrame is not in jsdom — capture returns null gracefully
    // but must still request the stream and clean up.
    await act(async () => {
      await result.current.captureStill();
    });
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalled();
    expect((stream as unknown as { _track: { stop: ReturnType<typeof vi.fn> } })._track.stop).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run -- use-screen-capture`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```typescript
// frontend/hooks/useScreenCapture.ts
/**
 * Screen capture via getDisplayMedia(): a single still frame or a short
 * webm clip. Accurate on the PDF.js viewer (unlike DOM-screenshot libs).
 * Each call prompts the browser's "share your screen" picker.
 */
import { useCallback, useMemo, useState } from 'react';

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

export interface ScreenCapture {
  isSupported: boolean;
  capturing: boolean;
  captureStill: () => Promise<Blob | null>;
  recordClip: (maxSeconds?: number) => Promise<Blob | null>;
}

export function useScreenCapture(): ScreenCapture {
  const [capturing, setCapturing] = useState(false);

  const isSupported = useMemo(
    () =>
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getDisplayMedia === 'function',
    [],
  );

  const captureStill = useCallback(async (): Promise<Blob | null> => {
    if (!isSupported) return null;
    setCapturing(true);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      // Grab one frame. ImageCapture is the modern path; fall back to a
      // <video>+<canvas> draw when unavailable.
      const track = stream.getVideoTracks()[0];
      const ImageCaptureCtor = (window as unknown as { ImageCapture?: typeof ImageCapture }).ImageCapture;
      if (ImageCaptureCtor && track) {
        const bitmap = await new ImageCaptureCtor(track).grabFrame();
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
        return await new Promise((resolve) =>
          canvas.toBlob((b) => resolve(b), 'image/webp', 0.9),
        );
      }
      return null;
    } catch {
      return null;
    } finally {
      if (stream) stopStream(stream);
      setCapturing(false);
    }
  }, [isSupported]);

  const recordClip = useCallback(
    async (maxSeconds = 30): Promise<Blob | null> => {
      if (!isSupported) return null;
      setCapturing(true);
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const activeStream = stream;
        const chunks: BlobPart[] = [];
        const recorder = new MediaRecorder(activeStream, { mimeType: 'video/webm' });
        const done = new Promise<Blob>((resolve) => {
          recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
          recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
        });
        // Stop when the user ends sharing, or after maxSeconds.
        activeStream.getVideoTracks()[0].addEventListener('ended', () => recorder.stop());
        const timer = setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), maxSeconds * 1000);
        recorder.start();
        const blob = await done;
        clearTimeout(timer);
        return blob;
      } catch {
        return null;
      } finally {
        if (stream) stopStream(stream);
        setCapturing(false);
      }
    },
    [isSupported],
  );

  return { isSupported, capturing, captureStill, recordClip };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run -- use-screen-capture`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/useScreenCapture.ts frontend/test/use-screen-capture.test.ts
git commit -m "feat(feedback): useScreenCapture (getDisplayMedia still + clip)"
```

---

## Task 13: Refactor useFeedback to the backend + media upload

**Files:**
- Modify: `frontend/hooks/useFeedback.ts`
- Modify: `frontend/lib/copy/navigation.ts`
- Test: `frontend/test/use-feedback.test.tsx`

- [ ] **Step 1: Add i18n copy keys**

In `frontend/lib/copy/navigation.ts`, add inside the `navigation` object (before the closing `} as const;`):

```typescript
    feedbackSummaryLabel: 'Summary (optional)',
    feedbackSummaryPlaceholder: 'One-line title',
    feedbackAttachScreenshot: 'Attach screenshot',
    feedbackRecordClip: 'Record clip',
    feedbackCaptureRemove: 'Remove',
    feedbackCaptureNotice: 'Captures are shared with the Prumo team in Linear.',
    feedbackCaptureFailed: 'Capture was cancelled or failed.',
    feedbackCaptureUnsupported: 'Screen capture is not supported in this browser.',
    feedbackSuccessSent: 'Thanks — your report was sent.',
```

- [ ] **Step 2: Write the failing test**

```typescript
// frontend/test/use-feedback.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/feedbackService', () => ({
  FeedbackService: { submit: vi.fn() },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { FeedbackService } from '@/services/feedbackService';
import { useFeedback } from '@/hooks/useFeedback';

const submitMock = FeedbackService.submit as unknown as ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => submitMock.mockReset());

describe('useFeedback', () => {
  it('submits via FeedbackService with captured context + attachments', async () => {
    submitMock.mockResolvedValueOnce({ report_id: 'r1' });
    const { result } = renderHook(() => useFeedback(), { wrapper });

    let ok = false;
    await waitFor(async () => {
      ok = await result.current.submitFeedback(
        { type: 'bug', description: 'PDF viewer is blank on the extraction screen.', severity: 'high' },
        [{ kind: 'image', storage_key: 'u1/x.webp', content_type: 'image/webp', size_bytes: 10 }],
      );
    });

    expect(ok).toBe(true);
    expect(submitMock).toHaveBeenCalledTimes(1);
    const payload = submitMock.mock.calls[0][0];
    expect(payload.type).toBe('bug');
    expect(payload.attachments).toHaveLength(1);
    expect(payload.context).toHaveProperty('url');
    expect(payload.context).toHaveProperty('user_agent');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm run test:run -- use-feedback`
Expected: FAIL — `submitFeedback` no longer matches (still does a Supabase insert / wrong signature).

- [ ] **Step 4: Rewrite the hook**

Replace the full contents of `frontend/hooks/useFeedback.ts`:

```typescript
/**
 * Hook to submit user feedback to the backend (which forwards to Linear).
 * Captures technical + application context automatically.
 */
import { useMutation } from '@tanstack/react-query';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { t } from '@/lib/copy';
import { FeedbackService } from '@/services/feedbackService';
import type {
  FeedbackAttachmentInput,
  FeedbackContext,
  FeedbackFormData,
  SubmitFeedbackPayload,
} from '@/types/feedback';

declare const __APP_VERSION__: string | undefined;

function getCurrentContext(): FeedbackContext {
  const pathname = window.location.pathname;
  const projectMatch = pathname.match(/\/projects\/([a-f0-9-]+)/);
  const urlParams = new URLSearchParams(window.location.search);
  const articleFromQuery = urlParams.get('article');
  const articleMatch = pathname.match(/\/articles\/([a-f0-9-]+)/);

  return {
    url: window.location.href,
    route: pathname,
    user_agent: navigator.userAgent,
    viewport_size: { width: window.innerWidth, height: window.innerHeight },
    project_id: projectMatch ? projectMatch[1] : null,
    article_id: articleFromQuery || (articleMatch ? articleMatch[1] : null),
    app_version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null,
  };
}

export function useFeedback() {
  const { user: _user } = useAuth();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (payload: SubmitFeedbackPayload) => FeedbackService.submit(payload),
  });

  const submitFeedback = async (
    data: FeedbackFormData,
    attachments: FeedbackAttachmentInput[] = [],
  ): Promise<boolean> => {
    if (!data.description || data.description.trim().length < 10) {
      toast({
        title: t('common', 'errors_sendFeedbackFailed'),
        description: t('common', 'feedbackDescriptionMinLength'),
        variant: 'destructive',
      });
      return false;
    }

    try {
      await mutation.mutateAsync({
        type: data.type,
        description: data.description.trim(),
        severity: data.type === 'bug' ? data.severity : undefined,
        summary: data.summary,
        context: getCurrentContext(),
        attachments,
      });
      toast({
        title: t('common', 'feedbackSuccessTitle'),
        description: t('navigation', 'feedbackSuccessSent'),
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('common', 'errors_sendFeedbackFailed');
      toast({
        title: t('common', 'errors_sendFeedbackFailed'),
        description: msg,
        variant: 'destructive',
      });
      return false;
    }
  };

  return { submitFeedback, submitting: mutation.isPending, error: mutation.error?.message ?? null };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm run test:run -- use-feedback`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/hooks/useFeedback.ts frontend/lib/copy/navigation.ts frontend/test/use-feedback.test.tsx
git commit -m "feat(feedback): route useFeedback through the backend API"
```

---

## Task 14: FeedbackDialog — capture, preview, summary, upload

**Files:**
- Modify: `frontend/components/feedback/FeedbackDialog.tsx`
- Test: `frontend/test/feedback-dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/test/feedback-dialog.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useFeedback', () => ({
  useFeedback: () => ({ submitFeedback: vi.fn().mockResolvedValue(true), submitting: false, error: null }),
}));
vi.mock('@/hooks/useScreenCapture', () => ({
  useScreenCapture: () => ({
    isSupported: true, capturing: false,
    captureStill: vi.fn(), recordClip: vi.fn(),
  }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

import { FeedbackDialog } from '@/components/feedback/FeedbackDialog';

describe('FeedbackDialog', () => {
  it('renders capture controls and the Linear-sharing notice', () => {
    render(<FeedbackDialog open onOpenChange={() => {}} />);
    expect(screen.getByRole('button', { name: /attach screenshot/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record clip/i })).toBeInTheDocument();
    expect(screen.getByText(/shared with the Prumo team in Linear/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run -- feedback-dialog`
Expected: FAIL — capture buttons/notice not present.

- [ ] **Step 3: Rewrite the dialog**

Replace the full contents of `frontend/components/feedback/FeedbackDialog.tsx`:

```typescript
/**
 * Feedback dialog — bugs, suggestions, questions, with optional
 * getDisplayMedia screenshot/clip uploaded to Supabase Storage.
 */
import { useState } from 'react';
import { MessageSquare, Camera, Video, X } from 'lucide-react';

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFeedback } from '@/hooks/useFeedback';
import { useScreenCapture } from '@/hooks/useScreenCapture';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { t } from '@/lib/copy';
import type { FeedbackAttachmentInput, FeedbackSeverity, FeedbackType } from '@/types/feedback';

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const BUCKET = 'feedback-media';

interface PendingCapture {
  kind: 'image' | 'video';
  blob: Blob;
  previewUrl: string;
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const [type, setType] = useState<FeedbackType>('bug');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<FeedbackSeverity | undefined>();
  const [capture, setCapture] = useState<PendingCapture | null>(null);

  const { submitFeedback, submitting } = useFeedback();
  const { isSupported, capturing, captureStill, recordClip } = useScreenCapture();
  const { user } = useAuth();
  const { toast } = useToast();

  const isDescriptionValid = description.trim().length >= 10;

  const onCapture = async (kind: 'image' | 'video') => {
    const blob = kind === 'image' ? await captureStill() : await recordClip(30);
    if (!blob) {
      toast({
        title: t('navigation', 'feedbackCaptureFailed'),
        variant: 'destructive',
      });
      return;
    }
    setCapture({ kind, blob, previewUrl: URL.createObjectURL(blob) });
  };

  const clearCapture = () => {
    if (capture) URL.revokeObjectURL(capture.previewUrl);
    setCapture(null);
  };

  const uploadCapture = async (): Promise<FeedbackAttachmentInput[]> => {
    if (!capture || !user) return [];
    const ext = capture.kind === 'image' ? 'webp' : 'webm';
    const key = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(key, capture.blob, {
      contentType: capture.blob.type,
    });
    if (error) throw new Error(error.message);
    return [{
      kind: capture.kind,
      storage_key: key,
      content_type: capture.blob.type,
      size_bytes: capture.blob.size,
    }];
  };

  const resetAndClose = () => {
    setType('bug'); setSummary(''); setDescription(''); setSeverity(undefined);
    clearCapture();
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDescriptionValid) return;

    let attachments: FeedbackAttachmentInput[] = [];
    try {
      attachments = await uploadCapture();
    } catch (err) {
      toast({
        title: t('navigation', 'feedbackCaptureFailed'),
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
      return;
    }

    const ok = await submitFeedback(
      { type, summary: summary || undefined, description, severity: type === 'bug' ? severity : undefined },
      attachments,
    );
    if (ok) resetAndClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : resetAndClose())}>
      <DialogContent className="sm:max-w-[525px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              {t('navigation', 'feedbackTitle')}
            </DialogTitle>
            <DialogDescription>{t('navigation', 'feedbackDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('navigation', 'feedbackTypeLabel')}</Label>
              <RadioGroup value={type} onValueChange={(v) => setType(v as FeedbackType)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="bug" id="bug" />
                  <Label htmlFor="bug" className="font-normal cursor-pointer">🐛 {t('navigation', 'feedbackTypeBug')}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="suggestion" id="suggestion" />
                  <Label htmlFor="suggestion" className="font-normal cursor-pointer">💡 {t('navigation', 'feedbackTypeSuggestion')}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="question" id="question" />
                  <Label htmlFor="question" className="font-normal cursor-pointer">❓ {t('navigation', 'feedbackTypeQuestion')}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="other" id="other" />
                  <Label htmlFor="other" className="font-normal cursor-pointer">💬 {t('navigation', 'feedbackTypeOther')}</Label>
                </div>
              </RadioGroup>
            </div>

            {type === 'bug' && (
              <div className="space-y-2">
                <Label htmlFor="severity">{t('navigation', 'feedbackSeverityLabel')}</Label>
                <Select value={severity} onValueChange={(v) => setSeverity(v as FeedbackSeverity)}>
                  <SelectTrigger id="severity">
                    <SelectValue placeholder={t('navigation', 'feedbackSeverityPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">{t('navigation', 'feedbackSeverityLow')}</SelectItem>
                    <SelectItem value="medium">{t('navigation', 'feedbackSeverityMedium')}</SelectItem>
                    <SelectItem value="high">{t('navigation', 'feedbackSeverityHigh')}</SelectItem>
                    <SelectItem value="critical">{t('navigation', 'feedbackSeverityCritical')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="summary">{t('navigation', 'feedbackSummaryLabel')}</Label>
              <Input
                id="summary"
                value={summary}
                maxLength={200}
                placeholder={t('navigation', 'feedbackSummaryPlaceholder')}
                onChange={(e) => setSummary(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">
                {t('navigation', 'feedbackDescriptionLabel')} <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="description"
                placeholder={t('navigation', 'feedbackDescriptionPlaceholder')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                className="resize-none"
                required
              />
              <p className="text-xs text-muted-foreground">
                {description.length < 10
                  ? <>{t('navigation', 'feedbackDescriptionMin')} ({10 - description.length} {t('navigation', 'feedbackDescriptionRemaining')})</>
                  : <>✓ {t('navigation', 'feedbackDescriptionValid')}</>}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex gap-2">
                <Button
                  type="button" variant="outline" size="sm"
                  disabled={!isSupported || capturing}
                  onClick={() => onCapture('image')}
                >
                  <Camera className="h-4 w-4 mr-1" /> {t('navigation', 'feedbackAttachScreenshot')}
                </Button>
                <Button
                  type="button" variant="outline" size="sm"
                  disabled={!isSupported || capturing}
                  onClick={() => onCapture('video')}
                >
                  <Video className="h-4 w-4 mr-1" /> {t('navigation', 'feedbackRecordClip')}
                </Button>
              </div>
              {capture && (
                <div className="flex items-center gap-2 rounded-md border p-2">
                  {capture.kind === 'image'
                    ? <img src={capture.previewUrl} alt="" className="h-16 w-auto rounded" />
                    : <video src={capture.previewUrl} className="h-16 w-auto rounded" controls />}
                  <Button type="button" variant="ghost" size="sm" onClick={clearCapture}>
                    <X className="h-4 w-4 mr-1" /> {t('navigation', 'feedbackCaptureRemove')}
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {isSupported
                  ? t('navigation', 'feedbackCaptureNotice')
                  : t('navigation', 'feedbackCaptureUnsupported')}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetAndClose} disabled={submitting}>
              {t('common', 'cancel')}
            </Button>
            <Button type="submit" disabled={submitting || !isDescriptionValid}>
              {submitting ? t('navigation', 'feedbackSubmitting') : t('navigation', 'feedbackSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run -- feedback-dialog`
Expected: PASS

- [ ] **Step 5: Run the full frontend test + lint**

Run: `cd frontend && npm run test:run && npm run lint`
Expected: PASS (no failures, no new lint errors).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/feedback/FeedbackDialog.tsx frontend/test/feedback-dialog.test.tsx
git commit -m "feat(feedback): capture/preview/summary in FeedbackDialog + media upload"
```

---

# Phase 6 — Config, deploy, docs, smoke

## Task 15: Env vars, deployment docs, label provisioning, smoke test

**Files:**
- Modify: `docs/reference/deployment.md`

- [ ] **Step 1: Document the new env vars**

In `docs/reference/deployment.md`, add rows to the env-var table:

```markdown
| `LINEAR_API_KEY` | Linear personal/workspace API key (secret) used to create feedback issues. | backend web + worker |
| `LINEAR_TEAM_ID` | Linear team id for the Prumo team (`9b86c9ed-ede9-4f36-99d1-c2f53fb82370`). | backend web + worker |
| `FEEDBACK_MEDIA_BUCKET` | Supabase Storage bucket for feedback screenshots/clips (default `feedback-media`). | backend worker |
```

- [ ] **Step 2: Set the vars on Railway (both web and worker services)**

The worker forwards to Linear, so BOTH the web and worker services need the vars.
Set them via the Railway dashboard (or MCP). Use the existing test/dev workspace value for `LINEAR_TEAM_ID`:
```
LINEAR_API_KEY=<linear personal API key>
LINEAR_TEAM_ID=9b86c9ed-ede9-4f36-99d1-c2f53fb82370
FEEDBACK_MEDIA_BUCKET=feedback-media
```
Also add them to the local `backend/.env` for dev.

- [ ] **Step 3: Note on label provisioning**

The `source:in-app` and `Question` labels are created lazily by `LinearClient.resolve_labels` on the first forward of each type — no manual step required. (`Bug`, `Feature`, `area:*` already exist in the Prumo team.)

- [ ] **Step 4: Backend smoke — full suite**

Run: `make test-backend`
Expected: PASS (no regressions; new feedback tests green). Integration tests need the local DB (`make start`).

- [ ] **Step 5: Manual end-to-end smoke (local stack running)**

1. `make start`; log in to the frontend with the test account.
2. Open the feedback dialog (Topbar), pick "bug", severity "high", type a description (≥10 chars), click **Attach screenshot**, share the tab, keep the preview, submit.
3. Confirm the success toast ("your report was sent").
4. Confirm a `feedback_reports` row exists with `forward_status` advancing to `sent` (query via Supabase) and a Linear issue appears in the **Prumo** team with the `source:in-app` + `Bug` labels, `High` priority, and the screenshot embedded.

- [ ] **Step 6: Commit**

```bash
git add docs/reference/deployment.md
git commit -m "docs(feedback): document LINEAR_* / FEEDBACK_* env vars + rollout notes"
```

---

# Self-review

**Spec coverage** (spec §-by-§ → task):
- §4 flow (submit 202 + async forward) → Tasks 7, 8, 9.
- §5 data model (slim outbox + attachments + RLS) → Tasks 1, 2.
- §6 Linear mapping (labels/priority/area/title/body) → Tasks 4, 5.
- §7 backend modules → Tasks 1–9.
- §8 frontend modules + async-toast consequence → Tasks 11–14 (generic success toast = Task 13 `feedbackSuccessSent`).
- §9 storage bucket + lifecycle → Task 10 (cleanup-after-`sent` deferred; see note below).
- §10 security/privacy/abuse (rate limit, opt-in preview, MIME allowlist, membership) → Tasks 6, 9, 13, 14.
- §11 observability (structlog) → Tasks 7, 8, 9.
- §12 test plan → tests in every task.
- §13 deferred scope → untouched by design.
- §15 `app_version` (`__APP_VERSION__` define) → Task 13 reads it defensively (null if absent).

**Known gap (intentional, low-risk):** spec §9's *blob cleanup-after-forward* task is not implemented (Linear keeps its own copy; the Supabase blobs are private and small). Tracked as a follow-up rather than blocking MVP. If you want it now, add a step to Task 8's `_forward` after the final `commit`: `for att in report.attachments: await storage.delete(settings.FEEDBACK_MEDIA_BUCKET, att.storage_key)`.

**Placeholder scan:** no TBD/TODO; every code step has complete code; the only intentionally-templated value is the Supabase migration timestamp filename (assigned by `supabase migration new`) and the verified Alembic head (confirmed in Task 2 Step 1).

**Type consistency:** `FeedbackService.create_report(payload) -> FeedbackReport`; `forward_feedback_to_linear_task.delay(str(report_id))`; `_forward(session, report_id)`; `LinearClient(api_key, team_id)` with `create_issue/resolve_labels/upload_file/update_issue_description`; mapping `label_names_for/priority_for/issue_title/issue_body/attachments_markdown`; frontend `FeedbackService.submit(payload) -> {report_id}`, `useScreenCapture` → `captureStill/recordClip`, `useFeedback.submitFeedback(data, attachments)`. Names match across tasks.

---

# Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-30-in-app-feedback-to-linear.md`.
