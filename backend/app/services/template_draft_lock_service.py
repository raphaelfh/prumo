"""The advisory editor lock on a template's config draft (B-9f).

Spec section 1: one server-persisted draft per template, with an advisory
editor lock behind the chip's "Draft · started Jul 30 by M. Costa · Take
over". Spec section 8: a typed 409 carrying holder identity.

**Advisory, and the word is load-bearing.** This arbitrates the typed
endpoints so two managers do not silently overwrite each other's draft. It
is NOT an authorization boundary: 0054 closed the raw PostgREST INSERT /
UPDATE path onto the two config tables, but ``project_extraction_templates``
still grants ALL to ``authenticated``, so a manager can drop the template
outright — around this lock and every endpoint that honours it.

Two rules keep it advisory rather than a mutex, and both are tested:

* an **unattributed** draft is claimable. ``config_draft_by IS NULL`` with
  ``config_draft_since`` set is a real state — every draft open when 0053
  deployed, and every raw PostgREST write 0054 later shut out — and
  refusing those would leave those templates permanently unusable;
* **take-over always wins**. There is no TTL, no heartbeat and no lease,
  because all three answer "is the holder still there?" with a guess. A
  laptop that sleeps mid-draft must not hold a template hostage, so the
  release valve is a human clicking Take over, not a timer.

The holder is set HERE, never by the 0048 triggers. A trigger cannot know
the actor on the typed-endpoint path: the asyncpg session sets no
``request.jwt.*``, so ``auth.uid()`` is NULL there. 0048 keeps stamping the
timestamp and keeps being the always-matching UPDATE that row-locks the
template against a concurrent republish.
"""

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from fastapi import status
from sqlalchemy import CursorResult, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.models.extraction import ProjectExtractionTemplate
from app.models.user import Profile
from app.schemas.hitl_session import TemplateDraftLockRefusalCode
from app.services.project_template_active_service import owned_template
from app.services.template_clone_service import TemplateNotFoundError

__all__ = [
    "DraftLockHeldError",
    "TemplateNotFoundError",
    "TakeOverResult",
    "claim_draft_lock",
    "release_draft_lock",
    "take_over_draft_lock",
]


class DraftLockHeldError(AppError):
    """Someone else is editing this draft.

    409 with the holder in ``details``: without a name, "Take over" is a
    blind click and the user cannot tell a colleague from a stale session.
    """

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(
            code=TemplateDraftLockRefusalCode.DRAFT_LOCK_HELD,
            message=message,
            status_code=status.HTTP_409_CONFLICT,
            details=details,
        )


@dataclass(frozen=True, slots=True)
class TakeOverResult:
    """Who was displaced, so the UI can say whose draft was taken."""

    previous_holder_id: UUID | None
    previous_holder_name: str | None


async def claim_draft_lock(
    db: AsyncSession, *, project_id: UUID, template_id: UUID, user_id: UUID
) -> None:
    """Claim the lock, or refuse naming the holder.

    ONE conditional UPDATE, not read-then-write: two managers racing their
    first edit would both see NULL and both believe they hold it. The
    predicate makes the claim and the check the same statement, so exactly
    one wins and the loser's rowcount is 0.

    Idempotent for the holder — every config write re-claims, and the
    holder's own writes must never refuse.

    ``project_id`` is part of the WHERE, not a check around it. This is the
    first DB statement on all 8 config-write endpoints, ahead of the
    service's own ownership guard, so an unscoped claim reached a foreign
    template: the refusal then named its holder, and the UPDATE briefly
    locked a row in another project. Scoped, a foreign template matches
    nothing and 404s below like a missing one.
    """
    result = await db.execute(
        update(ProjectExtractionTemplate)
        .where(
            ProjectExtractionTemplate.id == template_id,
            ProjectExtractionTemplate.project_id == project_id,
            # NULL is claimable: an unattributed draft must not strand.
            (ProjectExtractionTemplate.config_draft_by.is_(None))
            | (ProjectExtractionTemplate.config_draft_by == user_id),
        )
        .values(config_draft_by=user_id)
    )
    if _rowcount(result) == 1:
        return

    # Zero rows means held by someone else — OR the template is not in this
    # project (incl. does not exist). Both must refuse: treating "matched
    # nothing" as success is how a lock silently stops locking. The
    # canonical ownership guard separates the two, and raises the same
    # 404-class error every one of the 8 endpoints already translates.
    await owned_template(db, project_id=project_id, template_id=template_id)

    holder_id, holder_name = await _holder(db, template_id)
    raise DraftLockHeldError(
        "Another manager is editing this template's configuration.",
        details={
            "holder_id": str(holder_id) if holder_id is not None else None,
            "holder_name": holder_name,
        },
    )


async def take_over_draft_lock(
    db: AsyncSession, *, project_id: UUID, template_id: UUID, user_id: UUID
) -> TakeOverResult:
    """Seize the lock unconditionally, reporting who was displaced.

    Deliberately unconditional. The alternative — refusing unless the
    caller names the current holder — protects against a takeover racing a
    takeover, which costs a round trip to guard a case where both parties
    already decided to seize it. The last click wins, which is what a
    human-arbitrated release valve should do.

    Unconditional about the HOLDER, never about the project: ``project_id``
    is required and scopes the UPDATE itself, matching ``claim_draft_lock``
    above. It used to be optional with a hand-rolled ownership SELECT, which
    is the same predicate ``owned_template`` already owns — and an optional
    scope is one a caller can forget.
    """
    await owned_template(db, project_id=project_id, template_id=template_id)

    previous_id, previous_name = await _holder(db, template_id)
    await db.execute(
        update(ProjectExtractionTemplate)
        .where(
            ProjectExtractionTemplate.id == template_id,
            ProjectExtractionTemplate.project_id == project_id,
        )
        .values(config_draft_by=user_id)
    )
    return TakeOverResult(
        previous_holder_id=previous_id if previous_id != user_id else None,
        previous_holder_name=previous_name if previous_id != user_id else None,
    )


async def release_draft_lock(db: AsyncSession, *, template_id: UUID) -> None:
    """Drop the holder. Called wherever the draft itself ends.

    Publish and Discard both end the draft, so leaving a holder behind
    would show "being edited by …" over a template with no draft at all.
    """
    await db.execute(
        update(ProjectExtractionTemplate)
        .where(ProjectExtractionTemplate.id == template_id)
        .values(config_draft_by=None)
    )


async def _holder(db: AsyncSession, template_id: UUID) -> tuple[UUID | None, str | None]:
    """The current holder and their display name, if any.

    A profile with no ``full_name`` yields ``None`` rather than its uuid —
    a raw id must never reach the screen dressed as a person.
    """
    row = (
        await db.execute(
            select(ProjectExtractionTemplate.config_draft_by, Profile.full_name)
            .outerjoin(Profile, Profile.id == ProjectExtractionTemplate.config_draft_by)
            .where(ProjectExtractionTemplate.id == template_id)
        )
    ).first()
    if row is None:
        return None, None
    return row[0], row[1]


def _rowcount(result: object) -> int:
    """``CursorResult.rowcount`` behind a narrow cast (the repo's idiom)."""
    return int(getattr(result, "rowcount", 0) or 0) if isinstance(result, CursorResult) else 0
