# backend/app/services/template_portable_service.py
"""Portable template import/export (``prumo-template@1``).

Both directions live side by side so the serializer is the exact inverse of
the importer; ``tests/integration/test_template_portable_service.py`` proves
it with one round-trip per seeded extraction template. Import always creates
a NEW project template (``global_template_id = NULL``), activates it, and
publishes v1 through the one publish path — never touching an existing
template's draft, versions, or run pins (spec §3.1).

No topological sort: a nested document is parent-first by construction, and
one template-wide pre-order counter gives entity types the tie-free
``sort_order`` every other writer produces (SNAPSHOT_SQL sorts by it bare).
Only the clone service's TAIL (sibling deactivation, republish) is shared.

Design: docs/superpowers/specs/2026-08-23-template-portable-import-export-design.md §5.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from fastapi import status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.error_handler import AppError, ConflictError
from app.models.extraction import (
    ExtractionEntityRole,
    ExtractionEntityType,
    ExtractionField,
    ProjectExtractionTemplate,
)
from app.models.extraction_versioning import TemplateKind
from app.schemas.hitl_session import CloneTemplateResponse, TemplatePortableRefusalCode
from app.schemas.template_portable import (
    PORTABLE_FORMAT_VERSION,
    PortableField,
    PortableSection,
    PortableTemplate,
)
from app.services.project_template_active_service import (
    ProjectTemplateNotFoundError,
    deactivate_sibling_extraction_templates,
)
from app.services.template_version_service import TemplateVersionService

MAX_REPORTED_ERRORS = 20
_SINGLE_ACTIVE_INDEX = "uq_one_active_extraction_template_per_project"


def _issues(exc: ValidationError) -> tuple[list[dict[str, str]], int]:
    """``[{path, message}]`` capped at MAX_REPORTED_ERRORS, plus the total."""
    found = [{"path": _loc_to_path(tuple(e["loc"])), "message": e["msg"]} for e in exc.errors()]
    return found[:MAX_REPORTED_ERRORS], len(found)


def _loc_to_path(loc: tuple[int | str, ...]) -> str:
    out = ""
    for part in loc:
        out += f"[{part}]" if isinstance(part, int) else (f".{part}" if out else str(part))
    return out


class _PortableRefusal(AppError):
    """422 with the capped issue list in BOTH ``details`` (typed, what the UI
    renders) and ``message`` (one line per issue, for clients that only read
    the message — spec §5.4)."""

    def __init__(
        self,
        code: TemplatePortableRefusalCode,
        heading: str,
        issues: list[dict[str, str]],
        total: int,
    ) -> None:
        lines = [f"{i['path']}: {i['message']}" for i in issues]
        suffix = f"\n(+{total - len(issues)} more)" if total > len(issues) else ""
        super().__init__(
            code=code,
            message=f"{heading} ({total} issue(s)):\n" + "\n".join(lines) + suffix,
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            details={"errors": issues, "error_count": total},
        )


class TemplateImportInvalidError(_PortableRefusal):
    def __init__(self, issues: list[dict[str, str]], *, total: int) -> None:
        super().__init__(
            TemplatePortableRefusalCode.TEMPLATE_IMPORT_INVALID,
            "Invalid template file",
            issues,
            total,
        )


class TemplateExportInvalidError(_PortableRefusal):
    def __init__(self, issues: list[dict[str, str]], *, total: int) -> None:
        super().__init__(
            TemplatePortableRefusalCode.TEMPLATE_EXPORT_INVALID,
            "This template cannot be exported",
            issues,
            total,
        )


class TemplateImportUnsupportedVersionError(AppError):
    def __init__(self, found: Any) -> None:
        super().__init__(
            code=TemplatePortableRefusalCode.TEMPLATE_IMPORT_UNSUPPORTED_VERSION,
            message=(
                f"Unsupported template format: expected prumo_template = "
                f"{PORTABLE_FORMAT_VERSION}, found {repr(found)[:80]}."
            ),
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )


class TemplateImportWrongKindError(AppError):
    def __init__(self, found: Any) -> None:
        super().__init__(
            code=TemplatePortableRefusalCode.TEMPLATE_IMPORT_WRONG_KIND,
            message=f"Only extraction templates can be imported here (file kind: {repr(found)[:80]}).",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )


def parse_portable_document(raw: dict[str, Any]) -> PortableTemplate:
    """Validate a raw document into the model with TYPED failures. The version
    and kind pre-checks run first so the two most common "wrong file" cases get
    their own code instead of a generic list."""
    version = raw.get("prumo_template")
    if version != PORTABLE_FORMAT_VERSION:
        raise TemplateImportUnsupportedVersionError(version)
    kind = raw.get("kind")
    if kind != TemplateKind.EXTRACTION.value:
        raise TemplateImportWrongKindError(kind)
    try:
        return PortableTemplate.model_validate(raw)
    except ValidationError as exc:
        issues, total = _issues(exc)
        raise TemplateImportInvalidError(issues, total=total) from exc


# ---------------------------------------------------------------- export


async def _owned_extraction_template(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> ProjectExtractionTemplate:
    tpl = await db.get(ProjectExtractionTemplate, template_id)
    if tpl is None or tpl.project_id != project_id or tpl.kind != TemplateKind.EXTRACTION.value:
        raise ProjectTemplateNotFoundError(f"Project template {template_id} not found")
    return tpl


def _section_dict(et: ExtractionEntityType, children: list[ExtractionEntityType]) -> dict[str, Any]:
    is_group = et.role == ExtractionEntityRole.MODEL_CONTAINER.value
    return {
        "name": et.name,
        "label": et.label,
        "description": et.description,
        "required": et.is_required,
        # A group always repeats; ``repeats`` is only meaningful elsewhere.
        "repeats": (et.cardinality == "many") and not is_group,
        "group": is_group,
        "entry_label": et.entry_label if is_group else None,
        "fields": [
            PortableField.model_validate(f, from_attributes=True, by_name=True)
            for f in sorted(et.fields, key=lambda x: x.sort_order)
        ],
        "sections": [_section_dict(c, []) for c in children],
    }


async def to_portable(db: AsyncSession, *, project_id: UUID, template_id: UUID) -> PortableTemplate:
    """Serialize the LIVE structure (what the grid shows — spec §3.3)."""
    tpl = await _owned_extraction_template(db, project_id=project_id, template_id=template_id)
    rows = (
        (
            await db.execute(
                select(ExtractionEntityType)
                .where(ExtractionEntityType.project_template_id == template_id)
                .options(selectinload(ExtractionEntityType.fields))
                .order_by(ExtractionEntityType.sort_order, ExtractionEntityType.name)
            )
        )
        .scalars()
        .all()
    )
    children_of: dict[UUID, list[ExtractionEntityType]] = {}
    for et in rows:
        if et.parent_entity_type_id is not None:
            children_of.setdefault(et.parent_entity_type_id, []).append(et)
    roots = [et for et in rows if et.parent_entity_type_id is None]
    try:
        return PortableTemplate.model_validate(
            {
                "prumo_template": PORTABLE_FORMAT_VERSION,
                "kind": TemplateKind.EXTRACTION.value,
                "name": tpl.name,
                "description": tpl.description,
                "framework": tpl.framework,
                "version": tpl.version,
                "llm_template_instruction": tpl.llm_template_instruction or None,
                "sections": [_section_dict(et, children_of.get(et.id, [])) for et in roots],
            }
        )
    except ValidationError as exc:
        # Legacy rows the format cannot carry (e.g. an empty allowed_values
        # list) are a typed 422 naming the path, never a 500.
        issues, total = _issues(exc)
        raise TemplateExportInvalidError(issues, total=total) from exc


# ---------------------------------------------------------------- import


def _entity_type_row(
    section: PortableSection, *, template_id: UUID, parent_id: UUID | None, sort_order: int
) -> ExtractionEntityType:
    is_group = section.group
    role = (
        ExtractionEntityRole.MODEL_SECTION
        if parent_id is not None
        else ExtractionEntityRole.MODEL_CONTAINER
        if is_group
        else ExtractionEntityRole.STUDY_SECTION
    )
    return ExtractionEntityType(
        id=uuid4(),
        project_template_id=template_id,
        template_id=None,
        name=section.name,
        label=section.label,
        description=section.description,
        entry_label=(section.entry_label or "model") if is_group else None,
        parent_entity_type_id=parent_id,
        cardinality="many" if (is_group or section.repeats) else "one",
        role=role.value,
        sort_order=sort_order,
        is_required=section.is_required,
    )


def _field_row(f: PortableField, *, entity_type_id: UUID, sort_order: int) -> ExtractionField:
    # ``model_dump()`` (no alias) yields the column names 1:1.
    # validation_schema is vestigial (spec §4.4): same value the create path writes.
    return ExtractionField(
        entity_type_id=entity_type_id, sort_order=sort_order, validation_schema={}, **f.model_dump()
    )


async def import_portable(
    db: AsyncSession, *, project_id: UUID, doc: PortableTemplate, user_id: UUID
) -> CloneTemplateResponse:
    """Create a NEW active project template from ``doc`` and publish v1.

    Runs inside the caller's transaction; the caller commits. ids are
    pre-assigned so the whole tree lands in ONE flush (the clone service's
    shape); the deferred model_section-parent trigger fires at commit."""
    await deactivate_sibling_extraction_templates(db, project_id=project_id, keep_active_id=None)
    await db.flush()

    tpl = ProjectExtractionTemplate(
        id=uuid4(),
        project_id=project_id,
        global_template_id=None,
        name=doc.name,
        description=doc.description,
        framework=doc.framework,
        version=doc.version,
        kind=TemplateKind.EXTRACTION.value,
        schema_={},
        llm_template_instruction=doc.llm_template_instruction,
        is_active=True,
        created_by=user_id,
    )
    rows: list[ExtractionEntityType | ExtractionField] = []
    order = 0

    def add_section(section: PortableSection, parent_id: UUID | None) -> ExtractionEntityType:
        nonlocal order
        et = _entity_type_row(section, template_id=tpl.id, parent_id=parent_id, sort_order=order)
        order += 1
        rows.append(et)
        rows.extend(
            _field_row(f, entity_type_id=et.id, sort_order=i) for i, f in enumerate(section.fields)
        )
        return et

    for section in doc.sections:
        parent = add_section(section, None)
        for child in section.sections:
            add_section(child, parent.id)

    db.add(tpl)
    db.add_all(rows)
    try:
        await db.flush()
    except IntegrityError as exc:
        if _SINGLE_ACTIVE_INDEX in str(getattr(exc, "orig", exc)):
            # Two imports/switches raced on the single-active index: the
            # sibling UPDATE above ran on a snapshot that never saw the
            # winner. Nothing is written (caller never commits).
            raise ConflictError(
                "Another template was activated at the same time; retry the import."
            ) from exc
        raise

    # Publish v1 through the one publish path: snapshots under its locks and
    # clears the draft marker the inserts above just stamped.
    republished = await TemplateVersionService(db).republish(
        project_id=project_id, project_template_id=tpl.id, user_id=user_id
    )
    return CloneTemplateResponse(
        project_template_id=tpl.id,
        version_id=republished.version_id,
        entity_type_count=sum(isinstance(r, ExtractionEntityType) for r in rows),
        field_count=sum(isinstance(r, ExtractionField) for r in rows),
        created=True,
    )
