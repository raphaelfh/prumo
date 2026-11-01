"""Screening integration builders: members, articles, assignments, decisions.

Later screening suites extend this file. ``make_project`` lives in
``shared_fixtures.py``. Timestamp trap: ``db_session`` is one outer
transaction, so a default ``enrolled_at`` (``now()``) ties; ``created_at`` is
``clock_timestamp()`` and does not. A test that needs an order still seeds the
earlier row with an explicit past ``enrolled_at`` / ``created_at``.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article
from app.models.screening import (
    TITLE_ABSTRACT,
    ScreeningArbitration,
    ScreeningAssignment,
    ScreeningDecision,
)
from app.repositories.project_repository import ProjectRepository


async def add_member(db: AsyncSession, project_id: UUID, role: str) -> UUID:
    """A brand-new user (auth.users + profile) joined to ``project_id`` as ``role``."""
    user_id = uuid4()
    email = f"{user_id}@integration-test.prumo.local"
    await db.execute(
        text(
            "INSERT INTO auth.users (id, email, instance_id, aud, role) "
            "VALUES (:id, :email, '00000000-0000-0000-0000-000000000000', "
            "'authenticated', 'authenticated')"
        ),
        {"id": str(user_id), "email": email},
    )
    await db.execute(
        text(
            "INSERT INTO public.profiles (id, email, full_name) "
            "VALUES (:id, :email, 'Screening Test User') "
            "ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email"
        ),
        {"id": str(user_id), "email": email},
    )
    await db.execute(
        text(
            "INSERT INTO public.project_members (id, project_id, user_id, role) "
            "VALUES (gen_random_uuid(), :pid, :uid, :role)"
        ),
        {"pid": str(project_id), "uid": str(user_id), "role": role},
    )
    await db.flush()
    return user_id


async def make_screening_article(db: AsyncSession, project_id: UUID, **fields: Any) -> UUID:
    """An ORM ``Article`` in ``project_id``; flush only."""
    fields.setdefault("title", "Screening article")
    article = Article(project_id=project_id, **fields)
    db.add(article)
    await db.flush()
    return article.id


async def enroll_articles(
    db: AsyncSession,
    project_id: UUID,
    article_ids: Sequence[UUID],
    *,
    by: UUID,
    enrolled_at: datetime | None = None,
    phase: str = TITLE_ABSTRACT,
) -> list[UUID]:
    """ORM assignments in input order; ``None`` keeps the SQL default ``now()``."""
    assignments = [
        ScreeningAssignment(
            project_id=project_id,
            article_id=article_id,
            phase=phase,
            enrolled_by=by,
            **({} if enrolled_at is None else {"enrolled_at": enrolled_at}),
        )
        for article_id in article_ids
    ]
    db.add_all(assignments)
    await db.flush()
    return [assignment.id for assignment in assignments]


async def add_decision(
    db: AsyncSession,
    assignment_id: UUID,
    reviewer_id: UUID,
    decision: str,
    *,
    reason: str | None = None,
    created_at: datetime | None = None,
) -> UUID:
    """One decision row; ``None`` keeps the SQL default ``clock_timestamp()``."""
    row = ScreeningDecision(
        assignment_id=assignment_id,
        reviewer_id=reviewer_id,
        decision=decision,
        exclusion_reason=reason,
        **({} if created_at is None else {"created_at": created_at}),
    )
    db.add(row)
    await db.flush()
    return row.id


async def add_ruling(
    db: AsyncSession,
    assignment_id: UUID,
    decided_by: UUID,
    decision: str,
    *,
    reason: str | None = None,
    selected: UUID | None = None,
    created_at: datetime | None = None,
) -> UUID:
    """One arbitration row, for setup; ``None`` keeps the SQL default ``clock_timestamp()``."""
    row = ScreeningArbitration(
        assignment_id=assignment_id,
        decided_by=decided_by,
        decision=decision,
        exclusion_reason=reason,
        selected_decision_id=selected,
        **({} if created_at is None else {"created_at": created_at}),
    )
    db.add(row)
    await db.flush()
    return row.id


async def move_article(db: AsyncSession, article_id: UUID, to_project: UUID) -> None:
    """What a member's PostgREST update does: the article changes project, its assignment stays."""
    await db.execute(
        text("UPDATE public.articles SET project_id = :to WHERE id = :aid"),
        {"to": str(to_project), "aid": str(article_id)},
    )


async def set_reviewer_count(db: AsyncSession, project_id: UUID, n: int) -> None:
    """Write ``settings["screening"]`` through the one settings writer."""
    await ProjectRepository(db).update_settings_key(
        project_id, "screening", lambda old: {**(old or {}), "reviewer_count": n}
    )
