"""Questionnaire edits the MCP agent may make (spec §5.2): add, edit, delete, move
or reorder questions, replace a select's options, add, edit or delete sections
and set the template instruction. All stay invisible to reviewers and AI until
a manager publishes, and only on a non-narrow active version. Flushes only; the
MCP tool commits."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import exists, func, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.claim_value import normalize_options
from app.models.extraction import (
    ExtractionEntityType,
    ExtractionField,
    ExtractionRun,
    ProjectExtractionTemplate,
)
from app.repositories.extraction_template_version_repository import (
    ExtractionTemplateVersionRepository,
)
from app.schemas.mcp_template_draft import (
    AddQuestionOp,
    AddSectionOp,
    DeleteQuestionOp,
    DeleteSectionOp,
    DraftOp,
    MoveQuestionOp,
    OptionInput,
    ReorderQuestionsOp,
    SetInstructionOp,
    SetOptionsOp,
    UpdateQuestionOp,
    UpdateSectionOp,
)
from app.schemas.template_structure import (
    OptionItem,
    SectionCreateRequest,
    SectionRead,
    SectionUpdateRequest,
    TemplateFieldCreateRequest,
    TemplateFieldMoveRequest,
    TemplateFieldRead,
    TemplateFieldReorderRequest,
    TemplateFieldSortOrderUpdate,
    TemplateFieldUpdateRequest,
)
from app.services import template_field_naming, template_field_service, template_section_service
from app.services.extraction_snapshot import baseline_isolated_for_agent, live_entity_types
from app.services.template_field_service import (
    CrossTemplateMoveError,
    DuplicateEntityKeyError,
    DuplicateFieldNameError,
    EntityTypeNotFoundError,
    FieldInUseError,
    FieldNotFoundError,
)
from app.services.template_instruction_service import set_template_instruction
from app.services.template_lint import lint_tree
from app.services.template_section_service import (
    SectionCardinalityInUseError,
    SectionEntryLabelCardinalityError,
    SectionInUseError,
    SectionNotFoundError,
    SectionOwnsChildrenError,
    SectionParentMustRepeatError,
    owned_section,
)
from app.services.template_versioning import (
    NoActiveTemplateVersionError,
)


class ReorderMismatchError(Exception):
    """A reorder's ``field_ids`` do not name exactly the section's questions, once each."""


class OptionValueConflictError(Exception):
    """Two options of a ``set_options`` would share one stored code."""


class OptionsNotApplicableError(ValueError):
    """``set_options`` names a question that is not a select or multiselect."""


_OP_ERRORS = (
    SectionNotFoundError,
    EntityTypeNotFoundError,
    FieldNotFoundError,
    DuplicateFieldNameError,
    DuplicateEntityKeyError,
    FieldInUseError,
    CrossTemplateMoveError,
    ReorderMismatchError,
    OptionValueConflictError,
    OptionsNotApplicableError,
    SectionInUseError,
    SectionCardinalityInUseError,
    SectionParentMustRepeatError,
    SectionEntryLabelCardinalityError,
    SectionOwnsChildrenError,
    ValidationError,
    DBAPIError,
)

# Op-model attr -> ExtractionField column, for the "before" snapshot and the
# TemplateFieldUpdateRequest payload. ``instructions`` is user-facing for the
# field's ``llm_description`` column; ``required`` for ``is_required``.
_UPDATE_COLUMN = {
    "label": "label",
    "description": "description",
    "instructions": "llm_description",
    "required": "is_required",
    "unit": "unit",
    "allowed_units": "allowed_units",
    "allows_not_applicable": "allows_not_applicable",
    "allows_not_evaluated": "allows_not_evaluated",
    "allows_no_information": "allows_no_information",
    "is_entity_key": "is_entity_key",
    "allow_other": "allow_other",
}
_OPTION_TYPES = frozenset({"select", "multiselect"})


NarrowBaselineReason = Literal["pinned_empty_version", "legacy_snapshot"]


class NarrowBaselineError(Exception):
    """The active version is narrow: runs chain to live rows, so a draft edit would leak.

    ``reason`` names which case: an empty version a run is pinned to, or a
    snapshot older than the wide format."""

    def __init__(self, reason: NarrowBaselineReason) -> None:
        super().__init__(f"The active version is not isolated: {reason}.")
        self.reason: NarrowBaselineReason = reason


class DraftOpError(Exception):
    """One op in the batch failed; ``op_index`` names which."""

    def __init__(self, op_index: int, cause: Exception) -> None:
        super().__init__(f"op {op_index}: {cause}")
        self.op_index = op_index
        self.cause = cause


DraftOpName = Literal[
    "add_question",
    "update_question",
    "delete_question",
    "move_question",
    "reorder_questions",
    "set_options",
    "add_section",
    "update_section",
    "delete_section",
    "set_instruction",
]


@dataclass(frozen=True)
class AppliedDraftOp:
    """One successfully-applied op, for the MCP tool's audit row and reply.

    ``field`` is the question left in place (add, update, move); a delete
    leaves none. ``section_id``/``section_label`` name the section the op
    landed in; ``field_ids`` is a reorder's new order. ``section`` is the
    section an add or update section leaves; ``changed`` says whether a
    set_instruction changed the stored text. ``before``/``after`` are the
    op's own audit snapshots."""

    op_index: int
    op: DraftOpName
    field: TemplateFieldRead | None = None
    section: SectionRead | None = None
    changed: bool | None = None
    section_id: UUID | None = None
    section_label: str | None = None
    field_ids: list[UUID] | None = None
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None


