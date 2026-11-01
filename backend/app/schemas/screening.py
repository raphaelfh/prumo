"""Title/abstract and full-text screening: config, enrollment, records, decisions and arbitration. snake_case on the wire."""

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

ScreeningDecisionValue = Literal["include", "exclude", "maybe", "not_retrieved"]
ScreeningOutcomeKind = Literal["solo", "consensus", "arbitrated"]
ScreeningCallerStatus = Literal["awaiting_me", "awaiting_others", "conflict", "decided"]
ScreeningPhase = Literal["title_abstract"]
# Task 5 folds this into ScreeningPhase.
AssignmentPhase = Literal["title_abstract", "full_text"]
ScreeningRecordStatus = Literal[
    "not_enrolled", "to_screen", "waiting", "in_review", "conflict", "included", "excluded", "maybe"
]

MAX_ENROLL_ARTICLES = 10_000


class ScreeningConfigRead(BaseModel):
    """Screening setup of a project plus the caller's roles in it."""

    reviewer_count: int | None
    reviewer_count_locked: bool
    full_text_reviewer_count: int | None  # None = title/abstract only
    full_text_count_locked: bool  # a full-text assignment exists
    full_text_ready: int  # include/maybe outcomes not yet sent to full text
    full_text_enrolled: int
    reviewer_capable: int
    enrolled: int
    not_enrolled: int
    can_manage: bool
    can_review: bool
    can_arbitrate: bool
    exclusion_reasons: list[str]


class ScreeningConfigUpdate(BaseModel):
    """Reviewers per record (1 to 3) per phase; ``full_text_reviewer_count`` absent = unchanged, null = off."""

    model_config = ConfigDict(extra="forbid")

    reviewer_count: int = Field(ge=1, le=3)
    full_text_reviewer_count: int | None = Field(default=None, ge=1, le=3)


class ScreeningEnrollRequest(BaseModel):
    """Articles to enroll; omit ``article_ids`` to enroll every article of the project.

    ``full_text`` sends the include/maybe outcomes of title/abstract and takes no ids.
    """

    model_config = ConfigDict(extra="forbid")

    phase: AssignmentPhase = "title_abstract"
    article_ids: list[UUID] | None = Field(
        default=None, min_length=1, max_length=MAX_ENROLL_ARTICLES
    )

    @model_validator(mode="after")
    def _full_text_derives_its_ids(self) -> Self:
        if self.phase == "full_text" and self.article_ids is not None:
            raise ValueError("article_ids is not accepted when sending records to full text")
        return self


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


class ScreeningRecordRow(BaseModel):
    """One project article in a screening phase as the caller may see it.

    No abstract: the panel reads the assignment. ``assignment_id`` is ``None``
    when the article is not enrolled; the ``outcome*`` fields are set only once
    the record has an outcome.
    """

    article_id: UUID
    assignment_id: UUID | None
    queue_rank: int
    title: str
    first_author: str | None
    publication_year: int | None
    journal_title: str | None
    pmid: str | None
    doi: str | None
    ingestion_source: str | None
    has_pdf: bool
    status: ScreeningRecordStatus
    my_decision: ScreeningDecisionValue | None
    my_exclusion_reason: str | None
    outcome: ScreeningDecisionValue | None
    outcome_exclusion_reason: str | None
    outcome_kind: ScreeningOutcomeKind | None


class ScreeningRecordsRead(BaseModel):
    """Every article of the project in one phase, in queue order, with the protocol criteria."""

    phase: ScreeningPhase
    reviewer_count: int
    inclusion_criteria: list[str]
    exclusion_reasons: list[str]
    rows: list[ScreeningRecordRow]


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
    phase: AssignmentPhase
