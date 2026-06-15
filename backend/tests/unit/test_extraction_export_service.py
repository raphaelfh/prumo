"""Unit tests for ExtractionExportService.

Pure-mock tests that drive the service to ≥80% coverage. No real DB
session is used — all repository calls and SQLAlchemy execute() chains
are replaced with AsyncMock / MagicMock instances.

Coverage targets (in priority order):
  T1  assert_can_export             — auth gate (4 paths)
  T2  _build_consensus_value_map    — 3-tuple keys, JSONB unwrap
  T3  _resolve_articles_for_consensus — stage filtering + omit tracking
  T4  _infer_reviewer_outcome        — pure function, 5 outcomes
  T5  _load_ai_proposal_rows         — 8-query orchestration
  T6  _build_all_users_value_map     — 4-tuple keys, decision precedence
  T7  list_eligible_reviewers_for_picker — manager vs non-manager
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from app.core.error_handler import AuthorizationError
from app.models.extraction import (
    ExtractionEntityRole,
    ExtractionFieldType,
    ExtractionInstance,
    ExtractionRun,
    ExtractionRunStage,
)
from app.models.project import ProjectMemberRole
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportMode,
    ExtractionExportService,
    FieldDescriptor,
    SectionDescriptor,
    _build_header_label,
    _infer_reviewer_outcome,
    _letter_for,
    _normalize_allowed_values,
    _short_id,
)

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _make_service(user_id: str | None = None) -> ExtractionExportService:
    """Return a service wired to a no-op async session and storage."""
    db = AsyncMock()
    storage = MagicMock()
    return ExtractionExportService(
        db=db,
        user_id=user_id or str(uuid4()),
        storage=storage,
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

    ``created_at`` is required by ``_run_recency_key`` (added by PR #111 to
    deterministically pick the current run per article after reopen). We
    default to a stable timestamp so sort comparisons against a
    MagicMock-typed datetime don't blow up — tests that care about
    recency ordering pass an explicit ``created_at``.
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
    inst.sort_order = 0
    return inst


def _make_field(label: str, parent: UUID) -> FieldDescriptor:
    return FieldDescriptor(
        field_id=uuid4(),
        label=label,
        type=ExtractionFieldType.TEXT,
        allowed_values=(),
        parent_section_id=parent,
    )


def _make_section(label: str, role: ExtractionEntityRole) -> SectionDescriptor:
    eid = uuid4()
    return SectionDescriptor(
        entity_type_id=eid,
        label=label,
        role=role,
        parent_entity_type_id=None,
        fields=(_make_field(f"{label} F1", eid),),
    )


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
# T2 — _build_consensus_value_map
# ===========================================================================


class TestBuildConsensusValueMap:
    """3-tuple keyed value map from ExtractionPublishedState rows.

    Mocking strategy: mock svc.db.execute(...).all() to return fake row
    tuples (run_id, instance_id, field_id, value).
    """

    @pytest.mark.asyncio
    async def test_empty_run_ids_returns_empty_dict(self):
        """No run_ids → short-circuits to empty dict without hitting DB."""
        svc = _make_service()
        result = await svc._build_consensus_value_map(run_ids=[], fields_by_id={})
        assert result == {}
        svc.db.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_multiple_published_states_correct_keys(self):
        """Multiple rows → each 3-tuple key maps to the unwrapped value."""
        svc = _make_service()

        run_id = uuid4()
        instance_id1 = uuid4()
        instance_id2 = uuid4()
        field_id1 = uuid4()
        field_id2 = uuid4()

        rows = [
            (run_id, instance_id1, field_id1, "value_a"),
            (run_id, instance_id2, field_id2, "value_b"),
        ]
        svc.db.execute = AsyncMock(return_value=_rows_result(rows))

        result = await svc._build_consensus_value_map(run_ids=[run_id], fields_by_id={})

        assert result[(run_id, instance_id1, field_id1)] == "value_a"
        assert result[(run_id, instance_id2, field_id2)] == "value_b"
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_jsonb_wrapper_is_unwrapped(self):
        """Value stored as {"value": "actual"} is unwrapped to "actual"."""
        svc = _make_service()

        run_id = uuid4()
        instance_id = uuid4()
        field_id = uuid4()

        rows = [(run_id, instance_id, field_id, {"value": "actual_string"})]
        svc.db.execute = AsyncMock(return_value=_rows_result(rows))

        result = await svc._build_consensus_value_map(run_ids=[run_id], fields_by_id={})

        assert result[(run_id, instance_id, field_id)] == "actual_string"

    @pytest.mark.asyncio
    async def test_unknown_dict_collapses_to_scalar_never_leaks(self):
        """An unrecognised multi-key dict is collapsed deterministically to
        a string — ``resolve_value`` never leaks a dict into a cell."""
        svc = _make_service()

        run_id = uuid4()
        instance_id = uuid4()
        field_id = uuid4()
        raw = {"value": "x", "extra": "y"}

        rows = [(run_id, instance_id, field_id, raw)]
        svc.db.execute = AsyncMock(return_value=_rows_result(rows))

        result = await svc._build_consensus_value_map(run_ids=[run_id], fields_by_id={})
        resolved = result[(run_id, instance_id, field_id)]
        assert not isinstance(resolved, dict)
        assert resolved == "value: x; extra: y"


# ===========================================================================
# T3 — _resolve_articles_for_consensus
# ===========================================================================


class TestResolveArticlesForConsensus:
    """Stage filtering + omit tracking for consensus export (FR-013).

    Mocking strategy: mock svc.db.execute (for run queries), then also
    mock the helper methods _load_instances_for_runs,
    _load_entity_type_role_map, and _load_article_headers to return
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
        )
        assert articles == []
        assert omitted == {}
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
        svc._load_article_headers = AsyncMock(
            return_value={aid1: "Author1, 2021", aid2: "Author2, 2022"}
        )

        articles, omitted = await svc._resolve_articles_for_consensus(
            template_id=template_id,
            project_id=project_id,
            candidate_ids=[aid1, aid2],
        )

        assert len(articles) == 2
        assert omitted == {}
        article_ids_out = {a.article_id for a in articles}
        assert article_ids_out == {aid1, aid2}

    @pytest.mark.asyncio
    async def test_mixed_stages_only_finalized_kept(self):
        """FINALIZED kept; REVIEW + PROPOSAL → omitted with stage key."""
        svc = _make_service()
        template_id = uuid4()
        project_id = uuid4()

        aid_fin = uuid4()
        aid_rev = uuid4()
        aid_prop = uuid4()

        run_fin = _make_run(article_id=aid_fin, stage=ExtractionRunStage.FINALIZED.value)
        run_rev = _make_run(article_id=aid_rev, stage=ExtractionRunStage.REVIEW.value)
        run_prop = _make_run(article_id=aid_prop, stage=ExtractionRunStage.PROPOSAL.value)

        svc.db.execute = AsyncMock(return_value=_scalars_result([run_fin, run_rev, run_prop]))
        svc._load_instances_for_runs = AsyncMock(return_value={run_fin.id: []})
        svc._load_entity_type_role_map = AsyncMock(return_value={})
        svc._load_article_headers = AsyncMock(return_value={aid_fin: "Smith, 2020"})

        articles, omitted = await svc._resolve_articles_for_consensus(
            template_id=template_id,
            project_id=project_id,
            candidate_ids=[aid_fin, aid_rev, aid_prop],
        )

        assert len(articles) == 1
        assert articles[0].article_id == aid_fin
        assert omitted[ExtractionRunStage.REVIEW.value] == 1
        assert omitted[ExtractionRunStage.PROPOSAL.value] == 1

    @pytest.mark.asyncio
    async def test_missing_run_counted_as_no_run(self):
        """Article without a run → counted in omitted["no_run"]."""
        svc = _make_service()
        template_id = uuid4()
        project_id = uuid4()

        aid_exists = uuid4()
        aid_missing = uuid4()  # no run in DB

        run = _make_run(article_id=aid_exists, stage=ExtractionRunStage.FINALIZED.value)
        svc.db.execute = AsyncMock(return_value=_scalars_result([run]))
        svc._load_instances_for_runs = AsyncMock(return_value={run.id: []})
        svc._load_entity_type_role_map = AsyncMock(return_value={})
        svc._load_article_headers = AsyncMock(return_value={aid_exists: "Jones, 2019"})

        articles, omitted = await svc._resolve_articles_for_consensus(
            template_id=template_id,
            project_id=project_id,
            candidate_ids=[aid_exists, aid_missing],
        )

        assert len(articles) == 1
        assert omitted.get("no_run") == 1

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
        svc._load_entity_type_role_map = AsyncMock(
            return_value={
                study_entity_id: ExtractionEntityRole.STUDY_SECTION,
                model_entity_id: ExtractionEntityRole.MODEL_SECTION,
            }
        )
        svc._load_article_headers = AsyncMock(return_value={aid: "Test, 2023"})

        articles, omitted = await svc._resolve_articles_for_consensus(
            template_id=template_id,
            project_id=project_id,
            candidate_ids=[aid],
        )

        assert len(articles) == 1
        desc = articles[0]
        assert len(desc.model_instances) == 2
        assert study_entity_id in desc.study_instances
        assert omitted == {}


