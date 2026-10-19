"""Questionnaire lint: problems in a template tree that block or weaken AI
extraction. Pure: no DB access, the caller passes the tree it read.

Each rule mirrors a runtime behavior: a repeating section without an
entity-key field raises ``entity_key.MissingEntityKeyError`` at kickoff; a
question's AI guidance is ``llm_description`` falling back to
``description`` (``app.llm.schema._description``); ``CUSTOMIZE_SLOT`` is the
frontend's unfilled-slot pattern (``TemplateInstructionControl.tsx``,
``TemplateInstructionPane.tsx``; a unit test pins the parity)."""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable

from app.schemas.extraction_run import RunViewEntityType, RunViewField
from app.schemas.template_lint import LintCode, LintFinding, LintStatus

CUSTOMIZE_SLOT = re.compile(r"\[customize:[^\]]*\]")
_SELECT_TYPES = frozenset({"select", "multiselect"})
_LABEL_LIMIT = 5


def lint_tree(entity_types: list[RunViewEntityType], instruction: str | None) -> list[LintFinding]:
    """One finding per rule that fires, in the rule order below."""
    parents = {et.parent_entity_type_id for et in entity_types}
    many = [et for et in entity_types if et.cardinality == "many"]
    findings = [
        _question_rule(entity_types, "SELECT_WITHOUT_OPTIONS", "block", _select_without_options),
        _section_rule(
            "REPEATING_SECTION_WITHOUT_ENTITY_KEY",
            "block",
            [et for et in many if not any(f.is_entity_key for f in et.fields)],
        ),
        _section_rule(
            "REPEATING_SECTION_WITHOUT_ENTRY_LABEL",
            "warn",
            [et for et in many if _blank(et.entry_label)],
        ),
        _section_rule(
            "EMPTY_SECTION",
            "warn",
            [et for et in entity_types if not et.fields and et.id not in parents],
        ),
        _question_rule(
            entity_types,
            "QUESTION_WITHOUT_AI_GUIDANCE",
            "warn",
            lambda f: _blank(f.llm_description) and _blank(f.description),
        ),
        _question_rule(
            entity_types,
            "UNRESOLVED_CUSTOMIZE_SLOT",
            "warn",
            lambda f: _has_slot(f.llm_description),
            extra=1 if _has_slot(instruction) else 0,
        ),
    ]
    return [finding for finding in findings if finding is not None]


def _section_rule(
    code: LintCode, status: LintStatus, offending: list[RunViewEntityType]
) -> LintFinding | None:
    if not offending:
        return None
    return LintFinding(
        code=code, status=status, section_label=offending[0].label, count=len(offending)
    )


def _question_rule(
    entity_types: Iterable[RunViewEntityType],
    code: LintCode,
    status: LintStatus,
    fires: Callable[[RunViewField], bool],
    *,
    extra: int = 0,
) -> LintFinding | None:
    """`extra` counts a non-question node (the instruction) that also fired."""
    hits = [(et, f) for et in entity_types for f in et.fields if fires(f)]
    if not hits and not extra:
        return None
    return LintFinding(
        code=code,
        status=status,
        section_label=hits[0][0].label if hits else None,
        question_labels=[f.label for _et, f in hits[:_LABEL_LIMIT]],
        count=len(hits) + extra,
    )


def _select_without_options(field: RunViewField) -> bool:
    return field.field_type in _SELECT_TYPES and not field.allowed_values


def _blank(value: str | None) -> bool:
    return not (value or "").strip()


def _has_slot(value: str | None) -> bool:
    return bool(value and CUSTOMIZE_SLOT.search(value))