async def assert_isolated_baseline(db: AsyncSession, *, template_id: UUID) -> None:
    """Refuse a draft edit unless the active version isolates runs from the live rows.

    A narrow snapshot chains a run to the LIVE rows (spec §2), so editing the
    live structure would leak the draft to any run pinned to it before a
    manager publishes. An empty version (a blank template) passes while no
    run is pinned to it.
    """
    active = await ExtractionTemplateVersionRepository(db).get_active(template_id)
    if active is None:
        raise NoActiveTemplateVersionError(f"Project template {template_id} has no active version.")
    # The entity_types LIST, never the whole dict: the dict reads narrow for every template.
    entity_types = (active.schema_ or {}).get("entity_types") or []
    pinned = (
        await db.execute(select(exists().where(ExtractionRun.version_id == active.id)))
    ).scalar_one()
    if not baseline_isolated_for_agent(entity_types, pinned_run_exists=pinned):
        raise NarrowBaselineError("pinned_empty_version" if not entity_types else "legacy_snapshot")


async def _add(
    db: AsyncSession, project_id: UUID, template_id: UUID, index: int, op: AddQuestionOp
) -> AppliedDraftOp:
    section = await owned_section(db, template_id=template_id, section_id=op.section_id)
    section_label = section.label
    taken = set(
        (
            await db.execute(
                select(ExtractionField.name).where(ExtractionField.entity_type_id == op.section_id)
            )
        ).scalars()
    )
    sort_order = (
        await db.execute(
            select(func.coalesce(func.max(ExtractionField.sort_order), -1) + 1).where(
                ExtractionField.entity_type_id == op.section_id
            )
        )
    ).scalar_one()
    payload = TemplateFieldCreateRequest(
        entity_type_id=op.section_id,
        name=template_field_naming.derive_field_name(op.label, taken),
        label=op.label,
        field_type=op.type,
        allowed_values=[o.to_option_item() for o in op.options] if op.options else None,
        llm_description=op.instructions,
        is_required=op.required,
        unit=op.unit,
        allowed_units=op.allowed_units,
        allows_not_applicable=op.allows_not_applicable,
        allows_not_evaluated=op.allows_not_evaluated,
        allows_no_information=op.allows_no_information,
        allow_other=op.allow_other,
        sort_order=sort_order,
    )
    field = await template_field_service.create_field(
        db, project_id=project_id, template_id=template_id, payload=payload
    )
    return AppliedDraftOp(
        op_index=index,
        op="add_question",
        field=field,
        section_id=field.entity_type_id,
        section_label=section_label,
    )


