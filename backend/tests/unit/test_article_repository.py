"""Unit tests for app.repositories.article_repository.

Pure-mock — no database hit. Tests all repository classes in the module:
ArticleRepository, ArticleSyncRunRepository, ArticleSyncEventRepository,
ArticleFileRepository.
"""

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.article import Article, ArticleFile
from app.models.article_author import ArticleSyncEvent, ArticleSyncRun
from app.repositories.article_repository import (
    ArticleFileRepository,
    ArticleRepository,
    ArticleSyncEventRepository,
    ArticleSyncRunRepository,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PROJECT_ID = uuid.uuid4()
ARTICLE_ID = uuid.uuid4()
RUN_ID = uuid.uuid4()
USER_ID = uuid.uuid4()


def make_article(
    *,
    id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    title: str = "Test Article",
) -> MagicMock:
    art = MagicMock(spec=Article)
    art.id = id or uuid.uuid4()
    art.project_id = project_id or PROJECT_ID
    art.title = title
    art.doi = "10.1234/test"
    art.url_landing = None
    art.zotero_item_key = None
    art.ingestion_source = "manual"
    art.sync_state = "active"
    art.removed_at_source_at = None
    art.updated_at = datetime.now(UTC)
    art.files = []
    return art


def make_scalars_result(items: list) -> MagicMock:
    scalars = MagicMock()
    scalars.all.return_value = items
    result = MagicMock()
    result.scalars.return_value = scalars
    return result


def make_scalar_one_or_none(item) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = item
    return result


def make_scalar_one(val) -> MagicMock:
    result = MagicMock()
    result.scalar_one.return_value = val
    return result


def make_db() -> AsyncMock:
    db = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    return db


# ---------------------------------------------------------------------------
# ArticleRepository.get_by_project
# ---------------------------------------------------------------------------


class TestGetByProject:
    @pytest.mark.asyncio
    async def test_returns_articles(self) -> None:
        db = make_db()
        arts = [make_article(), make_article()]
        db.execute = AsyncMock(return_value=make_scalars_result(arts))
        repo = ArticleRepository(db)

        result = await repo.get_by_project(PROJECT_ID)

        assert result == arts

    @pytest.mark.asyncio
    async def test_accepts_string_project_id(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalars_result([]))
        repo = ArticleRepository(db)

        result = await repo.get_by_project(str(PROJECT_ID))

        assert result == []

    @pytest.mark.asyncio
    async def test_passes_pagination_params(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalars_result([]))
        repo = ArticleRepository(db)

        await repo.get_by_project(PROJECT_ID, skip=10, limit=5)

        db.execute.assert_awaited_once()


# ---------------------------------------------------------------------------
# ArticleRepository.get_with_files
# ---------------------------------------------------------------------------


class TestGetWithFiles:
    @pytest.mark.asyncio
    async def test_returns_article_when_found(self) -> None:
        db = make_db()
        art = make_article()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(art))
        repo = ArticleRepository(db)

        result = await repo.get_with_files(ARTICLE_ID)

        assert result is art

    @pytest.mark.asyncio
    async def test_returns_none_when_not_found(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(None))
        repo = ArticleRepository(db)

        result = await repo.get_with_files(ARTICLE_ID)

        assert result is None

    @pytest.mark.asyncio
    async def test_accepts_string_id(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(None))
        repo = ArticleRepository(db)

        result = await repo.get_with_files(str(ARTICLE_ID))

        assert result is None


# ---------------------------------------------------------------------------
# ArticleRepository.get_by_ids
# ---------------------------------------------------------------------------