# ===========================================================================
# T4 — _infer_reviewer_outcome  (pure function, no mocking)
# ===========================================================================


class TestInferReviewerOutcome:
    """Parameterized tests for the module-level pure helper.

    Uses ExtractionReviewerDecision-shaped tuples (decision, proposal_id).
    """

    def test_accept_proposal_exact_match_returns_accepted(self):
        """accept_proposal decision with matching proposal_id → 'accepted'."""
        pid = uuid4()
        decisions = [("accept_proposal", pid)]
        result = _infer_reviewer_outcome(
            proposal_id=pid,
            key=(uuid4(), uuid4(), uuid4()),
            latest_id=pid,
            decisions=decisions,
        )
        assert result == "accepted"

    def test_reject_decision_returns_rejected(self):
        """reject decision present → 'rejected' (before edit check)."""
        pid = uuid4()
        decisions = [("reject", None)]
        result = _infer_reviewer_outcome(
            proposal_id=pid,
            key=(uuid4(), uuid4(), uuid4()),
            latest_id=pid,
            decisions=decisions,
        )
        assert result == "rejected"

    def test_edit_decision_returns_edited(self):
        """edit decision present (no accept/reject) → 'edited (best-effort)'."""
        pid = uuid4()
        decisions = [("edit", None)]
        result = _infer_reviewer_outcome(
            proposal_id=pid,
            key=(uuid4(), uuid4(), uuid4()),
            latest_id=pid,
            decisions=decisions,
        )
        assert result == "edited (best-effort)"

    def test_newer_proposal_exists_returns_superseded(self):
        """This proposal_id != latest_id and no decisions → 'superseded'."""
        pid = uuid4()
        latest_id = uuid4()  # different from pid
        result = _infer_reviewer_outcome(
            proposal_id=pid,
            key=(uuid4(), uuid4(), uuid4()),
            latest_id=latest_id,
            decisions=[],
        )
        assert result == "superseded"

    def test_no_decisions_returns_pending(self):
        """No decisions and this is the latest proposal → 'pending'."""
        pid = uuid4()
        result = _infer_reviewer_outcome(
            proposal_id=pid,
            key=(uuid4(), uuid4(), uuid4()),
            latest_id=pid,
            decisions=[],
        )
        assert result == "pending"

    def test_accept_proposal_wrong_pid_falls_through_to_pending(self):
        """accept_proposal for a different proposal (pid is latest) → A4 'not selected'."""
        pid = uuid4()
        other_pid = uuid4()
        decisions = [("accept_proposal", other_pid)]
        result = _infer_reviewer_outcome(
            proposal_id=pid,
            key=(uuid4(), uuid4(), uuid4()),
            latest_id=pid,  # pid is latest
            decisions=decisions,
        )
        # accept_proposal targets a different proposal; pid is latest → A4 'not selected'
        assert result == "not selected"

    def test_superseded_wins_over_reject(self):
        """A2: a non-latest proposal with a reject on the key → 'superseded', not 'rejected'.

        The old precedence returned 'rejected' for ANY reject on the key, masking
        the fact that this proposal was superseded by a newer AI proposal.
        """
        pid = uuid4()
        latest_id = uuid4()  # a newer proposal supersedes pid
        decisions = [("reject", None)]
        result = _infer_reviewer_outcome(
            proposal_id=pid,
            key=(uuid4(), uuid4(), uuid4()),
            latest_id=latest_id,
            decisions=decisions,
        )
        assert result == "superseded"

    def test_reject_gated_on_no_accept_of_other(self):
        """A2: a reject co-existing with accept_proposal of a DIFFERENT proposal
        on the same key is 'not selected', never 'rejected' (the accept-of-other
        is the real outcome; the reject must not mask it)."""
        pid = uuid4()
        other_pid = uuid4()
        decisions = [("reject", None), ("accept_proposal", other_pid)]
        result = _infer_reviewer_outcome(
            proposal_id=pid,
            key=(uuid4(), uuid4(), uuid4()),
            latest_id=pid,  # pid is the latest, so not superseded
            decisions=decisions,
        )
        assert result == "not selected"

    def test_reject_only_still_rejected(self):
        """A2 regression: a plain reject (no accept-of-other, pid is latest) is
        still 'rejected'."""
        pid = uuid4()
        decisions = [("reject", None)]
        result = _infer_reviewer_outcome(
            proposal_id=pid,
            key=(uuid4(), uuid4(), uuid4()),
            latest_id=pid,
            decisions=decisions,
        )
        assert result == "rejected"

    def test_terminal_decision_other_field_not_pending(self):
        """A4: the latest proposal with a terminal decision on the key (an
        unrelated accept that matches neither this nor flags accept-of-other,
        e.g. an accept with a null proposal_id) is 'not selected', never 'pending'."""
        pid = uuid4()
        decisions = [("accept_proposal", None)]  # touched, but no usable target
        result = _infer_reviewer_outcome(
            proposal_id=pid,
            key=(uuid4(), uuid4(), uuid4()),
            latest_id=pid,
            decisions=decisions,
        )
        assert result == "not selected"

    def test_never_reviewed_is_pending(self):
        """A4: only a key with NO decisions at all is 'pending'."""
        pid = uuid4()
        result = _infer_reviewer_outcome(
            proposal_id=pid,
            key=(uuid4(), uuid4(), uuid4()),
            latest_id=pid,
            decisions=[],
        )
        assert result == "pending"

    @pytest.mark.parametrize(
        "decisions,expected",
        [
            # accept but non-matching pid (None vs real); pid is latest, key touched →
            # A4 'not selected' (never 'pending' once a decision exists on the key).
            ([("accept_proposal", None)], "not selected"),
            ([("reject", None), ("edit", None)], "rejected"),  # reject wins over edit
            ([("edit", None), ("reject", None)], "rejected"),  # order doesn't matter for reject
        ],
    )
    def test_decision_precedence(self, decisions, expected):
        """Precedence: accepted > superseded > not-selected > rejected > edited > pending."""
        pid = uuid4()
        result = _infer_reviewer_outcome(
            proposal_id=pid,
            key=(uuid4(), uuid4(), uuid4()),
            latest_id=pid,
            decisions=decisions,
        )
        assert result == expected


