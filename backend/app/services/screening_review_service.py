"""Blind title/abstract review: the records, one record, decisions and rulings.

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

from app.models.screening import (
    FULL_TEXT,
    TITLE_ABSTRACT,
    ScreeningArbitration,
    ScreeningDecision,
)
from app.repositories.project_repository import ProjectRepository
from app.repositories.screening_repository import RecordSource, ScreeningRepository
from app.schemas.common import ApiErrorCode
from app.schemas.screening import (
    PeerDecisionRead,
    ScreeningArbitrationCreate,
    ScreeningArticle,
    ScreeningAssignmentRead,
    ScreeningAssignmentRef,
    ScreeningDecisionCreate,
    ScreeningDecisionRead,
    ScreeningOutcomeRead,
    ScreeningPhase,
    ScreeningRecordRow,
    ScreeningRecordsRead,
)
from app.services.profile_names import profile_names
from app.services.project_ai_context import load_exclusion_reasons, load_inclusion_criteria
from app.services.screening_errors import ScreeningSelfArbitrationError, ScreeningStateError
from app.services.screening_outcome import (
    AssignmentState,
    CurrentDecision,
    CurrentRuling,
    Outcome,
    caller_status,
    derive_state,
    record_status,
    reveals_peers,
)
from app.services.screening_settings import ScreeningRoles, reviewer_count_of, screening_roles


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
    phase: ScreeningPhase,
    reviewer_count: int | None,
    assignment_ids: Sequence[UUID] | None = None,
) -> dict[UUID, AssignmentSnapshot]:
    """The derived state of the project's live ``phase`` assignments (or the given subset).

    Three queries for any scope. A moved or deleted article's assignment is
    absent; an unconfigured project (``reviewer_count is None``) reads as
    pending everywhere.
    """
    repo = ScreeningRepository(db)
    live = await repo.live_assignment_ids(
        project_id=project_id, phase=phase, assignment_ids=assignment_ids
    )
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
            else derive_state(
                reviewer_count, current, ruling, reasons_must_match=phase == FULL_TEXT
            )
        )
        snapshots[assignment_id] = AssignmentSnapshot(assignment_id, current, ruling, state)
    return snapshots


async def full_text_candidates(
    db: AsyncSession, *, project_id: UUID, ta_reviewer_count: int | None
) -> list[UUID]:
    """Article ids whose TA outcome is include or maybe and that have no FT assignment, in TA queue order."""
    if ta_reviewer_count is None:
        return []
    repo = ScreeningRepository(db)
    snapshots = await assignment_states(
        db, project_id=project_id, phase=TITLE_ABSTRACT, reviewer_count=ta_reviewer_count
    )
    sendable = [
        assignment_id
        for assignment_id, snapshot in snapshots.items()
        if snapshot.state.outcome is not None
        and snapshot.state.outcome.decision in ("include", "maybe")
    ]
    if not sendable:
        return []
    sent = await repo.assigned_article_ids(project_id=project_id, phase=FULL_TEXT)
    queue = await repo.assignments_with_articles(
        project_id=project_id, phase=TITLE_ABSTRACT, assignment_ids=sendable
    )
    return [article.id for _, article in queue if article.id not in sent]


def _check_decision_for_phase(
    phase: ScreeningPhase, decision: str, exclusion_reason: str | None
) -> None:
    """A decision the phase accepts: no ``not_retrieved`` at title/abstract, no ``maybe`` at full text."""
    if (phase == TITLE_ABSTRACT and decision == "not_retrieved") or (
        phase == FULL_TEXT and decision == "maybe"
    ):
        raise ScreeningStateError(
            ApiErrorCode.SCREENING_DECISION_NOT_IN_PHASE,
            "This decision is not available in this screening phase.",
        )
    if phase == FULL_TEXT and decision == "exclude" and exclusion_reason is None:
        raise ScreeningStateError(
            ApiErrorCode.SCREENING_REASON_REQUIRED, "Pick an exclusion reason."
        )


def _phase_advanced() -> ScreeningStateError:
    return ScreeningStateError(
        ApiErrorCode.SCREENING_PHASE_ADVANCED, "This article is already in full-text screening."
    )


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


def _record_row(
    rank: int,
    source: RecordSource,
    snapshot: AssignmentSnapshot | None,
    viewer_id: UUID,
    roles: ScreeningRoles,
    ta: tuple[Outcome | None, int | None] | None = None,
) -> ScreeningRecordRow:
    """One records-list row; nothing of another reviewer leaves here but the outcome.

    ``ta`` is a full-text row's title/abstract (outcome, reviewer count), else ``None``.
    """
    mine = (
        next((d for d in snapshot.decisions if d.reviewer_id == viewer_id), None)
        if snapshot is not None
        else None
    )
    outcome = snapshot.state.outcome if snapshot is not None else None
    ta_outcome, ta_reviewer_count = ta if ta is not None else (None, None)
    return ScreeningRecordRow(
        article_id=source.article_id,
        assignment_id=source.assignment_id if snapshot is not None else None,
        queue_rank=rank,
        title=source.title,
        first_author=source.authors[0] if source.authors else None,
        publication_year=source.publication_year,
        journal_title=source.journal_title,
        pmid=source.pmid,
        doi=source.doi,
        ingestion_source=source.ingestion_source,
        has_pdf=source.has_pdf,
        status=(
            "not_enrolled"
            if snapshot is None
            else record_status(
                snapshot.state,
                seated=snapshot.seats(viewer_id),
                is_arbitrator=roles.can_arbitrate,
                can_review=roles.can_review,
            )
        ),
        my_decision=mine.decision if mine is not None else None,
        my_exclusion_reason=mine.exclusion_reason if mine is not None else None,
        outcome=outcome.decision if outcome is not None else None,
        outcome_exclusion_reason=outcome.exclusion_reason if outcome is not None else None,
        outcome_kind=outcome.kind if outcome is not None else None,
        ta_outcome=ta_outcome.decision if ta_outcome is not None else None,
        ta_outcome_kind=ta_outcome.kind if ta_outcome is not None else None,
        ta_reviewer_count=ta_reviewer_count,
    )


class ScreeningReviewService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.projects = ProjectRepository(db)
        self.screening = ScreeningRepository(db)

    async def _reviewer_count(self, project_id: UUID, phase: ScreeningPhase) -> int | None:
        project = await self.projects.get_by_id(project_id)
        return reviewer_count_of(project.settings if project else None, phase)

    async def records(
        self, project_id: UUID, viewer_id: UUID, phase: ScreeningPhase
    ) -> ScreeningRecordsRead:
        """Every article of the project in ``phase``, in queue order, as ``viewer_id`` may see it."""
        reviewer_count = await self._reviewer_count(project_id, phase)
        if reviewer_count is None:
            raise _not_configured()
        snapshots = await assignment_states(
            self.db, project_id=project_id, phase=phase, reviewer_count=reviewer_count
        )
        roles = await screening_roles(self.db, project_id, viewer_id)
        sources = await self.screening.record_rows(project_id=project_id, phase=phase)
        ta_count, ta_outcomes = (
            await self._title_abstract_outcomes(project_id) if phase == FULL_TEXT else (None, None)
        )
        return ScreeningRecordsRead(
            phase=phase,
            reviewer_count=reviewer_count,
            inclusion_criteria=await load_inclusion_criteria(self.db, project_id),
            exclusion_reasons=await load_exclusion_reasons(self.db, project_id),
            rows=[
                _record_row(
                    rank,
                    source,
                    snapshots.get(source.assignment_id) if source.assignment_id else None,
                    viewer_id,
                    roles,
                    None if ta_outcomes is None else (ta_outcomes.get(source.article_id), ta_count),
                )
                for rank, source in enumerate(sources)
            ],
        )

    async def _title_abstract_outcomes(
        self, project_id: UUID
    ) -> tuple[int | None, dict[UUID, Outcome | None]]:
        """The title/abstract reviewer count and each article's outcome there."""
        count = await self._reviewer_count(project_id, TITLE_ABSTRACT)
        if count is None:
            return None, {}
        snapshots = await assignment_states(
            self.db, project_id=project_id, phase=TITLE_ABSTRACT, reviewer_count=count
        )
        by_article = await self.screening.live_assignment_ids_by_article(
            project_id=project_id, phase=TITLE_ABSTRACT
        )
        return count, {
            article_id: snapshots[assignment_id].state.outcome
            for article_id, assignment_id in by_article.items()
        }

    async def get_assignment(self, assignment_id: UUID, viewer_id: UUID) -> ScreeningAssignmentRead:
        ref = await get_assignment_ref(self.db, assignment_id)
        reviewer_count = await self._reviewer_count(ref.project_id, ref.phase)
        return await self._read(ref, viewer_id, reviewer_count)

    async def decide(
        self, assignment_id: UUID, reviewer_id: UUID, body: ScreeningDecisionCreate
    ) -> ScreeningAssignmentRead:
        ref = await get_assignment_ref(self.db, assignment_id)
        reviewer_count = reviewer_count_of(
            await self.projects.settings_for_share(ref.project_id), ref.phase
        )
        if reviewer_count is None:
            raise _not_configured()
        _check_decision_for_phase(ref.phase, body.decision, body.exclusion_reason)
        await self.screening.lock_assignment(assignment_id)
        snapshot = (
            await assignment_states(
                self.db,
                project_id=ref.project_id,
                phase=ref.phase,
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
        # Post-lock snapshot: a solo reviewer re-decides until a ruling lands (§6.3).
        re_deciding = snapshot.seats(reviewer_id)
        # Race-free only because the project row is held FOR SHARE (settings_for_share,
        # first read above) until commit, and a full-text send takes it FOR UPDATE.
        if (
            re_deciding
            and reviewer_count == 1
            and ref.phase == TITLE_ABSTRACT
            and await self._sent_to_full_text(ref)
        ):
            raise _phase_advanced()
        if re_deciding and (reviewer_count != 1 or snapshot.ruling is not None):
            raise ScreeningStateError(
                ApiErrorCode.SCREENING_DECISION_FINAL, "You already decided on this record."
            )
        if not re_deciding and len(snapshot.decisions) >= reviewer_count:
            raise ScreeningStateError(
                ApiErrorCode.SCREENING_REVIEWER_CAP, "This record already has all its reviewers."
            )
        await self.screening.add_decision(
            assignment_id, reviewer_id, body.decision, body.exclusion_reason, body.rationale
        )
        return await self._read(ref, reviewer_id, reviewer_count)

    async def arbitrate(
        self, assignment_id: UUID, arbitrator_id: UUID, body: ScreeningArbitrationCreate
    ) -> ScreeningAssignmentRead:
        """Append a ruling on exactly the current decisions; a re-ruling is a new row.

        Never by a seated arbitrator: a reviewer does not resolve their own record.
        """
        ref = await get_assignment_ref(self.db, assignment_id)
        reviewer_count = reviewer_count_of(
            await self.projects.settings_for_share(ref.project_id), ref.phase
        )
        if reviewer_count is None:
            raise _not_configured()
        await self.screening.lock_assignment(assignment_id)
        snapshot = (
            await assignment_states(
                self.db,
                project_id=ref.project_id,
                phase=ref.phase,
                reviewer_count=reviewer_count,
                assignment_ids=[assignment_id],
            )
        ).get(assignment_id)
        if snapshot is None:
            raise AssignmentNotFoundError
        # Same lock dependency as ``decide``: the share lock orders this against a send.
        if ref.phase == TITLE_ABSTRACT and await self._sent_to_full_text(ref):
            raise _phase_advanced()
        ruled_on = await owned_decisions(
            self.db, assignment_id=assignment_id, decision_ids=body.ruled_on_decision_ids
        )
        if snapshot.seats(arbitrator_id):
            raise ScreeningSelfArbitrationError
        outcome = snapshot.state.outcome
        pdf_found_later = (
            ref.phase == FULL_TEXT and outcome is not None and outcome.decision == "not_retrieved"
        )
        if (
            snapshot.state.phase != "conflict"
            and not pdf_found_later
            and (outcome is None or outcome.kind != "arbitrated")
        ):
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
            _check_decision_for_phase(ref.phase, decision, reason)
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

    async def _sent_to_full_text(self, ref: ScreeningAssignmentRef) -> bool:
        return await self.screening.has_assignment(
            project_id=ref.project_id, phase=FULL_TEXT, article_id=ref.article_id
        )

    async def _read(
        self, ref: ScreeningAssignmentRef, viewer_id: UUID, reviewer_count: int | None
    ) -> ScreeningAssignmentRead:
        """One record as ``viewer_id`` may see it; peers only when ``reveals_peers``."""
        project_id, assignment_id = ref.project_id, ref.id
        snapshot = (
            await assignment_states(
                self.db,
                project_id=project_id,
                phase=ref.phase,
                reviewer_count=reviewer_count,
                assignment_ids=[assignment_id],
            )
        ).get(assignment_id)
        articles = await self.screening.assignments_with_articles(
            project_id=project_id, phase=ref.phase, assignment_ids=[assignment_id]
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
