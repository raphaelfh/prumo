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
from app.api.mcp.draft_diff import LABEL_CAP, capped_diff
from app.api.mcp.errors import (
    NOT_FOUND_MESSAGE,
    McpErrorCode,
    McpToolError,
    reject_nul,
    validation_failure,
    with_names,
)
from app.api.mcp.server import agent_tool
from app.api.v1.endpoints._integrity import is_deadlock
from app.schemas.hitl_session import TemplateConfigDiffRead
from app.schemas.mcp_template_draft import (
    AddQuestionOp,
    AddSectionOp,
    AppliedDeleteOp,
    AppliedInstructionOp,
    AppliedOp,
    AppliedQuestionOp,
    AppliedReorderOp,
    AppliedSectionOp,
    DeleteQuestionOp,
    DeleteSectionOp,
    DraftOp,
    EditTemplateDraftResult,
    McpLintCounts,
    MoveQuestionOp,
    ReorderQuestionsOp,
    SetInstructionOp,
    SetOptionsOp,
    UpdateQuestionOp,
    UpdateSectionOp,
)
from app.services import agent_template_draft_service
from app.services.agent_template_draft_service import (
    AppliedDraftOp,
    DraftOpError,
    NarrowBaselineError,
    OptionsNotApplicableError,
    OptionValueConflictError,
    ReorderMismatchError,
)
from app.services.project_read_service import project_name
from app.services.project_template_active_service import (
    ProjectTemplateNotFoundError,
    owned_template,
)
from app.services.template_draft_lock_service import DraftLockHeldError, claim_draft_lock
from app.services.template_field_service import (
    CrossTemplateMoveError,
    DuplicateEntityKeyError,
    DuplicateFieldNameError,
    EntityTypeNotFoundError,
    FieldInUseError,
    FieldNotFoundError,
)
from app.services.template_section_service import (
    SectionCardinalityInUseError,
    SectionEntryLabelCardinalityError,
    SectionInUseError,
    SectionNotFoundError,
    SectionOwnsChildrenError,
    SectionParentMustRepeatError,
)
from app.services.template_versioning import (
    NoActiveTemplateVersionError,
    get_template_config_diff,
)
from app.utils.app_urls import editor_url
from app.utils.compact_json import RESULT_CAP, compact_json
from app.utils.json_schema import inline_json_schema
from app.utils.text_caps import cap_text