# ===========================================================================
# T5 — _load_ai_proposal_rows
# ===========================================================================


class TestLoadAiProposalRows:
    """AI metadata sheet loader (FR-036 – FR-040).

    This method issues 5 separate db.execute() calls for the main path.
    We use side_effect on db.execute to return controlled results in order.

    Query order (from reading the implementation):
      1. ExtractionInstance (inst_rows) — instance meta
      2. ExtractionProposalRecord (proposal_rows) — AI proposals
      3. ExtractionEvidence (evidence_rows) — evidence
      4. ExtractionReviewerState+Decision (decision_rows) — reviewer outcomes
      5. ExtractionEntityType (ent_label_rows) — section labels
      (6. ExtractionField fallback — only when missing field ids)
    """

    def _make_article(
        self,
        run_id: UUID | None = None,
        article_id: UUID | None = None,
        model_instances: tuple[UUID, ...] = (),
        study_instances: dict | None = None,
    ) -> ArticleDescriptor:
        return ArticleDescriptor(
            article_id=article_id or uuid4(),
            header_label="Test Article",
            run_id=run_id or uuid4(),
            run_stage=ExtractionRunStage.FINALIZED,
            model_instances=model_instances,
            study_instances=study_instances or {},
        )

    @pytest.mark.asyncio
    async def test_no_run_ids_returns_empty_tuple(self):
        """Articles with no run_id → no DB calls, returns ()."""
        svc = _make_service()
        articles = (
            ArticleDescriptor(
                article_id=uuid4(),
                header_label="No Run",
                run_id=None,
                run_stage=None,
                model_instances=(),
                study_instances={},
            ),
        )
        result = await svc._load_ai_proposal_rows(
            articles=articles,
            sections=(),
            value_map={},
            mode=ExportMode.CONSENSUS,
            target_reviewer_id=None,
        )
        assert result == ()
        svc.db.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_proposals_returns_empty_tuple(self):
        """Run has no AI proposals → returns () after first two queries."""
        svc = _make_service()
        run_id = uuid4()
        article_id = uuid4()
        instance_id = uuid4()
        entity_type_id = uuid4()

        article = self._make_article(run_id=run_id, article_id=article_id)

        # Query order: inst_rows, then proposal_rows (empty) → short-circuit
        svc.db.execute = AsyncMock(
            side_effect=[
                # 1. instance meta
                _rows_result([(instance_id, entity_type_id, article_id)]),
                # 2. proposal_rows — empty
                _rows_result([]),
            ]
        )

        result = await svc._load_ai_proposal_rows(
            articles=(article,),
            sections=(),
            value_map={},
            mode=ExportMode.CONSENSUS,
            target_reviewer_id=None,
        )
        assert result == ()

    @pytest.mark.asyncio
    async def test_single_proposal_no_decisions_pending(self):
        """Single AI proposal with no reviewer decisions → outcome='pending'."""
        svc = _make_service()
        run_id = uuid4()
        article_id = uuid4()
        instance_id = uuid4()
        entity_type_id = uuid4()
        field_id = uuid4()
        proposal_id = uuid4()
        ts = datetime(2024, 1, 1, tzinfo=UTC)

        # Build section with a controlled entity_type_id so we can match it.
        section_with_id = SectionDescriptor(
            entity_type_id=entity_type_id,
            label="Demographics",
            role=ExtractionEntityRole.STUDY_SECTION,
            parent_entity_type_id=None,
            fields=(
                FieldDescriptor(
                    field_id=field_id,
                    label="Age",
                    type=ExtractionFieldType.TEXT,
                    allowed_values=(),
                    parent_section_id=entity_type_id,
                ),
            ),
        )

        article = self._make_article(
            run_id=run_id,
            article_id=article_id,
            study_instances={entity_type_id: instance_id},
        )

        # proposal row: (id, run_id, instance_id, field_id, proposed_value, confidence, rationale, created_at)
        proposal_row = (
            proposal_id,
            run_id,
            instance_id,
            field_id,
            "some_value",
            0.9,
            "Rationale",
            ts,
        )
        # evidence rows: (proposal_record_id, text_content, page_number)
        evidence_row = (proposal_id, "Evidence text", 42)
        # decision rows: empty (no reviewer decisions)
        # entity label rows: (entity_type_id, label)
        ent_label_row = (entity_type_id, "Demographics")

        svc.db.execute = AsyncMock(
            side_effect=[
                # 1. instance meta
                _rows_result([(instance_id, entity_type_id, article_id)]),
                # 2. proposal_rows
                _rows_result([proposal_row]),
                # 3. evidence_rows
                _rows_result([evidence_row]),
                # 4. decision_rows
                _rows_result([]),
                # 5. ent_label_rows
                _rows_result([ent_label_row]),
                # (no field fallback — field_id is in field_label_by_id from sections)
            ]
        )

        result = await svc._load_ai_proposal_rows(
            articles=(article,),
            sections=(section_with_id,),
            value_map={},
            mode=ExportMode.CONSENSUS,
            target_reviewer_id=None,
        )

        assert len(result) == 1
        row = result[0]
        assert row.reviewer_outcome == "pending"
        assert row.final_value_used is None
        assert row.ai_proposed_value == "some_value"
        assert row.section_label == "Demographics"
        assert row.field_label == "Age"
        assert row.evidence_text == "Evidence text"
        assert row.evidence_pages == "42"
        assert row.confidence == 0.9
        assert row.rationale == "Rationale"

    @pytest.mark.asyncio
    async def test_single_proposal_accept_decision_consensus_mode(self):
        """Accepted proposal in CONSENSUS mode → outcome='accepted', 3-tuple key for final value."""
        svc = _make_service()
        run_id = uuid4()
        article_id = uuid4()
        instance_id = uuid4()
        entity_type_id = uuid4()
        field_id = uuid4()
        proposal_id = uuid4()
        ts = datetime(2024, 2, 1, tzinfo=UTC)

        article = self._make_article(
            run_id=run_id,
            article_id=article_id,
            study_instances={entity_type_id: instance_id},
        )

        proposal_row = (
            proposal_id,
            run_id,
            instance_id,
            field_id,
            {"value": "consensus_val"},
            0.95,
            None,
            ts,
        )
        reviewer_id = uuid4()
        # decision row: (run_id, instance_id, field_id, reviewer_id, decision, proposal_record_id)
        decision_row = (run_id, instance_id, field_id, reviewer_id, "accept_proposal", proposal_id)

        # value_map uses 3-tuple for CONSENSUS mode
        value_map = {(run_id, instance_id, field_id): "consensus_val"}

        svc.db.execute = AsyncMock(
            side_effect=[
                _rows_result([(instance_id, entity_type_id, article_id)]),
                _rows_result([proposal_row]),
                _rows_result([]),  # no evidence
                _rows_result([decision_row]),
                _rows_result([(entity_type_id, "Section Label")]),
                # 6th query: field label fallback (field_id not in sections=())
                _rows_result([(field_id, "Field Label")]),
            ]
        )

        result = await svc._load_ai_proposal_rows(
            articles=(article,),
            sections=(),
            value_map=value_map,
            mode=ExportMode.CONSENSUS,
            target_reviewer_id=None,
        )

        assert len(result) == 1
        row = result[0]
        assert row.reviewer_outcome == "accepted"
        assert row.final_value_used == "consensus_val"
        assert row.ai_proposed_value == "consensus_val"  # unwrapped from {"value": ...}

    @pytest.mark.asyncio
    async def test_all_users_mode_uses_4_tuple_key_with_none(self):
        """ALL_USERS mode uses (run, instance, field, None) key for consensus sub-column.

        Regression guard for raphaelfh's fix in aa9b288: ALL_USERS was
        previously using the 3-tuple key which missed the consensus value.
        """
        svc = _make_service()
        run_id = uuid4()
        article_id = uuid4()
        instance_id = uuid4()
        entity_type_id = uuid4()
        field_id = uuid4()
        proposal_id = uuid4()
        ts = datetime(2024, 3, 1, tzinfo=UTC)

        article = self._make_article(
            run_id=run_id,
            article_id=article_id,
            study_instances={entity_type_id: instance_id},
        )

        proposal_row = (proposal_id, run_id, instance_id, field_id, "val", None, None, ts)

        # ALL_USERS value_map has 4-tuple keys (None = consensus sub-column)
        value_map_4tuple = {(run_id, instance_id, field_id, None): "consensus_for_all_users"}
        # But also the 3-tuple key should NOT be picked up in ALL_USERS mode
        value_map_4tuple[(run_id, instance_id, field_id)] = "wrong_3tuple_value"

        svc.db.execute = AsyncMock(
            side_effect=[
                _rows_result([(instance_id, entity_type_id, article_id)]),
                _rows_result([proposal_row]),
                _rows_result([]),
                _rows_result([]),
                _rows_result([(entity_type_id, "Section")]),
                # 6th: field fallback (field_id not in sections=())
                _rows_result([(field_id, "Field Label")]),
            ]
        )

        result = await svc._load_ai_proposal_rows(
            articles=(article,),
            sections=(),
            value_map=value_map_4tuple,
            mode=ExportMode.ALL_USERS,
            target_reviewer_id=None,
        )

        assert len(result) == 1
        row = result[0]
        # Must use 4-tuple key lookup (None for consensus), NOT 3-tuple
        assert row.final_value_used == "consensus_for_all_users"

    @pytest.mark.asyncio
    async def test_consensus_mode_uses_3_tuple_key(self):
        """CONSENSUS mode uses (run, instance, field) 3-tuple key for final value.

        Complement to the ALL_USERS regression test — ensures CONSENSUS
        still reads from the 3-tuple key correctly.
        """
        svc = _make_service()
        run_id = uuid4()
        article_id = uuid4()
        instance_id = uuid4()
        entity_type_id = uuid4()
        field_id = uuid4()
        proposal_id = uuid4()
        ts = datetime(2024, 3, 15, tzinfo=UTC)

        article = self._make_article(
            run_id=run_id,
            article_id=article_id,
            study_instances={entity_type_id: instance_id},
        )

        proposal_row = (proposal_id, run_id, instance_id, field_id, "pval", None, None, ts)

        # Only 3-tuple key in value_map
        value_map = {(run_id, instance_id, field_id): "3tuple_value"}

        svc.db.execute = AsyncMock(
            side_effect=[
                _rows_result([(instance_id, entity_type_id, article_id)]),
                _rows_result([proposal_row]),
                _rows_result([]),
                _rows_result([]),
                _rows_result([(entity_type_id, "Section")]),
                # 6th: field fallback (field_id not in sections=())
                _rows_result([(field_id, "Field Label")]),
            ]
        )

        result = await svc._load_ai_proposal_rows(
            articles=(article,),
            sections=(),
            value_map=value_map,
            mode=ExportMode.CONSENSUS,
            target_reviewer_id=None,
        )

        assert len(result) == 1
        assert result[0].final_value_used == "3tuple_value"

    @pytest.mark.asyncio
    async def test_unknown_section_falls_back_to_entity_label(self):
        """When entity_type is not in sections, falls back to ent_label_rows."""
        svc = _make_service()
        run_id = uuid4()
        article_id = uuid4()
        instance_id = uuid4()
        entity_type_id = uuid4()  # NOT in sections
        field_id = uuid4()
        proposal_id = uuid4()
        ts = datetime(2024, 4, 1, tzinfo=UTC)

        article = self._make_article(
            run_id=run_id,
            article_id=article_id,
            study_instances={entity_type_id: instance_id},
        )

        proposal_row = (proposal_id, run_id, instance_id, field_id, "v", None, None, ts)

        svc.db.execute = AsyncMock(
            side_effect=[
                _rows_result([(instance_id, entity_type_id, article_id)]),
                _rows_result([proposal_row]),
                _rows_result([]),
                _rows_result([]),
                # ent_label_rows provides fallback label
                _rows_result([(entity_type_id, "Fallback Section Label")]),
                # 6th: field fallback (field_id not in sections=())
                _rows_result([(field_id, "Field Label")]),
            ]
        )

        result = await svc._load_ai_proposal_rows(
            articles=(article,),
            sections=(),  # empty sections → triggers fallback
            value_map={},
            mode=ExportMode.CONSENSUS,
            target_reviewer_id=None,
        )

        assert len(result) == 1
        assert result[0].section_label == "Fallback Section Label"

    @pytest.mark.asyncio
    async def test_unknown_field_triggers_fallback_query(self):
        """Field not in sections triggers an additional DB query for field label."""
        svc = _make_service()
        run_id = uuid4()
        article_id = uuid4()
        instance_id = uuid4()
        entity_type_id = uuid4()
        field_id = uuid4()  # NOT in any section
        proposal_id = uuid4()
        ts = datetime(2024, 5, 1, tzinfo=UTC)

        article = self._make_article(
            run_id=run_id,
            article_id=article_id,
            study_instances={entity_type_id: instance_id},
        )

        proposal_row = (proposal_id, run_id, instance_id, field_id, "v", None, None, ts)

        svc.db.execute = AsyncMock(
            side_effect=[
                _rows_result([(instance_id, entity_type_id, article_id)]),
                _rows_result([proposal_row]),
                _rows_result([]),
                _rows_result([]),
                _rows_result([(entity_type_id, "Section Label")]),
                # 6th query: field label fallback
                _rows_result([(field_id, "Fallback Field Label")]),
            ]
        )

        result = await svc._load_ai_proposal_rows(
            articles=(article,),
            sections=(),
            value_map={},
            mode=ExportMode.CONSENSUS,
            target_reviewer_id=None,
        )

        assert len(result) == 1
        assert result[0].field_label == "Fallback Field Label"

    @pytest.mark.asyncio
    async def test_multi_reviewer_accept_and_reject_not_masked(self):
        """A2: two reviewers disagree on one key (A accepts THIS proposal, B
        rejects). Outcome must be 'accepted' — the reject must not mask it.

        The decision query now selects reviewer_id; we assert the loader still
        consumes ALL reviewers' decisions for consensus mode and resolves
        precedence per A2 (accept wins)."""
        svc = _make_service()
        run_id = uuid4()
        article_id = uuid4()
        instance_id = uuid4()
        entity_type_id = uuid4()
        field_id = uuid4()
        proposal_id = uuid4()
        reviewer_a = uuid4()
        reviewer_b = uuid4()
        ts = datetime(2024, 3, 1, tzinfo=UTC)

        article = self._make_article(
            run_id=run_id,
            article_id=article_id,
            study_instances={entity_type_id: instance_id},
        )
        proposal_row = (
            proposal_id,
            run_id,
            instance_id,
            field_id,
            {"value": "v"},
            0.9,
            None,
            ts,
        )
        # decision rows now carry reviewer_id:
        # (run_id, instance_id, field_id, reviewer_id, decision, proposal_record_id)
        decision_a = (run_id, instance_id, field_id, reviewer_a, "accept_proposal", proposal_id)
        decision_b = (run_id, instance_id, field_id, reviewer_b, "reject", None)

        svc.db.execute = AsyncMock(
            side_effect=[
                _rows_result([(instance_id, entity_type_id, article_id)]),
                _rows_result([proposal_row]),
                _rows_result([]),  # evidence
                _rows_result([decision_a, decision_b]),  # decisions (reviewer-tagged)
                _rows_result([(entity_type_id, "Sec")]),
                _rows_result([(field_id, "Fld")]),
            ]
        )

        result = await svc._load_ai_proposal_rows(
            articles=(article,),
            sections=(),
            value_map={(run_id, instance_id, field_id): "v"},
            mode=ExportMode.CONSENSUS,
            target_reviewer_id=None,
        )
        assert len(result) == 1
        assert result[0].reviewer_outcome == "accepted"


