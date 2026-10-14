"""edit_template_draft: the questionnaire-editing MCP write tool (task 10b,
spec §5.2, §7).

Delegates the isolated draft ops to Task 10a's
``agent_template_draft_service`` and the advisory editor lock to
``template_draft_lock_service.claim_draft_lock`` -- never
``take_over_draft_lock``, which this tool never calls. Every audited refusal
(spec §7 table) is mapped here, next to the one ``agent_actions`` row it
writes (``app.api.mcp.audit``); ownership is checked FIRST and unconditionally,
before any audited code, so a foreign or missing template always answers
``NOT_FOUND`` with no row -- whatever the ops.
"""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from pydantic import Field, ValidationError, WithJsonSchema
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp.asgi_auth import current_principal
from app.api.mcp.audit import AuditScope, record_applied_write, refuse
from app.api.mcp.draft_diff import capped_diff
from app.api.mcp.errors import (
    NOT_FOUND_MESSAGE,
    McpErrorCode,
    McpToolError,
    reject_nul,
    validation_failure,
)
from app.api.mcp.server import agent_tool
from app.api.v1.endpoints._integrity import is_deadlock
from app.core.config import settings
from app.schemas.mcp_template_draft import (
    AddQuestionOp,
    AppliedQuestion,
    DraftOp,
    EditTemplateDraftResult,
    UpdateQuestionOp,
)
from app.services import agent_template_draft_service
from app.services.agent_template_draft_service import (
    AppliedDraftOp,
    DraftOpError,
    NarrowBaselineError,
)
from app.services.project_template_active_service import (
    ProjectTemplateNotFoundError,
    owned_template,
)
from app.services.template_draft_lock_service import DraftLockHeldError, claim_draft_lock
from app.services.template_field_service import (
    DuplicateFieldNameError,
    EntityTypeNotFoundError,
    FieldNotFoundError,
)
from app.services.template_section_service import SectionNotFoundError
from app.services.template_versioning import (
    NoActiveTemplateVersionError,
    get_template_config_diff,
)
from app.utils.compact_json import RESULT_CAP, compact_json
from app.utils.json_schema import inline_json_schema

_TOOL = "edit_template_draft"
MAX_OPS = 25
_OPS: dict[str, type[AddQuestionOp] | type[UpdateQuestionOp]] = {
    "add_question": AddQuestionOp,
    "update_question": UpdateQuestionOp,
}
# Advertised only: `_parse_ops` still validates each op, so an empty list, too
# many ops or a malformed op is an AUDITED refusal, not an SDK-level one.
_OPS_SCHEMA = WithJsonSchema(
    {
        **inline_json_schema(list[Annotated[DraftOp, Field(discriminator="op")]]),
        "maxItems": MAX_OPS,
    }
)
_ALLOWED_OPS = sorted(_OPS)
# update_question rewords only; a type or options change goes through the UI.
_LOCKED_UPDATE_KEYS = frozenset({"type", "options"})
_EDITABLE_UPDATE_FIELDS = sorted(UpdateQuestionOp.model_fields.keys() - {"op", "field_id"})
_EDITOR_TAB = {
    "extraction": "tab=extraction&extractionTab=configuration",
    "quality_assessment": "tab=quality&qaTab=configuration",
}
_ROW_GUARDS = (SectionNotFoundError, EntityTypeNotFoundError, FieldNotFoundError)
_NOT_ALLOWED_MESSAGE = "This op can only be done in the prumo UI."
_LOCKED_KEY_MESSAGE = "A question's type or options can only be changed in the prumo UI."
_LOCKED_KEY_NEXT_STEP = (
    "resend update_question with only the editable_fields listed here; "
    "change type or options in the prumo UI"
)
_NEXT_STEP = (
    "Saved as an unpublished draft. A manager must click Publish in prumo before "
    "reviewers or AI extraction see it."
)
_DESCRIPTION = (
    "Add a question to a section, or reword an existing one, in a project template's "
    "unpublished draft. Never report a question as live -- it stays invisible "
    "to reviewers and to AI extraction until a project manager clicks Publish in prumo. "
    "After a RETRY or DUPLICATE_NAME error, call get_template before resending an "
    "add_question: it is not idempotent and may have partially applied. At most 25 ops "
    "per call."
)


