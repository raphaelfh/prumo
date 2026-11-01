"""Unit tests for ExtractionExportService.

Pure-mock tests that drive the service to ≥80% coverage. No real DB
session is used — all repository calls and SQLAlchemy execute() chains
are replaced with AsyncMock / MagicMock instances.

Coverage targets (in priority order):
  T1  assert_can_export             — auth gate (4 paths)
  T2  (retired: the value-map builders became the cell loaders, integration-tested)
  T3  _resolve_articles_for_consensus — stage filtering + omit tracking
  T6  (retired with T2)
  T7  list_eligible_reviewers_for_picker — manager vs non-manager
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from app.core.error_handler import AuthorizationError
from app.models.extraction import (
    ExtractionRun,
    ExtractionRunStage,
)
from app.models.extraction_instance import ExtractionInstance
from app.models.project import ProjectMemberRole
from app.services.exports.rater_labels import letter_for, short_id
from app.services.extraction_export_service import (
    ArticleRef,
    ExportMode,
    ExtractionExportService,
)

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _make_service(user_id: str | None = None) -> ExtractionExportService:
    """Return a service wired to a no-op async session."""
    db = AsyncMock()
    return ExtractionExportService(
        db=db,
        user_id=user_id or str(uuid4()),
    )


def _scalars_result(items: list) -> MagicMock:
    """Return a fake SQLAlchemy Result whose .scalars().all() yields *items*."""
    scalars_obj = MagicMock()
    scalars_obj.all.return_value = items
    result = MagicMock()
    result.scalars.return_value = scalars_obj
    return result


def _rows_result(rows: list) -> MagicMock:
    """Return a fake Result whose .all() yields *rows* (row-tuple queries)."""
    result = MagicMock()
    result.all.return_value = rows
    return result


def _scalar_result(value) -> MagicMock:
    """Return a fake Result whose .scalar_one_or_none() yields *value*."""
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


def _make_run(
    *,
    article_id: UUID | None = None,
    stage: str = ExtractionRunStage.FINALIZED.value,
    template_id: UUID | None = None,
    project_id: UUID | None = None,
    kind: str = "extraction",
    created_at: datetime | None = None,
) -> ExtractionRun:
    """Construct an ExtractionRun-shaped object without a DB session.

    The current-run choice itself is SQL (``CurrentRunResolver``); a mocked
    ``execute`` hands back already-chosen rows, one per article.
    """
    run = MagicMock(spec=ExtractionRun)
    run.id = uuid4()
    run.article_id = article_id or uuid4()
    run.stage = stage
    run.template_id = template_id or uuid4()
    run.project_id = project_id or uuid4()
    run.kind = kind
    run.created_at = created_at or datetime(2026, 1, 1, tzinfo=UTC)
    return run


def _make_instance(
    *,
    article_id: UUID | None = None,
    entity_type_id: UUID | None = None,
    template_id: UUID | None = None,
) -> ExtractionInstance:
    inst = MagicMock(spec=ExtractionInstance)
    inst.id = uuid4()
    inst.article_id = article_id or uuid4()
    inst.entity_type_id = entity_type_id or uuid4()
    inst.template_id = template_id or uuid4()
    inst.parent_instance_id = None
    inst.sort_order = 0
    return inst


# ===========================================================================
# T1 — assert_can_export
# ===========================================================================


class TestAssertCanExport:
    """Auth gate: membership + manager checks (FR-003 / FR-004).

    Mocking strategy: monkeypatch ProjectMemberRepository at the
    module import name so the lazy accessor `_project_members_repo()`
    returns the mock repo.
    """

    @pytest.mark.asyncio
    async def test_non_member_raises_authorization_error(self, monkeypatch):
        """User is not a project member → AuthorizationError."""
        svc = _make_service()
        project_id = uuid4()

        member_repo = AsyncMock()
        member_repo.is_member = AsyncMock(return_value=False)

        monkeypatch.setattr(
            "app.services.extraction_export_service.ProjectMemberRepository",
            lambda _: member_repo,
        )

        with pytest.raises(AuthorizationError):
            await svc.assert_can_export(project_id, ExportMode.CONSENSUS, None)

    @pytest.mark.asyncio
    async def test_member_consensus_mode_no_raise(self, monkeypatch):
        """Member requesting CONSENSUS export → no error raised."""
        svc = _make_service()
        project_id = uuid4()

        member_repo = AsyncMock()
        member_repo.is_member = AsyncMock(return_value=True)
        member_repo.has_role = AsyncMock(return_value=False)

        monkeypatch.setattr(
            "app.services.extraction_export_service.ProjectMemberRepository",
            lambda _: member_repo,
        )

        # Should not raise
        await svc.assert_can_export(project_id, ExportMode.CONSENSUS, None)
        member_repo.has_role.assert_not_called()

    @pytest.mark.asyncio
    async def test_non_manager_single_user_other_reviewer_raises(self, monkeypatch):
        """Non-manager trying to export another reviewer's decisions → AuthorizationError."""
        user_id = uuid4()
        svc = _make_service(user_id=str(user_id))
        project_id = uuid4()
        other_reviewer_id = uuid4()

        member_repo = AsyncMock()
        member_repo.is_member = AsyncMock(return_value=True)
        member_repo.has_role = AsyncMock(return_value=False)  # not a manager

        monkeypatch.setattr(
            "app.services.extraction_export_service.ProjectMemberRepository",
            lambda _: member_repo,
        )

        with pytest.raises(AuthorizationError):
            await svc.assert_can_export(project_id, ExportMode.SINGLE_USER, other_reviewer_id)

    @pytest.mark.asyncio
    async def test_manager_all_users_mode_no_raise(self, monkeypatch):
        """Manager requesting ALL_USERS export → no error raised."""
        svc = _make_service()
        project_id = uuid4()

        member_repo = AsyncMock()
        member_repo.is_member = AsyncMock(return_value=True)
        member_repo.has_role = AsyncMock(return_value=True)  # is a manager

        monkeypatch.setattr(
            "app.services.extraction_export_service.ProjectMemberRepository",
            lambda _: member_repo,
        )

        await svc.assert_can_export(project_id, ExportMode.ALL_USERS, None)
        member_repo.has_role.assert_called_once_with(
            project_id, UUID(svc.user_id), ProjectMemberRole.MANAGER
        )

    @pytest.mark.asyncio
    async def test_invalid_user_id_raises_authorization_error(self, monkeypatch):
        """Service with non-UUID user_id raises AuthorizationError early."""
        svc = _make_service(user_id="not-a-uuid")

        member_repo = AsyncMock()
        member_repo.is_member = AsyncMock(return_value=True)

        monkeypatch.setattr(
            "app.services.extraction_export_service.ProjectMemberRepository",
            lambda _: member_repo,
        )

        with pytest.raises(AuthorizationError):
            await svc.assert_can_export(uuid4(), ExportMode.CONSENSUS, None)

    @pytest.mark.asyncio
    async def test_non_manager_single_user_own_reviewer_no_raise(self, monkeypatch):
        """Non-manager exporting their own decisions → no error (self-export allowed)."""
        user_id = uuid4()
        svc = _make_service(user_id=str(user_id))
        project_id = uuid4()

        member_repo = AsyncMock()
        member_repo.is_member = AsyncMock(return_value=True)
        member_repo.has_role = AsyncMock(return_value=False)

        monkeypatch.setattr(
            "app.services.extraction_export_service.ProjectMemberRepository",
            lambda _: member_repo,
        )

        # target_reviewer_id == caller_id → no manager check required
        await svc.assert_can_export(project_id, ExportMode.SINGLE_USER, user_id)
        member_repo.has_role.assert_not_called()