# ===========================================================================
# T6 — _build_all_users_value_map
# ===========================================================================


class TestBuildAllUsersValueMap:
    """4-tuple keyed value map for All-users mode (FR-015).

    Mocking strategy: svc.db.execute side_effect — first call returns
    consensus rows (ExtractionPublishedState), second call returns
    reviewer decision rows.
    """

    @pytest.mark.asyncio
    async def test_empty_run_ids_returns_empty(self):
        """No run_ids → short-circuit to empty dict."""
        svc = _make_service()
        result = await svc._build_all_users_value_map(run_ids=[], reviewer_ids=[], fields_by_id={})
        assert result == {}
        svc.db.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_consensus_only_no_reviewer_ids(self):
        """Consensus rows with no reviewer_ids → only (run, inst, field, None) keys."""
        svc = _make_service()
        run_id = uuid4()
        instance_id = uuid4()
        field_id = uuid4()

        consensus_row = (run_id, instance_id, field_id, "published_value")
        svc.db.execute = AsyncMock(return_value=_rows_result([consensus_row]))

        result = await svc._build_all_users_value_map(
            run_ids=[run_id], reviewer_ids=[], fields_by_id={}
        )

        assert result[(run_id, instance_id, field_id, None)] == "published_value"
        assert len(result) == 1
        # Should only have called execute once (consensus only, no reviewer ids)
        svc.db.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_accept_proposal_uses_proposed_value(self):
        """accept_proposal decision → uses proposed_value in 4-tuple key."""
        svc = _make_service()
        run_id = uuid4()
        instance_id = uuid4()
        field_id = uuid4()
        reviewer_id = uuid4()

        consensus_row = (run_id, instance_id, field_id, None)  # no consensus value
        # reviewer row: (run_id, instance_id, field_id, reviewer_id, decision, value, proposed_value)
        reviewer_row = (
            run_id,
            instance_id,
            field_id,
            reviewer_id,
            "accept_proposal",
            None,
            "proposed_val",
        )

        svc.db.execute = AsyncMock(
            side_effect=[
                _rows_result([consensus_row]),
                _rows_result([reviewer_row]),
            ]
        )

        result = await svc._build_all_users_value_map(
            run_ids=[run_id], reviewer_ids=[reviewer_id], fields_by_id={}
        )

        assert result[(run_id, instance_id, field_id, None)] is None
        assert result[(run_id, instance_id, field_id, reviewer_id)] == "proposed_val"

    @pytest.mark.asyncio
    async def test_edit_decision_uses_decision_value(self):
        """edit decision → uses decision.value in 4-tuple key."""
        svc = _make_service()
        run_id = uuid4()
        instance_id = uuid4()
        field_id = uuid4()
        reviewer_id = uuid4()

        reviewer_row = (
            run_id,
            instance_id,
            field_id,
            reviewer_id,
            "edit",
            {"value": "edited_val"},
            None,
        )

        svc.db.execute = AsyncMock(
            side_effect=[
                _rows_result([]),  # no consensus
                _rows_result([reviewer_row]),
            ]
        )

        result = await svc._build_all_users_value_map(
            run_ids=[run_id], reviewer_ids=[reviewer_id], fields_by_id={}
        )

        assert result[(run_id, instance_id, field_id, reviewer_id)] == "edited_val"

    @pytest.mark.asyncio
    async def test_reject_decision_absent_from_map(self):
        """reject decision → key NOT added to value map (renders blank)."""
        svc = _make_service()
        run_id = uuid4()
        instance_id = uuid4()
        field_id = uuid4()
        reviewer_id = uuid4()

        reviewer_row = (run_id, instance_id, field_id, reviewer_id, "reject", None, None)

        svc.db.execute = AsyncMock(
            side_effect=[
                _rows_result([]),
                _rows_result([reviewer_row]),
            ]
        )

        result = await svc._build_all_users_value_map(
            run_ids=[run_id], reviewer_ids=[reviewer_id], fields_by_id={}
        )

        assert (run_id, instance_id, field_id, reviewer_id) not in result

    @pytest.mark.asyncio
    async def test_consensus_and_reviewer_both_present(self):
        """Both consensus and reviewer decisions populate separate keys."""
        svc = _make_service()
        run_id = uuid4()
        instance_id = uuid4()
        field_id = uuid4()
        reviewer_id = uuid4()

        consensus_row = (run_id, instance_id, field_id, "consensus_val")
        reviewer_row = (
            run_id,
            instance_id,
            field_id,
            reviewer_id,
            "edit",
            {"value": "reviewer_val"},
            None,
        )

        svc.db.execute = AsyncMock(
            side_effect=[
                _rows_result([consensus_row]),
                _rows_result([reviewer_row]),
            ]
        )

        result = await svc._build_all_users_value_map(
            run_ids=[run_id], reviewer_ids=[reviewer_id], fields_by_id={}
        )

        assert result[(run_id, instance_id, field_id, None)] == "consensus_val"
        assert result[(run_id, instance_id, field_id, reviewer_id)] == "reviewer_val"


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
        """Non-UUID user_id → returns [] without raising."""
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
        # has_role should not have been called since UUID() raised
        member_repo.has_role.assert_not_called()

    @pytest.mark.asyncio
    async def test_non_manager_empty_reviewer_list(self, monkeypatch):
        """Non-manager when no reviewers exist → returns []."""
        user_id = uuid4()
        svc = _make_service(user_id=str(user_id))

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
# Pure helpers: _normalize_allowed_values
# ===========================================================================


