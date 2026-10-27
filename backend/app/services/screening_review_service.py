"""Blind title/abstract review: the queue, one record, decisions, conflicts and rulings.

``assignment_states`` is THE one place that loads and derives assignment state;
the review, arbitration and PRISMA reads all call it. Another reviewer's
decision leaves this module only when ``reveals_peers`` allows it.

Lock order is always project row (``FOR SHARE``) then assignment row
(``FOR NO KEY UPDATE``): the share lock makes a reviewer-count change wait for
an in-flight decision, the assignment lock serializes decisions on one record
so the reviewer cap holds and a ruling sees the decisions it rules on.

``owned_decisions`` is THE decision-in-assignment guard: a ruling's decision
ids reach the database only through it.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.screening import ScreeningArbitration, ScreeningDecision
from app.repositories.project_repository import ProjectRepository
from app.repositories.screening_repository import ScreeningRepository
from app.schemas.common import ApiErrorCode
from app.schemas.screening import (
    PeerDecisionRead,
    ScreeningArbitrationCreate,
    ScreeningArticle,
    ScreeningAssignmentRead,
    ScreeningAssignmentRef,
    ScreeningConflictItem,
    ScreeningConflictsRead,
    ScreeningDecisionCreate,
    ScreeningDecisionRead,
    ScreeningOutcomeRead,
    ScreeningQueueItem,
    ScreeningQueueRead,
)
from app.services.profile_names import profile_names
from app.services.project_ai_context import load_exclusion_reasons
from app.services.screening_config_service import reviewer_count_of, screening_roles
from app.services.screening_errors import ScreeningSelfArbitrationError, ScreeningStateError
from app.services.screening_outcome import (
    AssignmentState,
    CurrentDecision,
    CurrentRuling,
    caller_status,
    derive_state,
    reveals_peers,
)


class AssignmentNotFoundError(Exception):
    """The assignment is missing, or its article was deleted or moved out of the project."""


class DecisionNotFoundError(Exception):
    """A decision id is missing or belongs to another assignment (one error for both)."""


async def owned_decisions(
    db: AsyncSession, *, assignment_id: UUID, decision_ids: Sequence[UUID]
) -> list[ScreeningDecision]:
    """THE decision-in-assignment guard: the decisions, deduplicated, in input order.

    Only when every id belongs to ``assignment_id`` (bound by the caller's
    guard); a missing and a foreign id raise the same error.
    """
    wanted = list(dict.fromkeys(decision_ids))
    rows = await ScreeningRepository(db).decisions_in_assignment(assignment_id, wanted)
    by_id = {row.id: row for row in rows}
    if len(by_id) != len(wanted):
        raise DecisionNotFoundError("Decision not found")
    return [by_id[decision_id] for decision_id in wanted]


async def get_assignment_ref(db: AsyncSession, assignment_id: UUID) -> ScreeningAssignmentRef:
    """The by-id guard's lookup (``api/deps/scope.load_assignment_for_member``)."""
    row = await ScreeningRepository(db).get_assignment(assignment_id)
    if row is None:
        raise AssignmentNotFoundError
    return ScreeningAssignmentRef.model_validate(row, from_attributes=True)


@dataclass(frozen=True, slots=True)
class AssignmentSnapshot:
    assignment_id: UUID
    decisions: tuple[CurrentDecision, ...]
    ruling: CurrentRuling | None
    state: AssignmentState

    def seats(self, reviewer_id: UUID) -> bool:
        """THE seat rule: ``reviewer_id`` has a decision on this record."""
        return any(d.reviewer_id == reviewer_id for d in self.decisions)


_UNCONFIGURED = AssignmentState("pending", None)


def _current_decision(row: ScreeningDecision) -> CurrentDecision:
    return CurrentDecision(
        id=row.id,
        reviewer_id=row.reviewer_id,
        decision=row.decision,  # type: ignore[arg-type]  # CHECK-constrained text
        exclusion_reason=row.exclusion_reason,
        created_at=row.created_at,
        rationale=row.rationale,
    )


