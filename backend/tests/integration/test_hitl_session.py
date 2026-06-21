"""Integration tests for the unified HITL session endpoint.

Covers both kinds the endpoint accepts:

* ``quality_assessment``: pass ``global_template_id``; service clones the
  global PROBAST/QUADAS-2 template into the project on first call.
* ``extraction``: pass ``project_template_id`` directly; the service refuses
  ``global_template_id`` because extraction templates are authored per project.
"""

from collections.abc import AsyncGenerator
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from tests.integration.conftest import SEED

_SESSION_URL = "/api/v1/hitl/sessions"


@pytest_asyncio.fixture
async def auth_as_seed_primary(
    db_session: AsyncSession,  # noqa: ARG001 — fixture order: seed runs first
) -> AsyncGenerator[UUID, None]:
    """Override auth to ``SEED.primary_profile`` — the conftest-seeded
    profile that manages ``SEED.primary_project`` (owner of
    ``SEED.primary_article`` and ``SEED.primary_template``).

    Use this instead of ``auth_as_profile`` when the test also pins
    project/article/template to the seeded sentinel rows; ``LIMIT 1`` on
    ``profiles`` is non-deterministic on a polluted dev DB and can return
    a profile that doesn't manage the sentinel project, leading to 403
    on writes against ``primary_project``.
    """
    profile_id = SEED.primary_profile

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="primary@integration-test.prumo.local",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override_get_current_user
    try:
        yield profile_id
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest_asyncio.fixture
async def auth_as_profile(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """Override auth so the JWT sub points at a real profile."""
    del db_session  # kept for fixture-dependency ordering; the seed runs first
    profile_id = SEED.primary_profile

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="test@example.com",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override_get_current_user
    yield profile_id


@pytest_asyncio.fixture
async def home_project_fixture(
    db_session: AsyncSession,
) -> AsyncGenerator[tuple[UUID, UUID, UUID, UUID, UUID], None]:
    """Yield ``(profile_id, project_id, article_id, extraction_tpl_id, qa_tpl_id)``
    for an extraction-ready setup the JWT profile manages.

    Replaces the ``pytest.skip("Need an article + ...")`` paths in the
    BOLA + snapshot tests so CI — which seeds only the global templates —
    exercises them instead of skipping. Reuses the dev-DB rows when they
    already line up (profile is a member of a project that owns one
    article + an extraction template + a QA template); fabricates them
    and cleans up otherwise.

    Sets up its own ``get_current_user`` override, so a test that uses
    this fixture must NOT also depend on ``auth_as_profile`` — the two
    would race over ``app.dependency_overrides``.
    """
    raw = (await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if raw is not None:
        profile_id = UUID(str(raw))
        seeded_profile = False
    else:
        # Materialise a profile via auth.users — the handle_new_user
        # trigger creates the matching public.profiles row.
        profile_id = uuid4()
        await db_session.execute(
            text(
                "INSERT INTO auth.users (id, email, instance_id, aud, role) "
                "VALUES (:id, :email, "
                "'00000000-0000-0000-0000-000000000000', "
                "'authenticated', 'authenticated')"
            ),
            {
                "id": str(profile_id),
                "email": f"ci-home-{profile_id.hex[:8]}@hitl-test.local",
            },
        )
        await db_session.commit()
        confirmed = (
            await db_session.execute(
                text("SELECT id FROM public.profiles WHERE id = :id"),
                {"id": str(profile_id)},
            )
        ).scalar()
        if confirmed is None:
            # Trigger absent (degraded test DB) — create the profile by hand.
            await db_session.execute(
                text("INSERT INTO public.profiles (id, full_name) VALUES (:id, 'CI Home Profile')"),
                {"id": str(profile_id)},
            )
            await db_session.commit()
        seeded_profile = True

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="ci-home@hitl-test.local",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override_get_current_user

    # Reuse a (project, article, extraction_tpl, qa_tpl) tuple the
    # profile manages, when dev DB already has one.
    existing = (
        await db_session.execute(
            text(
                """
                SELECT pet.project_id, a.id, pet.id, qa.id
                FROM public.project_extraction_templates pet
                JOIN public.articles a ON a.project_id = pet.project_id
                JOIN public.project_members pm
                  ON pm.project_id = pet.project_id AND pm.user_id = :uid
                JOIN public.project_extraction_templates qa
                  ON qa.project_id = pet.project_id
                 AND qa.kind = 'quality_assessment'
                WHERE pet.kind = 'extraction'
                LIMIT 1
                """
            ),
            {"uid": str(profile_id)},
        )
    ).first()

    if existing is not None:
        project_id = UUID(str(existing[0]))
        article_id = UUID(str(existing[1]))
        extraction_tpl_id = UUID(str(existing[2]))
        qa_tpl_id = UUID(str(existing[3]))
        seeded_project = False
    else:
        project_id = uuid4()
        article_id = uuid4()
        extraction_tpl_id = uuid4()
        qa_tpl_id = uuid4()

        await db_session.execute(
            text(
                "INSERT INTO public.projects (id, name, created_by_id) VALUES (:pid, :name, :uid)"
            ),
            {
                "pid": str(project_id),
                "name": f"ci-home-{project_id.hex[:8]}",
                "uid": str(profile_id),
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO public.project_members (project_id, user_id, role) "
                "VALUES (:pid, :uid, 'manager')"
            ),
            {"pid": str(project_id), "uid": str(profile_id)},
        )
        await db_session.execute(
            text("INSERT INTO public.articles (id, project_id, title) VALUES (:aid, :pid, :title)"),
            {
                "aid": str(article_id),
                "pid": str(project_id),
                "title": f"ci-home-article-{article_id.hex[:8]}",
            },
        )
        for tpl_id, kind in (
            (extraction_tpl_id, "extraction"),
            (qa_tpl_id, "quality_assessment"),
        ):
            await db_session.execute(
                text(
                    """
                    INSERT INTO public.project_extraction_templates
                        (id, project_id, name, kind, framework, is_active, created_by)
                    VALUES
                        (:tid, :pid, :name, CAST(:kind AS template_kind),
                         'CUSTOM', true, :uid)
                    """
                ),
                {
                    "tid": str(tpl_id),
                    "pid": str(project_id),
                    "name": f"ci-{kind}-{tpl_id.hex[:8]}",
                    "kind": kind,
                    "uid": str(profile_id),
                },
            )
            # Migration 0004's deferred trigger refuses to commit a
            # project_extraction_template without an active version row.
            await db_session.execute(
                text(
                    """
                    INSERT INTO public.extraction_template_versions
                        (project_template_id, version, schema, published_by, is_active)
                    VALUES (:tid, 1, '{}'::jsonb, :uid, true)
                    """
                ),
                {"tid": str(tpl_id), "uid": str(profile_id)},
            )
        await db_session.commit()
        seeded_project = True

    try:
        yield profile_id, project_id, article_id, extraction_tpl_id, qa_tpl_id
    finally:
        if seeded_project:
            # CASCADE wipes articles + members + templates + versions.
            await db_session.execute(
                text("DELETE FROM public.projects WHERE id = :pid"),
                {"pid": str(project_id)},
            )
            await db_session.commit()
        if seeded_profile:
            await db_session.execute(
                text("DELETE FROM public.profiles WHERE id = :id"),
                {"id": str(profile_id)},
            )
            await db_session.execute(
                text("DELETE FROM auth.users WHERE id = :id"),
                {"id": str(profile_id)},
            )
            await db_session.commit()
        app.dependency_overrides.pop(get_current_user, None)


async def _pick_qa_global_template(db: AsyncSession) -> UUID | None:
    raw = (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_templates_global "
                "WHERE kind = 'quality_assessment' LIMIT 1"
            )
        )
    ).scalar()
    return UUID(str(raw)) if raw is not None else None