class TestNormalizeAllowedValues:
    """Unit tests for the allowed_values JSONB normalizer."""

    def test_none_returns_empty_tuple(self):
        assert _normalize_allowed_values(None) == ()

    def test_plain_string_list(self):
        assert _normalize_allowed_values(["a", "b", "c"]) == ("a", "b", "c")

    def test_dict_items_with_label(self):
        raw = [{"label": "Yes", "value": "yes"}, {"label": "No", "value": "no"}]
        assert _normalize_allowed_values(raw) == ("Yes", "No")

    def test_dict_items_fallback_to_value_when_no_label(self):
        raw = [{"value": "yes"}, {"value": "no"}]
        assert _normalize_allowed_values(raw) == ("yes", "no")

    def test_dict_items_without_label_or_value_skipped(self):
        raw = [{"other": "x"}, {"value": "y"}]
        assert _normalize_allowed_values(raw) == ("y",)

    def test_nested_options_key(self):
        raw = {"options": ["a", "b"]}
        assert _normalize_allowed_values(raw) == ("a", "b")

    def test_unknown_type_returns_empty_tuple(self):
        assert _normalize_allowed_values(42) == ()

    def test_empty_list_returns_empty_tuple(self):
        assert _normalize_allowed_values([]) == ()

    def test_mixed_string_and_dict_items(self):
        raw = ["plain", {"label": "From dict"}]
        assert _normalize_allowed_values(raw) == ("plain", "From dict")