# ===========================================================================
# T3 — _resolve_articles_for_consensus
# ===========================================================================


class TestResolveArticlesForConsensus:
    """Stage filtering + omit tracking for consensus export (FR-013).

    Mocking strategy: mock svc.db.execute (for run queries), then also
    mock the helper methods _load_instances_for_runs,
    _load_entity_type_role_map, and pass ``refs`` to return
    controlled data so we isolate the filtering logic.
    """

    @pytest.mark.asyncio
    async def test_empty_candidate_ids_returns_empty(self):
        """No candidate_ids → short-circuits before DB access."""
        svc = _make_service()
        articles, omitted = await svc._resolve_articles_for_consensus(
            template_id=uuid4(),
            project_id=uuid4(),
            candidate_ids=[],
            refs={},
            version_numbers={},
        )
        assert articles == []
        assert omitted == []
        svc.db.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_all_finalized_articles_kept(self):
        """All FINALIZED runs → all articles kept, no omissions."""
        svc = _make_service()
        project_id = uuid4()
        template_id = uuid4()

        aid1 = uuid4()
        aid2 = uuid4()
        run1 = _make_run(article_id=aid1, stage=ExtractionRunStage.FINALIZED.value)
        run2 = _make_run(article_id=aid2, stage=ExtractionRunStage.FINALIZED.value)
        run1.template_id = template_id
        run2.template_id = template_id

        svc.db.execute = AsyncMock(return_value=_scalars_result([run1, run2]))

        # Mock the three helpers called after filtering
        svc._load_instances_for_runs = AsyncMock(return_value={run1.id: [], run2.id: []})
        svc._load_entity_type_role_map = AsyncMock(return_value={})

        articles, omitted = await svc._resolve_articles_for_consensus(
            template_id=template_id,
            project_id=project_id,
            candidate_ids=[aid1, aid2],
            refs={
                aid1: ArticleRef("Author1 2021", None, None),
                aid2: ArticleRef("Author2 2022", None, None),
            },
            version_numbers={},
        )

        assert len(articles) == 2
        assert omitted == []
        article_ids_out = {a.article_id for a in articles}
        assert article_ids_out == {aid1, aid2}

    @pytest.mark.asyncio
    async def test_mixed_stages_only_finalized_kept(self):
        """FINALIZED kept; CONSENSUS + EXTRACT → omitted with stage key."""
        svc = _make_service()
        template_id = uuid4()
        project_id = uuid4()

        aid_fin = uuid4()
        aid_rev = uuid4()
        aid_prop = uuid4()

        run_fin = _make_run(article_id=aid_fin, stage=ExtractionRunStage.FINALIZED.value)
        run_rev = _make_run(article_id=aid_rev, stage=ExtractionRunStage.CONSENSUS.value)
        run_prop = _make_run(article_id=aid_prop, stage=ExtractionRunStage.EXTRACT.value)

        svc.db.execute = AsyncMock(return_value=_scalars_result([run_fin, run_rev, run_prop]))
        svc._load_instances_for_runs = AsyncMock(return_value={run_fin.id: []})
        svc._load_entity_type_role_map = AsyncMock(return_value={})

        articles, omitted = await svc._resolve_articles_for_consensus(
            template_id=template_id,
            project_id=project_id,
            candidate_ids=[aid_fin, aid_rev, aid_prop],
            refs={aid_fin: ArticleRef("Smith 2020", None, None)},
            version_numbers={},
        )

        assert len(articles) == 1
        assert articles[0].article_id == aid_fin
        assert articles[0].article_label == "Smith 2020"
        assert omitted == [
            (aid_rev, ExtractionRunStage.CONSENSUS.value),
            (aid_prop, ExtractionRunStage.EXTRACT.value),
        ]

    @pytest.mark.asyncio
    async def test_missing_run_counted_as_no_run(self):
        """Article without a run → omitted as ``no_run``."""
        svc = _make_service()
        template_id = uuid4()
        project_id = uuid4()

        aid_exists = uuid4()
        aid_missing = uuid4()  # no run in DB

        run = _make_run(article_id=aid_exists, stage=ExtractionRunStage.FINALIZED.value)
        svc.db.execute = AsyncMock(return_value=_scalars_result([run]))
        svc._load_instances_for_runs = AsyncMock(return_value={run.id: []})
        svc._load_entity_type_role_map = AsyncMock(return_value={})

        articles, omitted = await svc._resolve_articles_for_consensus(
            template_id=template_id,
            project_id=project_id,
            candidate_ids=[aid_exists, aid_missing],
            refs={aid_exists: ArticleRef("Jones 2019", None, None)},
            version_numbers={},
        )

        assert len(articles) == 1
        assert omitted == [(aid_missing, "no_run")]

    @pytest.mark.asyncio
    async def test_model_and_study_instances_resolved(self):
        """An article with both study + model instances populates both lists."""
        svc = _make_service()
        template_id = uuid4()
        project_id = uuid4()

        aid = uuid4()
        run = _make_run(article_id=aid, stage=ExtractionRunStage.FINALIZED.value)

        study_entity_id = uuid4()
        model_entity_id = uuid4()

        inst_study = _make_instance(article_id=aid, entity_type_id=study_entity_id)
        inst_model1 = _make_instance(article_id=aid, entity_type_id=model_entity_id)
        inst_model2 = _make_instance(article_id=aid, entity_type_id=model_entity_id)

        svc.db.execute = AsyncMock(return_value=_scalars_result([run]))
        svc._load_instances_for_runs = AsyncMock(
            return_value={run.id: [inst_study, inst_model1, inst_model2]}
        )

        articles, omitted = await svc._resolve_articles_for_consensus(
            template_id=template_id,
            project_id=project_id,
            candidate_ids=[aid],
            refs={aid: ArticleRef("Test 2023", None, None)},
            version_numbers={},
        )

        assert len(articles) == 1
        desc = articles[0]
        # Grouped by (entity_type, parent) rather than partitioned by role,
        # so the two model instances are one key and the study one another.
        # Compared as SETS: both fixtures share `sort_order=0`, so
        # `build_entries` orders them by id — random per run. The ordering
        # contract itself is pinned in test_extraction_export_entries_map.py.
        assert set(desc.entries[(model_entity_id, None)]) == {inst_model1.id, inst_model2.id}
        assert desc.entries[(study_entity_id, None)] == (inst_study.id,)
        assert omitted == []


