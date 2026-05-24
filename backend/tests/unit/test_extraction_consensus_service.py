"""Unit tests for ``ExtractionConsensusService``.

The integration twin (``tests/integration/test_extraction_consensus_service.py``)
exercises the same surface against a real Postgres, but those tests silently
``pytest.skip(...)`` when the DB has stale state — exactly the case CI was
hitting when the critical-path coverage snapshot put this module at 34%.
These mock-driven tests anchor the coverage in unit territory so a single
flake in the DB seed can no longer drag the gate below the floor.

Mocking strategy:

- Patch the three module-level imports (``load_run_for_update``,
  ``assert_coords_coherent``, ``ExtractionProposalRepository``) at the
  ``app.services.extraction_consensus_service`` namespace, since the service
  calls them through that path.
- Replace ``service._consensus`` / ``service._published`` /
  ``service._decisions`` directly on the instance after construction so the
  repository constructors are not invoked at all.
- ``db`` is a sentinel ``AsyncMock`` — the service never queries it directly;
  every DB op flows through one of the four mocked collaborators.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest

from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionConsensusMode,
    ExtractionReviewerDecisionType,
)
from app.services.coordinate_coherence import CoordinateMismatchError
from app.services.extraction_consensus_service import (
    ExtractionConsensusService,
    InvalidConsensusError,
    OptimisticConcurrencyError,
)


# =================== HELPERS ===================


def _make_service() -> ExtractionConsensusService:
    """Construct a service with all collaborators replaced by AsyncMocks."""
    service = ExtractionConsensusService(db=AsyncMock())
    service._consensus = AsyncMock()
    service._published = AsyncMock()
    service._decisions = AsyncMock()
    return service


def _make_run(stage: str = ExtractionRunStage.CONSENSUS.value) -> SimpleNamespace:
    """Build a stand-in for an ``ExtractionRun`` ORM instance."""
    return SimpleNamespace(stage=stage)


def _make_decision(
    *,
    decision_id: UUID | None = None,
    instance_id: UUID,
    field_id: UUID,
    decision: str = ExtractionReviewerDecisionType.EDIT.value,
    value: dict | None = None,
    proposal_record_id: UUID | None = None,
) -> SimpleNamespace:
    """Build a stand-in for an ``ExtractionReviewerDecision``."""
    return SimpleNamespace(
        id=decision_id or uuid4(),
        instance_id=instance_id,
        field_id=field_id,
        decision=decision,
        value=value,
        proposal_record_id=proposal_record_id,
    )


def _make_published(version: int = 1) -> SimpleNamespace:
    """Build a stand-in for an ``ExtractionPublishedState``."""
    return SimpleNamespace(
        version=version,
        published_at=None,
    )


def _patch_helpers(
    *,
    run: SimpleNamespace | None,
    coords_raises: type[Exception] | None = None,
    proposal: SimpleNamespace | None = None,
):
    """Context-manager bundle for the three module-level patches.

    Returns a tuple of patches to enter with ``contextlib.ExitStack`` — but the
    tests below only ever need one composition, so we expose a single helper
    instead. ``coords_raises`` is the exception *class* to raise (defaults to
    no raise); ``proposal`` is what ``ExtractionProposalRepository(...).get``
    will resolve to (defaults to None, i.e. proposal not found).
    """
    mod = "app.services.extraction_consensus_service"

    load_patch = patch(f"{mod}.load_run_for_update", new=AsyncMock(return_value=run))
    if coords_raises is None:
        coherent_patch = patch(f"{mod}.assert_coords_coherent", new=AsyncMock(return_value=None))
    else:
        coherent_patch = patch(
            f"{mod}.assert_coords_coherent",
            new=AsyncMock(side_effect=coords_raises("incoherent")),
        )
    proposal_repo = MagicMock()
    proposal_repo.get = AsyncMock(return_value=proposal)
    repo_class = MagicMock(return_value=proposal_repo)
    repo_patch = patch(f"{mod}.ExtractionProposalRepository", new=repo_class)
    return load_patch, coherent_patch, repo_patch


# =================== record_consensus: stage + coord guards ===================


@pytest.mark.asyncio
async def test_record_consensus_raises_when_run_not_found() -> None:
    service = _make_service()
    load_p, coh_p, repo_p = _patch_helpers(run=None)
    with load_p, coh_p, repo_p, pytest.raises(InvalidConsensusError, match="not found"):
        await service.record_consensus(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            consensus_user_id=uuid4(),
            mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
            value={"v": "x"},
            rationale="r",
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "stage",
    [
        ExtractionRunStage.PENDING.value,
        ExtractionRunStage.PROPOSAL.value,
        ExtractionRunStage.REVIEW.value,
        ExtractionRunStage.FINALIZED.value,
    ],
    ids=["pending", "proposal", "review", "finalized"],
)
async def test_record_consensus_rejects_non_consensus_stage(stage: str) -> None:
    service = _make_service()
    load_p, coh_p, repo_p = _patch_helpers(run=_make_run(stage=stage))
    with (
        load_p,
        coh_p,
        repo_p,
        pytest.raises(InvalidConsensusError, match="not 'consensus'"),
    ):
        await service.record_consensus(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            consensus_user_id=uuid4(),
            mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
            value={"v": "x"},
            rationale="r",
        )


@pytest.mark.asyncio
async def test_record_consensus_propagates_coordinate_mismatch() -> None:
    """``assert_coords_coherent`` raises; the service does not swallow it."""
    service = _make_service()
    load_p, coh_p, repo_p = _patch_helpers(
        run=_make_run(),
        coords_raises=CoordinateMismatchError,
    )
    with load_p, coh_p, repo_p, pytest.raises(CoordinateMismatchError):
        await service.record_consensus(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            consensus_user_id=uuid4(),
            mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
            value={"v": "x"},
            rationale="r",
        )


# =================== record_consensus: mode validation ===================


@pytest.mark.asyncio
async def test_select_existing_requires_decision_id() -> None:
    service = _make_service()
    load_p, coh_p, repo_p = _patch_helpers(run=_make_run())
    with (
        load_p,
        coh_p,
        repo_p,
        pytest.raises(InvalidConsensusError, match="requires selected_decision_id"),
    ):
        await service.record_consensus(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            consensus_user_id=uuid4(),
            mode=ExtractionConsensusMode.SELECT_EXISTING,
            selected_decision_id=None,
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("value", "rationale"),
    [(None, "r"), ({"v": "x"}, None), (None, None)],
    ids=["missing-value", "missing-rationale", "both-missing"],
)
async def test_manual_override_requires_value_and_rationale(
    value: dict | None,
    rationale: str | None,
) -> None:
    service = _make_service()
    load_p, coh_p, repo_p = _patch_helpers(run=_make_run())
    with (
        load_p,
        coh_p,
        repo_p,
        pytest.raises(InvalidConsensusError, match="requires both value and rationale"),
    ):
        await service.record_consensus(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            consensus_user_id=uuid4(),
            mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
            value=value,
            rationale=rationale,
        )


# =================== record_consensus: select_existing resolution ===================


@pytest.mark.asyncio
async def test_select_existing_rejects_decision_not_in_run() -> None:
    service = _make_service()
    service._decisions.list_by_run.return_value = []  # no matching decision
    load_p, coh_p, repo_p = _patch_helpers(run=_make_run())
    with load_p, coh_p, repo_p, pytest.raises(InvalidConsensusError, match="not in run"):
        await service.record_consensus(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            consensus_user_id=uuid4(),
            mode=ExtractionConsensusMode.SELECT_EXISTING,
            selected_decision_id=uuid4(),
        )


@pytest.mark.asyncio
async def test_select_existing_rejects_cross_coordinate_decision() -> None:
    """Decision targets a different (instance, field) than the consensus call."""
    service = _make_service()
    instance_id = uuid4()
    field_id = uuid4()
    other_instance = uuid4()
    decision_id = uuid4()
    service._decisions.list_by_run.return_value = [
        _make_decision(
            decision_id=decision_id,
            instance_id=other_instance,
            field_id=field_id,
        )
    ]
    load_p, coh_p, repo_p = _patch_helpers(run=_make_run())
    with load_p, coh_p, repo_p, pytest.raises(InvalidConsensusError, match="belongs to"):
        await service.record_consensus(
            run_id=uuid4(),
            instance_id=instance_id,
            field_id=field_id,
            consensus_user_id=uuid4(),
            mode=ExtractionConsensusMode.SELECT_EXISTING,
            selected_decision_id=decision_id,
        )


@pytest.mark.asyncio
async def test_select_existing_rejects_reject_decision() -> None:
    """REJECT carries no publishable value — must redirect to manual_override."""
    service = _make_service()
    instance_id = uuid4()
    field_id = uuid4()
    decision_id = uuid4()
    service._decisions.list_by_run.return_value = [
        _make_decision(
            decision_id=decision_id,
            instance_id=instance_id,
            field_id=field_id,
            decision=ExtractionReviewerDecisionType.REJECT.value,
        )
    ]
    load_p, coh_p, repo_p = _patch_helpers(run=_make_run())
    with load_p, coh_p, repo_p, pytest.raises(InvalidConsensusError, match="reject"):
        await service.record_consensus(
            run_id=uuid4(),
            instance_id=instance_id,
            field_id=field_id,
            consensus_user_id=uuid4(),
            mode=ExtractionConsensusMode.SELECT_EXISTING,
            selected_decision_id=decision_id,
        )


@pytest.mark.asyncio
async def test_select_existing_publishes_decision_value() -> None:
    """Happy path: decision has a value (EDIT decision); publish it as-is."""
    service = _make_service()
    instance_id = uuid4()
    field_id = uuid4()
    decision_id = uuid4()
    expected = {"v": "edited"}
    service._decisions.list_by_run.return_value = [
        _make_decision(
            decision_id=decision_id,
            instance_id=instance_id,
            field_id=field_id,
            value=expected,
        )
    ]
    service._published.insert_first_if_absent.return_value = _make_published(version=1)
    load_p, coh_p, repo_p = _patch_helpers(run=_make_run())
    with load_p, coh_p, repo_p:
        consensus, published = await service.record_consensus(
            run_id=uuid4(),
            instance_id=instance_id,
            field_id=field_id,
            consensus_user_id=uuid4(),
            mode=ExtractionConsensusMode.SELECT_EXISTING,
            selected_decision_id=decision_id,
        )
    assert consensus.mode == "select_existing"
    assert published.version == 1
    service._published.insert_first_if_absent.assert_awaited_once()
    _, kwargs = service._published.insert_first_if_absent.call_args
    assert kwargs["value"] == expected


@pytest.mark.asyncio
async def test_select_existing_falls_back_to_proposal_value() -> None:
    """Decision has no value (ACCEPT_PROPOSAL); resolve via proposal_record_id."""
    service = _make_service()
    run_id = uuid4()
    instance_id = uuid4()
    field_id = uuid4()
    decision_id = uuid4()
    proposal_id = uuid4()
    service._decisions.list_by_run.return_value = [
        _make_decision(
            decision_id=decision_id,
            instance_id=instance_id,
            field_id=field_id,
            decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL.value,
            value=None,
            proposal_record_id=proposal_id,
        )
    ]
    service._published.insert_first_if_absent.return_value = _make_published(version=1)
    proposal = SimpleNamespace(run_id=run_id, proposed_value={"v": "proposed"})
    load_p, coh_p, repo_p = _patch_helpers(run=_make_run(), proposal=proposal)
    with load_p, coh_p, repo_p:
        _, published = await service.record_consensus(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            consensus_user_id=uuid4(),
            mode=ExtractionConsensusMode.SELECT_EXISTING,
            selected_decision_id=decision_id,
        )
    assert published.version == 1
    _, kwargs = service._published.insert_first_if_absent.call_args
    assert kwargs["value"] == {"v": "proposed"}


@pytest.mark.asyncio
async def test_select_existing_rejects_missing_proposal() -> None:
    """proposal_record_id points at a row that doesn't exist."""
    service = _make_service()
    instance_id = uuid4()
    field_id = uuid4()
    decision_id = uuid4()
    service._decisions.list_by_run.return_value = [
        _make_decision(
            decision_id=decision_id,
            instance_id=instance_id,
            field_id=field_id,
            decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL.value,
            value=None,
            proposal_record_id=uuid4(),
        )
    ]
    load_p, coh_p, repo_p = _patch_helpers(run=_make_run(), proposal=None)
    with load_p, coh_p, repo_p, pytest.raises(InvalidConsensusError, match="not found in run"):
        await service.record_consensus(
            run_id=uuid4(),
            instance_id=instance_id,
            field_id=field_id,
            consensus_user_id=uuid4(),
            mode=ExtractionConsensusMode.SELECT_EXISTING,
            selected_decision_id=decision_id,
        )


