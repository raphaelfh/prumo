"""Data migration 0063: nested PICOTS ``timing`` -> a flat slot.

Drives the migration's EXACT statements inside the rolled-back test
transaction, importing them by file path. A data migration must never be run
here through the ``alembic`` subprocess: the local Supabase is one Docker stack
shared by every worktree and session, so ``alembic downgrade`` would rewrite
every project row for every concurrent agent rather than this test's own.

The shapes below are not hypothetical. Each is reachable in a real database:
``updatePICOTSField`` spread the parent and replaced ONE child, so a filled
object sitting beside the ``""`` default is the realistic input — and the naive
``a || '; ' || b`` merge returns SQL NULL on exactly that, silently destroying
the half a manager typed.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "0063_flatten_picots_timing.py"
)
_spec = importlib.util.spec_from_file_location("mig0063", _MIG_PATH)
_mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mig)


def _item(description: str = "", inclusion=None, exclusion=None) -> dict:
    return {
        "description": description,
        "inclusion": inclusion or [],
        "exclusion": exclusion or [],
    }


async def _set(db: AsyncSession, project_id: UUID, picots) -> None:
    await db.execute(
        text(
            "UPDATE public.projects SET picots_config_ai_review = CAST(:p AS jsonb) WHERE id = :pid"
        ),
        {"p": None if picots is None else json.dumps(picots), "pid": str(project_id)},
    )
    await db.flush()


async def _get(db: AsyncSession, project_id: UUID):
    return (
        await db.execute(
            text("SELECT picots_config_ai_review FROM public.projects WHERE id = :pid"),
            {"pid": str(project_id)},
        )
    ).scalar()


async def _migrate(db: AsyncSession) -> None:
    for stmt in _mig.upgrade_statements():
        await db.execute(text(stmt))
    await db.flush()


@pytest.mark.asyncio
async def test_both_halves_filled_merge_into_one_slot(db_session: AsyncSession) -> None:
    await _set(
        db_session,
        SEED.primary_project,
        {
            "population": _item("Adults"),
            "timing": {
                "prediction_moment": _item("At discharge (T0)", inclusion=["index admission"]),
                "prediction_horizon": _item("30-day horizon", exclusion=["in-hospital death"]),
            },
        },
    )

    await _migrate(db_session)

    picots = await _get(db_session, SEED.primary_project)
    assert picots["timing"] == {
        "description": "At discharge (T0); 30-day horizon",
        "inclusion": ["index admission"],
        "exclusion": ["in-hospital death"],
    }
    assert picots["population"] == _item("Adults"), "a sibling slot was rewritten"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_an_object_beside_a_string_keeps_the_filled_half(db_session: AsyncSession) -> None:
    """The realistic shape, and the one a naive merge destroys.

    Editing only the prediction moment spread the parent and left the horizon at
    its ``""`` default, so a dict sits beside a string. ``text || NULL`` is NULL
    and ``jsonb || NULL`` is NULL, so an ungated merge returns nothing at all.
    """
    await _set(
        db_session,
        SEED.primary_project,
        {"timing": {"prediction_moment": _item("At discharge"), "prediction_horizon": ""}},
    )

    await _migrate(db_session)

    picots = await _get(db_session, SEED.primary_project)
    assert picots["timing"]["description"] == "At discharge"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_the_orm_string_pair_default_normalizes_without_separator_garbage(
    db_session: AsyncSession,
) -> None:
    """``concat_ws('; ', '', '')`` would yield the two-character string ``"; "``.

    That would render as a real Timing line in the prompt — a fact about the
    review invented out of an unfilled form.
    """
    await _set(
        db_session,
        SEED.primary_project,
        {"timing": {"prediction_moment": "", "prediction_horizon": ""}},
    )

    await _migrate(db_session)

    picots = await _get(db_session, SEED.primary_project)
    assert "description" not in picots["timing"], picots["timing"]
    await db_session.rollback()


@pytest.mark.asyncio
async def test_a_blank_description_never_leaves_a_leading_separator(
    db_session: AsyncSession,
) -> None:
    """An OBJECT half with ``description: ""`` is not the same as a missing one.

    ``->>`` returns the empty string, not NULL, so ``concat_ws`` does NOT skip it
    and the merge becomes ``"; 30-day horizon"`` — a separator glued to the front
    of a line the model reads as the review's Timing.
    """
    await _set(
        db_session,
        SEED.primary_project,
        {
            "timing": {
                "prediction_moment": _item("", inclusion=["kept"]),
                "prediction_horizon": _item("30-day horizon"),
            }
        },
    )

    await _migrate(db_session)

    picots = await _get(db_session, SEED.primary_project)
    assert picots["timing"]["description"] == "30-day horizon"
    assert picots["timing"]["inclusion"] == ["kept"]
    await db_session.rollback()


@pytest.mark.asyncio
async def test_a_json_null_criteria_list_does_not_raise(db_session: AsyncSession) -> None:
    """``jsonb_array_elements`` on a scalar RAISES.

    The natural way to concatenate the arrays would abort ``alembic upgrade
    head`` on one such row — and the Dockerfile chains ``alembic upgrade head &&
    gunicorn``, so that aborts the Railway deploy, not just the migration.
    """
    await _set(
        db_session,
        SEED.primary_project,
        {
            "timing": {
                "prediction_moment": {"description": "D", "inclusion": None},
                "prediction_horizon": {},
            }
        },
    )

    await _migrate(db_session)

    picots = await _get(db_session, SEED.primary_project)
    assert picots["timing"]["description"] == "D"
    assert picots["timing"]["inclusion"] == []
    await db_session.rollback()


@pytest.mark.asyncio
async def test_a_hybrid_row_does_not_lose_its_already_flat_half(
    db_session: AsyncSession,
) -> None:
    """The predicate matches a row holding BOTH shapes — the merge must too.

    Reachable in the window between this migration and the frontend deploy: a
    cached pre-0063 bundle edits one timing box on an already-flattened row and
    ``updatePICOTSField`` spreads the parent, leaving a nested key beside the
    flat one. Merging only the nested halves would silently delete the flat
    description a manager wrote through the new editor.
    """
    await _set(
        db_session,
        SEED.primary_project,
        {
            "timing": {
                "description": "At discharge",
                "inclusion": ["index admission"],
                "exclusion": [],
                "prediction_horizon": _item("30-day horizon", exclusion=["death"]),
            }
        },
    )

    await _migrate(db_session)

    picots = await _get(db_session, SEED.primary_project)
    assert picots["timing"] == {
        "description": "At discharge; 30-day horizon",
        "inclusion": ["index admission"],
        "exclusion": ["death"],
    }
    await db_session.rollback()


@pytest.mark.parametrize(
    ("label", "picots"),
    [
        ("column-null", None),
        ("no-timing-key", {"population": {"description": "Adults"}}),
        ("timing-empty-object", {"timing": {}}),
        ("already-flat", {"timing": {"description": "flat", "inclusion": [], "exclusion": []}}),
        ("timing-is-a-scalar", {"timing": "just text"}),
    ],
)
@pytest.mark.asyncio
async def test_untouched_shapes_are_left_exactly_as_they_were(
    db_session: AsyncSession, label: str, picots
) -> None:
    """The predicate must not restamp rows it has nothing to do.

    ``trg_projects_updated_at`` fires on every UPDATE of ``public.projects``, and
    essentially every row in production has a NULL column (no server default;
    projects are created by an RPC that never sets it). Excluding already-flat
    rows is also what makes the statement idempotent, which the round-trip suite
    depends on — it downgrades below this revision and upgrades back repeatedly.
    """
    del label
    await _set(db_session, SEED.primary_project, picots)
    before = await _get(db_session, SEED.primary_project)

    await _migrate(db_session)

    assert await _get(db_session, SEED.primary_project) == before
    await db_session.rollback()


@pytest.mark.asyncio
async def test_running_the_migration_twice_changes_nothing_the_second_time(
    db_session: AsyncSession,
) -> None:
    """up -> (no-op down) -> up must not re-merge into ``"a; b; "``."""
    await _set(
        db_session,
        SEED.primary_project,
        {
            "timing": {
                "prediction_moment": _item("a"),
                "prediction_horizon": _item("b"),
            }
        },
    )

    await _migrate(db_session)
    once = await _get(db_session, SEED.primary_project)
    for stmt in _mig.downgrade_statements():
        await db_session.execute(text(stmt))
    await _migrate(db_session)

    assert once["timing"]["description"] == "a; b"
    assert await _get(db_session, SEED.primary_project) == once
    await db_session.rollback()


@pytest.mark.asyncio
async def test_only_the_targeted_project_is_touched(db_session: AsyncSession) -> None:
    """A set-based UPDATE with a JSONB predicate is easy to write unscoped."""
    other = SEED.secondary_project
    await _set(db_session, other, {"timing": {"description": "untouched", "inclusion": []}})
    await _set(
        db_session,
        SEED.primary_project,
        {"timing": {"prediction_moment": _item("x"), "prediction_horizon": _item("y")}},
    )

    await _migrate(db_session)

    assert (await _get(db_session, other))["timing"]["description"] == "untouched"
    await db_session.rollback()


def test_the_downgrade_is_an_intentional_no_op() -> None:
    """Pinned so a later edit that "restores" the nesting has to argue for it.

    A blanket re-nest cannot tell a pre-0063 flat row from a post-0063 one, so it
    would corrupt rows that were never nested.
    """
    assert _mig.downgrade_statements() == []


def test_the_revision_chain_is_declared() -> None:
    assert _mig.revision == "0063_flatten_picots_timing"
    assert _mig.down_revision == "0062_allows_no_information"
    assert len(_mig.revision) <= 32, "alembic_version.version_num is varchar(32)"