# ===========================================================================
# T7 — list_eligible_reviewers_for_picker
# ===========================================================================


class TestListEligibleReviewersForPicker:
    """Picker dropdown for SINGLE_USER mode — manager vs non-manager.

    Mocking strategy: mock list_reviewers_with_decisions (sister method)
    and _project_members_repo().has_role.
    """

    @pytest.mark.asyncio
    async def test_manager_sees_all_reviewers(self, monkeypatch):
        """Manager → all reviewers from list_reviewers_with_decisions."""
        user_id = uuid4()
        svc = _make_service(user_id=str(user_id))
        svc.db.execute = AsyncMock(return_value=_scalar_result("extraction"))

        all_reviewers = [
            {"id": str(uuid4()), "name": "Alice"},
            {"id": str(uuid4()), "name": "Bob"},
        ]

        member_repo = AsyncMock()
        member_repo.has_role = AsyncMock(return_value=True)

        monkeypatch.setattr(
            "app.services.extraction_export_service.ProjectMemberRepository",
            lambda _: member_repo,
        )
        svc.list_reviewers_with_decisions = AsyncMock(return_value=all_reviewers)

        result = await svc.list_eligible_reviewers_for_picker(
            project_id=uuid4(), template_id=uuid4()
        )

        assert result == all_reviewers

    @pytest.mark.asyncio
    async def test_non_manager_sees_only_self(self, monkeypatch):
        """Non-manager → only their own entry."""
        user_id = uuid4()
        svc = _make_service(user_id=str(user_id))
        svc.db.execute = AsyncMock(return_value=_scalar_result("extraction"))

        self_entry = {"id": str(user_id), "name": "Self"}
        other_entry = {"id": str(uuid4()), "name": "Other"}
        all_reviewers = [self_entry, other_entry]

        member_repo = AsyncMock()
        member_repo.has_role = AsyncMock(return_value=False)

        monkeypatch.setattr(
            "app.services.extraction_export_service.ProjectMemberRepository",
            lambda _: member_repo,
        )
        svc.list_reviewers_with_decisions = AsyncMock(return_value=all_reviewers)

        result = await svc.list_eligible_reviewers_for_picker(
            project_id=uuid4(), template_id=uuid4()
        )

        assert result == [self_entry]

    @pytest.mark.asyncio
    async def test_invalid_user_id_returns_empty_list(self, monkeypatch):
        """Non-UUID user_id → returns [] before any DB IO."""
        svc = _make_service(user_id="not-a-uuid")

        member_repo = AsyncMock()
        monkeypatch.setattr(
            "app.services.extraction_export_service.ProjectMemberRepository",
            lambda _: member_repo,
        )
        svc.list_reviewers_with_decisions = AsyncMock(return_value=[])

        result = await svc.list_eligible_reviewers_for_picker(
            project_id=uuid4(), template_id=uuid4()
        )

        assert result == []
        # Malformed subject short-circuits before any DB IO: neither the
        # template-kind lookup nor the reviewer query runs, and the manager
        # check is never reached.
        svc.db.execute.assert_not_called()
        svc.list_reviewers_with_decisions.assert_not_called()
        member_repo.has_role.assert_not_called()

    @pytest.mark.asyncio
    async def test_non_manager_empty_reviewer_list(self, monkeypatch):
        """Non-manager when no reviewers exist → returns []."""
        user_id = uuid4()
        svc = _make_service(user_id=str(user_id))
        svc.db.execute = AsyncMock(return_value=_scalar_result("extraction"))

        member_repo = AsyncMock()
        member_repo.has_role = AsyncMock(return_value=False)

        monkeypatch.setattr(
            "app.services.extraction_export_service.ProjectMemberRepository",
            lambda _: member_repo,
        )
        svc.list_reviewers_with_decisions = AsyncMock(return_value=[])

        result = await svc.list_eligible_reviewers_for_picker(
            project_id=uuid4(), template_id=uuid4()
        )

        assert result == []