async def _pick_extraction_project_template(db: AsyncSession) -> UUID | None:
    raw = (
        await db.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE kind = 'extraction' LIMIT 1"
            )
        )
    ).scalar()
    return UUID(str(raw)) if raw is not None else None


async def _pick_article(db: AsyncSession) -> tuple[UUID, UUID] | None:
    raw = (await db.execute(text("SELECT id, project_id FROM public.articles LIMIT 1"))).first()
    if raw is None:
        return None
    return UUID(str(raw[0])), UUID(str(raw[1]))


async def _wipe_project_template_chain(
    db: AsyncSession,
    *,
    project_id: UUID,
    global_template_id: UUID,
    article_id: UUID | None = None,
) -> None:
    """Drop runs + instances + project_extraction_templates rows tied to the
    given global template id (and optionally scoped to one article) so a
    subsequent clone/open exercises the create branch from a clean slate.
    Kind-agnostic — reused by both QA and extraction tests."""
    await _wipe_qa_state(
        db,
        project_id=project_id,
        global_template_id=global_template_id,
        article_id=article_id,
    )


async def _wipe_qa_state(
    db: AsyncSession,
    *,
    project_id: UUID,
    global_template_id: UUID,
    article_id: UUID | None = None,
) -> None:
    """Reset the (project, article?, qa-template) tuple so subsequent calls
    exercise the create branch rather than the reuse branch."""
    article_clause = "AND article_id = :aid" if article_id is not None else ""
    params: dict[str, object] = {"pid": str(project_id), "gid": str(global_template_id)}
    if article_id is not None:
        params["aid"] = str(article_id)

    await db.execute(
        text(
            f"""
            DELETE FROM public.extraction_runs
            WHERE project_id = :pid {article_clause}
              AND template_id IN (
                SELECT id FROM public.project_extraction_templates
                WHERE project_id = :pid AND global_template_id = :gid
              )
            """
        ),
        params,
    )
    await db.execute(
        text(
            f"""
            DELETE FROM public.extraction_instances
            WHERE project_id = :pid {article_clause}
              AND template_id IN (
                SELECT id FROM public.project_extraction_templates
                WHERE project_id = :pid AND global_template_id = :gid
              )
            """
        ),
        params,
    )
    await db.execute(
        text(
            "DELETE FROM public.project_extraction_templates "
            "WHERE project_id = :pid AND global_template_id = :gid"
        ),
        {"pid": str(project_id), "gid": str(global_template_id)},
    )
    await db.commit()


