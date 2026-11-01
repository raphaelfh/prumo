"""A local screening project to triage by hand: ``python -m app.seed_screening``.

Local only: it refuses any database that is not on this machine, and it is
never called from ``app.seed``, which runs on every production boot
(``backend/Dockerfile``, ``railway.toml``). It creates no auth users: it seats
existing local profiles. It grows per slice (S2 a duplicate pair; S3 full-text
records, one with a PDF uploaded to the local ``articles`` bucket).

The project is rebuilt, not duplicated: a second run deletes the first.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
from collections.abc import Sequence
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import AsyncSessionLocal, get_supabase_client
from app.core.error_handler import NotFoundError
from app.core.factories import create_storage_adapter
from app.models.article import Article, ArticleFile
from app.models.project import Project, ProjectMember
from app.models.screening import FULL_TEXT, TITLE_ABSTRACT
from app.models.user import Profile
from app.repositories.project_repository import ProjectRepository
from app.repositories.screening_repository import ScreeningRepository
from app.services.project_delete_service import delete_project_row
from app.services.screening_config_service import ScreeningConfigService

PROJECT_ID = uuid5(NAMESPACE_URL, "prumo:seed-screening")
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1"})

# The one full-text record with a PDF: a fixed article id makes the storage key known to ``_run``.
_PDF_ARTICLE_ID = uuid5(NAMESPACE_URL, "prumo:seed-screening:pdf-article")
SEED_PDF_KEY = f"{PROJECT_ID}/{_PDF_ARTICLE_ID}/seed-screening.pdf"
SEED_PDF_BYTES = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
    b"trailer<</Root 1 0 R>>\n"
    b"%%EOF\n"
)
_ARTICLES_BUCKET = "articles"

# (title, authors, journal, year); the first twelve are enrolled, the last two are not.
_ARTICLES = (
    ("Early antibiotics in adult sepsis", ["Silva A", "Costa B"], "Critical Care", 2019),
    ("Fluid resuscitation volumes in septic shock", ["Moreau C"], "Intensive Care Med", 2020),
    ("Lactate clearance as a sepsis endpoint", ["Tanaka D", "Ito E"], "Chest", 2018),
    ("Vasopressor timing in adults with sepsis", ["Okafor F"], "JAMA", 2021),
    ("Corticosteroids for septic shock: a trial", ["Novak G", "Horvat H"], "NEJM", 2017),
    ("Procalcitonin-guided therapy in the ICU", ["Lindqvist I"], "Lancet Resp Med", 2022),
    ("Sepsis bundles in emergency departments", ["Ramos J", "Vega K"], "Ann Emerg Med", 2016),
    ("Paediatric sepsis screening tools", ["Murphy L"], "Pediatrics", 2020),
    ("A narrative review of sepsis biomarkers", ["Schmidt M"], "Clin Chem", 2015),
    ("Machine learning for sepsis onset", ["Chen N", "Wang O"], "Nature Medicine", 2023),
    ("Early mobilisation in septic adults", ["Hart S", "Lund T"], "Crit Care Med", 2022),
    ("Balanced crystalloids in adult sepsis", ["Weber U"], "Intensive Care Med", 2021),
    ("Long-term outcomes after sepsis", ["Dubois P"], "BMJ", 2019),
    ("Cost of sepsis care in adults", ["Rossi Q", "Bianchi R"], "Health Econ", 2021),
)
_ENROLLED = 12
_PDF_ARTICLE_INDEX = 11  # a full-text record


def assert_local_database(url: str) -> None:
    """Exit unless ``url`` points at ``localhost`` or ``127.0.0.1``."""
    try:
        host = make_url(url).host
    except ArgumentError:
        host = None
    if host not in _LOCAL_HOSTS:
        raise SystemExit(f"seed_screening is local only; refusing database host {host!r}")


async def build(db: AsyncSession, *, manager_id: UUID, reviewer_ids: tuple[UUID, UUID]) -> UUID:
    """(Re)build the seed project; flush only. Returns its id."""
    bind = db.get_bind()
    engine: Any = getattr(bind, "engine", bind)  # a Connection's engine, else the Engine
    assert_local_database(str(engine.url))
    r1, r2 = reviewer_ids
    with contextlib.suppress(NotFoundError):
        await delete_project_row(db, PROJECT_ID)
    db.add(
        Project(
            id=PROJECT_ID,
            name="Screening workspace (local seed)",
            created_by_id=manager_id,
            eligibility_criteria={
                "inclusion": ["Adults with sepsis"],
                "exclusion": ["Wrong population", "Not a primary study", "Wrong outcome"],
            },
        )
    )
    await db.flush()
    db.add_all(
        [
            ProjectMember(project_id=PROJECT_ID, user_id=manager_id, role="manager"),
            ProjectMember(project_id=PROJECT_ID, user_id=r1, role="reviewer"),
            ProjectMember(project_id=PROJECT_ID, user_id=r2, role="reviewer"),
        ]
    )
    articles = [
        Article(
            **({"id": _PDF_ARTICLE_ID} if index == _PDF_ARTICLE_INDEX else {}),
            project_id=PROJECT_ID,
            title=title,
            authors=authors,
            journal_title=journal,
            publication_year=year,
        )
        for index, (title, authors, journal, year) in enumerate(_ARTICLES)
    ]
    db.add_all(articles)
    await db.flush()
    screening = ScreeningRepository(db)
    await screening.enroll(
        project_id=PROJECT_ID,
        enrolled_by=manager_id,
        article_ids=[a.id for a in articles[:_ENROLLED]],
        phase=TITLE_ABSTRACT,
    )
    await ProjectRepository(db).update_settings_key(
        PROJECT_ID,
        "screening",
        lambda old: {**(old or {}), "reviewer_count": 2, "full_text_reviewer_count": 2},
    )
    assignment_of = await screening.live_assignment_ids_by_article(
        project_id=PROJECT_ID, phase=TITLE_ABSTRACT
    )
    decisions = (
        (0, r1, "include", None),  # conflict
        (0, r2, "exclude", "Wrong population"),
        (1, r1, "include", None),  # consensus include
        (1, r2, "include", None),
        (2, r1, "exclude", "Not a primary study"),  # consensus exclude
        (2, r2, "exclude", "Not a primary study"),
        (3, r1, "include", None),  # one of two reviewers
        (10, r1, "include", None),  # two more consensus includes, sent to full text below
        (10, r2, "include", None),
        (11, r1, "include", None),
        (11, r2, "include", None),
    )
    for index, reviewer, decision, reason in decisions:
        await screening.add_decision(
            assignment_of[articles[index].id], reviewer, decision, reason, None
        )
    await ScreeningConfigService(db).enroll(PROJECT_ID, manager_id, None, FULL_TEXT)
    full_text_of = await screening.live_assignment_ids_by_article(
        project_id=PROJECT_ID, phase=FULL_TEXT
    )
    await screening.add_decision(
        full_text_of[articles[10].id], r1, "exclude", "Wrong outcome", None
    )
    db.add(
        ArticleFile(
            project_id=PROJECT_ID,
            article_id=_PDF_ARTICLE_ID,
            file_type="pdf",
            storage_key=SEED_PDF_KEY,
            file_role="MAIN",
        )
    )
    await db.flush()
    return PROJECT_ID


async def resolve_profiles(
    db: AsyncSession, manager_email: str | None
) -> tuple[UUID, tuple[UUID, UUID]]:
    """The manager (by email, else the oldest profile) and the two oldest other profiles."""
    by_age = select(Profile.id).order_by(Profile.created_at, Profile.id)
    if manager_email is not None:
        manager = (
            await db.execute(select(Profile.id).where(Profile.email == manager_email))
        ).scalar_one_or_none()
        if manager is None:
            raise SystemExit(f"seed_screening: no local profile has the email {manager_email!r}")
    else:
        manager = (await db.execute(by_age.limit(1))).scalar_one_or_none()
    others = (
        (await db.execute(by_age.where(Profile.id != manager).limit(2))).scalars().all()
        if manager is not None
        else []
    )
    if manager is None or len(others) < 2:
        raise SystemExit("seed_screening needs three local profiles; sign up two more users first")
    return manager, (others[0], others[1])


async def _run(manager_email: str | None) -> UUID:
    async with AsyncSessionLocal() as session:
        manager, reviewers = await resolve_profiles(session, manager_email)
        project_id = await build(session, manager_id=manager, reviewer_ids=reviewers)
        await session.commit()
    storage = create_storage_adapter(get_supabase_client())
    await storage.delete(_ARTICLES_BUCKET, SEED_PDF_KEY)  # a rerun rebuilds the project
    await storage.upload(_ARTICLES_BUCKET, SEED_PDF_KEY, SEED_PDF_BYTES, "application/pdf")
    return project_id


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.seed_screening")
    parser.add_argument("--manager-email", default=None)
    args = parser.parse_args(argv)
    assert_local_database(str(settings.DATABASE_URL))
    project_id = asyncio.run(_run(args.manager_email))
    print(f"/projects/{project_id}?tab=screening")


if __name__ == "__main__":
    main()