# ===========================================================================
# Pure helpers: short_id and letter_for
# ===========================================================================


class TestShortId:
    def test_returns_first_segment_of_uuid(self):
        uid = UUID("abcdef01-1234-4000-8000-000000000000")
        assert short_id(uid) == "abcdef01"


class TestLetterFor:
    def test_negative_returns_question_mark(self):
        assert letter_for(-1) == "?"

    def test_zero_returns_a(self):
        assert letter_for(0) == "A"

    def test_25_returns_z(self):
        assert letter_for(25) == "Z"

    def test_26_returns_aa(self):
        assert letter_for(26) == "AA"

    def test_51_returns_az(self):
        assert letter_for(51) == "AZ"

    def test_52_returns_ba(self):
        assert letter_for(52) == "BA"


# ===========================================================================
# Service: format_filename (static method)
# ===========================================================================


class TestFormatFilename:
    """Tests for the static format_filename method."""

    def test_basic_filename_format(self):
        ts = datetime(2024, 1, 15, 10, 30, 45, tzinfo=UTC)
        result = ExtractionExportService.format_filename(
            "My Project",
            "CHARMS Template",
            ExportMode.CONSENSUS,
            generated_at=ts,
        )
        assert result == "My_Project_CHARMS_Template_consensus_20240115-103045.xlsx"

    def test_special_chars_replaced_with_underscore(self):
        ts = datetime(2024, 6, 1, 0, 0, 0, tzinfo=UTC)
        result = ExtractionExportService.format_filename(
            "Project: Alpha/Beta",
            "Template (v1)",
            ExportMode.SINGLE_USER,
            generated_at=ts,
        )
        # Special chars become underscores
        assert result.endswith(".xlsx")
        assert "single_user" in result
        # No raw special chars
        assert ":" not in result
        assert "/" not in result
        assert "(" not in result

    def test_empty_project_name_falls_back_to_project(self):
        ts = datetime(2024, 6, 1, 0, 0, 0, tzinfo=UTC)
        result = ExtractionExportService.format_filename(
            "   ",  # only spaces → sanitise strips to empty
            "Template",
            ExportMode.CONSENSUS,
            generated_at=ts,
        )
        # The sanitizer replaces spaces with _ then strip("_") leaves empty,
        # so "project" fallback fires
        assert result.startswith("project_")

    def test_no_generated_at_uses_current_time(self):
        """Without generated_at, result still matches expected pattern."""
        result = ExtractionExportService.format_filename(
            "Proj",
            "Templ",
            ExportMode.ALL_USERS,
        )
        assert result.endswith(".xlsx")
        assert "all_users" in result
        assert result.startswith("Proj_Templ_all_users_")