# ===========================================================================
# Pure helpers: _build_header_label
# ===========================================================================


class TestBuildHeaderLabel:
    """Unit tests for the FR-012 article header label builder."""

    def test_author_with_year_comma_format(self):
        """'Smith, John' author + year → 'Smith, 2021'."""
        result = _build_header_label("Title", ["Smith, John"], 2021, uuid4())
        assert result == "Smith, 2021"

    def test_author_with_year_space_format(self):
        """'John Smith' author (no comma) → 'Smith, 2021'."""
        result = _build_header_label("Title", ["John Smith"], 2021, uuid4())
        assert result == "Smith, 2021"

    def test_author_without_year_returns_surname(self):
        """Author with no year → just the surname."""
        result = _build_header_label("Title", ["Jones, Alice"], None, uuid4())
        assert result == "Jones"

    def test_empty_author_falls_through_to_title(self):
        """Empty author string → falls through to title[:60]."""
        result = _build_header_label("A Good Title", [""], 2020, uuid4())
        assert result == "A Good Title"

    def test_no_authors_uses_title(self):
        """No authors list → uses title[:60]."""
        result = _build_header_label("My Title", None, 2020, uuid4())
        assert result == "My Title"

    def test_title_truncated_to_60_chars(self):
        """Title longer than 60 chars is truncated."""
        long_title = "A" * 80
        result = _build_header_label(long_title, None, None, uuid4())
        assert result == "A" * 60

    def test_no_authors_no_title_uses_short_id(self):
        """No authors, no title → short UUID prefix."""
        article_id = UUID("12345678-abcd-4000-8000-000000000000")
        result = _build_header_label(None, None, None, article_id)
        assert result == "12345678"

    def test_empty_authors_list_falls_through_to_title(self):
        """Empty authors list (not None) → falls through to title."""
        result = _build_header_label("Fallback Title", [], None, uuid4())
        assert result == "Fallback Title"


# ===========================================================================
# Pure helpers: _short_id and _letter_for
# ===========================================================================


class TestShortId:
    def test_returns_first_segment_of_uuid(self):
        uid = UUID("abcdef01-1234-4000-8000-000000000000")
        assert _short_id(uid) == "abcdef01"