async def _update(
    db: AsyncSession, project_id: UUID, template_id: UUID, index: int, op: UpdateQuestionOp
) -> AppliedDraftOp:
    sent = op.model_dump(exclude_unset=True, exclude={"op", "field_id"})
    row = await template_field_service.owned_field(
        db, template_id=template_id, field_id=op.field_id
    )
    before = {key: getattr(row, _UPDATE_COLUMN[key]) for key in sent}
    section = await owned_section(db, template_id=template_id, section_id=row.entity_type_id)
    section_label = section.label
    payload = TemplateFieldUpdateRequest(
        **{_UPDATE_COLUMN[key]: value for key, value in sent.items()}
    )
    field = await template_field_service.update_field(
        db, project_id=project_id, template_id=template_id, field_id=op.field_id, payload=payload
    )
    return AppliedDraftOp(
        op_index=index,
        op="update_question",
        field=field,
        section_id=field.entity_type_id,
        section_label=section_label,
        before=before,
    )


def _resolve_options(stored: Any, sent: Sequence[OptionInput]) -> list[OptionItem]:
    """The options a ``set_options`` stores: a sent value is kept; a value-less
    option keeps the stored code of the first stored option with the same
    trimmed label; only a new option's code is its trimmed label."""
    by_label: dict[str, str] = {}
    for option in normalize_options(stored):
        by_label.setdefault(option["label"].strip(), option["value"])
    final = [
        OptionItem(value=by_label[o.label.strip()], label=o.label)
        if o.value is None and o.label.strip() in by_label
        else o.to_option_item()
        for o in sent
    ]
    if len({o.value for o in final}) != len(final):
        raise OptionValueConflictError("two options would share one stored value")
    return final


async def _set_options(
    db: AsyncSession, project_id: UUID, template_id: UUID, index: int, op: SetOptionsOp
) -> AppliedDraftOp:
    row = await template_field_service.owned_field(
        db, template_id=template_id, field_id=op.field_id
    )
    if row.field_type not in _OPTION_TYPES:
        raise OptionsNotApplicableError("set_options applies to select and multiselect questions")
    before = {"options": normalize_options(row.allowed_values)}
    final = _resolve_options(row.allowed_values, op.options)
    section = await owned_section(db, template_id=template_id, section_id=row.entity_type_id)
    section_label = section.label
    field = await template_field_service.update_field(
        db,
        project_id=project_id,
        template_id=template_id,
        field_id=op.field_id,
        payload=TemplateFieldUpdateRequest(allowed_values=final),
    )
    return AppliedDraftOp(
        op_index=index,
        op="set_options",
        field=field,
        section_id=field.entity_type_id,
        section_label=section_label,
        before=before,
        after={"options": [o.model_dump() for o in final]},
    )


async def _delete(
    db: AsyncSession, project_id: UUID, template_id: UUID, index: int, op: DeleteQuestionOp
) -> AppliedDraftOp:
    row = await template_field_service.owned_field(
        db, template_id=template_id, field_id=op.field_id
    )
    before = {
        "field_id": str(row.id),
        "label": row.label,
        "name": row.name,
        "type": row.field_type,
        "section_id": str(row.entity_type_id),
    }
    await template_field_service.delete_field(
        db, project_id=project_id, template_id=template_id, field_id=op.field_id
    )
    return AppliedDraftOp(op_index=index, op="delete_question", before=before)


async def _section_field_ids(db: AsyncSession, section_id: UUID) -> list[UUID]:
    return list(
        (
            await db.execute(
                select(ExtractionField.id)
                .where(ExtractionField.entity_type_id == section_id)
                .order_by(ExtractionField.sort_order, ExtractionField.id)
            )
        ).scalars()
    )


