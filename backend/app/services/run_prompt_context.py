"""Resolve — and pin — the two run-constant texts every prompt is prefixed with.

One resolver, not two fetches. ``general_instructions_for_version`` was already
hoisted as run-constant but called at four prompt sites; adding a parallel
review-context fetch beside each would double them and let the two drift. Each
site now makes ONE call and gets both.

**The pin is written here.** The review question has no equivalent of the
version snapshot that anchors the template instruction, and
``ai_extraction``'s single-section path resolves once per LLM CALL,
not once per run — so without a run-scoped pin, two sections extracted ten
minutes apart could legitimately see different PICOT, and a Celery retry would
re-read whatever the project says now. First-writer-wins gives the run one
answer; putting the write in the resolver means an absent pin (every run that
predates this change) is built, pinned and used on its next call rather than
stranded at ``None`` for the weeks the one-live-run invariant keeps it alive.

**No ``repin``.** ``freeze_engine`` may overwrite because per-proposal
provenance (0056) records the engine on every row, so re-pinning cannot relabel
what a previous engine wrote. Nothing records the review context per proposal,
so an overwrite would make the run-level field misdescribe sections extracted
under the previous text — the unattributable claim the pin exists to prevent
(§IX). A manager who edits PICOT mid-run starts a new run.
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun
from app.models.project import Project
from app.repositories import ExtractionRunRepository
from app.schemas.run_prompt_context import ReviewQuestionPin, RunPromptContext
from app.services.extraction_snapshot import general_instructions_for_version
from app.services.project_ai_context import build_review_question

#: Annotated so it satisfies ``freeze_provenance_key``'s Literal — that
#: parameter is narrow on purpose (it writes into the dict holding the engine
#: pin and the per-section map), and a bare ``str`` constant would defeat it.
_PIN_KEY: Literal["review_context"] = "review_context"


def read_pinned_review_question(results: dict[str, Any] | None) -> ReviewQuestionPin | None:
    """The run's pinned review question, or ``None`` — a pure READ.

    ``None`` means no LLM call has run on this run yet, which is a different
    fact from a pin whose ``text`` is ``None`` (resolved, and the review says
    nothing). Read-only on purpose: the run-view service serves this, and a
    read path must never take the row lock or install a pin.
    """
    pinned = ((results or {}).get("provenance") or {}).get(_PIN_KEY)
    if isinstance(pinned, dict) and pinned:
        return ReviewQuestionPin.model_validate(pinned)
    return None


async def current_protocol_revision(db: AsyncSession, project_id: UUID) -> int | None:
    """The project's ``protocol_revision`` now, or ``None`` when the row is gone.

    Callers pass the run's own ``project_id``, never a caller-supplied one.
    """
    stmt = select(Project.protocol_revision).where(Project.id == project_id)
    return (await db.execute(stmt)).scalar_one_or_none()


def review_question_drift(
    pin: ReviewQuestionPin | None, current_revision: int | None
) -> bool | None:
    """Whether the project's protocol moved since the run pinned its question.

    ``None`` when nothing is pinned yet. A legacy pin (no revision) or an
    unknown current revision never reports drift: there is nothing to compare.
    """
    if pin is None:
        return None
    if pin.revision is None or current_revision is None:
        return False
    return pin.revision != current_revision


def pinned_question_drift(
    results: dict[str, Any] | None, current_revision: int | None
) -> bool | None:
    """:func:`review_question_drift` for a run's raw ``results``."""
    return review_question_drift(read_pinned_review_question(results), current_revision)


async def resolve_run_prompt_context(db: AsyncSession, run: ExtractionRun) -> RunPromptContext:
    """Both run-constant prompt texts, pinning the review context on first use.

    Scope comes from ``run.project_id`` — never a caller-supplied project id —
    so the context can only ever be the run's own project's.

    Runs in the CALLER's transaction, alongside ``freeze_run_engine``: the row
    lock the two share is re-entrant within one transaction and would deadlock
    across two.
    """
    pinned = read_pinned_review_question(run.results)
    if pinned is None:
        question = await build_review_question(db, run.project_id)
        stored = await ExtractionRunRepository(db).freeze_provenance_key(
            run.id,
            _PIN_KEY,
            ReviewQuestionPin(
                text=question.text if question else None,
                revision=question.revision if question else None,
            ).model_dump(),
        )
        pinned = ReviewQuestionPin.model_validate(stored) if stored else ReviewQuestionPin()
    return RunPromptContext(
        review_question=pinned.text,
        general_instructions=await general_instructions_for_version(db, run.version_id),
    )