# ===========================================================================
# Service: _resolve_project_name
# ===========================================================================


class TestResolveProjectName:
    @pytest.mark.asyncio
    async def test_project_with_name_returns_name(self, monkeypatch):
        """Project row with name → returns the name string."""
        svc = _make_service()
        project_id = uuid4()

        project_mock = MagicMock()
        project_mock.name = "Research Project Alpha"

        repo_mock = AsyncMock()
        repo_mock.get_by_id = AsyncMock(return_value=project_mock)

        monkeypatch.setattr(
            "app.services.extraction_export_service.ProjectRepository",
            lambda _: repo_mock,
        )

        result = await svc._resolve_project_name(project_id)
        assert result == "Research Project Alpha"

    @pytest.mark.asyncio
    async def test_project_not_found_returns_short_id(self, monkeypatch):
        """Project not found → falls back to first UUID segment."""
        svc = _make_service()
        project_id = UUID("abcdef01-1234-4000-8000-000000000000")

        repo_mock = AsyncMock()
        repo_mock.get_by_id = AsyncMock(return_value=None)

        monkeypatch.setattr(
            "app.services.extraction_export_service.ProjectRepository",
            lambda _: repo_mock,
        )

        result = await svc._resolve_project_name(project_id)
        assert result == "abcdef01"

    @pytest.mark.asyncio
    async def test_project_with_empty_name_returns_short_id(self, monkeypatch):
        """Project found but name is empty string → short_id fallback."""
        svc = _make_service()
        project_id = UUID("12345678-0000-4000-8000-000000000000")

        project_mock = MagicMock()
        project_mock.name = ""

        repo_mock = AsyncMock()
        repo_mock.get_by_id = AsyncMock(return_value=project_mock)

        monkeypatch.setattr(
            "app.services.extraction_export_service.ProjectRepository",
            lambda _: repo_mock,
        )

        result = await svc._resolve_project_name(project_id)
        assert result == "12345678"


# ===========================================================================
# Service: _load_active_template_version
# ===========================================================================


class TestLoadActiveTemplateVersion:
    @pytest.mark.asyncio
    async def test_template_not_found_raises_not_found_error(self):
        """No template row → NotFoundError raised."""
        from app.core.error_handler import NotFoundError

        svc = _make_service()
        template_id = uuid4()

        # scalar_one_or_none returns None (template not found)
        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = None
        svc.db.execute = AsyncMock(return_value=result_mock)

        with pytest.raises(NotFoundError):
            await svc._load_active_template_version(template_id, uuid4())

    @pytest.mark.asyncio
    async def test_template_found_no_version_raises_not_found_error(self, monkeypatch):
        """Template found but no active version → NotFoundError."""
        from app.core.error_handler import NotFoundError

        svc = _make_service()
        template_id = uuid4()

        template_mock = MagicMock()
        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = template_mock
        svc.db.execute = AsyncMock(return_value=result_mock)

        version_repo_mock = AsyncMock()
        version_repo_mock.get_active = AsyncMock(return_value=None)

        monkeypatch.setattr(
            "app.services.extraction_export_service.ExtractionTemplateVersionRepository",
            lambda _: version_repo_mock,
        )

        with pytest.raises(NotFoundError):
            await svc._load_active_template_version(template_id, uuid4())

    @pytest.mark.asyncio
    async def test_template_and_version_found_returns_tuple(self, monkeypatch):
        """Template + active version found → returns (template, version)."""
        svc = _make_service()
        template_id = uuid4()

        template_mock = MagicMock()
        version_mock = MagicMock()

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = template_mock
        svc.db.execute = AsyncMock(return_value=result_mock)

        version_repo_mock = AsyncMock()
        version_repo_mock.get_active = AsyncMock(return_value=version_mock)

        monkeypatch.setattr(
            "app.services.extraction_export_service.ExtractionTemplateVersionRepository",
            lambda _: version_repo_mock,
        )

        template, version = await svc._load_active_template_version(template_id, uuid4())
        assert template is template_mock
        assert version is version_mock