def _current_ruling(row: ScreeningArbitration) -> CurrentRuling:
    return CurrentRuling(
        id=row.id,
        decision=row.decision,  # type: ignore[arg-type]  # CHECK-constrained text
        exclusion_reason=row.exclusion_reason,
        created_at=row.created_at,
    )


async def assignment_states(
    db: AsyncSession,
    *,
    project_id: UUID,
    reviewer_count: int | None,
    assignment_ids: Sequence[UUID] | None = None,
) -> dict[UUID, AssignmentSnapshot]:
    """The derived state of the project's live assignments (or the given subset).

    Three queries for any scope. A moved or deleted article's assignment is
    absent; an unconfigured project (``reviewer_count is None``) reads as
    pending everywhere.
    """
    repo = ScreeningRepository(db)
    live = await repo.live_assignment_ids(project_id=project_id, assignment_ids=assignment_ids)
    decisions = await repo.current_decisions(project_id=project_id, assignment_ids=assignment_ids)
    rulings = await repo.latest_rulings(project_id=project_id, assignment_ids=assignment_ids)
    grouped: dict[UUID, list[CurrentDecision]] = defaultdict(list)
    for row in decisions:
        grouped[row.assignment_id].append(_current_decision(row))
    snapshots: dict[UUID, AssignmentSnapshot] = {}
    for assignment_id in live:
        current = tuple(sorted(grouped.get(assignment_id, ()), key=lambda d: (d.created_at, d.id)))
        ruling_row = rulings.get(assignment_id)
        ruling = _current_ruling(ruling_row) if ruling_row is not None else None
        state = (
            _UNCONFIGURED
            if reviewer_count is None
            else derive_state(reviewer_count, current, ruling)
        )
        snapshots[assignment_id] = AssignmentSnapshot(assignment_id, current, ruling, state)
    return snapshots


def _not_configured() -> ScreeningStateError:
    return ScreeningStateError(
        ApiErrorCode.SCREENING_NOT_CONFIGURED, "Screening is not set up for this project."
    )


def _decision_read(decision: CurrentDecision) -> ScreeningDecisionRead:
    return ScreeningDecisionRead(
        id=decision.id,
        decision=decision.decision,
        exclusion_reason=decision.exclusion_reason,
        rationale=decision.rationale,
        created_at=decision.created_at,
    )


def _peer_read(decision: CurrentDecision, names: dict[UUID, str | None]) -> PeerDecisionRead:
    return PeerDecisionRead(
        **_decision_read(decision).model_dump(),
        reviewer_id=decision.reviewer_id,
        reviewer_name=names.get(decision.reviewer_id),
    )


