"""Resolve — and pin — the two run-constant texts every prompt is prefixed with.

One resolver, not two fetches. ``general_instructions_for_version`` was already
hoisted as run-constant but called at four prompt sites; adding a parallel
review-context fetch beside each would double them and let the two drift. Each
site now makes ONE call and gets both.

**The pin is written here.** The review question has no equivalent of the
version snapshot that anchors the template instruction, and
``section_extraction_service``'s single-section path resolves once per LLM CALL,
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

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun
from app.repositories import ExtractionRunRepository
from app.schemas.run_prompt_context import ReviewContextPin, RunPromptContext
from app.services.extraction_snapshot import general_instructions_for_version
from app.services.project_ai_context import build_review_context

#: Annotated so it satisfies ``freeze_provenance_key``'s Literal — that
#: parameter is narrow on purpose (it writes into the dict holding the engine
#: pin and the per-section map), and a bare ``str`` constant would defeat it.
_PIN_KEY: Literal["review_context"] = "review_context"


def read_pinned_review_context(results: dict[str, Any] | None) -> ReviewContextPin | None:
    """The run's pinned review context, or ``None`` — a pure READ.

    ``None`` means no LLM call has run on this run yet, which is a different
    fact from a pin whose ``text`` is ``None`` (resolved, and the review says
    nothing). Read-only on purpose: the run-view service serves this, and a
    read path must never take the row lock or install a pin.
    """
    pinned = ((results or {}).get("provenance") or {}).get(_PIN_KEY)
    if isinstance(pinned, dict) and pinned:
        return ReviewContextPin.model_validate(pinned)
    return None


async def resolve_run_prompt_context(db: AsyncSession, run: ExtractionRun) -> RunPromptContext:
    """Both run-constant prompt texts, pinning the review context on first use.

    Scope comes from ``run.project_id`` — never a caller-supplied project id —
    so the context can only ever be the run's own project's.

    Runs in the CALLER's transaction, alongside ``freeze_run_engine``: the row
    lock the two share is re-entrant within one transaction and would deadlock
    across two.
    """
    pinned = read_pinned_review_context(run.results)
    if pinned is None:
        stored = await ExtractionRunRepository(db).freeze_provenance_key(
            run.id,
            _PIN_KEY,
            ReviewContextPin(text=await build_review_context(db, run.project_id)).model_dump(),
        )
        pinned = ReviewContextPin.model_validate(stored) if stored else ReviewContextPin()
    return RunPromptContext(
        review_context=pinned.text,
        general_instructions=await general_instructions_for_version(db, run.version_id),
    )