# ===========================================================================
# Service: _load_instances_for_runs
# ===========================================================================


class TestLoadInstancesForRuns:
    @pytest.mark.asyncio
    async def test_empty_run_ids_returns_empty(self):
        """Empty run_ids → short-circuit."""
        svc = _make_service()
        result = await svc._load_instances_for_runs([])
        assert result == {}
        svc.db.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_runs_not_found_returns_empty(self):
        """Run ids provided but no runs found in DB → {}."""
        svc = _make_service()
        svc.db.execute = AsyncMock(return_value=_scalars_result([]))

        result = await svc._load_instances_for_runs([uuid4()])
        assert result == {}

    @pytest.mark.asyncio
    async def test_instances_grouped_by_run(self):
        """Instances loaded and correctly grouped by run_id."""
        svc = _make_service()

        template_id = uuid4()
        article_id = uuid4()

        run = _make_run(article_id=article_id, template_id=template_id)
        run.id = uuid4()
        run.article_id = article_id
        run.template_id = template_id

        inst = _make_instance(article_id=article_id, template_id=template_id)

        svc.db.execute = AsyncMock(
            side_effect=[
                _scalars_result([run]),  # load runs
                _scalars_result([inst]),  # load instances
            ]
        )

        result = await svc._load_instances_for_runs([run.id])
        assert run.id in result
        assert inst in result[run.id]


# ===========================================================================
# Service: _resolve_articles_for_single_user
# ===========================================================================


class TestResolveArticlesForSingleUser:
    """Stage filtering for single-user mode.

    Mocking strategy: two db.execute() calls — one for run_rows, one for
    eligible_run_rows. Then helper mocks for instances/roles/headers.
    """

    @pytest.mark.asyncio
    async def test_empty_candidate_ids_returns_empty(self):
        svc = _make_service()
        articles, omitted = await svc._resolve_articles_for_single_user(
            template_id=uuid4(),
            project_id=uuid4(),
            candidate_ids=[],
            reviewer_id=uuid4(),
            refs={},
            version_numbers={},
        )
        assert articles == []
        assert omitted == []

    @pytest.mark.asyncio
    async def test_no_runs_found_returns_no_run_omission(self):
        """No runs in DB → all articles count as no_run."""
        svc = _make_service()
        candidate_ids = [uuid4(), uuid4()]

        svc.db.execute = AsyncMock(return_value=_scalars_result([]))

        articles, omitted = await svc._resolve_articles_for_single_user(
            template_id=uuid4(),
            project_id=uuid4(),
            candidate_ids=candidate_ids,
            reviewer_id=uuid4(),
            refs={},
            version_numbers={},
        )

        assert articles == []
        assert omitted == [(aid, "no_run") for aid in candidate_ids]

    @pytest.mark.asyncio
    async def test_cancelled_run_omitted(self):
        """CANCELLED stage → omitted as ``cancelled``."""
        svc = _make_service()
        aid = uuid4()
        reviewer_id = uuid4()

        run = _make_run(article_id=aid, stage=ExtractionRunStage.CANCELLED.value)

        svc.db.execute = AsyncMock(
            side_effect=[
                _scalars_result([run]),  # run_rows
                _rows_result([]),  # eligible_run_rows (empty)
            ]
        )

        articles, omitted = await svc._resolve_articles_for_single_user(
            template_id=uuid4(),
            project_id=uuid4(),
            candidate_ids=[aid],
            reviewer_id=reviewer_id,
            refs={},
            version_numbers={},
        )
        assert articles == []
        assert omitted == [(aid, "cancelled")]

    @pytest.mark.asyncio
    async def test_run_not_eligible_omitted(self):
        """Run not in eligible_run_ids → no_decisions_from_reviewer."""
        svc = _make_service()
        aid = uuid4()
        reviewer_id = uuid4()

        run = _make_run(article_id=aid, stage=ExtractionRunStage.CONSENSUS.value)

        svc.db.execute = AsyncMock(
            side_effect=[
                _scalars_result([run]),
                _rows_result([]),  # eligible_run_ids empty → not eligible
            ]
        )

        articles, omitted = await svc._resolve_articles_for_single_user(
            template_id=uuid4(),
            project_id=uuid4(),
            candidate_ids=[aid],
            reviewer_id=reviewer_id,
            refs={},
            version_numbers={},
        )
        assert articles == []
        assert omitted == [(aid, "no_decisions_from_reviewer")]

    @pytest.mark.asyncio
    async def test_eligible_run_returns_article_descriptor(self):
        """Eligible run → article descriptor returned."""
        svc = _make_service()
        aid = uuid4()
        reviewer_id = uuid4()

        run = _make_run(article_id=aid, stage=ExtractionRunStage.CONSENSUS.value)

        svc.db.execute = AsyncMock(
            side_effect=[
                _scalars_result([run]),
                _rows_result([(run.id,)]),  # eligible_run_ids includes this run
            ]
        )

        svc._load_instances_for_runs = AsyncMock(return_value={run.id: []})
        svc._load_entity_type_role_map = AsyncMock(return_value={})

        articles, omitted = await svc._resolve_articles_for_single_user(
            template_id=uuid4(),
            project_id=uuid4(),
            candidate_ids=[aid],
            reviewer_id=reviewer_id,
            refs={aid: ArticleRef("Author 2020", None, None)},
            version_numbers={},
        )
        assert len(articles) == 1
        assert articles[0].article_id == aid
        assert omitted == []