@pytest.mark.asyncio
async def test_select_existing_rejects_proposal_from_other_run() -> None:
    """The proposal exists but belongs to a different run — coord guard."""
    service = _make_service()
    run_id = uuid4()
    instance_id = uuid4()
    field_id = uuid4()
    decision_id = uuid4()
    service._decisions.list_by_run.return_value = [
        _make_decision(
            decision_id=decision_id,
            instance_id=instance_id,
            field_id=field_id,
            decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL.value,
            value=None,
            proposal_record_id=uuid4(),
        )
    ]
    other_run = uuid4()
    foreign_proposal = SimpleNamespace(run_id=other_run, proposed_value={"v": "x"})
    load_p, coh_p, repo_p = _patch_helpers(run=_make_run(), proposal=foreign_proposal)
    with load_p, coh_p, repo_p, pytest.raises(InvalidConsensusError, match="not found in run"):
        await service.record_consensus(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            consensus_user_id=uuid4(),
            mode=ExtractionConsensusMode.SELECT_EXISTING,
            selected_decision_id=decision_id,
        )


@pytest.mark.asyncio
async def test_select_existing_rejects_empty_resolved_value() -> None:
    """Decision has empty value and no proposal_record_id — never publish ``{}``."""
    service = _make_service()
    instance_id = uuid4()
    field_id = uuid4()
    decision_id = uuid4()
    service._decisions.list_by_run.return_value = [
        _make_decision(
            decision_id=decision_id,
            instance_id=instance_id,
            field_id=field_id,
            decision=ExtractionReviewerDecisionType.EDIT.value,
            value={},  # empty dict — falsy
            proposal_record_id=None,
        )
    ]
    load_p, coh_p, repo_p = _patch_helpers(run=_make_run())
    with load_p, coh_p, repo_p, pytest.raises(InvalidConsensusError, match="empty value"):
        await service.record_consensus(
            run_id=uuid4(),
            instance_id=instance_id,
            field_id=field_id,
            consensus_user_id=uuid4(),
            mode=ExtractionConsensusMode.SELECT_EXISTING,
            selected_decision_id=decision_id,
        )


