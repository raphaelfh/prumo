"""The project's review question, rendered for the AI.

``projects.picots_config_ai_review`` is a JSONB column whose name promises it
feeds the model. Until this module it fed nothing: the only text reaching the
prompts was ``llm_template_instruction``, so PICOT arrived only as hand-typed
prose in a template's ✨ instruction — five seeded templates ship a
``[customize: ... state the review's Step-1 PICOTS ...]`` slot asking the
manager to retype it.

Two halves, split so the rendering is testable without a database:

* ``render_picots_block`` — pure, and where every shape decision lives.
* ``build_review_context`` — reads the project + the one toggle.

The column is written by the settings UI over PostgREST (RLS ``project_update``,
manager-only) and has no server default, so it can hold anything a manager's
browser sent: absent, ``{}``, per-slot dicts, per-slot strings, a ``timing``
nested one level deeper than its five siblings, or junk. Every branch below
exists because one of those shapes is reachable, not defensively.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.repositories.project_repository import ProjectRepository

#: Ceiling on the rendered block. Mirrors ``llm_template_instruction``'s
#: ``max_length=4000`` (``schemas/hitl_session.py``) — the surface this
#: replaces. The cap lives in the RENDERER, not on a write schema, because
#: PostgREST is the column's writer: a cap on an API body would be decorative
#: while the browser can still PATCH the row directly.
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


def render_picots_block(picots: Any, review_type: str | None) -> str | None:
    """The review question as prompt text, or ``None`` when there is none.

    Empty slots are OMITTED, not padded: a line reading
    ``- Comparator model(s): (not specified)`` would be read by the model as a
    fact about the review rather than an unfilled form.

    A slot counts as empty only when its description AND both criteria lists
    are empty — a manager who typed inclusion criteria without a description
    still gets them, which a description-only test would silently drop.
    """
    if not isinstance(picots, Mapping):
        return None
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
    if not lines:
        return None
    block = "\n".join(lines)
    if len(block) > MAX_REVIEW_CONTEXT_CHARS:
        return block[: MAX_REVIEW_CONTEXT_CHARS - 1] + "…"
    return block


def _picots_enabled(settings: Any) -> bool:
    """``settings.ai_context.picots`` — an absent key is the default, ON."""
    ai_context = (settings or {}).get("ai_context") if isinstance(settings, Mapping) else None
    return bool((ai_context or {}).get("picots", True)) if isinstance(ai_context, Mapping) else True


async def build_review_context(db: AsyncSession, project_id: UUID) -> str | None:
    """The project's review question, or ``None`` when it says nothing.

    ``settings.ai_context.picots`` is the off switch, defaulting to ON: an
    absent key is the default state, and an empty PICOT renders nothing, so
    every project that has not filled the editor keeps a byte-identical prompt.
    """
    project = await ProjectRepository(db).get_by_id(project_id)
    if project is None:
        return None
    if not _picots_enabled(project.settings):
        return None
    return render_picots_block(project.picots_config_ai_review, project.review_type)


class ProjectNotFoundError(Exception):
    """Raised when the project row is missing. HTTP translation in the router."""


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
        "preview": render_picots_block(project.picots_config_ai_review, project.review_type)
        if enabled
        else None,
    }


async def set_ai_context(
    db: AsyncSession,
    project_id: UUID,
    *,
    picots: dict[str, Any] | None,
    picots_enabled: bool | None,
) -> dict[str, Any]:
    """Write either half (or both) under one row lock.

    The lock mirrors ``LlmEngineService``: ``projects.settings`` is plain JSONB
    read-modify-written by several services, so an unlocked write can drop a
    concurrent sibling key — and ``managers_see_reviewers`` living in that same
    column means the dropped key could be a blind-review control silently
    flipping back on.
    """
    project = (
        await db.execute(
            select(Project)
            .where(Project.id == project_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if project is None:
        raise ProjectNotFoundError(f"Project {project_id} not found")

    if picots is not None:
        project.picots_config_ai_review = picots
    if picots_enabled is not None:
        # Plain JSONB (NOT MutableDict): build a new dict and REASSIGN, or the
        # change is not tracked and never persists. Only our sub-key is written.
        settings = dict(project.settings or {})
        ai_context = dict(settings.get("ai_context") or {})
        ai_context["picots"] = picots_enabled
        settings["ai_context"] = ai_context
        project.settings = settings
    await db.flush()
    return await get_ai_context(db, project_id)