# ===========================================================================
# Service: list_reviewers_with_decisions
# ===========================================================================


class TestListReviewersWithDecisions:
    """Tests for list_reviewers_with_decisions."""

    @pytest.mark.asyncio
    async def test_returns_sorted_reviewer_list(self):
        """Rows with name → returns sorted list by name."""
        svc = _make_service()
        rid1 = uuid4()
        rid2 = uuid4()
        svc.db.execute = AsyncMock(
            return_value=_rows_result(
                [
                    (rid1, "Bob Smith", "bob@example.com"),
                    (rid2, "Alice Jones", "alice@example.com"),
                ]
            )
        )

        result = await svc.list_reviewers_with_decisions(project_id=uuid4(), template_id=uuid4())

        # Sorted alphabetically by name (lowercase)
        assert result[0]["name"] == "Alice Jones"
        assert result[1]["name"] == "Bob Smith"
        assert result[0]["id"] == str(rid2)

    @pytest.mark.asyncio
    async def test_falls_back_to_email_when_no_name(self):
        """No full_name → falls back to email."""
        svc = _make_service()
        rid = uuid4()
        svc.db.execute = AsyncMock(return_value=_rows_result([(rid, None, "reviewer@example.com")]))

        result = await svc.list_reviewers_with_decisions(project_id=uuid4(), template_id=uuid4())
        assert result[0]["name"] == "reviewer@example.com"

    @pytest.mark.asyncio
    async def test_no_rows_returns_empty_list(self):
        svc = _make_service()
        svc.db.execute = AsyncMock(return_value=_rows_result([]))

        result = await svc.list_reviewers_with_decisions(project_id=uuid4(), template_id=uuid4())
        assert result == []


# ===========================================================================
# Service: _resolve_articles_for_all_users
# ===========================================================================


class TestResolveArticlesForAllUsers:
    """Stage filtering for all-users mode — excludes cancelled/pending/proposal."""

    @pytest.mark.asyncio
    async def test_empty_candidate_ids_returns_empty(self):
        svc = _make_service()
        articles, omitted = await svc._resolve_articles_for_all_users(
            template_id=uuid4(),
            project_id=uuid4(),
            candidate_ids=[],
            refs={},
            version_numbers={},
        )
        assert articles == []
        assert omitted == []

    @pytest.mark.asyncio
    async def test_cancelled_extract_pending_omitted(self):
        """CANCELLED, EXTRACT, PENDING → all omitted."""
        svc = _make_service()
        aid1, aid2, aid3 = uuid4(), uuid4(), uuid4()

        run1 = _make_run(article_id=aid1, stage=ExtractionRunStage.CANCELLED.value)
        run2 = _make_run(article_id=aid2, stage=ExtractionRunStage.EXTRACT.value)
        run3 = _make_run(article_id=aid3, stage=ExtractionRunStage.PENDING.value)

        svc.db.execute = AsyncMock(return_value=_scalars_result([run1, run2, run3]))

        articles, omitted = await svc._resolve_articles_for_all_users(
            template_id=uuid4(),
            project_id=uuid4(),
            candidate_ids=[aid1, aid2, aid3],
            refs={},
            version_numbers={},
        )
        assert articles == []
        assert omitted == [
            (aid1, ExtractionRunStage.CANCELLED.value),
            (aid2, ExtractionRunStage.EXTRACT.value),
            (aid3, ExtractionRunStage.PENDING.value),
        ]

    @pytest.mark.asyncio
    async def test_consensus_and_finalized_kept(self):
        """CONSENSUS and FINALIZED stages → kept for all-users."""
        svc = _make_service()
        aid1, aid2 = uuid4(), uuid4()

        run1 = _make_run(article_id=aid1, stage=ExtractionRunStage.CONSENSUS.value)
        run2 = _make_run(article_id=aid2, stage=ExtractionRunStage.FINALIZED.value)

        svc.db.execute = AsyncMock(return_value=_scalars_result([run1, run2]))
        svc._load_instances_for_runs = AsyncMock(return_value={run1.id: [], run2.id: []})
        svc._load_entity_type_role_map = AsyncMock(return_value={})

        articles, omitted = await svc._resolve_articles_for_all_users(
            template_id=uuid4(),
            project_id=uuid4(),
            candidate_ids=[aid1, aid2],
            refs={aid1: ArticleRef("A1 2021", None, None), aid2: ArticleRef("A2 2022", None, None)},
            version_numbers={},
        )
        assert len(articles) == 2
        assert omitted == []


