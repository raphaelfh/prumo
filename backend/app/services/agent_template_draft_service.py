"""Questionnaire edits the MCP agent may make (spec §5.2): add a question, or reword
one. Both stay invisible to reviewers and AI until a manager publishes, and only on a
non-narrow active version. Flushes only; the MCP tool commits."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionField
from app.repositories.extraction_template_version_repository import (
    ExtractionTemplateVersionRepository,
)
from app.schemas.mcp_template_draft import AddQuestionOp, DraftOp, UpdateQuestionOp
from app.schemas.template_structure import (
    TemplateFieldCreateRequest,
    TemplateFieldRead,
    TemplateFieldUpdateRequest,
)
from app.services import template_field_naming, template_field_service
from app.services.extraction_snapshot import snapshot_is_narrow
from app.services.template_field_service import (
    DuplicateFieldNameError,
    EntityTypeNotFoundError,
    FieldNotFoundError,
)
from app.services.template_section_service import SectionNotFoundError, owned_section
from app.services.template_version_read_service import NoActiveTemplateVersionError

_OP_ERRORS = (
    SectionNotFoundError,
    EntityTypeNotFoundError,
    FieldNotFoundError,
    DuplicateFieldNameError,
    ValidationError,
    DBAPIError,
)

# Op-model attr -> ExtractionField column, for the "before" snapshot and the
# TemplateFieldUpdateRequest payload. ``instructions`` is user-facing for the
# field's ``llm_description`` column.
_UPDATE_COLUMN = {"label": "label", "description": "description", "instructions": "llm_description"}


class NarrowBaselineError(Exception):
    """The active version is narrow: runs chain to live rows, so a draft edit would leak."""


class DraftOpError(Exception):
    """One op in the batch failed; ``op_index`` names which."""

    def __init__(self, op_index: int, cause: Exception) -> None:
        super().__init__(f"op {op_index}: {cause}")
        self.op_index = op_index
        self.cause = cause


@dataclass(frozen=True)
class AppliedDraftOp:
    """One successfully-applied op, for the MCP tool's audit row and reply."""

    op_index: int
    op: Literal["add_question", "update_question"]
    field: TemplateFieldRead
    before: dict[str, Any] | None


async def assert_isolated_baseline(db: AsyncSession, *, template_id: UUID) -> None:
    """Refuse a draft edit unless the active version is a wide, isolated snapshot.

    A narrow snapshot chains a run to the LIVE rows (spec §2), so editing the
    live structure would leak the draft to any run still pinned to it before a
    manager publishes.
    """
    active = await ExtractionTemplateVersionRepository(db).get_active(template_id)
    if active is None:
        raise NoActiveTemplateVersionError(f"Project template {template_id} has no active version.")
    # Hand snapshot_is_narrow the entity_types LIST: the whole dict reads narrow for every template.
    if snapshot_is_narrow((active.schema_ or {}).get("entity_types") or []):
        raise NarrowBaselineError(f"Project template {template_id} has a narrow active version.")


async def _add(
    db: AsyncSession, project_id: UUID, template_id: UUID, index: int, op: AddQuestionOp
) -> AppliedDraftOp:
    await owned_section(db, template_id=template_id, section_id=op.section_id)
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
        allowed_values=op.options,
        llm_description=op.instructions,
        sort_order=sort_order,
    )
    field = await template_field_service.create_field(
        db, project_id=project_id, template_id=template_id, payload=payload
    )
    return AppliedDraftOp(op_index=index, op="add_question", field=field, before=None)


async def _update(
    db: AsyncSession, project_id: UUID, template_id: UUID, index: int, op: UpdateQuestionOp
) -> AppliedDraftOp:
    sent = op.model_dump(exclude_unset=True, exclude={"op", "field_id"})
    row = await template_field_service.owned_field(
        db, template_id=template_id, field_id=op.field_id
    )
    before = {key: getattr(row, _UPDATE_COLUMN[key]) for key in sent}
    payload = TemplateFieldUpdateRequest(
        **{_UPDATE_COLUMN[key]: value for key, value in sent.items()}
    )
    field = await template_field_service.update_field(
        db, project_id=project_id, template_id=template_id, field_id=op.field_id, payload=payload
    )
    return AppliedDraftOp(op_index=index, op="update_question", field=field, before=before)


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
            if isinstance(op, AddQuestionOp):
                applied.append(await _add(db, project_id, template_id, index, op))
            else:
                applied.append(await _update(db, project_id, template_id, index, op))
        except _OP_ERRORS as exc:
            raise DraftOpError(index, exc) from exc
    return applied