# =================== QA: clone-on-first-call ===================


@pytest.mark.asyncio
async def test_qa_session_clones_template_on_first_call(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    await _wipe_qa_state(
        db_session,
        project_id=project_id,
        global_template_id=global_template_id,
        article_id=article_id,
    )

    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "quality_assessment",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "global_template_id": str(global_template_id),
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()["data"]
    assert body["kind"] == "quality_assessment"
    assert UUID(body["run_id"])
    assert UUID(body["project_template_id"])
    assert len(body["instances_by_entity_type"]) >= 1

    # The cloned project_extraction_template carries kind=quality_assessment.
    kind = (
        await db_session.execute(
            text("SELECT kind FROM public.project_extraction_templates WHERE id = :tid"),
            {"tid": body["project_template_id"]},
        )
    ).scalar()
    assert kind == "quality_assessment"

    # And v=1 active version was created (migration 0004 invariant).
    version_count = (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active = true"
            ),
            {"tid": body["project_template_id"]},
        )
    ).scalar()
    assert version_count == 1

    # The Run lands in EXTRACT ready for the UI to record decisions.
    stage = (
        await db_session.execute(
            text("SELECT stage FROM public.extraction_runs WHERE id = :rid"),
            {"rid": body["run_id"]},
        )
    ).scalar()
    assert stage == "extract"


@pytest.mark.asyncio
async def test_qa_session_is_idempotent_across_calls(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    # Clear any QA runs leaked into this coord by prior committed test
    # runs so the first POST below truly creates a new Run (HTTP 201).
    await db_session.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :pid "
            "AND article_id = :aid AND kind = 'quality_assessment'"
        ),
        {"pid": str(project_id), "aid": str(article_id)},
    )
    await db_session.commit()

    payload = {
        "kind": "quality_assessment",
        "project_id": str(project_id),
        "article_id": str(article_id),
        "global_template_id": str(global_template_id),
    }
    first = await db_client.post(_SESSION_URL, json=payload)
    assert first.status_code == 201
    second = await db_client.post(_SESSION_URL, json=payload)
    # Issue #32: resume returns 200, not 201 (no new Run was created).
    assert second.status_code == 200
    assert (
        second.json()["data"]["project_template_id"] == first.json()["data"]["project_template_id"]
    )
    assert second.json()["data"]["run_id"] == first.json()["data"]["run_id"]