class TestLetterFor:
    def test_negative_returns_question_mark(self):
        assert _letter_for(-1) == "?"

    def test_zero_returns_a(self):
        assert _letter_for(0) == "A"

    def test_25_returns_z(self):
        assert _letter_for(25) == "Z"

    def test_26_returns_aa(self):
        assert _letter_for(26) == "AA"

    def test_51_returns_az(self):
        assert _letter_for(51) == "AZ"

    def test_52_returns_ba(self):
        assert _letter_for(52) == "BA"


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
            await svc._load_active_template_version(template_id)

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
            await svc._load_active_template_version(template_id)

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

        template, version = await svc._load_active_template_version(template_id)
        assert template is template_mock
        assert version is version_mock


# ===========================================================================
# Service: _load_sections
# ===========================================================================


class TestLoadSections:
    @pytest.mark.asyncio
    async def test_no_entity_types_returns_empty_tuple(self):
        """No entity types in template → returns empty tuple."""
        svc = _make_service()
        svc.db.execute = AsyncMock(return_value=_scalars_result([]))

        result = await svc._load_sections(uuid4())
        assert result == ()

    @pytest.mark.asyncio
    async def test_entity_types_with_fields_returns_sections(self):
        """Entity types + fields → SectionDescriptors with FieldDescriptors."""
        svc = _make_service()
        template_id = uuid4()

        entity_id = uuid4()
        entity = MagicMock()
        entity.id = entity_id
        entity.label = "Demographics"
        entity.role = ExtractionEntityRole.STUDY_SECTION.value
        entity.parent_entity_type_id = None

        field_id = uuid4()
        field = MagicMock()
        field.id = field_id
        field.label = "Age"
        field.field_type = ExtractionFieldType.NUMBER.value
        field.allowed_values = None
        field.entity_type_id = entity_id
        field.sort_order = 0

        svc.db.execute = AsyncMock(
            side_effect=[
                _scalars_result([entity]),
                _scalars_result([field]),
            ]
        )

        result = await svc._load_sections(template_id)

        assert len(result) == 1
        section = result[0]
        assert section.entity_type_id == entity_id
        assert section.label == "Demographics"
        assert section.role == ExtractionEntityRole.STUDY_SECTION
        assert len(section.fields) == 1
        assert section.fields[0].label == "Age"
        assert section.fields[0].type == ExtractionFieldType.NUMBER


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
# Service: _load_entity_type_role_map
# ===========================================================================


class TestLoadEntityTypeRoleMap:
    @pytest.mark.asyncio
    async def test_returns_correct_role_map(self):
        """Rows are mapped to entity_type_id → ExtractionEntityRole."""
        svc = _make_service()
        eid = uuid4()
        svc.db.execute = AsyncMock(
            return_value=_rows_result([(eid, ExtractionEntityRole.STUDY_SECTION.value)])
        )

        result = await svc._load_entity_type_role_map(uuid4())
        assert result[eid] == ExtractionEntityRole.STUDY_SECTION


# ===========================================================================
# Service: _load_article_headers
# ===========================================================================


class TestLoadArticleHeaders:
    @pytest.mark.asyncio
    async def test_empty_article_ids_returns_empty(self):
        """Empty list → no DB call, returns {}."""
        svc = _make_service()
        result = await svc._load_article_headers([])
        assert result == {}
        svc.db.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_builds_headers_from_db_rows(self):
        """DB rows → header labels built via _build_header_label."""
        svc = _make_service()
        aid = uuid4()

        svc.db.execute = AsyncMock(
            return_value=_rows_result([(aid, "A Title", ["Smith, John"], 2022)])
        )

        result = await svc._load_article_headers([aid])
        assert result[aid] == "Smith, 2022"


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
        )
        assert articles == []
        assert omitted == {}

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
        )

        assert articles == []
        assert omitted["no_run"] == len(candidate_ids)

    @pytest.mark.asyncio
    async def test_cancelled_run_omitted(self):
        """CANCELLED stage → counted in omitted['cancelled']."""
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
        )
        assert articles == []
        assert omitted.get("cancelled") == 1

    @pytest.mark.asyncio
    async def test_run_not_eligible_omitted(self):
        """Run not in eligible_run_ids → no_decisions_from_reviewer."""
        svc = _make_service()
        aid = uuid4()
        reviewer_id = uuid4()

        run = _make_run(article_id=aid, stage=ExtractionRunStage.REVIEW.value)

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
        )
        assert articles == []
        assert omitted.get("no_decisions_from_reviewer") == 1

    @pytest.mark.asyncio
    async def test_eligible_run_returns_article_descriptor(self):
        """Eligible run → article descriptor returned."""
        svc = _make_service()
        aid = uuid4()
        reviewer_id = uuid4()

        run = _make_run(article_id=aid, stage=ExtractionRunStage.REVIEW.value)

        svc.db.execute = AsyncMock(
            side_effect=[
                _scalars_result([run]),
                _rows_result([(run.id,)]),  # eligible_run_ids includes this run
            ]
        )

        svc._load_instances_for_runs = AsyncMock(return_value={run.id: []})
        svc._load_entity_type_role_map = AsyncMock(return_value={})
        svc._load_article_headers = AsyncMock(return_value={aid: "Author, 2020"})

        articles, omitted = await svc._resolve_articles_for_single_user(
            template_id=uuid4(),
            project_id=uuid4(),
            candidate_ids=[aid],
            reviewer_id=reviewer_id,
        )
        assert len(articles) == 1
        assert articles[0].article_id == aid
        assert omitted == {}


# ===========================================================================
# Service: _build_single_user_value_map
# ===========================================================================


