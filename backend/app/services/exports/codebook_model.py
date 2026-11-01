"""The version-spanning Codebook model and rule-3 field codes (spec §5 rule 3).

PURE: no DB, no openpyxl. Lives directly under ``exports/`` for the reason
``values.py`` gives: the service imports ``CodebookEntry`` at module level, so a
home inside ``exports/extraction/`` would close the import cycle. The service
descriptors are therefore TYPE_CHECKING-only.

Scope is the active version plus every version pinned by a run. Metadata comes
from the active version, else from the latest pinned version holding the field.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING
from uuid import UUID

from app.models.extraction import ExtractionFieldType
from app.services.exports.descriptors import walk_sections

if TYPE_CHECKING:
    from app.services.exports.values import OptionLabels
    from app.services.extraction_export_service import FieldDescriptor, SectionDescriptor


@dataclass(frozen=True, slots=True)
class VersionSections:
    """One template version's section tree, loaded once (R14)."""

    version_id: UUID
    version_label: int  # ExtractionTemplateVersion.version
    sections: tuple[SectionDescriptor, ...]


@dataclass(frozen=True, slots=True)
class CodebookOption:
    code: str
    label: str
    order: int  # 1-based position in the first version that has the code
    in_current_version: bool


@dataclass(frozen=True, slots=True)
class CodebookEntry:
    field_id: UUID
    field_code: str
    section_id: UUID | None  # None when the section is absent from the active tree
    section_code: str
    section_label: str
    parent_section_code: str | None
    field_label: str
    type: ExtractionFieldType
    unit: str | None
    allowed_units: tuple[str, ...]
    required: bool
    is_entity_key: bool
    allowed_absent_codes: tuple[str, ...]
    allow_other: bool
    description: str | None
    in_current_version: bool
    versions: tuple[int, ...]  # ascending version labels holding the field
    options: tuple[CodebookOption, ...]


def _suffixed(bare: str, field_id: UUID) -> str:
    return f"{bare}__{str(field_id).split('-')[0]}"


def assign_field_codes(candidates: Sequence[tuple[UUID, str, bool]]) -> dict[UUID, str]:
    """Rule 3 over ``(field_id, bare_code, is_active)`` candidates.

    Candidates come in order: active fields in walk order, then non-active
    fields latest version first. An active field keeps the bare code unless an
    earlier active field holds it (D1); a non-active field keeps it only when
    no other candidate shares it.
    """
    shared = Counter(bare for _, bare, _ in candidates)
    held: set[str] = set()
    codes: dict[UUID, str] = {}
    for field_id, bare, is_active in candidates:
        if is_active and bare not in held:
            held.add(bare)
            codes[field_id] = bare
        elif not is_active and shared[bare] == 1:
            codes[field_id] = bare
        else:
            codes[field_id] = _suffixed(bare, field_id)
    return codes


def _placed_fields(
    version: VersionSections,
) -> list[tuple[SectionDescriptor, FieldDescriptor]]:
    return [(s, f) for s in walk_sections(version.sections) for f in s.fields]


def build_codebook_entries(
    active: VersionSections,
    pinned_latest_first: Sequence[VersionSections],
    labels: OptionLabels,
) -> tuple[CodebookEntry, ...]:
    """One entry per field of any version, in field-code candidate order.

    ``pinned_latest_first`` is taken as given: the loader sorts it once and hands
    the same sequence to ``build_option_labels``, so labels and metadata agree.
    """
    by_latest = (active, *pinned_latest_first)
    source: dict[UUID, tuple[VersionSections, SectionDescriptor, FieldDescriptor]] = {}
    versions: dict[UUID, set[int]] = {}
    for version in by_latest:
        for section, f in _placed_fields(version):
            source.setdefault(f.field_id, (version, section, f))
            versions.setdefault(f.field_id, set()).add(version.version_label)
    active_ids = {s.entity_type_id for s in active.sections}
    codes = assign_field_codes(
        [(fid, f"{s.name}.{f.name}", v is active) for fid, (v, s, f) in source.items()]
    )
    entries: list[CodebookEntry] = []
    for fid, (version, section, f) in source.items():
        parent = next(
            (s for s in version.sections if s.entity_type_id == section.parent_entity_type_id),
            None,
        )
        entries.append(
            CodebookEntry(
                field_id=fid,
                field_code=codes[fid],
                section_id=section.entity_type_id if section.entity_type_id in active_ids else None,
                section_code=section.name,
                section_label=section.label,
                parent_section_code=parent.name if parent is not None else None,
                field_label=f.label,
                type=f.type,
                unit=f.unit,
                allowed_units=f.allowed_units,
                required=f.is_required,
                is_entity_key=f.is_entity_key,
                allowed_absent_codes=f.allowed_absent_codes,
                allow_other=f.allow_other,
                description=f.description,
                in_current_version=version is active,
                versions=tuple(sorted(versions[fid])),
                options=_options(fid, by_latest, labels),
            )
        )
    return tuple(entries)


def _options(
    field_id: UUID, by_latest: Sequence[VersionSections], labels: OptionLabels
) -> tuple[CodebookOption, ...]:
    """The union of ``(field_id, code)`` over active, then pinned latest-first."""
    options: dict[str, CodebookOption] = {}
    for i, version in enumerate(by_latest):
        for _, f in _placed_fields(version):
            if f.field_id != field_id:
                continue
            for order, av in enumerate(f.allowed_values, start=1):
                if av.value not in options:
                    options[av.value] = CodebookOption(
                        av.value, labels[(field_id, av.value)], order, i == 0
                    )
    return tuple(options.values())


def apply_field_codes(
    sections: Sequence[SectionDescriptor], codes: Mapping[UUID, str]
) -> tuple[SectionDescriptor, ...]:
    """Stamp each field's ``code``; a field absent from ``codes`` keeps its own."""
    return tuple(
        replace(
            s,
            fields=tuple(replace(f, code=codes.get(f.field_id, f.code)) for f in s.fields),
        )
        for s in sections
    )


def field_code_clashes(
    entries: Sequence[CodebookEntry],
) -> tuple[tuple[str, tuple[str, ...]], ...]:
    """``(bare, codes in entry order)`` for each bare code two or more entries share (D1)."""
    groups: dict[str, list[str]] = {}
    for e in entries:
        bare = e.field_code.removesuffix(_suffixed("", e.field_id))
        groups.setdefault(bare, []).append(e.field_code)
    return tuple((bare, tuple(codes)) for bare, codes in groups.items() if len(codes) > 1)