# =================== record_consensus: manual_override happy path ===================


@pytest.mark.asyncio
async def test_manual_override_publishes_provided_value() -> None:
    service = _make_service()
    service._published.insert_first_if_absent.return_value = _make_published(version=1)
    load_p, coh_p, repo_p = _patch_helpers(run=_make_run())
    value = {"v": "manual"}
    with load_p, coh_p, repo_p:
        consensus, published = await service.record_consensus(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            consensus_user_id=uuid4(),
            mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
            value=value,
            rationale="reviewer override",
        )
    assert consensus.mode == "manual_override"
    assert consensus.rationale == "reviewer override"
    assert published.version == 1
    service._published.insert_first_if_absent.assert_awaited_once()
    _, kwargs = service._published.insert_first_if_absent.call_args
    assert kwargs["value"] == value


@pytest.mark.asyncio
async def test_string_mode_is_accepted() -> None:
    """``mode`` may be passed as a raw string (no enum needed)."""
    service = _make_service()
    service._published.insert_first_if_absent.return_value = _make_published(version=1)
    load_p, coh_p, repo_p = _patch_helpers(run=_make_run())
    with load_p, coh_p, repo_p:
        consensus, _ = await service.record_consensus(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            consensus_user_id=uuid4(),
            mode="manual_override",
            value={"v": "raw"},
            rationale="r",
        )
    assert consensus.mode == "manual_override"