class TestGetByIds:
    @pytest.mark.asyncio
    async def test_empty_ids_returns_empty(self) -> None:
        db = make_db()
        repo = ArticleRepository(db)

        result = await repo.get_by_ids([], PROJECT_ID)

        assert result == []
        db.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_returns_articles_in_requested_order(self) -> None:
        db = make_db()
        id1 = uuid.uuid4()
        id2 = uuid.uuid4()
        art1 = make_article(id=id1)
        art2 = make_article(id=id2)
        # DB returns them in reversed order
        db.execute = AsyncMock(return_value=make_scalars_result([art2, art1]))
        repo = ArticleRepository(db)

        result = await repo.get_by_ids([id1, id2], PROJECT_ID)

        assert result[0].id == id1
        assert result[1].id == id2

    @pytest.mark.asyncio
    async def test_accepts_string_ids(self) -> None:
        db = make_db()
        id1 = uuid.uuid4()
        art = make_article(id=id1)
        db.execute = AsyncMock(return_value=make_scalars_result([art]))
        repo = ArticleRepository(db)

        result = await repo.get_by_ids([str(id1)], str(PROJECT_ID))

        assert result[0].id == id1

    @pytest.mark.asyncio
    async def test_skips_ids_not_in_db_result(self) -> None:
        db = make_db()
        id1 = uuid.uuid4()
        id2 = uuid.uuid4()
        art1 = make_article(id=id1)
        db.execute = AsyncMock(return_value=make_scalars_result([art1]))
        repo = ArticleRepository(db)

        # id2 not returned by DB
        result = await repo.get_by_ids([id1, id2], PROJECT_ID)

        assert len(result) == 1
        assert result[0].id == id1


# ---------------------------------------------------------------------------
# ArticleRepository.get_by_zotero_item_key
# ---------------------------------------------------------------------------


class TestGetByZoteroItemKey:
    @pytest.mark.asyncio
    async def test_returns_article(self) -> None:
        db = make_db()
        art = make_article()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(art))
        repo = ArticleRepository(db)

        result = await repo.get_by_zotero_item_key(PROJECT_ID, "ABCDE123")

        assert result is art

    @pytest.mark.asyncio
    async def test_returns_none_for_missing_key(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(None))
        repo = ArticleRepository(db)

        result = await repo.get_by_zotero_item_key(PROJECT_ID, "NOPE")

        assert result is None


# ---------------------------------------------------------------------------
# ArticleRepository.count_by_project
# ---------------------------------------------------------------------------


class TestCountByProject:
    @pytest.mark.asyncio
    async def test_returns_count(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalar_one(7))
        repo = ArticleRepository(db)

        result = await repo.count_by_project(PROJECT_ID)

        assert result == 7

    @pytest.mark.asyncio
    async def test_accepts_string_project_id(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalar_one(0))
        repo = ArticleRepository(db)

        result = await repo.count_by_project(str(PROJECT_ID))

        assert result == 0


# ---------------------------------------------------------------------------
# ArticleRepository.get_by_canonical_identity
# ---------------------------------------------------------------------------


class TestGetByCanonicalIdentity:
    @pytest.mark.asyncio
    async def test_uses_zotero_key_when_provided(self) -> None:
        db = make_db()
        art = make_article()
        repo = ArticleRepository(db)

        with patch.object(
            repo, "get_by_zotero_item_key", AsyncMock(return_value=art)
        ) as mock_zotero:
            result = await repo.get_by_canonical_identity(PROJECT_ID, zotero_item_key="KEY123")

        assert result is art
        mock_zotero.assert_awaited_once_with(PROJECT_ID, "KEY123")

    @pytest.mark.asyncio
    async def test_returns_none_when_no_clauses(self) -> None:
        db = make_db()
        repo = ArticleRepository(db)

        result = await repo.get_by_canonical_identity(PROJECT_ID)

        assert result is None

    @pytest.mark.asyncio
    async def test_queries_by_doi(self) -> None:
        db = make_db()
        art = make_article()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(art))
        repo = ArticleRepository(db)

        result = await repo.get_by_canonical_identity(PROJECT_ID, doi="10.1234/x")

        assert result is art


# ---------------------------------------------------------------------------
# ArticleRepository.upsert_by_canonical_identity
# ---------------------------------------------------------------------------