@agent_tool(
    requires="write",
    project_arg="project_id",
    title="Edit questionnaire draft",
    description=_DESCRIPTION,
    destructive=False,
    idempotent=False,
)
async def edit_template_draft(
    db: AsyncSession,
    project_id: UUID,
    template_id: UUID,
    ops: Annotated[list[dict[str, Any]], _OPS_SCHEMA],
) -> EditTemplateDraftResult:
    scope = AuditScope(
        tool=_TOOL,
        project_id=project_id,
        template_id=template_id,
        input={"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    try:  # 1 -- ownership before any audited refusal (no row for NOT_FOUND)
        template = await owned_template(db, project_id=project_id, template_id=template_id)
    except ProjectTemplateNotFoundError:
        await refuse(db, scope, McpToolError(McpErrorCode.NOT_FOUND, NOT_FOUND_MESSAGE))

    applied: list[AppliedDraftOp] = []
    try:
        parsed = _parse_ops(ops)  # 2, 3
        await _assert_baseline(db, template_id)  # 4
        await claim_draft_lock(
            db, project_id=project_id, template_id=template_id, user_id=current_principal().user_sub
        )  # 5
        applied = await agent_template_draft_service.apply_draft_ops(
            db, project_id=project_id, template_id=template_id, ops=parsed
        )
        diff = await get_template_config_diff(db, project_id=project_id, template_id=template_id)
        await record_applied_write(
            db,
            scope,
            before={"ops": [a.before for a in applied]},
            after={"ops": [_applied_json(a) for a in applied]},
        )
        await db.commit()  # inside the try: a commit-time deadlock is an audited RETRY
    except McpToolError as error:
        await refuse(db, scope, error)
    except DraftLockHeldError as exc:
        await refuse(
            db,
            scope,
            McpToolError(
                McpErrorCode.DRAFT_LOCK_HELD,
                "Another manager is editing this draft.",
                holder_name=(exc.details or {}).get("holder_name"),
            ),
        )
    except DraftOpError as exc:
        mapped_error = _op_failure(exc)
        if mapped_error is None:
            raise exc.cause from exc  # unmapped: INTERNAL_ERROR via the choke point, no row
        await refuse(db, scope, mapped_error)
    except DBAPIError as exc:  # the lock claim's UPDATE or the commit can lose a deadlock too
        if not is_deadlock(exc):
            raise
        await refuse(
            db,
            scope,
            McpToolError(McpErrorCode.RETRY, "A concurrent edit won; nothing was changed."),
        )

    result = EditTemplateDraftResult(
        status="draft_saved_unpublished",
        visible_to_reviewers_and_ai=False,
        applied=[
            AppliedQuestion(
                op_index=a.op_index,
                op=a.op,
                field_id=a.field.id,
                section_id=a.field.entity_type_id,
                name=a.field.name,
                label=a.field.label,
            )
            for a in applied
        ],
        diff=capped_diff(diff, budget=0),  # placeholder: measures the rest of the result
        draft_fingerprint=diff.fingerprint,
        editor_url=f"{settings.PUBLIC_APP_URL.rstrip('/')}/projects/{project_id}?"
        f"{_EDITOR_TAB[template.kind]}",
        next_step=_NEXT_STEP,
    )
    # The diff gets whatever the result cap leaves after everything else
    # (measured with the row-less diff above, whose own fixed part the
    # budget then re-counts).
    rest = len(compact_json(result.model_dump(mode="json"))) - len(
        compact_json(result.diff.model_dump(mode="json"))
    )
    return result.model_copy(update={"diff": capped_diff(diff, budget=RESULT_CAP - rest)})


def _parse_ops(ops: list[dict[str, Any]]) -> list[DraftOp]:
    if len(ops) > MAX_OPS:
        raise McpToolError(McpErrorCode.TOO_MANY_OPS, f"At most {MAX_OPS} ops per call.")
    if not ops:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT, "ops must name at least one op.", field="ops"
        )
    parsed: list[DraftOp] = []
    for index, raw in enumerate(ops):
        op_name = raw.get("op")
        model = _OPS.get(op_name) if isinstance(op_name, str) else None
        if model is None:
            raise McpToolError(
                McpErrorCode.OP_NOT_ALLOWED_VIA_AGENT,
                _NOT_ALLOWED_MESSAGE,
                op_index=index,
                allowed_ops=_ALLOWED_OPS,
            )
        locked = sorted(_LOCKED_UPDATE_KEYS & raw.keys()) if model is UpdateQuestionOp else []
        if locked:
            raise McpToolError(
                McpErrorCode.OP_NOT_ALLOWED_VIA_AGENT,
                _LOCKED_KEY_MESSAGE,
                next_step=_LOCKED_KEY_NEXT_STEP,
                op_index=index,
                allowed_ops=_ALLOWED_OPS,
                field=locked[0],
                editable_fields=_EDITABLE_UPDATE_FIELDS,
            )
        reject_nul(raw, op_index=index)
        try:
            parsed.append(model.model_validate(raw))
        except ValidationError as exc:
            raise validation_failure(exc, op_index=index) from exc
    return parsed


async def _assert_baseline(db: AsyncSession, template_id: UUID) -> None:
    try:
        await agent_template_draft_service.assert_isolated_baseline(db, template_id=template_id)
    except NoActiveTemplateVersionError as exc:
        raise McpToolError(
            McpErrorCode.NO_PUBLISHED_VERSION, "A manager must publish this template first."
        ) from exc
    except NarrowBaselineError as exc:
        raise McpToolError(
            McpErrorCode.NARROW_BASELINE, "Publish this template once in prumo, then retry."
        ) from exc


def _op_failure(exc: DraftOpError) -> McpToolError | None:
    cause = exc.cause
    if isinstance(cause, _ROW_GUARDS):
        return McpToolError(McpErrorCode.NOT_FOUND, NOT_FOUND_MESSAGE, op_index=exc.op_index)
    if isinstance(cause, DuplicateFieldNameError):
        return McpToolError(
            McpErrorCode.DUPLICATE_NAME,
            "That question name is already used in this section.",
            op_index=exc.op_index,
        )
    if isinstance(cause, ValidationError):
        return validation_failure(cause, op_index=exc.op_index)
    if isinstance(cause, DBAPIError) and is_deadlock(cause):
        return McpToolError(
            McpErrorCode.RETRY, "A concurrent edit won; nothing was changed.", op_index=exc.op_index
        )
    return None


def _applied_json(a: AppliedDraftOp) -> dict[str, Any]:
    return {
        "op_index": a.op_index,
        "op": a.op,
        "field_id": str(a.field.id),
        "section_id": str(a.field.entity_type_id),
        "name": a.field.name,
        "label": a.field.label,
        "description": a.field.description,
        "instructions": a.field.llm_description,
    }