async def _renumber(
    db: AsyncSession, project_id: UUID, template_id: UUID, field_ids: Sequence[UUID]
) -> None:
    await template_field_service.reorder_fields(
        db,
        project_id=project_id,
        template_id=template_id,
        payload=TemplateFieldReorderRequest(
            updates=[
                TemplateFieldSortOrderUpdate(id=fid, sort_order=i)
                for i, fid in enumerate(field_ids)
            ]
        ),
    )


async def _move(
    db: AsyncSession, project_id: UUID, template_id: UUID, index: int, op: MoveQuestionOp
) -> AppliedDraftOp:
    row = await template_field_service.owned_field(
        db, template_id=template_id, field_id=op.field_id
    )
    before = {"section_id": str(row.entity_type_id), "sort_order": row.sort_order}
    section = await owned_section(db, template_id=template_id, section_id=op.section_id)
    section_label = section.label
    field = await template_field_service.move_field(
        db,
        project_id=project_id,
        template_id=template_id,
        field_id=op.field_id,
        payload=TemplateFieldMoveRequest(entity_type_id=op.section_id, sort_order=op.position),
    )
    order = [fid for fid in await _section_field_ids(db, op.section_id) if fid != op.field_id]
    position = min(op.position, len(order))
    order.insert(position, op.field_id)
    await _renumber(db, project_id, template_id, order)
    return AppliedDraftOp(
        op_index=index,
        op="move_question",
        field=field,
        section_id=op.section_id,
        section_label=section_label,
        before=before,
        after={"section_id": str(op.section_id), "position": position},
    )


async def _reorder(
    db: AsyncSession, project_id: UUID, template_id: UUID, index: int, op: ReorderQuestionsOp
) -> AppliedDraftOp:
    section = await owned_section(db, template_id=template_id, section_id=op.section_id)
    section_label = section.label
    current = await _section_field_ids(db, op.section_id)
    if len(set(op.field_ids)) != len(op.field_ids) or set(op.field_ids) != set(current):
        raise ReorderMismatchError("field_ids must name exactly this section's questions")
    await _renumber(db, project_id, template_id, op.field_ids)
    return AppliedDraftOp(
        op_index=index,
        op="reorder_questions",
        section_id=op.section_id,
        section_label=section_label,
        field_ids=list(op.field_ids),
        before={"field_ids": [str(fid) for fid in current]},
        after={"field_ids": [str(fid) for fid in op.field_ids]},
    )


async def _add_section(
    db: AsyncSession, project_id: UUID, template_id: UUID, index: int, op: AddSectionOp
) -> AppliedDraftOp:
    # Checked here, not left to SectionCreateRequest: its validator would
    # surface the same rule as a bare validation error.
    if (op.cardinality == "many") != (op.entry_label is not None):
        raise SectionEntryLabelCardinalityError(
            "a repeating section needs an entry_label and only a repeating section takes one"
        )
    taken = set(
        (
            await db.execute(
                select(ExtractionEntityType.name).where(
                    ExtractionEntityType.project_template_id == template_id
                )
            )
        ).scalars()
    )
    section = await template_section_service.create_section(
        db,
        project_id=project_id,
        template_id=template_id,
        payload=SectionCreateRequest(
            name=template_field_naming.derive_field_name(op.label, taken),
            label=op.label,
            description=op.description,
            cardinality=op.cardinality,
            parent_entity_type_id=op.parent_section_id,
            entry_label=op.entry_label,
            is_required=op.required,
        ),
    )
    return AppliedDraftOp(op_index=index, op="add_section", section=section)


async def _update_section(
    db: AsyncSession, project_id: UUID, template_id: UUID, index: int, op: UpdateSectionOp
) -> AppliedDraftOp:
    sent = op.model_dump(exclude_unset=True, exclude={"op", "section_id"})
    row = await owned_section(db, template_id=template_id, section_id=op.section_id)
    before = {key: getattr(row, key) for key in sent}
    section = await template_section_service.update_section(
        db,
        project_id=project_id,
        template_id=template_id,
        section_id=op.section_id,
        payload=SectionUpdateRequest(**sent),
    )
    return AppliedDraftOp(
        op_index=index,
        op="update_section",
        section=section,
        before=before,
        after={key: getattr(section, key) for key in sent},
    )


