"""get_review_question / set_review_question: the project's AI review question.

The read returns the PICOTS slots with their labels, eligibility, study design,
the exact text the AI receives and the protocol revision. The write replaces
named slots or flips the "send to AI" switch through the same
``project_ai_context.set_ai_context`` the Settings editor uses, compare-and-swap
on ``expected_revision`` under the project row lock. One ``agent_actions`` row
per applied write or audited refusal; the tool owns the transaction.
"""

from __future__ import annotations

from typing import Annotated, Any, get_args
from uuid import UUID

from pydantic import ValidationError, WithJsonSchema
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp.audit import AuditScope, record_applied_write, refuse
from app.api.mcp.errors import (
    NOT_FOUND_MESSAGE,
    McpErrorCode,
    McpToolError,
    error_result,
    reject_nul,
    validation_failure,
    with_names,
)
from app.api.mcp.server import agent_tool
from app.api.v1.endpoints._integrity import is_deadlock
from app.schemas.mcp_review_question import McpReviewQuestion
from app.schemas.project_protocol import PicotsSlotKey, PicotsSlotWrite
from app.services.project_ai_context import (
    ProjectNotFoundError,
    StaleProtocolRevisionError,
    get_review_question_view,
    lock_ai_context,
    set_ai_context,
)
from app.services.project_read_service import project_name
from app.utils.compact_json import RESULT_CAP, compact_json
from app.utils.json_schema import inline_json_schema
from app.utils.text_caps import cap_json_weight

_TOOL = "set_review_question"
_SLOT_KEYS = frozenset(get_args(PicotsSlotKey))
_EMPTY_NOTE = "No review question yet"
_TRUNCATED_NEXT_STEP = (
    "call get_review_question for the full current values, then confirm with the user"
)
_APPLIED_NOTE = (
    "Runs that already made their first AI call keep the review question they started with."
)
# Advertised only: `_parse_slots` still validates, so a bad key or slot is an
# audited INVALID_ARGUMENT naming it, not an SDK-level refusal.
_Slots = Annotated[
    dict[str, Any] | None,
    WithJsonSchema(inline_json_schema(dict[PicotsSlotKey, PicotsSlotWrite] | None)),
]


@agent_tool(
    requires="read",
    project_arg="project_id",
    title="Get review question",
    destructive=False,
    description=(
        "Return the project's review question: the PICOTS slots with their labels, the "
        "eligibility criteria, the eligible study designs, whether it is sent to the AI, "
        "`preview` (the exact text the AI receives, null when muted or empty) and "
        "`revision` -- pass it as expected_revision to set_review_question."
    ),
)
async def get_review_question(db: AsyncSession, project_id: UUID) -> McpReviewQuestion:
    view = await get_review_question_view(db, project_id)
    empty = not view.eligibility.inclusion and not view.eligibility.exclusion
    empty = empty and not view.study_design.types
    empty = empty and all(
        not (s.description or s.inclusion or s.exclusion) for s in view.slots.values()
    )
    return view.model_copy(update={"note": _EMPTY_NOTE if empty else None})


@agent_tool(
    requires="write",
    project_arg="project_id",
    title="Set review question",
    destructive=False,
    idempotent=True,
    description=(
        "Replace named PICOTS slots of the project's review question and/or turn sending it "
        "to the AI on or off. Each slot named in `slots` is replaced whole (description, "
        "inclusion, exclusion); unnamed slots are kept. `expected_revision` is required: "
        "the revision from get_review_question -- the write is refused if the review "
        "question changed meanwhile. Eligibility and study design are edited with "
        "update_project_details, which moves the same revision. Every applied or refused "
        "change is audited. Returns the review question as now stored."
    ),
)
async def set_review_question(
    db: AsyncSession,
    project_id: UUID,
    expected_revision: int,
    slots: _Slots = None,
    picots_enabled: bool | None = None,
) -> McpReviewQuestion:
    scope = AuditScope(
        tool=_TOOL,
        project_id=project_id,
        template_id=None,
        input={
            "project_id": str(project_id),
            "expected_revision": expected_revision,
            "slots": slots,
            "picots_enabled": picots_enabled,
        },
    )
    # The choke point proved membership; read before any refusal rolls back.
    name = await project_name(db, project_id)
    try:
        await _apply(db, scope, expected_revision, slots, picots_enabled)
    except McpToolError as error:
        await refuse(db, scope, _fit_current(with_names(error, project_name=name)))
    view = await get_review_question_view(db, project_id)
    return view.model_copy(update={"note": _APPLIED_NOTE})