class ScreeningReviewService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.projects = ProjectRepository(db)
        self.screening = ScreeningRepository(db)

    async def _reviewer_count(self, project_id: UUID) -> int | None:
        project = await self.projects.get_by_id(project_id)
        return reviewer_count_of(project.settings if project else None)

    async def queue(self, project_id: UUID, reviewer_id: UUID) -> ScreeningQueueRead:
        reviewer_count = await self._reviewer_count(project_id)
        if reviewer_count is None:
            raise _not_configured()
        page = await self.screening.queue_page(
            project_id=project_id, reviewer_id=reviewer_id, reviewer_count=reviewer_count
        )
        awaiting_me = await self.screening.count_awaiting_me(
            project_id=project_id, reviewer_id=reviewer_id, reviewer_count=reviewer_count
        )
        snapshots = await assignment_states(
            self.db, project_id=project_id, reviewer_count=reviewer_count
        )
        awaiting_others = sum(
            1
            for snapshot in snapshots.values()
            if snapshot.state.outcome is None and snapshot.seats(reviewer_id)
        )
        return ScreeningQueueRead(
            items=[
                ScreeningQueueItem(
                    assignment_id=assignment_id,
                    article=ScreeningArticle.model_validate(article, from_attributes=True),
                )
                for assignment_id, article in page
            ],
            awaiting_me=awaiting_me,
            awaiting_others=awaiting_others,
            exclusion_reasons=await load_exclusion_reasons(self.db, project_id),
        )

    async def get_assignment(self, assignment_id: UUID, viewer_id: UUID) -> ScreeningAssignmentRead:
        ref = await get_assignment_ref(self.db, assignment_id)
        reviewer_count = await self._reviewer_count(ref.project_id)
        return await self._read(ref.project_id, assignment_id, viewer_id, reviewer_count)

    async def decide(
        self, assignment_id: UUID, reviewer_id: UUID, body: ScreeningDecisionCreate
    ) -> ScreeningAssignmentRead:
        ref = await get_assignment_ref(self.db, assignment_id)
        reviewer_count = reviewer_count_of(await self.projects.settings_for_share(ref.project_id))
        if reviewer_count is None:
            raise _not_configured()
        await self.screening.lock_assignment(assignment_id)
        snapshot = (
            await assignment_states(
                self.db,
                project_id=ref.project_id,
                reviewer_count=reviewer_count,
                assignment_ids=[assignment_id],
            )
        ).get(assignment_id)
        if snapshot is None:
            raise AssignmentNotFoundError
        if body.exclusion_reason is not None and body.exclusion_reason not in (
            await load_exclusion_reasons(self.db, ref.project_id)
        ):
            raise ScreeningStateError(
                ApiErrorCode.SCREENING_UNKNOWN_EXCLUSION_REASON,
                "The protocol's exclusion reasons changed. Reload and pick again.",
            )
        if snapshot.seats(reviewer_id):
            raise ScreeningStateError(
                ApiErrorCode.SCREENING_DECISION_FINAL, "You already decided on this record."
            )
        if len(snapshot.decisions) >= reviewer_count:
            raise ScreeningStateError(
                ApiErrorCode.SCREENING_REVIEWER_CAP, "This record already has all its reviewers."
            )
        await self.screening.add_decision(
            assignment_id, reviewer_id, body.decision, body.exclusion_reason, body.rationale
        )
        return await self._read(ref.project_id, assignment_id, reviewer_id, reviewer_count)

    async def conflicts(self, project_id: UUID, viewer_id: UUID) -> ScreeningConflictsRead:
        """Unruled conflicts in queue order, each with every reviewer's current decision.

        Records the caller reviewed are excluded: a reviewer never arbitrates
        their own record.
        """
        reviewer_count = await self._reviewer_count(project_id)
        roles = await screening_roles(self.db, project_id, viewer_id)
        snapshots = await assignment_states(
            self.db, project_id=project_id, reviewer_count=reviewer_count
        )
        in_conflict = {
            assignment_id: snapshot
            for assignment_id, snapshot in snapshots.items()
            if snapshot.state.phase == "conflict"
            and reveals_peers(
                snapshot.state,
                seated=snapshot.seats(viewer_id),
                is_arbitrator=roles.can_arbitrate,
            )
        }
        items: list[ScreeningConflictItem] = []
        if in_conflict:
            articles = await self.screening.assignments_with_articles(
                project_id=project_id, assignment_ids=list(in_conflict)
            )
            names = await profile_names(
                self.db, {d.reviewer_id for s in in_conflict.values() for d in s.decisions}
            )
            items = [
                ScreeningConflictItem(
                    assignment_id=assignment_id,
                    article=ScreeningArticle.model_validate(article, from_attributes=True),
                    decisions=[_peer_read(d, names) for d in in_conflict[assignment_id].decisions],
                )
                for assignment_id, article in articles
            ]
        return ScreeningConflictsRead(
            items=items, exclusion_reasons=await load_exclusion_reasons(self.db, project_id)
        )

    async def arbitrate(
        self, assignment_id: UUID, arbitrator_id: UUID, body: ScreeningArbitrationCreate
    ) -> ScreeningAssignmentRead:
        """Append a ruling on exactly the current decisions; a re-ruling is a new row.

        Never by a seated arbitrator: a reviewer does not resolve their own record.
        """
        ref = await get_assignment_ref(self.db, assignment_id)
        reviewer_count = reviewer_count_of(await self.projects.settings_for_share(ref.project_id))
        if reviewer_count is None:
            raise _not_configured()
        await self.screening.lock_assignment(assignment_id)
        snapshot = (
            await assignment_states(
                self.db,
                project_id=ref.project_id,
                reviewer_count=reviewer_count,
                assignment_ids=[assignment_id],
            )
        ).get(assignment_id)
        if snapshot is None:
            raise AssignmentNotFoundError
        ruled_on = await owned_decisions(
            self.db, assignment_id=assignment_id, decision_ids=body.ruled_on_decision_ids
        )
        if snapshot.seats(arbitrator_id):
            raise ScreeningSelfArbitrationError
        outcome = snapshot.state.outcome
        if snapshot.state.phase != "conflict" and (outcome is None or outcome.kind != "arbitrated"):
            raise ScreeningStateError(
                ApiErrorCode.SCREENING_NOT_IN_CONFLICT, "This record is not in conflict."
            )
        if set(body.ruled_on_decision_ids) != {d.id for d in snapshot.decisions}:
            raise ScreeningStateError(
                ApiErrorCode.SCREENING_STALE_DECISIONS,
                "The decisions changed since you opened this conflict. Reload it.",
            )
        if body.selected_decision_id is not None:
            selected = next(d for d in ruled_on if d.id == body.selected_decision_id)
            decision, reason = selected.decision, selected.exclusion_reason
        else:
            assert body.decision is not None  # the schema requires one of the two
            decision, reason = body.decision, body.exclusion_reason
            if reason is not None and reason not in (
                await load_exclusion_reasons(self.db, ref.project_id)
            ):
                raise ScreeningStateError(
                    ApiErrorCode.SCREENING_UNKNOWN_EXCLUSION_REASON,
                    "The protocol's exclusion reasons changed. Reload and pick again.",
                )
        await self.screening.add_arbitration(
            assignment_id,
            decision,
            reason,
            body.selected_decision_id,
            body.rationale,
            decided_by=arbitrator_id,
        )
        return await self.get_assignment(assignment_id, arbitrator_id)

    async def _read(
        self, project_id: UUID, assignment_id: UUID, viewer_id: UUID, reviewer_count: int | None
    ) -> ScreeningAssignmentRead:
        """One record as ``viewer_id`` may see it; peers only when ``reveals_peers``."""
        snapshot = (
            await assignment_states(
                self.db,
                project_id=project_id,
                reviewer_count=reviewer_count,
                assignment_ids=[assignment_id],
            )
        ).get(assignment_id)
        articles = await self.screening.assignments_with_articles(
            project_id=project_id, assignment_ids=[assignment_id]
        )
        if snapshot is None or not articles:
            raise AssignmentNotFoundError
        roles = await screening_roles(self.db, project_id, viewer_id)
        state = snapshot.state
        mine = next((d for d in snapshot.decisions if d.reviewer_id == viewer_id), None)
        seated = mine is not None  # the seat rule: a decision on this record
        peers = (
            [d for d in snapshot.decisions if d.reviewer_id != viewer_id]
            if reveals_peers(state, seated=seated, is_arbitrator=roles.can_arbitrate)
            else []
        )
        names = await profile_names(self.db, {d.reviewer_id for d in peers}) if peers else {}
        outcome = state.outcome
        return ScreeningAssignmentRead(
            id=assignment_id,
            project_id=project_id,
            article=ScreeningArticle.model_validate(articles[0][1], from_attributes=True),
            status=caller_status(
                state,
                seated=seated,
                is_arbitrator=roles.can_arbitrate,
                can_review=roles.can_review,
            ),
            my_decision=_decision_read(mine) if mine is not None else None,
            outcome=(
                ScreeningOutcomeRead(
                    kind=outcome.kind,
                    decision=outcome.decision,
                    exclusion_reason=outcome.exclusion_reason,
                    reasons_differ=outcome.reasons_differ,
                )
                if outcome is not None
                else None
            ),
            peer_decisions=[_peer_read(d, names) for d in peers],
            exclusion_reasons=await load_exclusion_reasons(self.db, project_id),
        )