async def _delete_section(
    db: AsyncSession, project_id: UUID, template_id: UUID, index: int, op: DeleteSectionOp
) -> AppliedDraftOp:
    row = await owned_section(db, template_id=template_id, section_id=op.section_id)
    before = {"section_id": str(row.id), "label": row.label, "cardinality": row.cardinality}
    # The REST delete cascades child sections; an agent deletes them one by one.
    if await template_section_service.owns_children(db, section_id=op.section_id):
        raise SectionOwnsChildrenError("delete or move the child sections first")
    await template_section_service.delete_section(
        db, project_id=project_id, template_id=template_id, section_id=op.section_id
    )
    return AppliedDraftOp(op_index=index, op="delete_section", before=before)


async def _live_instruction(db: AsyncSession, template_id: UUID) -> str | None:
    """The stored instruction, read from the row (not the identity map)."""
    return (
        await db.execute(
            select(ProjectExtractionTemplate.llm_template_instruction).where(
                ProjectExtractionTemplate.id == template_id
            )
        )
    ).scalar_one()


async def _set_instruction(
    db: AsyncSession, project_id: UUID, template_id: UUID, index: int, op: SetInstructionOp
) -> AppliedDraftOp:
    old = await _live_instruction(db, template_id)
    new = (
        await set_template_instruction(
            db,
            project_id=project_id,
            template_id=template_id,
            llm_template_instruction=op.instruction,
        )
    ).llm_template_instruction
    return AppliedDraftOp(
        op_index=index,
        op="set_instruction",
        changed=new != old,
        before={"instruction": old},
        after={"instruction": new},
    )


async def draft_lint_counts(db: AsyncSession, *, template_id: UUID) -> tuple[int, int]:
    """``(block, warn)`` lint finding counts over the live (draft) tree."""
    findings = lint_tree(
        await live_entity_types(db, template_id=template_id),
        await _live_instruction(db, template_id),
    )
    block = sum(1 for finding in findings if finding.status == "block")
    return block, len(findings) - block


async def _dispatch(
    db: AsyncSession, project_id: UUID, template_id: UUID, index: int, op: DraftOp
) -> AppliedDraftOp:
    match op:
        case AddQuestionOp():
            return await _add(db, project_id, template_id, index, op)
        case UpdateQuestionOp():
            return await _update(db, project_id, template_id, index, op)
        case DeleteQuestionOp():
            return await _delete(db, project_id, template_id, index, op)
        case MoveQuestionOp():
            return await _move(db, project_id, template_id, index, op)
        case ReorderQuestionsOp():
            return await _reorder(db, project_id, template_id, index, op)
        case SetOptionsOp():
            return await _set_options(db, project_id, template_id, index, op)
        case AddSectionOp():
            return await _add_section(db, project_id, template_id, index, op)
        case UpdateSectionOp():
            return await _update_section(db, project_id, template_id, index, op)
        case DeleteSectionOp():
            return await _delete_section(db, project_id, template_id, index, op)
        case SetInstructionOp():
            return await _set_instruction(db, project_id, template_id, index, op)


async def apply_draft_ops(
    db: AsyncSession, *, project_id: UUID, template_id: UUID, ops: Sequence[DraftOp]
) -> list[AppliedDraftOp]:
    """Apply each op in order; a failure raises ``DraftOpError`` naming its index.

    Earlier ops in the batch stay flushed (not rolled back) — the caller
    (Task 10b's tool) owns the transaction and decides whether to commit a
    partial batch or roll the whole thing back.
    """
    applied: list[AppliedDraftOp] = []
    for index, op in enumerate(ops):
        try:
            applied.append(await _dispatch(db, project_id, template_id, index, op))
        except _OP_ERRORS as exc:
            raise DraftOpError(index, exc) from exc
    return applied