@pytest.mark.asyncio
async def test_qa_session_returns_finalized_run_instead_of_forking(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Re-opening after finalize must surface the finalized run, not silently
    fork a new one — otherwise every page reload after publish would orphan
    the published values. Reopen is the explicit revision path."""
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    await _wipe_qa_state(
        db_session,
        project_id=project_id,
        global_template_id=global_template_id,
        article_id=article_id,
    )

    payload = {
        "kind": "quality_assessment",
        "project_id": str(project_id),
        "article_id": str(article_id),
        "global_template_id": str(global_template_id),
    }
    first = await db_client.post(_SESSION_URL, json=payload)
    assert first.status_code == 201
    first_data = first.json()["data"]
    run_id = first_data["run_id"]
    instances_by_et = first_data["instances_by_entity_type"]
    # Pick any instance from the QA template; we just need one (instance, field)
    # pair to write a consensus decision so the run can finalize.
    et_id, instance_id = next(iter(instances_by_et.items()))
    field_id = (
        await db_session.execute(
            text("SELECT id FROM public.extraction_fields WHERE entity_type_id = :et LIMIT 1"),
            {"et": et_id},
        )
    ).scalar()
    assert field_id is not None, "QA entity type has no fields"

    for stage in ("review", "consensus"):
        adv = await db_client.post(f"/api/v1/runs/{run_id}/advance", json={"target_stage": stage})
        assert adv.status_code == 200, adv.text

    # Satisfy the FINALIZED invariant: write at least one consensus decision
    # (manual_override carries the value+rationale directly).
    consensus_res = await db_client.post(
        f"/api/v1/runs/{run_id}/consensus",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "mode": "manual_override",
            "value": {"value": "Y"},
            "rationale": "test fixture",
        },
    )
    assert consensus_res.status_code == 201, consensus_res.text

    final_res = await db_client.post(
        f"/api/v1/runs/{run_id}/advance",
        json={"target_stage": "finalized"},
    )
    assert final_res.status_code == 200, final_res.text

    second = await db_client.post(_SESSION_URL, json=payload)
    # Issue #32: surfacing a finalized run is a resume, not a creation.
    assert second.status_code == 200
    assert second.json()["data"]["run_id"] == run_id


# =================== QA: bad inputs ===================


@pytest.mark.asyncio
async def test_qa_session_rejects_extraction_global_template(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article")
    article_id, project_id = article
    extraction_global = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_templates_global "
                "WHERE kind = 'extraction' LIMIT 1"
            )
        )
    ).scalar()
    if extraction_global is None:
        pytest.skip("No extraction-kind global template seeded")

    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "quality_assessment",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "global_template_id": str(extraction_global),
        },
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_qa_session_returns_404_when_global_template_missing(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article")
    article_id, project_id = article

    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "quality_assessment",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "global_template_id": "00000000-0000-0000-0000-000000000000",
        },
    )
    assert res.status_code == 404


# =================== BOLA + missing-coverage branches (quality-loop run 2026-05-20-0200) ===================


def _err_message(response_json: dict) -> str:
    """Pull the human-readable error message out of the API envelope.

    Errors come back as ``{ok: False, error: {code, message}, trace_id}``,
    never as the FastAPI default ``{detail: ...}``.
    """
    return str(response_json.get("error", {}).get("message", ""))


async def _make_isolated_project(
    db: AsyncSession,
    *,
    creator_profile_id: UUID,
    with_member: bool,
) -> UUID:
    """Insert a fresh project (and optionally enrol the creator as manager)
    so the BOLA tests can fabricate the "other project" they need.

    Returns the new ``project_id``. The caller is responsible for cleanup
    if needed.
    """
    project_id = uuid4()
    await db.execute(
        text(
            """
            INSERT INTO public.projects (id, name, created_by_id)
            VALUES (:pid, :name, :uid)
            """
        ),
        {
            "pid": str(project_id),
            "name": f"BOLA test project {project_id.hex[:8]}",
            "uid": str(creator_profile_id),
        },
    )
    if with_member:
        await db.execute(
            text(
                """
                INSERT INTO public.project_members (project_id, user_id, role)
                VALUES (:pid, :uid, 'manager')
                """
            ),
            {"pid": str(project_id), "uid": str(creator_profile_id)},
        )
    return project_id


async def _make_article_in(db: AsyncSession, *, project_id: UUID) -> UUID:
    article_id = uuid4()
    await db.execute(
        text(
            """
            INSERT INTO public.articles (id, project_id, title)
            VALUES (:aid, :pid, :title)
            """
        ),
        {
            "aid": str(article_id),
            "pid": str(project_id),
            "title": f"BOLA test article {article_id.hex[:8]}",
        },
    )
    return article_id


@pytest.mark.asyncio
async def test_session_rejects_article_from_another_project(
    db_client: AsyncClient,
    db_session: AsyncSession,
    home_project_fixture: tuple[UUID, UUID, UUID, UUID, UUID],
) -> None:
    """BOLA defense (f_001 / f_002): a caller authenticated for project P_A
    must not be able to open a HITL session that points at an article owned
    by project P_B. The endpoint enforces membership for ``project_id`` but
    never validated that ``article_id`` belongs to that project — letting a
    legitimate manager of one project create instances/runs that reference
    another project's article. Must surface as a 400.
    """
    profile_id, home_project_id, _home_article_id, home_template, _ = home_project_fixture

    # Fabricate an isolated project + article that the auth profile is NOT a
    # member of. The membership check passes for home_project_id; only the
    # new article-ownership invariant should reject the request.
    foreign_project_id = await _make_isolated_project(
        db_session, creator_profile_id=profile_id, with_member=False
    )
    foreign_article_id = await _make_article_in(db_session, project_id=foreign_project_id)
    await db_session.commit()

    try:
        res = await db_client.post(
            _SESSION_URL,
            json={
                "kind": "extraction",
                "project_id": str(home_project_id),
                "article_id": str(foreign_article_id),
                "project_template_id": str(home_template),
            },
        )
        assert res.status_code == 400, res.text
        assert "article" in _err_message(res.json()).lower()
    finally:
        await db_session.execute(
            text("DELETE FROM public.articles WHERE id = :aid"),
            {"aid": str(foreign_article_id)},
        )
        await db_session.execute(
            text("DELETE FROM public.projects WHERE id = :pid"),
            {"pid": str(foreign_project_id)},
        )
        await db_session.commit()


@pytest.mark.asyncio
async def test_session_rejects_template_from_another_project(
    db_client: AsyncClient,
    db_session: AsyncSession,
    home_project_fixture: tuple[UUID, UUID, UUID, UUID, UUID],
) -> None:
    """Covers f_003: ``_resolve_project_template`` already rejects templates
    whose ``project_id`` does not match the request, but no test pinned that
    behaviour. Lock it in: passing a project_template_id from another project
    must return 400, not 404 or 500.
    """
    profile_id, home_project_id, home_article_id, _et, _qa = home_project_fixture

    # Build an isolated project + an extraction template owned by it. The
    # template id can then be smuggled into a request that claims to target
    # the home project — _resolve_project_template must reject it.
    foreign_project_id = await _make_isolated_project(
        db_session, creator_profile_id=profile_id, with_member=False
    )
    foreign_template_id = uuid4()
    await db_session.execute(
        text(
            """
            INSERT INTO public.project_extraction_templates
                (id, project_id, name, kind, framework, is_active, created_by)
            VALUES
                (:tid, :pid, :name, 'extraction', 'CUSTOM', false, :uid)
            """
        ),
        {
            "tid": str(foreign_template_id),
            "pid": str(foreign_project_id),
            "name": f"foreign-tpl-{foreign_template_id.hex[:8]}",
            "uid": str(profile_id),
        },
    )
    # Migration 0004 deferred trigger: every project_extraction_template must
    # have exactly one active version row, otherwise commit fails.
    await db_session.execute(
        text(
            """
            INSERT INTO public.extraction_template_versions
                (project_template_id, version, schema, published_by, is_active)
            VALUES
                (:tid, 1, '{}'::jsonb, :uid, true)
            """
        ),
        {"tid": str(foreign_template_id), "uid": str(profile_id)},
    )
    await db_session.commit()

    try:
        res = await db_client.post(
            _SESSION_URL,
            json={
                "kind": "extraction",
                "project_id": str(home_project_id),
                "article_id": str(home_article_id),
                "project_template_id": str(foreign_template_id),
            },
        )
        assert res.status_code == 400, res.text
    finally:
        await db_session.execute(
            text("DELETE FROM public.project_extraction_templates WHERE id = :tid"),
            {"tid": str(foreign_template_id)},
        )
        await db_session.execute(
            text("DELETE FROM public.projects WHERE id = :pid"),
            {"pid": str(foreign_project_id)},
        )
        await db_session.commit()


@pytest.mark.asyncio
async def test_session_rejects_kind_mismatch(
    db_client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001
    home_project_fixture: tuple[UUID, UUID, UUID, UUID, UUID],
) -> None:
    """Covers f_004: ``_resolve_project_template`` rejects requests whose
    declared kind disagrees with the template's stored kind. Pin the 400.
    """
    _profile_id, project_id, article_id, _et, qa_template = home_project_fixture

    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "extraction",  # mismatch — template is quality_assessment
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(qa_template),
        },
    )
    assert res.status_code == 400, res.text
    assert "kind" in _err_message(res.json()).lower()


@pytest.mark.asyncio
async def test_session_open_captures_hitl_config_snapshot(
    db_client: AsyncClient,
    db_session: AsyncSession,
    home_project_fixture: tuple[UUID, UUID, UUID, UUID, UUID],
) -> None:
    """Covers f_005: every Run created via ``_reuse_or_create_run`` must
    carry a ``hitl_config_snapshot`` populated from ``HitlConfigService``.
    Without this snapshot, replaying old runs would silently inherit the
    project's *current* HITL config — defeating the whole point of pinning
    reviewer counts/consensus rule at the moment the Run started.
    """
    _profile_id, project_id, article_id, _et, _qa = home_project_fixture
    global_template_id = await _pick_qa_global_template(db_session)
    if global_template_id is None:
        pytest.skip("Need a seeded QA global template (PROBAST / QUADAS-2)")

    await _wipe_qa_state(
        db_session,
        project_id=project_id,
        global_template_id=global_template_id,
        article_id=article_id,
    )

    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "quality_assessment",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "global_template_id": str(global_template_id),
        },
    )
    assert res.status_code == 201, res.text
    run_id = res.json()["data"]["run_id"]

    snapshot = (
        await db_session.execute(
            text("SELECT hitl_config_snapshot FROM public.extraction_runs WHERE id = :rid"),
            {"rid": run_id},
        )
    ).scalar()
    assert snapshot is not None, "hitl_config_snapshot must be populated at Run creation"
    assert isinstance(snapshot, dict)
    # The snapshot resolves to either a system default or a project override —
    # in both cases the contract guarantees reviewer_count + consensus_rule.
    assert "reviewer_count" in snapshot
    assert "consensus_rule" in snapshot


# =================== Extraction kind ===================


@pytest.mark.asyncio
async def test_extraction_session_requires_project_template_id(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Extraction templates are authored per project, so passing only a
    global_template_id makes no sense and must 400."""
    article = await _pick_article(db_session)
    qa_global = await _pick_qa_global_template(db_session)
    if article is None or qa_global is None:
        pytest.skip("Need an article + a seeded global template")
    article_id, project_id = article

    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "extraction",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "global_template_id": str(qa_global),
        },
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_extraction_session_opens_run_for_existing_project_template(
    db_client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001 — kept for seed-fixture ordering
    auth_as_seed_primary: UUID,  # noqa: ARG001
) -> None:
    # Pin to the sentinel triple: ``_pick_article`` and
    # ``_pick_extraction_project_template`` each ``LIMIT 1`` independently
    # and could land in different projects on a polluted dev DB, surfacing
    # as "project_template_id … not found in project" (400) instead of
    # the 201/200 contract this test asserts.
    project_id = SEED.primary_project
    article_id = SEED.primary_article
    template_id = SEED.primary_template

    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "extraction",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(template_id),
        },
    )
    # 201 on first open, 200 if a previous test left an in-flight Run
    # behind for the same (article, project_template) tuple. Issue #32.
    assert res.status_code in (200, 201), res.text
    body = res.json()["data"]
    assert body["kind"] == "extraction"
    assert body["project_template_id"] == str(template_id)
    assert UUID(body["run_id"])


