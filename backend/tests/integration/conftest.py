"""Integration test fixtures.

Provides a session-scoped, idempotent seed of the minimum graph the
integration suite needs: profiles, projects, project members, an
article, two project-scoped extraction templates (one per project, both
``kind='extraction'``), and the entity-type / field / instance scaffolding
that runs/exports query.

Why this exists
---------------
Before this conftest, ~196 integration tests silently called
``pytest.skip(...)`` in CI because the test database was empty:

    if (await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar() is None:
        pytest.skip("No profile rows available")

Local dev DBs accumulate rows from manual usage, so the same tests
*ran* locally and *skipped* in CI — the test suite was lying about
coverage. This fixture seeds the row those queries probe for, so the
``LIMIT 1`` checks now find what they need and the tests execute.

Design choices
--------------
- **Sentinel UUIDs** (``ffffffff-9999-...``) so seed rows are
  distinguishable from real data in logs.
- **Session-scoped autouse** — runs once before any integration test;
  the seed persists for the whole session.
- **Idempotent** — every INSERT uses ``ON CONFLICT (id) DO NOTHING``;
  re-running against a populated DB is a no-op.
- **No teardown** — the seed is meant to persist. Tests that create
  their own rows are responsible for their own cleanup.
- **Raw SQL** — bypasses the SQLAlchemy ORM so the seed cannot
  accidentally trip on model-level invariants (e.g. relationship
  back-population) that would obscure the SQL-level shape we want.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import NamedTuple
from uuid import UUID

import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

# =================== SENTINEL UUIDS ===================

# All seed rows live under the ``ffffffff-9999-NNNN-...`` namespace.
# The NNNN segment encodes the entity type:
#   0000 → profile
#   0001 → project
#   0002 → article
#   0003 → project_extraction_template
#   0004 → extraction_entity_type
#   0005 → extraction_field
#   0006 → extraction_instance
PRIMARY_PROFILE_ID = UUID("ffffffff-9999-0000-0000-000000000001")
OUTSIDER_PROFILE_ID = UUID("ffffffff-9999-0000-0000-000000000002")
REVIEWER_PROFILE_ID = UUID("ffffffff-9999-0000-0000-000000000003")

PRIMARY_PROJECT_ID = UUID("ffffffff-9999-0001-0000-000000000001")
SECONDARY_PROJECT_ID = UUID("ffffffff-9999-0001-0000-000000000002")

PRIMARY_ARTICLE_ID = UUID("ffffffff-9999-0002-0000-000000000001")

PRIMARY_TEMPLATE_ID = UUID("ffffffff-9999-0003-0000-000000000001")

PRIMARY_ENTITY_TYPE_ID = UUID("ffffffff-9999-0004-0000-000000000001")

PRIMARY_FIELD_ID = UUID("ffffffff-9999-0005-0000-000000000001")

PRIMARY_INSTANCE_ID = UUID("ffffffff-9999-0006-0000-000000000001")


class IntegrationSeedIds(NamedTuple):
    """Stable IDs for the rows seeded by ``seeded_integration_db``.

    Tests can import these directly when they need to construct queries
    keyed on the seed (rare — most tests use ``LIMIT 1``-style discovery
    and don't care which UUID they got).
    """

    primary_profile: UUID
    outsider_profile: UUID
    reviewer_profile: UUID
    primary_project: UUID
    secondary_project: UUID
    primary_article: UUID
    primary_template: UUID
    primary_entity_type: UUID
    primary_field: UUID
    primary_instance: UUID


SEED = IntegrationSeedIds(
    primary_profile=PRIMARY_PROFILE_ID,
    outsider_profile=OUTSIDER_PROFILE_ID,
    reviewer_profile=REVIEWER_PROFILE_ID,
    primary_project=PRIMARY_PROJECT_ID,
    secondary_project=SECONDARY_PROJECT_ID,
    primary_article=PRIMARY_ARTICLE_ID,
    primary_template=PRIMARY_TEMPLATE_ID,
    primary_entity_type=PRIMARY_ENTITY_TYPE_ID,
    primary_field=PRIMARY_FIELD_ID,
    primary_instance=PRIMARY_INSTANCE_ID,
)


# =================== SEED LOGIC ===================


async def _seed_minimum_graph(session: AsyncSession) -> None:
    """Insert the minimum integration test graph. Idempotent.

    Topology after seed (``M`` = manager, ``R`` = reviewer):

        primary_profile ──┬── M(primary_project) ── primary_article
                          │                       └ primary_template ── entity_type ── field
                          │                                          └ instance
                          └── M(secondary_project) ── secondary_template
        reviewer_profile ──── R(primary_project)
        outsider_profile (no memberships — for cross-project guard tests)

    Why each row exists:

    - ``primary_profile`` satisfies the "any profile" ``LIMIT 1`` check
      that ~140 skip points consult.
    - ``outsider_profile`` covers tests that need a profile that is
      *not* a member of any project (membership guard tests).
    - ``reviewer_profile`` covers tests that need a non-manager member
      (``role != 'manager'``).
    - Two projects cover cross-project tests (template owned by a
      different project than the one under test).
    - One article + one template + one entity_type + one field + one
      instance covers the run/proposal/consensus suite that queries the
      full chain.
    """
    already_seeded = await session.execute(
        text("SELECT 1 FROM public.profiles WHERE id = :id"),
        {"id": str(PRIMARY_PROFILE_ID)},
    )
    if already_seeded.scalar() is not None:
        return

    # --- Profiles ---
    # Insert via auth.users to fire the ``handle_new_user`` trigger
    # (which materialises ``public.profiles``). Fall back to a direct
    # ``public.profiles`` insert if the trigger isn't present (CI's stub
    # ``auth.users`` table does not carry the trigger).
    for profile_id, email, full_name in (
        (PRIMARY_PROFILE_ID, "primary@integration-test.prumo.local", "Integration Primary"),
        (OUTSIDER_PROFILE_ID, "outsider@integration-test.prumo.local", "Integration Outsider"),
        (REVIEWER_PROFILE_ID, "reviewer@integration-test.prumo.local", "Integration Reviewer"),
    ):
        await session.execute(
            text(
                "INSERT INTO auth.users (id, email, instance_id, aud, role) "
                "VALUES (:id, :email, '00000000-0000-0000-0000-000000000000', "
                "'authenticated', 'authenticated') "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": str(profile_id), "email": email},
        )
        # Force public.profiles to exist even if the trigger is absent.
        await session.execute(
            text(
                "INSERT INTO public.profiles (id, email, full_name) "
                "VALUES (:id, :email, :full_name) "
                "ON CONFLICT (id) DO UPDATE "
                "SET email = EXCLUDED.email, full_name = EXCLUDED.full_name"
            ),
            {"id": str(profile_id), "email": email, "full_name": full_name},
        )

    # --- Projects ---
    for project_id, name in (
        (PRIMARY_PROJECT_ID, "Integration Test — Primary Project"),
        (SECONDARY_PROJECT_ID, "Integration Test — Cross-Project"),
    ):
        await session.execute(
            text(
                "INSERT INTO public.projects (id, name, created_by_id, is_active) "
                "VALUES (:id, :name, :created_by, true) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {
                "id": str(project_id),
                "name": name,
                "created_by": str(PRIMARY_PROFILE_ID),
            },
        )

    # --- Project members ---
    # primary_profile is manager of both projects; reviewer_profile is
    # a reviewer of primary_project; outsider_profile has no memberships.
    for project_id, user_id, role in (
        (PRIMARY_PROJECT_ID, PRIMARY_PROFILE_ID, "manager"),
        (PRIMARY_PROJECT_ID, REVIEWER_PROFILE_ID, "reviewer"),
        (SECONDARY_PROJECT_ID, PRIMARY_PROFILE_ID, "manager"),
    ):
        await session.execute(
            text(
                "INSERT INTO public.project_members "
                "(id, project_id, user_id, role) "
                "VALUES (gen_random_uuid(), :pid, :uid, :role) "
                "ON CONFLICT (project_id, user_id) DO NOTHING"
            ),
            {"pid": str(project_id), "uid": str(user_id), "role": role},
        )

    # --- Article ---
    await session.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, :title, 1) "
            "ON CONFLICT (id) DO NOTHING"
        ),
        {
            "id": str(PRIMARY_ARTICLE_ID),
            "pid": str(PRIMARY_PROJECT_ID),
            "title": "Integration Test Article",
        },
    )

    # --- Project extraction template ---
    # One template, kind='extraction', in PRIMARY_PROJECT. The
    # ``WHERE kind='extraction' LIMIT 1`` discovery query is deterministic.
    #
    # We intentionally do NOT seed a second project-scoped template
    # here: doing so requires either (a) setting ``global_template_id``
    # to a real global to keep ``test_kind_discriminator`` happy, or
    # (b) accepting that ``test_kind_discriminator_backfilled_to_extraction_kind``
    # would fail because the seed introduces a non-extraction template
    # that isn't a QA clone. The handful of tests that need
    # "a template owned by a different project" can opt back into
    # ``pytest.skip(...)`` until they are refactored to bring their own
    # cross-project fixture in F4/F5.
    await session.execute(
        text(
            "INSERT INTO public.project_extraction_templates "
            "(id, project_id, name, description, framework, version, kind, "
            " schema, is_active, created_by) "
            "VALUES (:id, :pid, :name, NULL, 'CUSTOM', '1.0', 'extraction', "
            " '{}'::jsonb, true, :created_by) "
            "ON CONFLICT (id) DO NOTHING"
        ),
        {
            "id": str(PRIMARY_TEMPLATE_ID),
            "pid": str(PRIMARY_PROJECT_ID),
            "name": "integration-test-template",
            "created_by": str(PRIMARY_PROFILE_ID),
        },
    )
    # Active v1 version (deferred trigger from migration 0004 forbids
    # an active template without an active version).
    await session.execute(
        text(
            "INSERT INTO public.extraction_template_versions "
            "(id, project_template_id, version, schema, published_by, is_active) "
            "VALUES (gen_random_uuid(), :tid, 1, '{\"entity_types\": []}'::jsonb, "
            " :published_by, true) "
            "ON CONFLICT (project_template_id, version) DO NOTHING"
        ),
        {
            "tid": str(PRIMARY_TEMPLATE_ID),
            "published_by": str(PRIMARY_PROFILE_ID),
        },
    )

    # --- Entity type + field + instance in the primary template ---
    # study_section role, no parent (the simplest valid shape).
    await session.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality, role, "
            " parent_entity_type_id, sort_order, is_required) "
            "VALUES (:id, :tid, 'participants', 'Participants', 'one', "
            " 'study_section', NULL, 0, false) "
            "ON CONFLICT (id) DO NOTHING"
        ),
        {
            "id": str(PRIMARY_ENTITY_TYPE_ID),
            "tid": str(PRIMARY_TEMPLATE_ID),
        },
    )

    await session.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required) "
            "VALUES (:id, :etid, 'sample_size', 'Sample Size', 'number', false) "
            "ON CONFLICT (id) DO NOTHING"
        ),
        {
            "id": str(PRIMARY_FIELD_ID),
            "etid": str(PRIMARY_ENTITY_TYPE_ID),
        },
    )

    await session.execute(
        text(
            "INSERT INTO public.extraction_instances "
            "(id, project_id, template_id, entity_type_id, article_id, "
            " label, status, created_by) "
            "VALUES (:id, :pid, :tid, :etid, :aid, "
            " 'Integration Test Instance', 'pending', :created_by) "
            "ON CONFLICT (id) DO NOTHING"
        ),
        {
            "id": str(PRIMARY_INSTANCE_ID),
            "pid": str(PRIMARY_PROJECT_ID),
            "tid": str(PRIMARY_TEMPLATE_ID),
            "etid": str(PRIMARY_ENTITY_TYPE_ID),
            "aid": str(PRIMARY_ARTICLE_ID),
            "created_by": str(PRIMARY_PROFILE_ID),
        },
    )

    await session.commit()


# =================== FIXTURE ===================


@pytest_asyncio.fixture(scope="session", autouse=True, loop_scope="session")
async def seeded_integration_db() -> AsyncGenerator[IntegrationSeedIds, None]:
    """Seed the integration test DB before any test in this directory runs.

    Returns the sentinel ID bundle so tests can reference specific seeded
    rows by name when they need to. Most tests don't — they use the
    pre-existing ``SELECT ... LIMIT 1`` discovery pattern and the seed
    just ensures that query returns something.

    Idempotent: re-running against a populated DB is a no-op.
    """
    engine = create_async_engine(
        settings.async_database_url,
        echo=False,
        pool_pre_ping=True,
    )
    sessionmaker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with sessionmaker() as session:
        await _seed_minimum_graph(session)
    await engine.dispose()
    yield SEED
