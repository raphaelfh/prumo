"""Title/abstract screening: config, enrollment, queue, decisions and arbitration. snake_case on the wire."""

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

ScreeningDecisionValue = Literal["include", "exclude", "maybe"]
ScreeningOutcomeKind = Literal["solo", "consensus", "arbitrated"]
ScreeningCallerStatus = Literal["awaiting_me", "awaiting_others", "conflict", "decided"]

MAX_ENROLL_ARTICLES = 10_000


class ScreeningConfigRead(BaseModel):
    """Screening setup of a project plus the caller's roles in it."""

    reviewer_count: int | None
    reviewer_count_locked: bool
    reviewer_capable: int
    enrolled: int
    not_enrolled: int
    can_manage: bool
    can_review: bool
    can_arbitrate: bool


class ScreeningConfigUpdate(BaseModel):
    """Reviewers per record (1 to 3)."""

    model_config = ConfigDict(extra="forbid")

    reviewer_count: int = Field(ge=1, le=3)


class ScreeningEnrollRequest(BaseModel):
    """Articles to enroll; omit ``article_ids`` to enroll every article of the project."""

    model_config = ConfigDict(extra="forbid")

    article_ids: list[UUID] | None = Field(
        default=None, min_length=1, max_length=MAX_ENROLL_ARTICLES
    )


class ScreeningEnrollResult(BaseModel):
    enrolled: int
    already_enrolled: int


class ScreeningArticle(BaseModel):
    """The bibliographic record a reviewer screens."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    abstract: str | None
    authors: list[str] | None
    journal_title: str | None
    publication_year: int | None
    pmid: str | None
    doi: str | None


class ScreeningQueueItem(BaseModel):
    assignment_id: UUID
    article: ScreeningArticle


class ScreeningQueueRead(BaseModel):
    """The caller's next records to screen, with the counts around them."""

    items: list[ScreeningQueueItem]
    awaiting_me: int
    awaiting_others: int
    exclusion_reasons: list[str]


class ScreeningDecisionCreate(BaseModel):
    """One reviewer decision; an exclusion reason only on ``exclude``."""

    model_config = ConfigDict(extra="forbid")

    decision: ScreeningDecisionValue
    exclusion_reason: str | None = Field(None, max_length=1000)
    rationale: str | None = Field(None, max_length=2000)

    @model_validator(mode="after")
    def _reason_only_on_exclude(self) -> Self:
        if self.exclusion_reason is not None and self.decision != "exclude":
            raise ValueError("exclusion_reason is only allowed when decision is 'exclude'")
        return self


class ScreeningDecisionRead(BaseModel):
    id: UUID
    decision: ScreeningDecisionValue
    exclusion_reason: str | None
    rationale: str | None
    created_at: datetime


class PeerDecisionRead(ScreeningDecisionRead):
    """Another reviewer's current decision, shown only once the review is unblinded."""

    reviewer_id: UUID
    reviewer_name: str | None


class ScreeningOutcomeRead(BaseModel):
    kind: ScreeningOutcomeKind
    decision: ScreeningDecisionValue
    exclusion_reason: str | None
    reasons_differ: bool


class ScreeningAssignmentRead(BaseModel):
    """One record as the caller may see it: peers stay hidden until there is an outcome."""

    id: UUID
    project_id: UUID
    article: ScreeningArticle
    status: ScreeningCallerStatus
    my_decision: ScreeningDecisionRead | None
    outcome: ScreeningOutcomeRead | None
    peer_decisions: list[PeerDecisionRead]
    exclusion_reasons: list[str]


class ScreeningConflictItem(BaseModel):
    """One unruled conflict with every reviewer's current decision."""

    assignment_id: UUID
    article: ScreeningArticle
    decisions: list[PeerDecisionRead]


class ScreeningConflictsRead(BaseModel):
    """The project's unruled conflicts, and the protocol reasons an override may cite."""

    items: list[ScreeningConflictItem]
    exclusion_reasons: list[str]


class ScreeningArbitrationCreate(BaseModel):
    """A ruling on the decisions the arbitrator saw: select one of them, or override.

    A new ruling is always a new row; the latest one stands.
    """

    model_config = ConfigDict(extra="forbid")

    ruled_on_decision_ids: list[UUID] = Field(min_length=1, max_length=3)
    selected_decision_id: UUID | None = None
    decision: ScreeningDecisionValue | None = None
    exclusion_reason: str | None = Field(None, max_length=1000)
    rationale: str | None = Field(None, max_length=2000)

    @model_validator(mode="after")
    def _select_or_override(self) -> Self:
        if (self.selected_decision_id is None) == (self.decision is None):
            raise ValueError("Give exactly one of selected_decision_id or decision")
        if (
            self.selected_decision_id is not None
            and self.selected_decision_id not in self.ruled_on_decision_ids
        ):
            raise ValueError("selected_decision_id must be one of ruled_on_decision_ids")
        if self.exclusion_reason is not None and self.decision != "exclude":
            raise ValueError("exclusion_reason is only allowed when decision is 'exclude'")
        return self


class ScreeningAssignmentRef(BaseModel):
    """An assignment resolved by id: what the guard hands to the route."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    article_id: UUID
