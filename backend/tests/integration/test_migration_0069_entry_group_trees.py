"""Migration 0069 — the invariants that replace ``role``.

The migration is already applied to the test database (``alembic upgrade
head``), so these assert the SCHEMA it leaves behind, by trying to write
rows the old world allowed and the new one forbids — and, just as
importantly, a row the OLD world forbade and the new one must allow.

Every INSERT runs inside a SAVEPOINT that is rolled back, so nothing is
left behind.

The two REFUSAL cases of ``trg_check_section_parent_repeats`` are NOT here.
It is DEFERRABLE INITIALLY DEFERRED, so it fires at COMMIT, and this file's
``db_session`` never reaches one — a savepoint release is not a commit. They
live in ``smoke_constraints/test_section_parent_repeats.py``, which uses the
``db_session_real`` fixture the backend rules require for exactly this. What
stays here is what a savepoint CAN prove: the shapes 0069 makes storable,
and the objects it removed.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

_INSERT = text(
    """
    INSERT INTO public.extraction_entity_types
        (id, project_template_id, name, label, cardinality,
         parent_entity_type_id, sort_order, is_required, entry_label)
    VALUES (:id, :ptid, :name, :label, :card, :parent, 1, false, :noun)
    """
)


async def _project_template_id(db: AsyncSession) -> UUID | None:
    return (
        await db.execute(text("SELECT id FROM public.project_extraction_templates LIMIT 1"))
    ).scalar()


async def _insert(
    db: AsyncSession,
    ptid: UUID,
    *,
    card: str,
    parent: UUID | None = None,
    noun: str | None = "entry",
) -> UUID:
    new_id = uuid4()
    await db.execute(
        _INSERT,
        {
            "id": str(new_id),
            "ptid": str(ptid),
            "name": f"s_{new_id.hex[:8]}",
            "label": "S",
            "card": card,
            "parent": str(parent) if parent else None,
            "noun": noun,
        },
    )
    return new_id


@pytest.mark.asyncio
async def test_a_group_may_own_a_group_which_may_own_a_section(
    db_session: AsyncSession,
) -> None:
    """Depth three, which 0016 made unrepresentable.

    This is the assertion the whole train exists for: 0016's CHECK required a
    `model_section`'s parent to BE the root container, so a group inside a
    group could not be stored at all.
    """
    ptid = await _project_template_id(db_session)
    if ptid is None:
        pytest.skip("Missing fixtures.")

    await db_session.begin_nested()
    root = await _insert(db_session, ptid, card="many")
    nested = await _insert(db_session, ptid, card="many", parent=root)
    await _insert(db_session, ptid, card="one", parent=nested, noun=None)
    await db_session.commit()  # must not raise
    await db_session.rollback()


@pytest.mark.asyncio
async def test_a_template_may_hold_several_root_groups(
    db_session: AsyncSession,
) -> None:
    """0016's two partial unique indexes allowed exactly one per template."""
    ptid = await _project_template_id(db_session)
    if ptid is None:
        pytest.skip("Missing fixtures.")

    await db_session.begin_nested()
    await _insert(db_session, ptid, card="many")
    await _insert(db_session, ptid, card="many")
    await db_session.commit()  # must not raise
    await db_session.rollback()


@pytest.mark.asyncio
async def test_a_repeating_section_must_carry_a_noun(
    db_session: AsyncSession,
) -> None:
    """Spec §3.5, enforced by CHECK rather than by the service alone."""
    ptid = await _project_template_id(db_session)
    if ptid is None:
        pytest.skip("Missing fixtures.")

    await db_session.begin_nested()
    with pytest.raises((IntegrityError, DBAPIError)) as exc:
        await _insert(db_session, ptid, card="many", noun=None)
        await db_session.commit()
    assert "noun_on_repeating" in str(exc.value)
    await db_session.rollback()


@pytest.mark.asyncio
async def test_the_role_column_and_its_enum_are_gone(
    db_session: AsyncSession,
) -> None:
    assert (
        await db_session.execute(
            text(
                "SELECT count(*) FROM information_schema.columns "
                "WHERE table_name = 'extraction_entity_types' AND column_name = 'role'"
            )
        )
    ).scalar() == 0
    assert (
        await db_session.execute(
            text("SELECT count(*) FROM pg_type WHERE typname = 'extraction_entity_role'")
        )
    ).scalar() == 0


@pytest.mark.asyncio
async def test_check_cardinality_one_is_gone(db_session: AsyncSession) -> None:
    """Retired with the role world. B2 removed only the browser CALL, leaving
    a SECURITY DEFINER function granted to `authenticated` with no caller."""
    assert (
        await db_session.execute(
            text("SELECT count(*) FROM pg_proc WHERE proname = 'check_cardinality_one'")
        )
    ).scalar() == 0