# =================== _publish_internal branches (via record_consensus) ===================


@pytest.mark.asyncio
async def test_publish_internal_falls_through_to_update_on_conflict() -> None:
    """First INSERT conflicts; the path UPDATEs and returns the new state."""
    service = _make_service()
    service._published.insert_first_if_absent.return_value = None  # conflict
    existing = _make_published(version=3)
    latest = _make_published(version=4)
    service._published.get = AsyncMock(side_effect=[existing, latest])
    service._published.update_with_optimistic_lock.return_value = 1
    load_p, coh_p, repo_p = _patch_helpers(run=_make_run())
    with load_p, coh_p, repo_p:
        _, published = await service.record_consensus(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            consensus_user_id=uuid4(),
            mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
            value={"v": "x"},
            rationale="r",
        )
    assert published.version == 4
    # Optimistic lock used the existing version.
    _, kwargs = service._published.update_with_optimistic_lock.call_args
    assert kwargs["expected_version"] == 3


@pytest.mark.asyncio
async def test_publish_internal_raises_when_post_conflict_row_missing() -> None:
    """ON CONFLICT happened but the row is then not visible (very rare race)."""
    service = _make_service()
    service._published.insert_first_if_absent.return_value = None
    service._published.get = AsyncMock(return_value=None)
    load_p, coh_p, repo_p = _patch_helpers(run=_make_run())
    with load_p, coh_p, repo_p, pytest.raises(OptimisticConcurrencyError, match="not visible"):
        await service.record_consensus(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            consensus_user_id=uuid4(),
            mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
            value={"v": "x"},
            rationale="r",
        )