_TOOL = "edit_template_draft"
MAX_OPS = 25
_OPS: dict[str, type[DraftOp]] = {
    "add_question": AddQuestionOp,
    "update_question": UpdateQuestionOp,
    "delete_question": DeleteQuestionOp,
    "move_question": MoveQuestionOp,
    "reorder_questions": ReorderQuestionsOp,
    "set_options": SetOptionsOp,
    "add_section": AddSectionOp,
    "update_section": UpdateSectionOp,
    "delete_section": DeleteSectionOp,
    "set_instruction": SetInstructionOp,
}
# Ops that need the draft fingerprint the agent last read.
_FINGERPRINTED_OPS = frozenset({"delete_question", "move_question", "delete_section"})
# Advertised only: `_parse_ops` still validates each op, so an empty list, too
# many ops or a malformed op is an AUDITED refusal, not an SDK-level one.
_OPS_SCHEMA = WithJsonSchema(
    {
        **inline_json_schema(list[Annotated[DraftOp, Field(discriminator="op")]]),
        "maxItems": MAX_OPS,
    }
)
_ALLOWED_OPS = sorted(_OPS)
# update_question never changes a name or type (prumo UI only) or options (set_options).
_LOCKED_UPDATE_KEYS = frozenset({"type", "name", "options"})
_EDITABLE_UPDATE_FIELDS = sorted(UpdateQuestionOp.model_fields.keys() - {"op", "field_id"})
_ROW_GUARDS = (SectionNotFoundError, EntityTypeNotFoundError, FieldNotFoundError)
# Section rule errors -> (message, rule); messages are static (the service's name the section).
_SECTION_RULES: dict[type[Exception], tuple[str, str]] = {
    SectionParentMustRepeatError: (
        "A section's parent must be a repeating ('many') section.",
        "section_parent_must_repeat",
    ),
    SectionEntryLabelCardinalityError: (
        "A repeating section needs an entry_label, and only a repeating section takes one.",
        "section_entry_label_cardinality",
    ),
    SectionOwnsChildrenError: (
        "This section owns child sections; delete or move them first.",
        "section_owns_children",
    ),
}
_NOT_ALLOWED_MESSAGE = "This op can only be done in the prumo UI."
# Locked key -> (message, next_step).
_LOCKED_KEY_REFUSAL = {
    "type": (
        "A question's type or name can only be changed in the prumo UI.",
        "resend update_question with only the editable_fields listed here; "
        "change a name or type in the prumo UI",
    ),
    "options": (
        "Change options with set_options.",
        "resend the options change as a set_options op",
    ),
}
_LOCKED_KEY_REFUSAL["name"] = _LOCKED_KEY_REFUSAL["type"]
# NarrowBaselineError.reason -> (message, next_step): each names its own fix.
_NARROW_BASELINE = {
    "pinned_empty_version": (
        "The published version of this template is empty and a run is pinned to it.",
        "publish the current draft in prumo so runs move to a version with questions, then retry",
    ),
    "legacy_snapshot": (
        "The published version of this template uses an older format.",
        "publish once in prumo to refresh the published version, then retry",
    ),
}
_NEXT_STEP = (
    "Saved as an unpublished draft. A manager must click Publish in prumo before "
    "reviewers or AI extraction see it."
)
_DESCRIPTION = (
    "Edit a project template's unpublished draft with a batch of ops, applied in order "
    "and all-or-nothing:\n"
    "- add_question: add a question to a section;\n"
    "- update_question: edit a question's wording, instructions, required flag, unit and "
    "allowed_units, the not-applicable / not-evaluated / no-information / other flags and "
    "is_entity_key (only the sent keys change; a name or type changes only in the prumo UI);\n"
    "- set_options: replace a select or multiselect question's options;\n"
    "- delete_question: delete a question (refused while it holds recorded data);\n"
    "- move_question: move a question to a section at a 0-based position;\n"
    "- reorder_questions: set a section's order (must name exactly its questions);\n"
    "- add_section: add a section (cardinality 'one' or 'many'; a 'many' section needs an "
    "entry_label; parent_section_id must name a 'many' section);\n"
    "- update_section: edit a section's label, description, entry_label or cardinality;\n"
    "- delete_section: delete a section and its questions (refused while it holds recorded "
    "data or owns child sections);\n"
    "- set_instruction: set the template's AI instruction (null or blank clears it).\n"
    "A batch with delete_question, move_question or delete_section needs "
    "expected_fingerprint: the fingerprint from get_template view 'draft' or 'changes'. "
    "Never report a change as live -- it stays invisible to reviewers and to AI extraction "
    "until a project manager clicks Publish in prumo; only a human can publish. The reply "
    "counts lint findings and the destructive changes Publish will ask the human to "
    "acknowledge. "
    "A select or multiselect question takes options as [{value?, label}]; a missing value "
    "becomes the trimmed label, and values must be unique. In set_options an option sent "
    "without a value keeps the stored value of the option with the same trimmed label; to "
    "relabel an option and keep its recorded answers, resend its value with the new label. "
    "Removing an option is allowed in the draft; Publish asks for confirmation. "
    "After a RETRY or DUPLICATE_NAME error, call get_template before resending an "
    "add_question or add_section: they are not idempotent and may have partially applied. "
    "At most 25 ops per call."
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
    expected_fingerprint: str | None = None,
) -> EditTemplateDraftResult:
    scope = AuditScope(
        tool=_TOOL,
        project_id=project_id,
        template_id=template_id,
        input={
            "project_id": str(project_id),
            "template_id": str(template_id),
            "ops": ops,
            "expected_fingerprint": expected_fingerprint,
        },
    )
    try:  # 1 -- ownership before any audited refusal (no row for NOT_FOUND)
        template = await owned_template(db, project_id=project_id, template_id=template_id)
    except ProjectTemplateNotFoundError:
        await refuse(db, scope, McpToolError(McpErrorCode.NOT_FOUND, NOT_FOUND_MESSAGE))

    # Membership and ownership are proven: refusals from here on name both,
    # read now because a refusal's rollback expires every loaded row.
    names = {"project_name": await project_name(db, project_id), "template_name": template.name}
    link = editor_url(project_id, template.kind)
    try:
        applied, diff = await _apply(db, scope, project_id, template_id, ops, expected_fingerprint)
    except McpToolError as error:
        await refuse(db, scope, with_names(error, **names))
    block, warn = await agent_template_draft_service.draft_lint_counts(db, template_id=template_id)

    result = EditTemplateDraftResult(
        status="draft_saved_unpublished",
        visible_to_reviewers_and_ai=False,
        project_name=cap_text(names["project_name"])[0],
        template_name=cap_text(names["template_name"])[0],
        applied=[_applied_reply(a) for a in applied],
        diff=capped_diff(diff, budget=0),  # placeholder: measures the rest of the result
        draft_fingerprint=diff.fingerprint,
        editor_url=link,
        next_step=_NEXT_STEP,
        lint=McpLintCounts(block=block, warn=warn),
        destructive_changes=len(diff.changes.destructive),
    )
    # The diff gets whatever the result cap leaves after everything else
    # (measured with the row-less diff above, whose own fixed part the
    # budget then re-counts).
    rest = len(compact_json(result.model_dump(mode="json"))) - len(
        compact_json(result.diff.model_dump(mode="json"))
    )
    result = result.model_copy(update={"diff": capped_diff(diff, budget=max(0, RESULT_CAP - rest))})
    assert len(compact_json(result.model_dump(mode="json"))) <= RESULT_CAP
    return result