async def _apply(
    db: AsyncSession,
    scope: AuditScope,
    expected_revision: int,
    slots: dict[str, Any] | None,
    picots_enabled: bool | None,
) -> None:
    """The write and its applied row; every audited refusal surfaces as McpToolError."""
    try:
        updates = _parse_slots(slots, picots_enabled)
        before = await lock_ai_context(db, scope.project_id)
        after = await set_ai_context(
            db,
            scope.project_id,
            picots=None,
            picots_enabled=picots_enabled,
            expected_revision=expected_revision,
            slot_updates=updates,
        )
        await record_applied_write(
            db, scope, before=_audit_view(before, updates), after=_audit_view(after, updates)
        )
        await db.commit()  # inside the try: a deadlock here is an audited RETRY too
    except StaleProtocolRevisionError as exc:
        current = await get_review_question_view(db, scope.project_id)
        raise McpToolError(
            McpErrorCode.STALE_VALUE,
            "The review question changed since it was read.",
            current_revision=(exc.details or {})["current_revision"],
            current=current.model_dump(
                mode="json", exclude={"note", "untrusted_content", "untrusted_fields"}
            ),
            untrusted_content=True,
            untrusted_fields=["current"],
        ) from exc
    except ProjectNotFoundError as exc:  # deleted after the choke point
        raise McpToolError(McpErrorCode.NOT_FOUND, NOT_FOUND_MESSAGE) from exc
    except DBAPIError as exc:
        if not is_deadlock(exc):
            raise  # INTERNAL_ERROR via the dispatcher: logged, no row
        raise McpToolError(
            McpErrorCode.RETRY, "A concurrent write won; nothing was changed."
        ) from exc


def _parse_slots(
    slots: dict[str, Any] | None, picots_enabled: bool | None
) -> dict[str, dict[str, Any]] | None:
    # Order: NUL, presence, key, slot shape (all INVALID_ARGUMENT).
    reject_nul({"slots": slots})
    if not slots and picots_enabled is None:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT,
            "name at least one of slots or picots_enabled",
            field="slots",
        )
    if not slots:
        return None
    updates: dict[str, dict[str, Any]] = {}
    for key in sorted(slots):
        if key not in _SLOT_KEYS:
            raise McpToolError(
                McpErrorCode.INVALID_ARGUMENT,
                f"Not a PICOTS slot; use one of {', '.join(sorted(_SLOT_KEYS))}.",
                field=f"slots.{key}",
            )
        try:
            updates[key] = PicotsSlotWrite.model_validate(slots[key]).model_dump()
        except ValidationError as exc:
            raise validation_failure(exc, prefix=f"slots.{key}") from exc
    return updates


def _fit_current(error: McpToolError) -> McpToolError:
    """A STALE_VALUE refusal with ``current`` cut until the rendered error fits
    ``RESULT_CAP``, flagged ``current_truncated``; any other error untouched.

    Slots at their write bounds render far past the cap. The preview goes
    first (derived from the rest), then trailing list items -- study design,
    eligibility, then slots, so the slots the write targets survive longest --
    then the free-text fields. A cut ``current`` is not safe to write back, so
    ``next_step`` points to the uncapped ``get_review_question``."""
    if error.code is not McpErrorCode.STALE_VALUE:
        return error
    error.extras["current_truncated"] = False
    if _rendered_len(error) <= RESULT_CAP:
        return error
    error.extras["current_truncated"] = True
    error.next_step = _TRUNCATED_NEXT_STEP
    over = _rendered_len(error) - RESULT_CAP
    current = error.extras["current"]  # a fresh model_dump: ours to cut
    if current["preview"] is not None:
        over -= _json_len(current["preview"]) - _json_len(None)
        current["preview"] = None
    slots = list(current["slots"].values())
    eligibility, design = current["eligibility"], current["study_design"]
    lists = [s[part] for s in slots for part in ("inclusion", "exclusion")]
    lists += [eligibility["inclusion"], eligibility["exclusion"], design["types"]]
    for items in reversed(lists):
        while over > 0 and items:
            item = items.pop()
            over -= _json_len(item) + (2 if items else 0)  # its ", " separator
    texts = [(s, "description") for s in slots] + [(eligibility, "notes"), (design, "notes")]
    for holder, key in reversed(texts):
        if over <= 0:
            break
        weight = _json_len(holder[key])
        holder[key], _ = cap_json_weight(holder[key], max(2, weight - over))
        over -= weight - _json_len(holder[key])
    return error


def _rendered_len(error: McpToolError) -> int:
    """Measured as the dispatcher renders it: the error result's compact JSON."""
    return _json_len(error_result(error).structured_content)


def _json_len(value: object) -> int:
    return len(compact_json(value))


def _audit_view(model: dict[str, Any], updates: dict[str, dict[str, Any]] | None) -> dict[str, Any]:
    """The revision, the switch and the named slots, as the editor reads them."""
    return {
        "revision": model["revision"],
        "slots": {key: model["picots"][key] for key in updates or {}},
        "picots_enabled": model["picots_enabled"],
    }