# ===========================================================================
# Service: _list_reviewers_for_runs
# ===========================================================================


class TestListReviewersForRuns:
    """_list_reviewers_for_runs labels and orders reviewers from the project map."""

    @pytest.mark.asyncio
    async def test_empty_run_ids_returns_empty_tuple(self):
        svc = _make_service()
        result = await svc._list_reviewers_for_runs(run_ids=[], labels={})
        assert result == ((), {})

    @pytest.mark.asyncio
    async def test_raters_by_run_groups_reviewers_per_run(self):
        svc = _make_service()
        r1, r2, run_a, run_b = uuid4(), uuid4(), uuid4(), uuid4()
        svc.db.execute = AsyncMock(
            return_value=_rows_result([(r1, run_a), (r2, run_a), (r1, run_b)])
        )
        labels = {r2: "Member A", r1: "Member B"}  # the _load_rater_labels map, stubbed
        reviewers, by_run = await svc._list_reviewers_for_runs(
            run_ids=[run_a, run_b], labels=labels
        )
        assert [(r.reviewer_id, r.display_label) for r in reviewers] == [
            (r2, "Member A"),
            (r1, "Member B"),
        ]
        assert by_run == {run_a: (r2, r1), run_b: (r1,)}


class TestLoadRaterLabels:
    """The labelling rules over the loader's (actor, first_at, name, email) rows."""

    @staticmethod
    def _svc_with(rows: list) -> ExtractionExportService:
        svc = _make_service()
        result = MagicMock()
        result.tuples.return_value = rows
        svc.db.execute = AsyncMock(return_value=result)
        return svc

    @pytest.mark.asyncio
    async def test_name_falls_back_to_email_then_short_id(self):
        a, b, c = uuid4(), uuid4(), uuid4()
        t = datetime(2026, 1, 1, tzinfo=UTC)
        svc = self._svc_with([(a, t, "Ann", None), (b, t, None, "b@x.org"), (c, t, None, None)])

        labels = await svc._load_rater_labels(project_id=uuid4(), anonymize=False)

        assert labels == {a: "Ann", b: "b@x.org", c: str(c).split("-")[0]}

    @pytest.mark.asyncio
    async def test_anonymize_hides_even_the_named_only_exporter(self):
        a = uuid4()
        svc = self._svc_with([(a, datetime(2026, 1, 1, tzinfo=UTC), "Ann", None)])

        labels = await svc._load_rater_labels(project_id=uuid4(), anonymize=True, named_only=a)

        assert labels == {a: "Member A"}

    @pytest.mark.asyncio
    async def test_same_name_takes_short_id_suffix(self):
        t = datetime(2026, 1, 1, tzinfo=UTC)
        a = UUID("aaaaaaaa-0000-4000-8000-000000000001")
        b = UUID("bbbbbbbb-0000-4000-8000-000000000002")
        svc = self._svc_with([(a, t, "Alex", None), (b, t, "alex", None)])

        labels = await svc._load_rater_labels(project_id=uuid4(), anonymize=False)

        assert labels == {a: "Alex aaaaaaaa", b: "alex bbbbbbbb"}

    @pytest.mark.asyncio
    async def test_same_name_and_short_id_takes_full_id_suffix(self):
        t = datetime(2026, 1, 1, tzinfo=UTC)
        a = UUID("ffffffff-9999-0000-0000-000000000001")
        b = UUID("ffffffff-9999-0000-0000-000000000003")
        svc = self._svc_with([(a, t, "Alex", None), (b, t, "Alex", None)])

        labels = await svc._load_rater_labels(project_id=uuid4(), anonymize=False)

        assert labels == {a: f"Alex {a}", b: f"Alex {b}"}

    @pytest.mark.asyncio
    async def test_letter_ties_break_on_id(self):
        t = datetime(2026, 1, 1, tzinfo=UTC)
        lo, hi = sorted((uuid4(), uuid4()), key=str)
        svc = self._svc_with([(hi, t, "H", None), (lo, t, "L", None)])

        labels = await svc._load_rater_labels(project_id=uuid4(), anonymize=True)

        assert list(labels.items()) == [(lo, "Member A"), (hi, "Member B")]