async def _apply(
    db: AsyncSession,
    scope: AuditScope,
    project_id: UUID,
    template_id: UUID,
    ops: list[dict[str, Any]],
    expected_fingerprint: str | None,
) -> tuple[list[AppliedDraftOp], TemplateConfigDiffRead]:
    """Steps 2-5 and the applied row; every audited refusal surfaces as McpToolError."""
    try:
        parsed = _parse_ops(ops)  # 2, 3
        guarded = any(op.op in _FINGERPRINTED_OPS for op in parsed)
        if guarded and expected_fingerprint is None:
            raise McpToolError(
                McpErrorCode.INVALID_ARGUMENT,
                "required when a batch deletes or moves",
                field="expected_fingerprint",
            )
        # Claim before the baseline check: the claim's UPDATE row-locks the
        # template, and create_run takes that row FOR SHARE, so no run can pin
        # the (empty) active version between the pinned-run check and commit.
        # A refusal below rolls the claim back.
        await claim_draft_lock(
            db, project_id=project_id, template_id=template_id, user_id=current_principal().user_sub
        )  # 4
        await _assert_baseline(db, template_id)  # 5
        if guarded:
            await _assert_fingerprint(db, project_id, template_id, expected_fingerprint)
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
    except DraftLockHeldError as exc:
        raise McpToolError(
            McpErrorCode.DRAFT_LOCK_HELD,
            "Another manager is editing this draft.",
            holder_name=(exc.details or {}).get("holder_name"),
            untrusted_content=True,
            untrusted_fields=["holder_name"],
        ) from exc
    except DraftOpError as exc:
        mapped_error = _op_failure(exc)
        if mapped_error is None:
            raise exc.cause from exc  # unmapped: INTERNAL_ERROR via the choke point, no row
        raise mapped_error from exc
    except DBAPIError as exc:  # the lock claim's UPDATE or the commit can lose a deadlock too
        if not is_deadlock(exc):
            raise
        raise McpToolError(
            McpErrorCode.RETRY, "A concurrent edit won; nothing was changed."
        ) from exc
    return applied, diff


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
            message, next_step = _LOCKED_KEY_REFUSAL[locked[0]]
            raise McpToolError(
                McpErrorCode.OP_NOT_ALLOWED_VIA_AGENT,
                message,
                next_step=next_step,
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
        message, next_step = _NARROW_BASELINE[exc.reason]
        raise McpToolError(McpErrorCode.NARROW_BASELINE, message, next_step=next_step) from exc


async def _assert_fingerprint(
    db: AsyncSession, project_id: UUID, template_id: UUID, expected: str | None
) -> None:
    """A destructive or moving batch applies only to the draft the agent last read."""
    current = (
        await get_template_config_diff(db, project_id=project_id, template_id=template_id)
    ).fingerprint
    if current != expected:
        raise McpToolError(
            McpErrorCode.STALE_VALUE,
            "The draft changed since you read it; nothing was changed.",
            next_step="call get_template with view 'changes', confirm with the user, then "
            "resend with its fingerprint",
            current_fingerprint=current,
        )


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
    if isinstance(cause, FieldInUseError):
        return McpToolError(
            McpErrorCode.IN_USE,
            "This question holds recorded data and cannot be deleted.",
            op_index=exc.op_index,
        )
    if isinstance(cause, SectionInUseError):
        return McpToolError(
            McpErrorCode.IN_USE,
            "This section holds recorded data and cannot be deleted.",
            op_index=exc.op_index,
        )
    if isinstance(cause, SectionCardinalityInUseError):
        return McpToolError(
            McpErrorCode.IN_USE,
            "An entry of this section holds more than one item; it cannot stop repeating.",
            op_index=exc.op_index,
        )
    if type(cause) in _SECTION_RULES:
        message, rule = _SECTION_RULES[type(cause)]
        return McpToolError(
            McpErrorCode.STRUCTURE_CONFLICT, message, rule=rule, op_index=exc.op_index
        )
    if isinstance(cause, DuplicateEntityKeyError):
        return McpToolError(
            McpErrorCode.STRUCTURE_CONFLICT,
            "This section already has an entry key; clear it on the other question first.",
            rule="duplicate_entity_key",
            op_index=exc.op_index,
        )
    if isinstance(cause, OptionValueConflictError):
        return McpToolError(
            McpErrorCode.STRUCTURE_CONFLICT,
            "Two options would share one stored value.",
            next_step="give each option a distinct value, then resend",
            rule="option_value_conflict",
            op_index=exc.op_index,
        )
    if isinstance(cause, OptionsNotApplicableError):
        return McpToolError(
            McpErrorCode.INVALID_ARGUMENT, str(cause), field="options", op_index=exc.op_index
        )
    if isinstance(cause, CrossTemplateMoveError):
        return McpToolError(
            McpErrorCode.STRUCTURE_CONFLICT,
            "A question can only move to a section of the same template.",
            rule="cross_template_move",
            op_index=exc.op_index,
        )
    if isinstance(cause, ReorderMismatchError):
        return McpToolError(
            McpErrorCode.INVALID_ARGUMENT,
            "field_ids must name exactly this section's questions",
            field="field_ids",
            op_index=exc.op_index,
        )
    if isinstance(cause, ValidationError):
        return validation_failure(cause, op_index=exc.op_index)
    if isinstance(cause, DBAPIError) and is_deadlock(cause):
        return McpToolError(
            McpErrorCode.RETRY, "A concurrent edit won; nothing was changed.", op_index=exc.op_index
        )
    return None


def _applied_reply(a: AppliedDraftOp) -> AppliedOp:
    if a.op == "delete_question":
        return AppliedDeleteOp(op_index=a.op_index, op=a.op, field_id=_deleted_id(a))
    if a.op == "set_instruction":
        assert a.changed is not None
        return AppliedInstructionOp(op_index=a.op_index, op=a.op, changed=a.changed)
    if a.op == "delete_section":
        return AppliedSectionOp(
            op_index=a.op_index,
            op=a.op,
            section_id=_deleted_section_id(a),
            label=None,
            cardinality=None,
        )
    if a.op == "add_section" or a.op == "update_section":
        assert a.section is not None
        return AppliedSectionOp(
            op_index=a.op_index,
            op=a.op,
            section_id=a.section.id,
            label=cap_text(a.section.label, LABEL_CAP)[0],
            cardinality=a.section.cardinality,
        )
    assert a.section_id is not None and a.section_label is not None
    # Every text leaf is capped so 25 applied ops stay well inside RESULT_CAP.
    section_label = cap_text(a.section_label, LABEL_CAP)[0]
    if a.op == "reorder_questions":
        assert a.field_ids is not None
        return AppliedReorderOp(
            op_index=a.op_index,
            op=a.op,
            section_id=a.section_id,
            section_label=section_label,
            count=len(a.field_ids),
        )
    assert a.field is not None
    return AppliedQuestionOp(
        op_index=a.op_index,
        op=a.op,
        field_id=a.field.id,
        section_id=a.section_id,
        section_label=section_label,
        name=cap_text(a.field.name, LABEL_CAP)[0],
        label=cap_text(a.field.label, LABEL_CAP)[0],
    )


def _deleted_id(a: AppliedDraftOp) -> UUID:
    assert a.before is not None
    return UUID(a.before["field_id"])


def _deleted_section_id(a: AppliedDraftOp) -> UUID:
    assert a.before is not None
    return UUID(a.before["section_id"])


def _applied_json(a: AppliedDraftOp) -> dict[str, Any]:
    row: dict[str, Any] = {"op_index": a.op_index, "op": a.op}
    if a.op == "delete_question":
        row["field_id"] = str(_deleted_id(a))
        return row
    if a.op == "delete_section":
        row["section_id"] = str(_deleted_section_id(a))
        return row
    if a.section is not None:
        row.update(
            section_id=str(a.section.id),
            name=a.section.name,
            label=a.section.label,
            cardinality=a.section.cardinality,
            entry_label=a.section.entry_label,
            description=a.section.description,
            parent_section_id=(
                str(a.section.parent_entity_type_id) if a.section.parent_entity_type_id else None
            ),
        )
    if a.changed is not None:
        row["changed"] = a.changed
    if a.section_id is not None:
        row["section_id"] = str(a.section_id)
    if a.field_ids is not None:
        row["field_ids"] = [str(fid) for fid in a.field_ids]
    if a.field is not None:
        row.update(
            field_id=str(a.field.id),
            name=a.field.name,
            label=a.field.label,
            description=a.field.description,
            instructions=a.field.llm_description,
        )
    if a.after is not None:
        row.update(a.after)
    return row
