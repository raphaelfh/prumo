"""The project's review question, rendered for the AI.

``projects.picots_config_ai_review`` is a JSONB column whose name promises it
feeds the model; this module is what makes it do so. Because the review
question reaches every prompt from here, the seeded template instructions
carry no slot asking the manager to retype it.

Two halves, split so the rendering is testable without a database:

* ``render_review_question`` — pure, and where every shape decision lives:
  the PICOTS slots, then the project's eligibility and eligible study designs.
* ``build_review_question`` — reads the project + the one toggle.

The column's writer is ``PUT /api/v1/projects/{project_id}/ai-context``
(manager-only). It has no server default, and rows written before that endpoint
existed can hold anything: absent, ``{}``, per-slot dicts, per-slot strings, a
``timing`` nested one level deeper than its five siblings, or junk. Every branch below
exists because one of those shapes is reachable, not defensively.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from uuid import UUID

from fastapi import status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.repositories.project_repository import ProjectRepository
from app.services.project_protocol import bump_protocol_revision

if TYPE_CHECKING:
    from app.models.project import Project

#: Ceiling on the rendered block. Mirrors ``llm_template_instruction``'s
#: ``max_length=4000`` (``schemas/hitl_session.py``). The cap lives in the
#: RENDERER: the API is the column's writer, but stored rows predate it, so
#: only a cap at render time bounds what reaches the prompt.
MAX_REVIEW_CONTEXT_CHARS = 4000

#: Storage keys in the instrument's P-I-C-O-T-S order. This tuple IS the
#: rendered order, which the unit tests assert as a whole string.
_SLOT_KEYS = (
    "population",
    "index_models",
    "comparator_models",
    "outcomes",
    "timing",
    "setting_and_intended_use",
)

#: Slots whose label never varies.
_FIXED_LABELS = {
    "population": "Population",
    "outcomes": "Outcome(s)",
    "timing": "Timing",
    "setting_and_intended_use": "Setting and intended use",
}

#: The I and C labels vary by review type, and use the INSTRUMENT's own wording
#: — PROBAST+AI phrases its applicability items against "index model(s)", so a
#: generic "Intervention" would decouple the prompt from the tool grading it.
#: Keys mirror the ``review_type`` enum; anything else falls back to ``other``.
_IC_LABELS = {
    "interventional": ("Intervention", "Comparator"),
    "predictive_model": ("Index model(s)", "Comparator model(s)"),
    "diagnostic": ("Index test", "Reference standard"),
    "prognostic": ("Prognostic factor", "Comparator"),
    "qualitative": ("Phenomenon", "Comparator"),
    "other": ("Intervention", "Comparator"),
}

#: Migration 0063 flattened ``timing`` to match its five siblings, and the PICOT
#: editor writes the flat shape. The nested pair is still read, PERMANENTLY, not
#: as a leftover: Railway and Vercel deploy independently, so a browser holding
#: the pre-0063 bundle keeps writing ``timing.prediction_moment`` after the
#: migration has run, and a reader that only understood flat would silently drop
#: what that manager typed.
_TIMING_PARTS = ("prediction_moment", "prediction_horizon")


def labels_for(review_type: str | None) -> dict[str, str]:
    index_label, comparator_label = _IC_LABELS.get(review_type or "", _IC_LABELS["other"])
    return {**_FIXED_LABELS, "index_models": index_label, "comparator_models": comparator_label}


def _texts(raw: Any) -> tuple[str, list[str], list[str]]:
    """One slot as (description, inclusion, exclusion) — never raising.

    A bare string is read as the description (the shape the ORM's declared
    default would produce). Anything that is neither a string nor a mapping
    contributes nothing rather than being ``str()``-ed into the prompt.
    """
    if isinstance(raw, str):
        return raw.strip(), [], []
    if not isinstance(raw, Mapping):
        return "", [], []
    description = raw.get("description")
    return (
        description.strip() if isinstance(description, str) else "",
        _string_list(raw.get("inclusion")),
        _string_list(raw.get("exclusion")),
    )


def _string_list(raw: Any) -> list[str]:
    """``jsonb_build_object`` with a SQL NULL emits JSON null, not ``[]``."""
    if not isinstance(raw, list):
        return []
    return [item.strip() for item in raw if isinstance(item, str) and item.strip()]


def _timing_texts(raw: Any) -> tuple[str, list[str], list[str]]:
    """One timing slot, flat (canonical) or nested (pre-0063, still reachable).

    Each half of the nested pair is read independently, so the realistic
    half-filled shape — a dict beside the string ``""``, produced by editing only
    one of the two — keeps the filled half instead of collapsing to nothing.
    """
    if not isinstance(raw, Mapping):
        return _texts(raw)
    if not any(part in raw for part in _TIMING_PARTS):
        return _texts(raw)  # flat only — the canonical shape
    # A HYBRID row carries both, so read the slot's own flat values FIRST and the
    # nested halves after. Branching either/or would drop whichever half the
    # branch did not take — and a hybrid is exactly what a cached pre-0063 bundle
    # creates when it edits one timing box on an already-flattened row.
    parts = [_texts(raw)] + [_texts(raw.get(part)) for part in _TIMING_PARTS]
    return (
        "; ".join(description for description, _, _ in parts if description),
        [item for _, inclusion, _ in parts for item in inclusion],
        [item for _, _, exclusion in parts for item in exclusion],
    )


def _picots_lines(picots: Any, review_type: str | None) -> list[str]:
    """The PICOTS half of the review question, one slot per line group.

    Empty slots are OMITTED, not padded: a line reading
    ``- Comparator model(s): (not specified)`` would be read by the model as a
    fact about the review rather than an unfilled form.

    A slot counts as empty only when its description AND both criteria lists
    are empty — a manager who typed inclusion criteria without a description
    still gets them, which a description-only test would silently drop.
    """
    if not isinstance(picots, Mapping):
        return []
    labels = labels_for(review_type)
    lines: list[str] = []
    for key in _SLOT_KEYS:
        reader = _timing_texts if key == "timing" else _texts
        description, inclusion, exclusion = reader(picots.get(key))
        if not description and not inclusion and not exclusion:
            continue
        lines.append(f"- {labels[key]}: {description}".rstrip())
        if inclusion:
            lines.append(f"  Include: {'; '.join(inclusion)}")
        if exclusion:
            lines.append(f"  Exclude: {'; '.join(exclusion)}")
    return lines


def _protocol_lines(eligibility: Any, study_design: Any) -> list[str]:
    """Project eligibility and eligible study designs; ``notes`` never render.

    Both columns predate the bounded write shapes (``schemas/project_protocol``)
    and were never migrated, so a legacy dict or junk items read as empty.
    """
    eligibility = eligibility if isinstance(eligibility, Mapping) else {}
    inclusion = _string_list(eligibility.get("inclusion"))
    exclusion = _string_list(eligibility.get("exclusion"))
    designs = _string_list(study_design.get("types")) if isinstance(study_design, Mapping) else []
    lines: list[str] = []
    if inclusion or exclusion:
        lines.append("Eligibility:")
        if inclusion:
            lines.append(f"  Include: {'; '.join(inclusion)}")
        if exclusion:
            lines.append(f"  Exclude: {'; '.join(exclusion)}")
    if designs:
        lines.append(f"Eligible study designs: {'; '.join(designs)}")
    return lines


def render_review_question(
    picots: Any, review_type: str | None, eligibility: Any, study_design: Any
) -> str | None:
    """The review question as prompt text, or ``None`` when there is none.

    PICOTS first, then the project's eligibility and eligible study designs,
    under ONE cap: an empty eligibility/design leaves the PICOTS bytes exactly
    as they were before those joined the prompt (ADR 0023).
    """
    lines = _picots_lines(picots, review_type) + _protocol_lines(eligibility, study_design)
    if not lines:
        return None
    block = "\n".join(lines)
    if len(block) > MAX_REVIEW_CONTEXT_CHARS:
        return block[: MAX_REVIEW_CONTEXT_CHARS - 1] + "…"
    return block


def _render_for(project: Project) -> str | None:
    """The one place a project row becomes the review question."""
    return render_review_question(
        project.picots_config_ai_review,
        project.review_type,
        project.eligibility_criteria,
        project.study_design,
    )


def _picots_enabled(settings: Any) -> bool:
    """``settings.ai_context.picots`` — an absent key is the default, ON."""
    ai_context = (settings or {}).get("ai_context") if isinstance(settings, Mapping) else None
    return bool((ai_context or {}).get("picots", True)) if isinstance(ai_context, Mapping) else True


@dataclass(frozen=True, slots=True)
class ReviewQuestion:
    """The rendered question for a project that exists; ``text`` is ``None`` when muted or empty.

    ``revision`` is the project's ``protocol_revision`` the text was built from.
    """

    text: str | None
    revision: int


async def build_review_question(db: AsyncSession, project_id: UUID) -> ReviewQuestion | None:
    """The project's review question, or ``None`` when the project is missing.

    ``settings.ai_context.picots`` is the off switch for the WHOLE block,
    defaulting to ON: an absent key is the default state, and an empty protocol
    renders nothing, so every project that has not filled the editor keeps a
    byte-identical prompt.
    """
    project = await ProjectRepository(db).get_by_id(project_id)
    if project is None:
        return None
    text = _render_for(project) if _picots_enabled(project.settings) else None
    return ReviewQuestion(text=text, revision=project.protocol_revision)


class ProjectNotFoundError(Exception):
    """Raised when the project row is missing. HTTP translation in the router."""


class StaleProtocolRevisionError(AppError):
    """The protocol moved since the caller read it; nothing was written."""

    def __init__(self, *, current_revision: int, current: dict[str, Any]) -> None:
        super().__init__(
            code="STALE_VALUE",
            message="The review question changed since you read it.",
            status_code=status.HTTP_409_CONFLICT,
            details={"current_revision": current_revision, "current": current},
        )


def _slots_payload(raw: Any) -> dict[str, dict[str, Any]]:
    """Every slot in canonical flat form, for the editor.

    Reuses the SAME readers the prompt uses, so what the editor shows and what
    the model gets cannot describe the stored value differently — including for
    a legacy nested or hybrid ``timing``.
    """
    picots = raw if isinstance(raw, Mapping) else {}
    out: dict[str, dict[str, Any]] = {}
    for key in _SLOT_KEYS:
        reader = _timing_texts if key == "timing" else _texts
        description, inclusion, exclusion = reader(picots.get(key))
        out[key] = {
            "description": description,
            "inclusion": inclusion,
            "exclusion": exclusion,
        }
    return out


async def get_ai_context(db: AsyncSession, project_id: UUID) -> dict[str, Any]:
    """The editor's read model. Raises ``ProjectNotFoundError`` if the row is gone."""
    project = await ProjectRepository(db).get_by_id(project_id)
    if project is None:
        raise ProjectNotFoundError(f"Project {project_id} not found")
    enabled = _picots_enabled(project.settings)
    return {
        "picots": _slots_payload(project.picots_config_ai_review),
        "labels": labels_for(project.review_type),
        "review_type": project.review_type,
        "picots_enabled": enabled,
        "preview": _render_for(project) if enabled else None,
        "revision": project.protocol_revision,
    }