class TestBuildSingleUserValueMap:
    """3-tuple keyed value map for single-user mode."""

    @pytest.mark.asyncio
    async def test_empty_run_ids_returns_empty(self):
        svc = _make_service()
        result = await svc._build_single_user_value_map(
            run_ids=[], reviewer_id=uuid4(), fields_by_id={}
        )
        assert result == {}
        svc.db.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_accept_proposal_uses_proposed_value(self):
        svc = _make_service()
        run_id, instance_id, field_id = uuid4(), uuid4(), uuid4()
        row = (run_id, instance_id, field_id, "accept_proposal", None, "proposed_val")
        svc.db.execute = AsyncMock(return_value=_rows_result([row]))

        result = await svc._build_single_user_value_map(
            run_ids=[run_id], reviewer_id=uuid4(), fields_by_id={}
        )
        assert result[(run_id, instance_id, field_id)] == "proposed_val"

    @pytest.mark.asyncio
    async def test_edit_decision_uses_decision_value(self):
        svc = _make_service()
        run_id, instance_id, field_id = uuid4(), uuid4(), uuid4()
        row = (run_id, instance_id, field_id, "edit", {"value": "edited"}, None)
        svc.db.execute = AsyncMock(return_value=_rows_result([row]))

        result = await svc._build_single_user_value_map(
            run_ids=[run_id], reviewer_id=uuid4(), fields_by_id={}
        )
        assert result[(run_id, instance_id, field_id)] == "edited"

    @pytest.mark.asyncio
    async def test_reject_key_absent(self):
        svc = _make_service()
        run_id, instance_id, field_id = uuid4(), uuid4(), uuid4()
        row = (run_id, instance_id, field_id, "reject", None, None)
        svc.db.execute = AsyncMock(return_value=_rows_result([row]))

        result = await svc._build_single_user_value_map(
            run_ids=[run_id], reviewer_id=uuid4(), fields_by_id={}
        )
        assert (run_id, instance_id, field_id) not in result


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
            template_id=uuid4(), project_id=uuid4(), candidate_ids=[]
        )
        assert articles == []
        assert omitted == {}

    @pytest.mark.asyncio
    async def test_cancelled_proposal_pending_omitted(self):
        """CANCELLED, PROPOSAL, PENDING → all omitted."""
        svc = _make_service()
        aid1, aid2, aid3 = uuid4(), uuid4(), uuid4()

        run1 = _make_run(article_id=aid1, stage=ExtractionRunStage.CANCELLED.value)
        run2 = _make_run(article_id=aid2, stage=ExtractionRunStage.PROPOSAL.value)
        run3 = _make_run(article_id=aid3, stage=ExtractionRunStage.PENDING.value)

        svc.db.execute = AsyncMock(return_value=_scalars_result([run1, run2, run3]))

        articles, omitted = await svc._resolve_articles_for_all_users(
            template_id=uuid4(),
            project_id=uuid4(),
            candidate_ids=[aid1, aid2, aid3],
        )
        assert articles == []
        assert omitted[ExtractionRunStage.CANCELLED.value] == 1
        assert omitted[ExtractionRunStage.PROPOSAL.value] == 1
        assert omitted[ExtractionRunStage.PENDING.value] == 1

    @pytest.mark.asyncio
    async def test_review_and_finalized_kept(self):
        """REVIEW and FINALIZED stages → kept for all-users."""
        svc = _make_service()
        aid1, aid2 = uuid4(), uuid4()

        run1 = _make_run(article_id=aid1, stage=ExtractionRunStage.REVIEW.value)
        run2 = _make_run(article_id=aid2, stage=ExtractionRunStage.FINALIZED.value)

        svc.db.execute = AsyncMock(return_value=_scalars_result([run1, run2]))
        svc._load_instances_for_runs = AsyncMock(return_value={run1.id: [], run2.id: []})
        svc._load_entity_type_role_map = AsyncMock(return_value={})
        svc._load_article_headers = AsyncMock(return_value={aid1: "A1, 2021", aid2: "A2, 2022"})

        articles, omitted = await svc._resolve_articles_for_all_users(
            template_id=uuid4(),
            project_id=uuid4(),
            candidate_ids=[aid1, aid2],
        )
        assert len(articles) == 2
        assert omitted == {}


# ===========================================================================
# Service: _list_reviewers_for_runs
# ===========================================================================


class TestListReviewersForRuns:
    """Tests for _list_reviewers_for_runs with anonymize flag."""

    @pytest.mark.asyncio
    async def test_empty_run_ids_returns_empty_tuple(self):
        svc = _make_service()
        result = await svc._list_reviewers_for_runs(run_ids=[], anonymize=False)
        assert result == ()

    @pytest.mark.asyncio
    async def test_anonymize_false_returns_named_reviewers(self):
        """anonymize=False → reviewers sorted by name."""
        svc = _make_service()
        rid1, rid2 = uuid4(), uuid4()
        svc.db.execute = AsyncMock(
            return_value=_rows_result(
                [
                    (rid1, "Charlie", None),
                    (rid2, "Alice", None),
                ]
            )
        )

        result = await svc._list_reviewers_for_runs(run_ids=[uuid4()], anonymize=False)

        assert len(result) == 2
        assert result[0].display_label == "Alice"
        assert result[1].display_label == "Charlie"

    @pytest.mark.asyncio
    async def test_anonymize_true_returns_letter_labels(self):
        """anonymize=True → reviewers labeled Reviewer A, B, etc."""
        svc = _make_service()
        rid1 = uuid4()
        rid2 = uuid4()
        svc.db.execute = AsyncMock(
            return_value=_rows_result(
                [
                    (rid1, "Alice", None),
                    (rid2, "Bob", None),
                ]
            )
        )

        result = await svc._list_reviewers_for_runs(run_ids=[uuid4()], anonymize=True)

        assert len(result) == 2
        labels = {r.display_label for r in result}
        assert "Reviewer A" in labels
        assert "Reviewer B" in labels

    @pytest.mark.asyncio
    async def test_email_fallback_when_no_name(self):
        """No name → email used as display label."""
        svc = _make_service()
        rid = uuid4()
        svc.db.execute = AsyncMock(return_value=_rows_result([(rid, None, "r@example.com")]))

        result = await svc._list_reviewers_for_runs(run_ids=[uuid4()], anonymize=False)
        assert result[0].display_label == "r@example.com"


# ===========================================================================
# Service: _load_ai_proposal_rows — model_instances index coverage
# ===========================================================================


class TestAiProposalRowsModelInstances:
    """Tests for the model_instances indexing path in _load_ai_proposal_rows."""

    @pytest.mark.asyncio
    async def test_model_instance_index_assigned_correctly(self):
        """model_instances are indexed 1-based in instance_index_by_id."""
        svc = _make_service()
        run_id = uuid4()
        article_id = uuid4()
        entity_type_id = uuid4()
        model_instance_id1 = uuid4()
        model_instance_id2 = uuid4()
        field_id = uuid4()
        proposal_id = uuid4()
        ts = datetime(2024, 6, 1, tzinfo=UTC)

        # Article with 2 model_instances
        article = ArticleDescriptor(
            article_id=article_id,
            header_label="Test Article",
            run_id=run_id,
            run_stage=ExtractionRunStage.FINALIZED,
            model_instances=(model_instance_id1, model_instance_id2),
            study_instances={},
        )

        proposal_row = (proposal_id, run_id, model_instance_id1, field_id, "v", None, None, ts)

        svc.db.execute = AsyncMock(
            side_effect=[
                # inst_rows: instance_id, entity_type_id, article_id
                _rows_result([(model_instance_id1, entity_type_id, article_id)]),
                _rows_result([proposal_row]),
                _rows_result([]),
                _rows_result([]),
                _rows_result([(entity_type_id, "Model Section")]),
                _rows_result([(field_id, "Field")]),  # field fallback
            ]
        )

        result = await svc._load_ai_proposal_rows(
            articles=(article,),
            sections=(),
            value_map={},
            mode=ExportMode.CONSENSUS,
            target_reviewer_id=None,
        )

        assert len(result) == 1
        # model_instance_id1 is first → instance_index = 1
        assert result[0].instance_index == 1