@pytest.mark.asyncio
async def test_publish_internal_raises_when_update_rowcount_zero() -> None:
    """A concurrent writer bumped the version between our READ and our UPDATE."""
    service = _make_service()
    service._published.insert_first_if_absent.return_value = None
    service._published.get = AsyncMock(return_value=_make_published(version=2))
    service._published.update_with_optimistic_lock.return_value = 0
    load_p, coh_p, repo_p = _patch_helpers(run=_make_run())
    with (
        load_p,
        coh_p,
        repo_p,
        pytest.raises(OptimisticConcurrencyError, match="changed during consensus write"),
    ):
        await service.record_consensus(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            consensus_user_id=uuid4(),
            mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
            value={"v": "x"},
            rationale="r",
        )


@pytest.mark.asyncio
async def test_publish_internal_raises_when_post_update_row_vanishes() -> None:
    """UPDATE succeeded but a subsequent fetch finds nothing — should never happen."""
    service = _make_service()
    service._published.insert_first_if_absent.return_value = None
    service._published.get = AsyncMock(side_effect=[_make_published(version=1), None])
    service._published.update_with_optimistic_lock.return_value = 1
    load_p, coh_p, repo_p = _patch_helpers(run=_make_run())
    with load_p, coh_p, repo_p, pytest.raises(RuntimeError, match="vanished"):
        await service.record_consensus(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            consensus_user_id=uuid4(),
            mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
            value={"v": "x"},
            rationale="r",
        )


# =================== publish() method (explicit, optimistic-version path) ===================


@pytest.mark.asyncio
async def test_publish_raises_when_run_not_found() -> None:
    service = _make_service()
    load_p, _, _ = _patch_helpers(run=None)
    with load_p, pytest.raises(InvalidConsensusError, match="not found"):
        await service.publish(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            value={"v": "x"},
            published_by=uuid4(),
            expected_version=1,
        )


@pytest.mark.asyncio
async def test_publish_raises_when_run_not_in_consensus() -> None:
    service = _make_service()
    load_p, _, _ = _patch_helpers(run=_make_run(stage=ExtractionRunStage.REVIEW.value))
    with load_p, pytest.raises(InvalidConsensusError, match="not 'consensus'"):
        await service.publish(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            value={"v": "x"},
            published_by=uuid4(),
            expected_version=1,
        )


@pytest.mark.asyncio
async def test_publish_raises_optimistic_concurrency_when_version_mismatch() -> None:
    service = _make_service()
    service._published.update_with_optimistic_lock.return_value = 0
    load_p, _, _ = _patch_helpers(run=_make_run())
    with (
        load_p,
        pytest.raises(OptimisticConcurrencyError, match="did not match current state"),
    ):
        await service.publish(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            value={"v": "x"},
            published_by=uuid4(),
            expected_version=99,
        )


@pytest.mark.asyncio
async def test_publish_returns_existing_after_successful_update() -> None:
    service = _make_service()
    service._published.update_with_optimistic_lock.return_value = 1
    state = _make_published(version=2)
    service._published.get = AsyncMock(return_value=state)
    load_p, _, _ = _patch_helpers(run=_make_run())
    with load_p:
        result = await service.publish(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            value={"v": "x"},
            published_by=uuid4(),
            expected_version=1,
        )
    assert result is state


@pytest.mark.asyncio
async def test_publish_raises_when_row_vanishes_after_update() -> None:
    """Successful UPDATE then the SELECT returns nothing — should never happen."""
    service = _make_service()
    service._published.update_with_optimistic_lock.return_value = 1
    service._published.get = AsyncMock(return_value=None)
    load_p, _, _ = _patch_helpers(run=_make_run())
    with load_p, pytest.raises(RuntimeError, match="vanished"):
        await service.publish(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            value={"v": "x"},
            published_by=uuid4(),
            expected_version=1,
        )