# =================== Project-template management ===================


@pytest.mark.asyncio
async def test_clone_template_endpoint_is_idempotent(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need a project + a seeded QA template")
    _, project_id = article

    url = f"/api/v1/projects/{project_id}/templates/clone"
    payload = {"global_template_id": str(global_template_id), "kind": "quality_assessment"}

    first = await db_client.post(url, json=payload)
    assert first.status_code == 201, first.text
    first_body = first.json()["data"]
    assert UUID(first_body["project_template_id"])
    assert UUID(first_body["version_id"])

    second = await db_client.post(url, json=payload)
    assert second.status_code == 201
    second_body = second.json()["data"]
    assert second_body["project_template_id"] == first_body["project_template_id"]
    assert second_body["created"] is False


@pytest.mark.asyncio
async def test_clone_template_endpoint_rejects_kind_mismatch(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    article = await _pick_article(db_session)
    qa_global = await _pick_qa_global_template(db_session)
    if article is None or qa_global is None:
        pytest.skip("Need a project + a seeded QA global template")
    _, project_id = article

    res = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/clone",
        json={"global_template_id": str(qa_global), "kind": "extraction"},
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_patch_template_active_toggles_qa_template(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need a project + a seeded QA template")
    _, project_id = article

    clone = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/clone",
        json={"global_template_id": str(global_template_id), "kind": "quality_assessment"},
    )
    assert clone.status_code == 201
    template_id = clone.json()["data"]["project_template_id"]

    off = await db_client.patch(
        f"/api/v1/projects/{project_id}/templates/{template_id}",
        json={"is_active": False},
    )
    assert off.status_code == 200, off.text
    assert off.json()["data"]["is_active"] is False

    on = await db_client.patch(
        f"/api/v1/projects/{project_id}/templates/{template_id}",
        json={"is_active": True},
    )
    assert on.status_code == 200
    assert on.json()["data"]["is_active"] is True


@pytest.mark.asyncio
async def test_patch_template_active_rejects_disabling_only_extraction_template(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_seed_primary: UUID,  # noqa: ARG001
) -> None:
    """Disabling the project's only active extraction template must 400 —
    extraction's article-table view assumes a single active template."""
    # Pin to the sentinel template + project so the auth principal
    # (``SEED.primary_profile``, manager of ``SEED.primary_project``) is
    # guaranteed to have write access. ``_pick_extraction_project_template``
    # used to LIMIT 1 over all extraction templates and could return one
    # from a project the auth principal does not manage, surfacing as
    # 403 "Manager role required" instead of the 400 this test asserts.
    project_id = SEED.primary_project
    template_id = SEED.primary_template

    other_active = (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM public.project_extraction_templates "
                "WHERE project_id = :pid AND kind = 'extraction' "
                "AND is_active = true AND id <> :tid"
            ),
            {"pid": str(project_id), "tid": str(template_id)},
        )
    ).scalar()
    if (other_active or 0) > 0:
        pytest.skip("Project has more than one active extraction template; rule does not apply")

    res = await db_client.patch(
        f"/api/v1/projects/{project_id}/templates/{template_id}",
        json={"is_active": False},
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_patch_template_active_returns_404_for_unknown_template(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need a project")
    _, project_id = article

    res = await db_client.patch(
        f"/api/v1/projects/{project_id}/templates/00000000-0000-0000-0000-000000000000",
        json={"is_active": False},
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_session_backfills_singleton_children_added_after_model_creation(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Late-added cardinality='one' children of an existing many-parent
    instance must be materialised at session open.

    Repro: Manager creates a CHARMS project, the user creates a model
    instance (parent under the ``prediction_models`` many-parent), then the
    Manager adds a new ``extraction_entity_types`` row under
    ``prediction_models`` from the Configuration tab. Without backfill the
    new sub-section renders fields with no instance to bind values to —
    orphan UI. Re-opening the session must materialise the missing child.
    """
    from app.models.extraction import ExtractionCardinality, TemplateKind
    from app.seed import seed_charms

    await seed_charms(db_session)
    await db_session.commit()

    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    article_id, project_id = article

    # Clone CHARMS so this test owns the project template lifecycle.
    charms_global_id = UUID("000c0000-0000-0000-0000-000000000001")
    await _wipe_project_template_chain(
        db_session,
        project_id=project_id,
        global_template_id=charms_global_id,
    )
    clone_res = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/clone",
        json={"global_template_id": str(charms_global_id), "kind": "extraction"},
    )
    assert clone_res.status_code == 201, clone_res.text
    project_template_id = UUID(clone_res.json()["data"]["project_template_id"])

    # First session open: top-level singletons seeded; many-parent is empty.
    first = await db_client.post(
        _SESSION_URL,
        json={
            "kind": TemplateKind.EXTRACTION.value,
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(project_template_id),
        },
    )
    assert first.status_code in (200, 201), first.text

    # Simulate the user creating a model: insert a parent instance under
    # the prediction_models many-parent.
    prediction_models_row = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_entity_types "
                "WHERE project_template_id = :ptid AND name = 'prediction_models'"
            ),
            {"ptid": str(project_template_id)},
        )
    ).scalar()
    if prediction_models_row is None:
        pytest.skip("CHARMS clone is missing prediction_models entity_type")
    prediction_models_et_id = UUID(str(prediction_models_row))

    model_instance_id = (
        await db_session.execute(
            text(
                """
                INSERT INTO public.extraction_instances
                    (project_id, article_id, template_id, entity_type_id,
                     parent_instance_id, label, sort_order, status, created_by)
                VALUES (:pid, :aid, :tid, :etid, NULL, 'XGBoost', 0,
                        'pending'::extraction_instance_status,
                        (SELECT id FROM public.profiles LIMIT 1))
                RETURNING id
                """
            ),
            {
                "pid": str(project_id),
                "aid": str(article_id),
                "tid": str(project_template_id),
                "etid": str(prediction_models_et_id),
            },
        )
    ).scalar()
    assert model_instance_id is not None

    # Manager adds a brand-new sub-section under prediction_models. The
    # parent is the model container, so the child must be a model_section
    # (enforced by the trigger from migration 0016).
    from app.models.extraction import ExtractionEntityRole
    from tests.factories import make_entity_type

    new_sub = make_entity_type(
        project_template_id=project_template_id,
        name="late_added_sub",
        label="Late Added Sub",
        cardinality=ExtractionCardinality.ONE.value,
        role=ExtractionEntityRole.MODEL_SECTION,
        parent_entity_type_id=prediction_models_et_id,
        sort_order=99,
    )
    db_session.add(new_sub)
    await db_session.flush()
    new_sub_section_id = new_sub.id
    assert new_sub_section_id is not None
    await db_session.commit()

    # Re-open session: backfill must materialise the missing child.
    second = await db_client.post(
        _SESSION_URL,
        json={
            "kind": TemplateKind.EXTRACTION.value,
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(project_template_id),
        },
    )
    assert second.status_code in (200, 201), second.text

    backfilled = (
        await db_session.execute(
            text(
                """
                SELECT COUNT(*) FROM public.extraction_instances
                WHERE article_id = :aid
                  AND entity_type_id = :etid
                  AND parent_instance_id = :pid
                """
            ),
            {
                "aid": str(article_id),
                "etid": str(new_sub_section_id),
                "pid": str(model_instance_id),
            },
        )
    ).scalar()
    assert backfilled == 1, (
        "Late-added singleton sub-section should be materialised exactly once "
        "for the existing model instance after session re-open"
    )


@pytest.mark.asyncio
async def test_session_backfill_is_idempotent(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Subsequent session opens must not duplicate the materialised
    child instance. Same invariant as the singletons guard at the
    top level: one instance per (parent_instance, child_entity_type)."""
    from app.models.extraction import TemplateKind
    from app.seed import seed_charms

    await seed_charms(db_session)
    await db_session.commit()

    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    article_id, project_id = article

    charms_global_id = UUID("000c0000-0000-0000-0000-000000000001")
    await _wipe_project_template_chain(
        db_session,
        project_id=project_id,
        global_template_id=charms_global_id,
    )
    clone_res = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/clone",
        json={"global_template_id": str(charms_global_id), "kind": "extraction"},
    )
    assert clone_res.status_code == 201, clone_res.text
    project_template_id = UUID(clone_res.json()["data"]["project_template_id"])

    prediction_models_row = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_entity_types "
                "WHERE project_template_id = :ptid AND name = 'prediction_models'"
            ),
            {"ptid": str(project_template_id)},
        )
    ).scalar()
    if prediction_models_row is None:
        pytest.skip("CHARMS clone is missing prediction_models entity_type")
    prediction_models_et_id = UUID(str(prediction_models_row))

    model_instance_id = (
        await db_session.execute(
            text(
                """
                INSERT INTO public.extraction_instances
                    (project_id, article_id, template_id, entity_type_id,
                     parent_instance_id, label, sort_order, status, created_by)
                VALUES (:pid, :aid, :tid, :etid, NULL, 'XGBoost', 0,
                        'pending'::extraction_instance_status,
                        (SELECT id FROM public.profiles LIMIT 1))
                RETURNING id
                """
            ),
            {
                "pid": str(project_id),
                "aid": str(article_id),
                "tid": str(project_template_id),
                "etid": str(prediction_models_et_id),
            },
        )
    ).scalar()
    await db_session.commit()

    payload = {
        "kind": TemplateKind.EXTRACTION.value,
        "project_id": str(project_id),
        "article_id": str(article_id),
        "project_template_id": str(project_template_id),
    }
    res1 = await db_client.post(_SESSION_URL, json=payload)
    assert res1.status_code in (200, 201), res1.text
    res2 = await db_client.post(_SESSION_URL, json=payload)
    assert res2.status_code in (200, 201), res2.text

    duplicates = (
        await db_session.execute(
            text(
                """
                SELECT entity_type_id, COUNT(*)
                FROM public.extraction_instances
                WHERE article_id = :aid
                  AND parent_instance_id = :pid
                GROUP BY entity_type_id
                HAVING COUNT(*) > 1
                """
            ),
            {"aid": str(article_id), "pid": str(model_instance_id)},
        )
    ).all()
    assert duplicates == [], (
        "Backfill must not duplicate child singletons under the same parent instance"
    )
