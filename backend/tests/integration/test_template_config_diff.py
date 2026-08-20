"""GET config-diff (slice B-9b2a): the Publish sheet's read model.

Three response shapes — one per ``DiffStatus`` — and the third is the one
this slice exists to get right:

1. ``available``: an ordinary computed diff, bucketed by tier;
2. ``initial_version``: a template that never published — 200, never 404;
3. ``baseline_too_old``: a pre-0026 "narrow" baseline, where the diff engine
   is never called at all, because diffing an unrestorable baseline
   fabricates rows (``role`` defaults to ``None`` in the engine but is
   non-nullable live, so every entity type manufactures a phantom SEMANTIC
   row) beside a chip that renders no count at all.

Real DB throughout: ``affects_recorded_data`` is answered by five RESTRICT
tables, and the RESTRICT is also the argument for why a REMOVED row can
never be about recorded work.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.template_change import ChangeVariant, DiffStatus
from app.schemas.hitl_session import TemplateConfigDiffRead
from app.services import template_version_read_service
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_version_read_service import (
    get_template_config_diff,
    get_template_config_status,
)
from tests.integration.conftest import SEED, make_proposal, open_session
from tests.integration.helpers import template_fixtures
from tests.integration.helpers.template_fixtures import (
    ARTICLE_ID,
    add_field,
    add_section,
    authenticated_as,
    delete_field,
    entity_id,
    field_id,
    force_narrow_baseline,
    fresh_charms,
    set_label,
)

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

#: Every template-config endpoint is manager-gated, so this fixture is shared
#: with ``test_template_discard_draft``. Bound by assignment rather than
#: imported by name: an import binding collides with the identically named
#: parameter in every test that requests it (ruff F811).
auth_as_manager = template_fixtures.auth_as_manager


@pytest_asyncio.fixture
async def auth_as_reviewer(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
    """JWT sub = a member of the primary project who is NOT a manager."""
    del db_session  # fixture ordering only: the seed must run first
    async for user_id in authenticated_as(SEED.reviewer_profile, "r@example.com"):
        yield user_id


async def _diff(db: AsyncSession, project_id: UUID, template_id: UUID) -> TemplateConfigDiffRead:
    return await get_template_config_diff(db, project_id=project_id, template_id=template_id)


def _all_rows(diff: TemplateConfigDiffRead) -> list[Any]:
    buckets = diff.changes
    return [*buckets.additive, *buckets.cosmetic, *buckets.semantic, *buckets.destructive]


async def _set_required(db: AsyncSession, target: UUID, *, value: bool) -> None:
    await db.execute(
        text("UPDATE public.extraction_fields SET is_required = :v WHERE id = :id"),
        {"id": str(target), "v": value},
    )
    await db.flush()


async def _set_field_type(db: AsyncSession, target: UUID, field_type: str) -> None:
    await db.execute(
        text("UPDATE public.extraction_fields SET field_type = :t WHERE id = :id"),
        {"id": str(target), "t": field_type},
    )
    await db.flush()


async def _unpublish(db: AsyncSession, template_id: UUID) -> None:
    """Drop the active version. The 0004 invariant is a DEFERRABLE INITIALLY
    DEFERRED constraint trigger, so this never-committed transaction can hold
    the unpublished shape."""
    await db.execute(
        text(
            "UPDATE public.extraction_template_versions SET is_active = false "
            "WHERE project_template_id = :tid"
        ),
        {"tid": str(template_id)},
    )
    await db.flush()


async def _record_a_value(db: AsyncSession, project_id: UUID, template_id: UUID) -> UUID:
    """One human proposal on ``sample_size.number_of_participants``."""
    owner = await entity_id(db, template_id, "sample_size")
    target = await field_id(db, template_id, "sample_size", "number_of_participants")
    session = await open_session(
        db,
        project_id=project_id,
        article_id=ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await make_proposal(
        db,
        run_id=session.run_id,
        instance_id=UUID(session.instances_by_entity_type[str(owner)]),
        field_id=target,
        user_id=SEED.primary_profile,
    )
    return target


# ==========================================================================
# Shape 1 — the ordinary diff
# ==========================================================================


@pytest.mark.asyncio
async def test_a_four_tier_draft_lands_in_four_buckets(db_session: AsyncSession) -> None:
    """One draft touching every severity tier at once."""
    project_id, template_id, _ = await fresh_charms(db_session)
    section = await entity_id(db_session, template_id, "sample_size")
    renamed = await field_id(db_session, template_id, "sample_size", "number_of_participants")
    relaxed = await field_id(db_session, template_id, "sample_size", "number_of_events")
    victim = await field_id(db_session, template_id, "sample_size", "epv_epp")

    added = await add_field(db_session, section, "b9b2a_added")
    await set_label(db_session, "extraction_fields", renamed, "Participants (n)")
    await _set_required(db_session, relaxed, value=False)
    await delete_field(db_session, victim)

    diff = await _diff(db_session, project_id, template_id)

    assert diff.status is DiffStatus.AVAILABLE
    assert [r.id for r in diff.changes.additive] == [f"added:field:{added}:-:-"]
    assert [r.id for r in diff.changes.cosmetic] == [f"modified:field:{renamed}:label:-"]
    assert [r.id for r in diff.changes.semantic] == [f"modified:field:{relaxed}:is_required:-"]
    assert [r.id for r in diff.changes.destructive] == [f"removed:field:{victim}:-:-"]
    assert {r.variant for r in _all_rows(diff)} == {
        ChangeVariant.FIELD_ADDED,
        ChangeVariant.FIELD_MODIFIED,
        ChangeVariant.FIELD_REMOVED,
    }


@pytest.mark.asyncio
async def test_a_section_row_inherits_the_flag_from_its_child_fields(
    db_session: AsyncSession,
) -> None:
    """A section holds no values of its own, so ``affects_recorded_data``
    comes from the fields it owns in the CURRENT tree — the map a section
    add/remove would otherwise absorb."""
    project_id, template_id, _ = await fresh_charms(db_session)
    await _record_a_value(db_session, project_id, template_id)
    recorded_section = await entity_id(db_session, template_id, "sample_size")
    clean_section = await entity_id(db_session, template_id, "missing_data")
    await set_label(db_session, "extraction_entity_types", recorded_section, "Sample size (n)")
    await set_label(db_session, "extraction_entity_types", clean_section, "Missing data (%)")

    diff = await _diff(db_session, project_id, template_id)

    flags = {r.id: r.affects_recorded_data for r in diff.changes.cosmetic}
    assert flags[f"modified:entity_type:{recorded_section}:label:-"] is True
    assert flags[f"modified:entity_type:{clean_section}:label:-"] is False


@pytest.mark.asyncio
async def test_an_added_section_absorbs_its_child_fields_and_their_flag(
    db_session: AsyncSession,
) -> None:
    """The reason the post-pass takes a parent→children map at all.

    A whole added section is ONE row: its fields are absorbed, so the
    change list alone cannot say whether any of them holds recorded work.
    The map is what answers it."""
    project_id, template_id, _ = await fresh_charms(db_session)
    section = await add_section(db_session, template_id, "b9b2a_new_section")
    child = await add_field(db_session, section, "b9b2a_new_child")
    session = await open_session(
        db_session,
        project_id=project_id,
        article_id=ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await make_proposal(
        db_session,
        run_id=session.run_id,
        instance_id=UUID(session.instances_by_entity_type[str(section)]),
        field_id=child,
        user_id=SEED.primary_profile,
    )

    diff = await _diff(db_session, project_id, template_id)

    rows = {r.id: r for r in _all_rows(diff)}
    assert f"added:field:{child}:-:-" not in rows, "the child row must be absorbed"
    absorbed = rows[f"added:entity_type:{section}:-:-"]
    assert absorbed.variant is ChangeVariant.ENTITY_TYPE_ADDED
    assert absorbed.affects_recorded_data is True


@pytest.mark.asyncio
async def test_recorded_values_flip_a_tier_without_moving_the_total(
    db_session: AsyncSession,
) -> None:
    """The whole point of resolving the real set (D3): a ``field_type``
    change is SEMANTIC on an empty field and DESTRUCTIVE on one that already
    holds answers. The chip's count never moves — it counts changes, not
    severity — so the sheet may not disagree with it about HOW MANY."""
    project_id, template_id, _ = await fresh_charms(db_session)
    recorded = await _record_a_value(db_session, project_id, template_id)
    await _set_field_type(db_session, recorded, "text")

    diff = await _diff(db_session, project_id, template_id)
    status = await get_template_config_status(
        db_session, project_id=project_id, template_id=template_id
    )

    assert [r.id for r in diff.changes.destructive] == [f"modified:field:{recorded}:field_type:-"]
    assert diff.changes.destructive[0].affects_recorded_data is True
    assert diff.changes.semantic == []
    assert len(_all_rows(diff)) == status.pending_change_count


@pytest.mark.asyncio
async def test_a_recorded_value_moves_the_fingerprint_without_touching_the_tree(
    db_session: AsyncSession,
) -> None:
    """The drift signal the Publish sheet is checked against (B-9b2b).

    This is the escalation the ack contract exists for: nobody edited the
    template between the two reads — a reviewer merely answered a question —
    yet the row the manager is looking at went SEMANTIC → DESTRUCTIVE. A
    fingerprint over the live snapshot would be identical here; over the
    projection it moves, which is what lets the publish refuse.
    """
    project_id, template_id, _ = await fresh_charms(db_session)
    target = await field_id(db_session, template_id, "sample_size", "number_of_participants")
    await _set_field_type(db_session, target, "text")

    before = await _diff(db_session, project_id, template_id)
    assert await _record_a_value(db_session, project_id, template_id) == target
    after = await _diff(db_session, project_id, template_id)

    assert before.status is DiffStatus.AVAILABLE
    assert after.status is DiffStatus.AVAILABLE
    assert before.fingerprint is not None
    assert [r.id for r in _all_rows(before)] == [r.id for r in _all_rows(after)], (
        "the tree must be untouched — only the tier may move"
    )
    assert before.fingerprint != after.fingerprint


# ==========================================================================
# Shape 2 — no baseline
# ==========================================================================


@pytest.mark.asyncio
async def test_a_template_that_never_published_reports_the_initial_version_shape(
    db_session: AsyncSession,
) -> None:
    """200 with empty buckets, never a 404: "nothing to compare against" is
    a renderable state, matching ``config-status``."""
    project_id, template_id, _ = await fresh_charms(db_session)
    section = await entity_id(db_session, template_id, "sample_size")
    await add_field(db_session, section, "b9b2a_unpublished")
    await _unpublish(db_session, template_id)

    diff = await _diff(db_session, project_id, template_id)

    assert diff.status is DiffStatus.INITIAL_VERSION
    assert _all_rows(diff) == []


# ==========================================================================
# Shape 3 (D9, BLOCKING) — the narrow baseline
# ==========================================================================


@pytest.mark.asyncio
async def test_a_narrow_baseline_reports_no_rows(db_session: AsyncSession) -> None:
    """The observable half of D9.

    Without the ``baseline_is_restorable`` gate this fails loudly, and the
    failure message names the rows the engine fabricated — at minimum one
    phantom SEMANTIC ``role`` row per entity type, because ``role`` defaults
    to ``None`` in the engine but is non-nullable live."""
    project_id, template_id, _ = await fresh_charms(db_session)
    section = await entity_id(db_session, template_id, "sample_size")
    await force_narrow_baseline(db_session, template_id, section)

    diff = await _diff(db_session, project_id, template_id)

    assert diff.status is DiffStatus.BASELINE_TOO_OLD
    rows = _all_rows(diff)
    assert rows == [], f"unrestorable baseline fabricated {len(rows)} row(s): {rows}"
    # No rows to acknowledge means nothing to drift against (B-9b2b): a
    # fingerprint here would hash emptiness and still refuse a publish for
    # movement the sheet never showed.
    assert diff.fingerprint is None


@pytest.mark.asyncio
async def test_a_narrow_baseline_never_reaches_the_diff_engine(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The cost half of D9: the gate comes BEFORE ``diff_snapshots``, like
    both existing callers, so an unrestorable baseline pays for neither the
    snapshot build nor the walk."""
    project_id, template_id, _ = await fresh_charms(db_session)
    section = await entity_id(db_session, template_id, "sample_size")
    await force_narrow_baseline(db_session, template_id, section)

    def _forbidden(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("an unrestorable baseline must never be diffed")

    monkeypatch.setattr(template_version_read_service, "diff_snapshots", _forbidden)
    monkeypatch.setattr(
        template_version_read_service, "build_template_version_snapshot", _forbidden
    )

    diff = await _diff(db_session, project_id, template_id)

    assert diff.status is DiffStatus.BASELINE_TOO_OLD


# ==========================================================================
# affects_recorded_data — the REMOVED argument
# ==========================================================================


@pytest.mark.asyncio
async def test_a_removed_field_never_claims_recorded_data(db_session: AsyncSession) -> None:
    """A REMOVED row is structurally false, not accidentally so."""
    project_id, template_id, _ = await fresh_charms(db_session)
    await _record_a_value(db_session, project_id, template_id)
    victim = await field_id(db_session, template_id, "sample_size", "epv_epp")
    await delete_field(db_session, victim)

    diff = await _diff(db_session, project_id, template_id)

    removed = [r for r in diff.changes.destructive if r.variant is ChangeVariant.FIELD_REMOVED]
    assert [r.id for r in removed] == [f"removed:field:{victim}:-:-"]
    assert removed[0].affects_recorded_data is False


@pytest.mark.asyncio
async def test_a_field_holding_recorded_work_cannot_be_removed_at_all(
    db_session: AsyncSession,
) -> None:
    """The premise behind the REMOVED rule: every workflow ``field_id`` FK
    is ON DELETE RESTRICT, so a field that left the live tree provably held
    no recorded work — the delete would have been refused."""
    project_id, template_id, _ = await fresh_charms(db_session)
    recorded = await _record_a_value(db_session, project_id, template_id)

    with pytest.raises(IntegrityError):
        await delete_field(db_session, recorded)

    await db_session.rollback()


# ==========================================================================
# The chip's count stays value-blind
# ==========================================================================


@pytest.mark.asyncio
async def test_config_status_still_passes_an_empty_value_set(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A count consumes no tiers, so ``config-status`` must not pay for the
    five-table union — the two reads share the engine, not the query."""
    project_id, template_id, _ = await fresh_charms(db_session)
    recorded = await _record_a_value(db_session, project_id, template_id)
    await _set_field_type(db_session, recorded, "text")

    seen: list[frozenset[UUID]] = []
    real = template_version_read_service.diff_snapshots

    def _spy(baseline: Any, current: Any, *, fields_with_values: frozenset[UUID]) -> Any:
        seen.append(fields_with_values)
        return real(baseline, current, fields_with_values=fields_with_values)

    monkeypatch.setattr(template_version_read_service, "diff_snapshots", _spy)

    await get_template_config_status(db_session, project_id=project_id, template_id=template_id)

    assert seen == [frozenset()]


# ==========================================================================
# BOLA + the HTTP surface
# ==========================================================================


@pytest.mark.asyncio
async def test_a_foreign_project_is_not_found(db_session: AsyncSession) -> None:
    """Scoped by ``(id, project_id)`` like every sibling: a template owned
    elsewhere 404s rather than leaking that it exists."""
    _, template_id, _ = await fresh_charms(db_session)

    with pytest.raises(ProjectTemplateNotFoundError):
        await _diff(db_session, SEED.primary_project, template_id)


@pytest.mark.asyncio
async def test_endpoint_serves_the_envelope(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_manager: UUID
) -> None:
    assert auth_as_manager == SEED.primary_profile
    project_id, template_id, _ = await fresh_charms(db_session)
    section = await entity_id(db_session, template_id, "sample_size")
    added = await add_field(db_session, section, "b9b2a_http_field")

    res = await db_client.get(f"/api/v1/projects/{project_id}/templates/{template_id}/config-diff")

    assert res.status_code == 200, res.text
    envelope = res.json()
    assert envelope["ok"] is True
    data = envelope["data"]
    assert data["status"] == "available"
    assert [r["id"] for r in data["changes"]["additive"]] == [f"added:field:{added}:-:-"]
    assert data["changes"]["additive"][0]["affects_recorded_data"] is False
    await db_session.rollback()


@pytest.mark.asyncio
async def test_endpoint_serves_200_for_both_unavailable_shapes(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_manager: UUID
) -> None:
    """Neither unavailable shape is a 404 — the sheet renders an
    explanation, it does not error."""
    assert auth_as_manager == SEED.primary_profile
    project_id, template_id, _ = await fresh_charms(db_session)
    section = await entity_id(db_session, template_id, "sample_size")
    await force_narrow_baseline(db_session, template_id, section)

    narrow = await db_client.get(
        f"/api/v1/projects/{project_id}/templates/{template_id}/config-diff"
    )

    assert narrow.status_code == 200, narrow.text
    assert narrow.json()["data"]["status"] == "baseline_too_old"

    await _unpublish(db_session, template_id)
    initial = await db_client.get(
        f"/api/v1/projects/{project_id}/templates/{template_id}/config-diff"
    )

    assert initial.status_code == 200, initial.text
    assert initial.json()["data"]["status"] == "initial_version"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_endpoint_404s_a_template_from_another_project(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_manager: UUID
) -> None:
    assert auth_as_manager == SEED.primary_profile
    _, template_id, _ = await fresh_charms(db_session)

    res = await db_client.get(
        f"/api/v1/projects/{SEED.primary_project}/templates/{template_id}/config-diff"
    )

    assert res.status_code == 404, res.text
    await db_session.rollback()


@pytest.mark.asyncio
async def test_endpoint_rejects_a_non_manager(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_reviewer: UUID
) -> None:
    """Manager-gated like every sibling config endpoint."""
    assert auth_as_reviewer == SEED.reviewer_profile

    res = await db_client.get(
        f"/api/v1/projects/{SEED.primary_project}/templates/{SEED.primary_template}/config-diff"
    )

    assert res.status_code == 403, res.text
    await db_session.rollback()