class TestUpsertByCanonicalIdentity:
    @pytest.mark.asyncio
    async def test_updates_existing_article(self) -> None:
        db = make_db()
        existing = make_article()
        repo = ArticleRepository(db)

        with patch.object(repo, "get_by_canonical_identity", AsyncMock(return_value=existing)):
            art, created = await repo.upsert_by_canonical_identity(
                project_id=PROJECT_ID,
                payload={"title": "New Title"},
                canonical_identity={"zotero_item_key": "K"},
            )

        assert created is False
        assert art is existing

    @pytest.mark.asyncio
    async def test_creates_new_article(self) -> None:
        db = make_db()
        new_art = make_article()
        repo = ArticleRepository(db)

        with (
            patch.object(repo, "get_by_canonical_identity", AsyncMock(return_value=None)),
            patch.object(repo, "create", AsyncMock(return_value=new_art)),
        ):
            art, created = await repo.upsert_by_canonical_identity(
                project_id=PROJECT_ID,
                payload={"title": "Brand New"},
                canonical_identity={"doi": "10.1/new"},
            )

        assert created is True
        assert art is new_art


# ---------------------------------------------------------------------------
# ArticleRepository.mark_removed_at_source / mark_reactivated
# ---------------------------------------------------------------------------


class TestMarkArticleState:
    @pytest.mark.asyncio
    async def test_mark_removed_sets_state(self) -> None:
        db = make_db()
        art = make_article()
        repo = ArticleRepository(db)

        result = await repo.mark_removed_at_source(art)

        assert art.sync_state == "removed_at_source"
        assert result is art

    @pytest.mark.asyncio
    async def test_mark_reactivated_clears_removed_at(self) -> None:
        db = make_db()
        art = make_article()
        art.removed_at_source_at = datetime.now(UTC)
        repo = ArticleRepository(db)

        result = await repo.mark_reactivated(art)

        assert art.sync_state == "reactivated"
        assert art.removed_at_source_at is None
        assert result is art


# ---------------------------------------------------------------------------
# ArticleSyncRunRepository
# ---------------------------------------------------------------------------


class TestArticleSyncRunRepository:
    @pytest.mark.asyncio
    async def test_create_run_sets_status_pending(self) -> None:
        db = make_db()
        repo = ArticleSyncRunRepository(db)
        created_run = MagicMock(spec=ArticleSyncRun)

        with patch.object(repo, "create", AsyncMock(return_value=created_run)):
            result = await repo.create_run(
                project_id=PROJECT_ID,
                requested_by_user_id=USER_ID,
                source="zotero",
                source_collection_key=None,
            )

        assert result is created_run

    @pytest.mark.asyncio
    async def test_get_owned_run_returns_run(self) -> None:
        db = make_db()
        sync_run = MagicMock(spec=ArticleSyncRun)
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(sync_run))
        repo = ArticleSyncRunRepository(db)

        result = await repo.get_owned_run(RUN_ID, USER_ID)

        assert result is sync_run

    @pytest.mark.asyncio
    async def test_update_counts_sets_completed_at_for_terminal_status(self) -> None:
        db = make_db()
        run = MagicMock(spec=ArticleSyncRun)
        run.total_received = 0
        run.persisted = 0
        run.updated = 0
        run.skipped = 0
        run.failed = 0
        run.removed_at_source = 0
        run.reactivated = 0
        repo = ArticleSyncRunRepository(db)

        await repo.update_counts(run, {"persisted": 5, "total_received": 5}, "completed")

        assert run.status == "completed"
        assert run.completed_at is not None

    @pytest.mark.asyncio
    async def test_update_counts_no_completed_at_for_running(self) -> None:
        db = make_db()
        run = MagicMock(spec=ArticleSyncRun)
        run.total_received = 0
        run.persisted = 0
        run.updated = 0
        run.skipped = 0
        run.failed = 0
        run.removed_at_source = 0
        run.reactivated = 0
        run.completed_at = None
        repo = ArticleSyncRunRepository(db)

        await repo.update_counts(run, {}, "running")

        assert run.completed_at is None