async def set_ai_context(
    db: AsyncSession,
    project_id: UUID,
    *,
    picots: dict[str, Any] | None,
    picots_enabled: bool | None,
    expected_revision: int | None = None,
    slot_updates: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Write either half (or both) under one row lock.

    ``picots`` replaces the whole question; ``slot_updates`` replaces only the
    named slots of the stored one. The two are mutually exclusive.

    ``expected_revision``, when given, is compared under the lock before any
    write: a mismatch raises ``StaleProtocolRevisionError`` carrying the current
    read model, and nothing is written.

    The switch goes through ``ProjectRepository.update_settings_key``:
    ``projects.settings`` is one JSONB column shared by several writers, and a
    write outside that helper could drop a concurrent sibling key, such as the
    ``managers_see_reviewers`` blind-review control.
    """
    if picots is not None and slot_updates is not None:
        raise ValueError("picots and slot_updates are mutually exclusive")
    projects = ProjectRepository(db)
    project = await projects.lock_for_update(project_id)
    if project is None:
        raise ProjectNotFoundError(f"Project {project_id} not found")
    if expected_revision is not None and expected_revision != project.protocol_revision:
        raise StaleProtocolRevisionError(
            current_revision=project.protocol_revision,
            current=await get_ai_context(db, project_id),
        )
    old_enabled = _picots_enabled(project.settings)
    old_picots = project.picots_config_ai_review
    if slot_updates is not None:
        # A new dict: plain JSONB tracks reassignment only.
        stored = old_picots if isinstance(old_picots, Mapping) else {}
        picots = {**stored, **slot_updates}

    # Switch first, question second. ``update_settings_key`` re-reads the
    # locked row with ``populate_existing``, and with ``autoflush=False`` that
    # re-read would discard a question assigned (unflushed) before it.
    if picots_enabled is not None:
        await projects.update_settings_key(
            project_id, "ai_context", lambda old: {**dict(old or {}), "picots": picots_enabled}
        )
    if picots is not None:
        project.picots_config_ai_review = picots
    # After ``update_settings_key`` for the same reason: its re-read would
    # discard an earlier unflushed bump. One bump per call, real changes only.
    if (picots_enabled is not None and picots_enabled != old_enabled) or (
        picots is not None and picots != old_picots
    ):
        bump_protocol_revision(project)
    await db.flush()
    return await get_ai_context(db, project_id)
