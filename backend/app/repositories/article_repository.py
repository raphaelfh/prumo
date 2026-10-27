"""
Article Repository.

Article and file persistence layer.
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import ColumnElement, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute, selectinload

from app.models.article import Article, ArticleFile
from app.models.article_author import ArticleSyncEvent, ArticleSyncRun
from app.repositories.base import BaseRepository


def doi_match_key(
    column: ColumnElement[str | None] | InstrumentedAttribute[str | None],
) -> ColumnElement[str]:
    """Lower-cased, trimmed DOI with any ``doi.org`` URL or ``doi:`` prefix removed.

    The right-hand side of the comparison is ``normalize_doi`` output; stored values
    from other sources may still carry a prefix or stray case/whitespace.
    """
    return func.regexp_replace(
        func.lower(func.btrim(column)), r"^(https?://(dx\.)?doi\.org/|doi:\s*)", ""
    )


FillOutcome = Literal["inserted", "updated", "unchanged"]


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, list):
        return not value
    return False


class ArticleRepository(BaseRepository[Article]):
    """
    Repository for article operations.

    Encapsulates article and related-file queries.
    """

    def __init__(self, db: AsyncSession):
        super().__init__(db, Article)

    async def get_by_ids(
        self,
        article_ids: list[UUID] | list[str],
        project_id: UUID | str,
        *,
        include_files: bool = False,
    ) -> list[Article]:
        """
        Fetch articles by ID list scoped to a project.

        Args:
            article_ids: Article IDs.
            project_id: Project ID (articles must belong to it).
            include_files: Whether to eager-load related files.

        Returns:
            Matching articles in the same order as requested IDs.
        """
        if not article_ids:
            return []
        ids = [UUID(aid) if isinstance(aid, str) else aid for aid in article_ids]
        if isinstance(project_id, str):
            project_id = UUID(project_id)
        query = select(Article).where(
            Article.id.in_(ids),
            Article.project_id == project_id,
        )
        if include_files:
            query = query.options(selectinload(Article.files))
        result = await self.db.execute(query)
        rows = list(result.scalars().all())
        # Preserve requested ID order.
        by_id = {a.id: a for a in rows}
        return [by_id[i] for i in ids if i in by_id]

    async def get_by_zotero_item_key(
        self,
        project_id: UUID | str,
        zotero_item_key: str,
    ) -> Article | None:
        """
        Fetch article by zotero_item_key within a project.

        Args:
            project_id: Project ID.
            zotero_item_key: Zotero item key.

        Returns:
            Matching article or None.
        """
        if isinstance(project_id, str):
            project_id = UUID(project_id)

        result = await self.db.execute(
            select(Article)
            .where(Article.project_id == project_id)
            .where(Article.zotero_item_key == zotero_item_key)
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_by_canonical_identity(
        self,
        project_id: UUID,
        *,
        zotero_item_key: str | None = None,
        pmid: str | None = None,
        doi: str | None = None,
        url_landing: str | None = None,
    ) -> Article | None:
        """Oldest article in the project matching the key; PMID, then DOI, then URL."""
        if zotero_item_key:
            return await self.get_by_zotero_item_key(project_id, zotero_item_key)

        predicates = (
            (pmid, Article.pmid == pmid),
            (doi, doi_match_key(Article.doi) == doi),
            (url_landing, Article.url_landing == url_landing),
        )
        for value, predicate in predicates:
            if not value:
                continue
            result = await self.db.execute(
                select(Article)
                .where(Article.project_id == project_id)
                .where(predicate)
                .order_by(Article.created_at.asc(), Article.id.asc())
                .limit(1)
            )
            found = result.scalar_one_or_none()
            if found is not None:
                return found
        return None

    async def existing_pmids(self, project_id: UUID, pmids: Sequence[str]) -> set[str]:
        """The subset of ``pmids`` already stored on an article of the project."""
        if not pmids:
            return set()
        result = await self.db.execute(
            select(Article.pmid)
            .where(Article.project_id == project_id)
            .where(Article.pmid.in_(pmids))
        )
        return {pmid for pmid in result.scalars().all() if pmid is not None}

    async def complete_pmid_matches(
        self, project_id: UUID, pmids: Sequence[str], fields: Sequence[str]
    ) -> dict[str, UUID]:
        """``{pmid: article_id}`` for the PMIDs whose match has every ``fields`` filled.

        The match is the article a PMID lookup in ``get_by_canonical_identity``
        returns (the project's oldest with that PMID), so a fill-only upsert
        of any of these PMIDs would write nothing.
        """
        if not pmids:
            return {}
        result = await self.db.execute(
            select(Article)
            .where(Article.project_id == project_id)
            .where(Article.pmid.in_(list(pmids)))
            .order_by(Article.pmid, Article.created_at.asc(), Article.id.asc())
            .distinct(Article.pmid)
        )
        return {
            article.pmid: article.id
            for article in result.scalars().all()
            if article.pmid is not None
            and not any(_is_blank(getattr(article, field)) for field in fields)
        }

    async def upsert_by_canonical_identity(
        self,
        *,
        project_id: UUID,
        payload: dict[str, Any],
        canonical_identity: dict[str, str | None],
    ) -> tuple[Article, bool]:
        existing = await self.get_by_canonical_identity(
            project_id,
            zotero_item_key=canonical_identity.get("zotero_item_key"),
            doi=canonical_identity.get("doi"),
            url_landing=canonical_identity.get("url_landing"),
        )
        if existing:
            for key, value in payload.items():
                setattr(existing, key, value)
            existing.last_synced_at = datetime.now(UTC)
            await self.db.flush()
            await self.db.refresh(existing)
            return existing, False

        article = Article(
            project_id=project_id,
            last_synced_at=datetime.now(UTC),
            **payload,
        )
        created = await self.create(article)
        return created, True

    async def fill_only_upsert(
        self,
        *,
        project_id: UUID,
        payload: dict[str, Any],
        canonical_identity: dict[str, str | None],
        fill_fields: Sequence[str],
    ) -> tuple[Article, FillOutcome]:
        """Insert, or fill only the blank ``fill_fields`` of the matched article.

        A match keeps every other column (title, provenance, Zotero keys,
        ``last_synced_at``) exactly as the first source wrote it; it is
        ``unchanged`` when no field was blank or the payload had nothing for it.
        """
        existing = await self.get_by_canonical_identity(
            project_id,
            pmid=canonical_identity.get("pmid"),
            doi=canonical_identity.get("doi"),
            url_landing=canonical_identity.get("url_landing"),
        )
        if existing:
            filled = False
            for field in fill_fields:
                incoming = payload.get(field)
                if _is_blank(incoming) or not _is_blank(getattr(existing, field)):
                    continue
                setattr(existing, field, incoming)
                filled = True
            await self.db.flush()
            return existing, "updated" if filled else "unchanged"

        article = Article(
            project_id=project_id,
            last_synced_at=datetime.now(UTC),
            **payload,
        )
        created = await self.create(article)
        return created, "inserted"

    async def mark_removed_at_source(self, article: Article) -> Article:
        article.sync_state = "removed_at_source"
        article.removed_at_source_at = datetime.now(UTC)
        article.last_synced_at = datetime.now(UTC)
        await self.db.flush()
        await self.db.refresh(article)
        return article

    async def mark_reactivated(self, article: Article) -> Article:
        article.sync_state = "reactivated"
        article.removed_at_source_at = None
        article.last_synced_at = datetime.now(UTC)
        await self.db.flush()
        await self.db.refresh(article)
        return article

    async def get_zotero_project_articles(
        self, project_id: UUID, collection_key: str | None = None
    ) -> list[Article]:
        query = select(Article).where(
            Article.project_id == project_id,
            Article.ingestion_source == "zotero",
            Article.zotero_item_key.is_not(None),
        )
        if collection_key:
            query = query.where(Article.zotero_collection_key == collection_key)
        result = await self.db.execute(query)
        return list(result.scalars().all())


class ArticleSyncRunRepository(BaseRepository[ArticleSyncRun]):
    def __init__(self, db: AsyncSession):
        super().__init__(db, ArticleSyncRun)

    async def create_run(
        self,
        *,
        project_id: UUID,
        requested_by_user_id: UUID,
        source: str,
        source_collection_key: str | None,
    ) -> ArticleSyncRun:
        run = ArticleSyncRun(
            project_id=project_id,
            requested_by_user_id=requested_by_user_id,
            started_at=datetime.now(UTC),
            status="pending",
            source=source,
            source_collection_key=source_collection_key,
        )
        return await self.create(run)

    async def get_owned_run(self, sync_run_id: UUID, user_id: UUID) -> ArticleSyncRun | None:
        result = await self.db.execute(
            select(ArticleSyncRun)
            .where(ArticleSyncRun.id == sync_run_id)
            .where(ArticleSyncRun.requested_by_user_id == user_id)
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def run_in_project(
        self,
        sync_run_id: UUID,
        *,
        project_id: UUID,
        requested_by: UUID | None = None,
        for_update: bool = False,
    ) -> ArticleSyncRun | None:
        """The run, only when it belongs to ``project_id``; the one run-in-project guard.

        Missing and foreign runs both answer ``None``. ``requested_by``
        narrows it to the requester's own runs; ``for_update`` row-locks it
        and refreshes any stale identity-map copy.
        """
        query = select(ArticleSyncRun).where(
            ArticleSyncRun.id == sync_run_id, ArticleSyncRun.project_id == project_id
        )
        if requested_by is not None:
            query = query.where(ArticleSyncRun.requested_by_user_id == requested_by)
        if for_update:
            query = query.with_for_update().execution_options(populate_existing=True)
        return (await self.db.execute(query)).scalar_one_or_none()

    async def update_counts(
        self,
        run: ArticleSyncRun,
        counts: dict[str, int],
        status: str,
        *,
        failure_summary: dict[str, Any] | None = None,
    ) -> ArticleSyncRun:
        run.total_received = counts.get("total_received", run.total_received)
        run.persisted = counts.get("persisted", run.persisted)
        run.updated = counts.get("updated", run.updated)
        run.skipped = counts.get("skipped", run.skipped)
        run.failed = counts.get("failed", run.failed)
        run.removed_at_source = counts.get("removed_at_source", run.removed_at_source)
        run.reactivated = counts.get("reactivated", run.reactivated)
        run.status = status
        if failure_summary is not None:
            run.failure_summary = failure_summary
        if status in {"completed", "failed", "cancelled"}:
            run.completed_at = datetime.now(UTC)
        await self.db.flush()
        await self.db.refresh(run)
        return run


class ArticleSyncEventRepository(BaseRepository[ArticleSyncEvent]):
    def __init__(self, db: AsyncSession):
        super().__init__(db, ArticleSyncEvent)

    async def create_event(
        self,
        *,
        project_id: UUID,
        sync_run_id: UUID,
        status: str,
        zotero_item_key: str | None,
        article_id: UUID | None = None,
        authority_rule_applied: str | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
        event_payload: dict[str, Any] | None = None,
    ) -> ArticleSyncEvent:
        event = ArticleSyncEvent(
            project_id=project_id,
            article_id=article_id,
            sync_run_id=sync_run_id,
            zotero_item_key=zotero_item_key,
            status=status,
            authority_rule_applied=authority_rule_applied,
            error_code=error_code,
            error_message=error_message,
            event_payload=event_payload,
            processed_at=datetime.now(UTC),
        )
        return await self.create(event)

    async def pmids_with_events(self, sync_run_id: UUID, pmids: Sequence[str]) -> set[str]:
        """The subset of ``pmids`` that already has an event in the run."""
        if not pmids:
            return set()
        pmid = ArticleSyncEvent.event_payload["pmid"].astext
        result = await self.db.execute(
            select(pmid)
            .where(ArticleSyncEvent.sync_run_id == sync_run_id)
            .where(pmid.in_(list(pmids)))
            .distinct()
        )
        return set(result.scalars().all())

    async def status_counts(self, sync_run_id: UUID) -> dict[str, int]:
        """Event count per status in the run."""
        result = await self.db.execute(
            select(ArticleSyncEvent.status, func.count())
            .where(ArticleSyncEvent.sync_run_id == sync_run_id)
            .group_by(ArticleSyncEvent.status)
        )
        return {status: int(count) for status, count in result.all()}

    async def list_run_events(
        self,
        *,
        sync_run_id: UUID,
        offset: int = 0,
        limit: int = 50,
        status_filter: str | None = None,
    ) -> tuple[list[ArticleSyncEvent], int]:
        query = select(ArticleSyncEvent).where(ArticleSyncEvent.sync_run_id == sync_run_id)
        count_query = (
            select(func.count())
            .select_from(ArticleSyncEvent)
            .where(ArticleSyncEvent.sync_run_id == sync_run_id)
        )
        if status_filter:
            query = query.where(ArticleSyncEvent.status == status_filter)
            count_query = count_query.where(ArticleSyncEvent.status == status_filter)

        result = await self.db.execute(
            query.order_by(ArticleSyncEvent.processed_at.desc()).offset(offset).limit(limit)
        )
        total_result = await self.db.execute(count_query)
        return list(result.scalars().all()), int(total_result.scalar_one())

    async def list_failed_by_run(
        self, sync_run_id: UUID, limit: int = 100
    ) -> list[ArticleSyncEvent]:
        result = await self.db.execute(
            select(ArticleSyncEvent)
            .where(ArticleSyncEvent.sync_run_id == sync_run_id)
            .where(ArticleSyncEvent.status == "failed")
            .order_by(ArticleSyncEvent.processed_at.asc())
            .limit(limit)
        )
        return list(result.scalars().all())


class ArticleFileRepository(BaseRepository[ArticleFile]):
    """
    Repository for article files.

    Manages PDFs and other attachments.
    """

    def __init__(self, db: AsyncSession):
        super().__init__(db, ArticleFile)

    async def list_for_article_ordered(self, article_id: UUID | str) -> list[ArticleFile]:
        """List an article's files MAIN-first, then by created_at asc.

        Drives the document switcher: the MAIN document is the default
        selection, supplements follow in a stable upload order.
        """
        if isinstance(article_id, str):
            article_id = UUID(article_id)
        main_first = case((ArticleFile.file_role == "MAIN", 0), else_=1)
        query = (
            select(ArticleFile)
            .where(ArticleFile.article_id == article_id)
            .order_by(main_first, ArticleFile.created_at.asc())
        )
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_latest_pdf(self, article_id: UUID | str) -> ArticleFile | None:
        """
        Fetch latest PDF for an article.

        Args:
            article_id: Article ID.

        Returns:
            PDF file or None.
        """
        if isinstance(article_id, str):
            article_id = UUID(article_id)

        result = await self.db.execute(
            select(ArticleFile)
            .where(ArticleFile.article_id == article_id)
            .where(ArticleFile.file_type.ilike("%pdf%"))
            .order_by(ArticleFile.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()