# ---------------------------------------------------------------------------
# ArticleSyncEventRepository
# ---------------------------------------------------------------------------


class TestArticleSyncEventRepository:
    @pytest.mark.asyncio
    async def test_create_event_sets_processed_at(self) -> None:
        db = make_db()
        repo = ArticleSyncEventRepository(db)
        created = MagicMock(spec=ArticleSyncEvent)

        with patch.object(repo, "create", AsyncMock(return_value=created)):
            result = await repo.create_event(
                project_id=PROJECT_ID,
                sync_run_id=RUN_ID,
                status="success",
                zotero_item_key="K1",
                article_id=ARTICLE_ID,
            )

        assert result is created

    @pytest.mark.asyncio
    async def test_list_run_events_returns_events_and_count(self) -> None:
        db = make_db()
        events = [MagicMock(spec=ArticleSyncEvent)]
        scalars_result = make_scalars_result(events)
        count_result = make_scalar_one(1)
        db.execute = AsyncMock(side_effect=[scalars_result, count_result])
        repo = ArticleSyncEventRepository(db)

        result_events, total = await repo.list_run_events(sync_run_id=RUN_ID)

        assert result_events == events
        assert total == 1

    @pytest.mark.asyncio
    async def test_list_run_events_with_status_filter(self) -> None:
        db = make_db()
        db.execute = AsyncMock(side_effect=[make_scalars_result([]), make_scalar_one(0)])
        repo = ArticleSyncEventRepository(db)

        events, total = await repo.list_run_events(sync_run_id=RUN_ID, status_filter="failed")

        assert events == []
        assert total == 0

    @pytest.mark.asyncio
    async def test_list_failed_by_run_returns_only_failed(self) -> None:
        db = make_db()
        failed_event = MagicMock(spec=ArticleSyncEvent)
        failed_event.status = "failed"
        db.execute = AsyncMock(return_value=make_scalars_result([failed_event]))
        repo = ArticleSyncEventRepository(db)

        result = await repo.list_failed_by_run(RUN_ID)

        assert result == [failed_event]


# ---------------------------------------------------------------------------
# ArticleFileRepository
# ---------------------------------------------------------------------------


class TestArticleFileRepository:
    @pytest.mark.asyncio
    async def test_get_by_article_returns_files(self) -> None:
        db = make_db()
        files = [MagicMock(spec=ArticleFile)]
        db.execute = AsyncMock(return_value=make_scalars_result(files))
        repo = ArticleFileRepository(db)

        result = await repo.get_by_article(ARTICLE_ID)

        assert result == files

    @pytest.mark.asyncio
    async def test_get_by_article_with_type_filter(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalars_result([]))
        repo = ArticleFileRepository(db)

        result = await repo.get_by_article(ARTICLE_ID, file_type="pdf")

        assert result == []

    @pytest.mark.asyncio
    async def test_get_latest_pdf_returns_file(self) -> None:
        db = make_db()
        pdf = MagicMock(spec=ArticleFile)
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(pdf))
        repo = ArticleFileRepository(db)

        result = await repo.get_latest_pdf(ARTICLE_ID)

        assert result is pdf

    @pytest.mark.asyncio
    async def test_get_latest_pdf_returns_none_when_absent(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(None))
        repo = ArticleFileRepository(db)

        result = await repo.get_latest_pdf(ARTICLE_ID)

        assert result is None

    @pytest.mark.asyncio
    async def test_get_by_storage_key_returns_file(self) -> None:
        db = make_db()
        f = MagicMock(spec=ArticleFile)
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(f))
        repo = ArticleFileRepository(db)

        result = await repo.get_by_storage_key("articles/file.pdf")

        assert result is f

    @pytest.mark.asyncio
    async def test_get_by_article_accepts_string_id(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalars_result([]))
        repo = ArticleFileRepository(db)

        result = await repo.get_by_article(str(ARTICLE_ID))

        assert result == []
