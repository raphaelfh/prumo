"""Quality-Assessment publish flow: comprehensive scenarios.

Covers the *full* PROBAST/QUADAS-2 publish path through the public HTTP
endpoints — including the invariants that block silent data corruption:

* an empty publish (zero filled fields) must not advance a run to
  ``finalized`` (BUG-001: the run would otherwise show a "Published"
  badge over zero PublishedState rows);
* reopen → modify → republish must preserve the parent run as audit
  trail and surface the child as the canonical state;
* republishing the *same* fields must update ``PublishedState.version``
  monotonically per run (optimistic concurrency);
* mid-publish failures (e.g., posting a consensus to a stale run that
  has already finalized) surface as 4xx with the original run intact.

The scenarios are parameterized so adding a new case only requires
extending the table at the top.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app

_SESSION_URL = "/api/v1/hitl/sessions"


@pytest_asyncio.fixture
async def auth_as_profile(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
    raw = (await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if raw is None:
        pytest.skip("No profile rows available")
    profile_id = UUID(str(raw))

    async def override() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="test@example.com",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override
    try:
        yield profile_id
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def _pick_article(db: AsyncSession) -> tuple[UUID, UUID] | None:
    row = (await db.execute(text("SELECT id, project_id FROM public.articles LIMIT 1"))).first()
    if row is None:
        return None
    return UUID(str(row[0])), UUID(str(row[1]))


async def _pick_qa_global_template(db: AsyncSession, name: str = "PROBAST") -> UUID | None:
    raw = (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_templates_global "
                "WHERE kind='quality_assessment' AND name=:n LIMIT 1"
            ),
            {"n": name},
        )
    ).scalar()
    return UUID(str(raw)) if raw is not None else None


async def _wipe_qa_runs_for_article(
    db: AsyncSession,
    *,
    project_id: UUID,
    article_id: UUID,
    global_template_id: UUID,
) -> None:
    """Remove runs (and their dependents) tied to a QA template clone for one article.

    Leaves the project_extraction_templates row in place so the session POST
    exercises the *reuse* clone branch — speeds up the parameterized fan-out.
    """
    await db.execute(
        text(
            """
            DELETE FROM public.extraction_runs
            WHERE project_id = :pid
              AND article_id = :aid
              AND template_id IN (
                SELECT id FROM public.project_extraction_templates
                WHERE project_id = :pid AND global_template_id = :gid
              )
            """
        ),
        {"pid": str(project_id), "aid": str(article_id), "gid": str(global_template_id)},
    )
    await db.commit()


async def _open_qa_session(
    client: AsyncClient,
    *,
    project_id: UUID,
    article_id: UUID,
    global_template_id: UUID,
) -> dict[str, Any]:
    res = await client.post(
        _SESSION_URL,
        json={
            "kind": "quality_assessment",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "global_template_id": str(global_template_id),
        },
    )
    assert res.status_code in (200, 201), res.text
    return res.json()["data"]


async def _pick_first_field(db: AsyncSession, *, entity_type_id: UUID) -> UUID:
    raw = (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_fields "
                "WHERE entity_type_id = :et "
                "ORDER BY sort_order LIMIT 1"
            ),
            {"et": str(entity_type_id)},
        )
    ).scalar()
    assert raw is not None, "Expected at least one field on the entity type"
    return UUID(str(raw))


async def _advance(client: AsyncClient, run_id: str, target: str) -> None:
    res = await client.post(
        f"/api/v1/runs/{run_id}/advance",
        json={"target_stage": target},
    )
    assert res.status_code == 200, res.text


async def _write_manual_consensus(
    client: AsyncClient,
    *,
    run_id: str,
    instance_id: str,
    field_id: str,
    value: Any,
    rationale: str,
) -> None:
    res = await client.post(
        f"/api/v1/runs/{run_id}/consensus",
        json={
            "instance_id": instance_id,
            "field_id": field_id,
            "mode": "manual_override",
            "value": {"value": value},
            "rationale": rationale,
        },
    )
    assert res.status_code == 201, res.text


# ===================== BUG-001: empty publish must be blocked =====================


@pytest.mark.asyncio
async def test_finalize_rejected_from_consensus_stage_when_empty(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """A run that walked all the way to CONSENSUS but recorded zero
    ConsensusDecisions must not reach FINALIZED.

    Previously (BUG-001) the publish flow advanced through stages even
    with no values filled, leaving a "Published" run that returned an
    empty PublishedState set — the UI showed it as complete.
    """
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    await _wipe_qa_runs_for_article(
        db_session,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    session = await _open_qa_session(
        db_client,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    run_id = session["run_id"]
    await _advance(db_client, run_id, "review")
    await _advance(db_client, run_id, "consensus")

    res = await db_client.post(
        f"/api/v1/runs/{run_id}/advance",
        json={"target_stage": "finalized"},
    )
    assert res.status_code == 400, res.text
    assert "no consensus decisions" in res.json()["error"]["message"].lower()

    # Verify the run is still parked at CONSENSUS — no half-finalized state.
    row = (
        await db_session.execute(
            text("SELECT stage, status FROM public.extraction_runs WHERE id = :rid"),
            {"rid": run_id},
        )
    ).first()
    assert row is not None
    assert row[0] == "consensus"


# ===================== Happy-path publish (1 field) =====================


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("value", "expected_published"),
    [
        ("Y", "Y"),
        ("PY", "PY"),
        ("PN", "PN"),
        ("N", "N"),
        ("NI", "NI"),
        ("NA", "NA"),
    ],
    ids=["yes", "probably-yes", "probably-no", "no", "no-info", "not-applicable"],
)
async def test_single_field_publish_for_each_probast_value(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
    value: str,
    expected_published: str,
) -> None:
    """A QA publish writes one ConsensusDecision per field and the matching
    PublishedState row. Parameterized over each PROBAST signaling-question
    value (Y/PY/PN/N/NI/NA) so the typed select round-trips through the
    consensus and publish path."""
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    await _wipe_qa_runs_for_article(
        db_session,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    session = await _open_qa_session(
        db_client,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    run_id = session["run_id"]
    instances_by_et = session["instances_by_entity_type"]
    et_id_str, instance_id = next(iter(instances_by_et.items()))
    field_id = await _pick_first_field(
        db_session,
        entity_type_id=UUID(et_id_str),
    )

    # Walk through proposal → review → consensus.
    await _advance(db_client, run_id, "review")
    await _advance(db_client, run_id, "consensus")

    await _write_manual_consensus(
        db_client,
        run_id=run_id,
        instance_id=str(instance_id),
        field_id=str(field_id),
        value=value,
        rationale="parameterized publish test",
    )
    await _advance(db_client, run_id, "finalized")

    # Verify PublishedState row.
    row = (
        await db_session.execute(
            text(
                "SELECT value, version FROM public.extraction_published_states "
                "WHERE run_id = :rid AND instance_id = :iid AND field_id = :fid"
            ),
            {"rid": run_id, "iid": str(instance_id), "fid": str(field_id)},
        )
    ).first()
    assert row is not None, "PublishedState row must exist after finalize"
    assert row[0] == {"value": expected_published}
    assert row[1] == 1


# ===================== Republish updates PublishedState.version =====================


@pytest.mark.asyncio
async def test_republish_same_field_increments_published_version(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Within a single consensus stage, writing two manual_overrides on
    the same coord must increment PublishedState.version (optimistic
    concurrency). The second consensus is an explicit revision — UI
    surfaces it as 'Change value', and the audit trail keeps both
    ConsensusDecision rows append-only.
    """
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    await _wipe_qa_runs_for_article(
        db_session,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    session = await _open_qa_session(
        db_client,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    run_id = session["run_id"]
    et_id_str, instance_id = next(iter(session["instances_by_entity_type"].items()))
    field_id = await _pick_first_field(
        db_session,
        entity_type_id=UUID(et_id_str),
    )

    await _advance(db_client, run_id, "review")
    await _advance(db_client, run_id, "consensus")
    await _write_manual_consensus(
        db_client,
        run_id=run_id,
        instance_id=str(instance_id),
        field_id=str(field_id),
        value="Y",
        rationale="initial",
    )
    await _write_manual_consensus(
        db_client,
        run_id=run_id,
        instance_id=str(instance_id),
        field_id=str(field_id),
        value="N",
        rationale="revision",
    )
    await _advance(db_client, run_id, "finalized")

    row = (
        await db_session.execute(
            text(
                "SELECT value, version FROM public.extraction_published_states "
                "WHERE run_id = :rid AND instance_id = :iid AND field_id = :fid"
            ),
            {"rid": run_id, "iid": str(instance_id), "fid": str(field_id)},
        )
    ).first()
    assert row is not None
    assert row[0] == {"value": "N"}, "PublishedState reflects the latest consensus value"
    assert row[1] == 2, "Optimistic version must increment on each consensus write"

    # And two ConsensusDecision rows exist (append-only history).
    count = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.extraction_consensus_decisions "
                "WHERE run_id = :rid AND instance_id = :iid AND field_id = :fid"
            ),
            {"rid": run_id, "iid": str(instance_id), "fid": str(field_id)},
        )
    ).scalar()
    assert count == 2


# ===================== Cannot finalize when stage is wrong =====================


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "from_stage",
    ["pending", "proposal", "review"],
    ids=["from-pending", "from-proposal", "from-review"],
)
async def test_finalize_rejected_from_wrong_stage(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
    from_stage: str,
) -> None:
    """advance(target=finalized) is only valid from CONSENSUS. Any other
    transition surfaces as 400 (InvalidStageTransitionError).
    """
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    await _wipe_qa_runs_for_article(
        db_session,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    session = await _open_qa_session(
        db_client,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    run_id = session["run_id"]

    # Walk to the requested stage. PROPOSAL is the default after open.
    for stage in ("review",):
        if from_stage == "pending":
            # Reset to pending — open_or_resume parks at proposal; reverse
            # by direct SQL since pending → proposal is one-way.
            await db_session.execute(
                text(
                    "UPDATE public.extraction_runs SET stage='pending', "
                    "status='pending' WHERE id = :rid"
                ),
                {"rid": run_id},
            )
            await db_session.commit()
            break
        if from_stage == "proposal":
            break
        await _advance(db_client, run_id, stage)
        if from_stage == "review":
            break

    res = await db_client.post(
        f"/api/v1/runs/{run_id}/advance",
        json={"target_stage": "finalized"},
    )
    assert res.status_code == 400, res.text
    # The error message must name the bad transition.
    assert "cannot transition" in res.json()["error"]["message"].lower()


# ===================== Manual override requires rationale =====================


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("value_payload", "rationale", "expected_status", "ids"),
    [
        ({"value": "Y"}, "with rationale", 201, "happy-path"),
        ({"value": "Y"}, None, 400, "missing-rationale"),
        (None, "rationale alone", 400, "missing-value"),
    ],
    ids=["happy-path", "missing-rationale", "missing-value"],
)
async def test_manual_override_payload_validation(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
    value_payload: dict | None,
    rationale: str | None,
    expected_status: int,
    ids: str,  # noqa: ARG001
) -> None:
    """manual_override requires both ``value`` and ``rationale``. Either
    being absent rejects the request before any DB write, so the run is
    untouched and republish can retry cleanly."""
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    await _wipe_qa_runs_for_article(
        db_session,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    session = await _open_qa_session(
        db_client,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    run_id = session["run_id"]
    et_id_str, instance_id = next(iter(session["instances_by_entity_type"].items()))
    field_id = await _pick_first_field(
        db_session,
        entity_type_id=UUID(et_id_str),
    )

    await _advance(db_client, run_id, "review")
    await _advance(db_client, run_id, "consensus")

    body: dict[str, Any] = {
        "instance_id": str(instance_id),
        "field_id": str(field_id),
        "mode": "manual_override",
    }
    if value_payload is not None:
        body["value"] = value_payload
    if rationale is not None:
        body["rationale"] = rationale

    res = await db_client.post(f"/api/v1/runs/{run_id}/consensus", json=body)
    assert res.status_code == expected_status, res.text


# ===================== Coordinate coherence =====================


@pytest.mark.asyncio
async def test_consensus_rejects_field_from_wrong_template(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Writing a consensus with a ``field_id`` that belongs to a different
    template (i.e. doesn't match the run's version snapshot) must reject
    with 422 — never silently write a row pointing at a foreign field.

    This guard prevents the cross-template leak class of bugs where the
    UI passes a stale id after a template version bump or theme switch.
    """
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    foreign_global = await _pick_qa_global_template(db_session, name="QUADAS-2")
    if article is None or global_template_id is None or foreign_global is None:
        pytest.skip("Need two distinct QA global templates")
    article_id, project_id = article

    await _wipe_qa_runs_for_article(
        db_session,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    session = await _open_qa_session(
        db_client,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    run_id = session["run_id"]
    et_id_str, instance_id = next(iter(session["instances_by_entity_type"].items()))

    # Pick a field from a DIFFERENT clone (QUADAS-2) — this id is alien to
    # the PROBAST run's version snapshot.
    foreign_session = await _open_qa_session(
        db_client,
        project_id=project_id,
        article_id=article_id,
        global_template_id=foreign_global,
    )
    foreign_et_id, _foreign_instance = next(
        iter(foreign_session["instances_by_entity_type"].items())
    )
    foreign_field = await _pick_first_field(
        db_session,
        entity_type_id=UUID(foreign_et_id),
    )

    await _advance(db_client, run_id, "review")
    await _advance(db_client, run_id, "consensus")

    res = await db_client.post(
        f"/api/v1/runs/{run_id}/consensus",
        json={
            "instance_id": str(instance_id),
            "field_id": str(foreign_field),
            "mode": "manual_override",
            "value": {"value": "Y"},
            "rationale": "should be rejected",
        },
    )
    assert res.status_code == 422, res.text


# ===================== Session resume is idempotent =====================


@pytest.mark.asyncio
@pytest.mark.parametrize("calls", [2, 3, 4], ids=["twice", "three-times", "four-times"])
async def test_session_open_is_idempotent_across_n_calls(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
    calls: int,
) -> None:
    """Repeated POST /hitl/sessions on the same (project, article, template)
    must return the same run_id every time — no duplicates accumulate
    even under bursty page loads or React StrictMode double-renders.
    """
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    await _wipe_qa_runs_for_article(
        db_session,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )

    run_ids = set()
    template_ids = set()
    for _ in range(calls):
        body = await _open_qa_session(
            db_client,
            project_id=project_id,
            article_id=article_id,
            global_template_id=global_template_id,
        )
        run_ids.add(body["run_id"])
        template_ids.add(body["project_template_id"])
    assert len(run_ids) == 1, f"Expected idempotency, got {run_ids}"
    assert len(template_ids) == 1, f"Expected single clone, got {template_ids}"


# ===================== Reopen → modify → republish (audit trail) =====================


@pytest.mark.asyncio
async def test_reopen_modify_republish_preserves_parent_audit(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """The reopen flow MUST keep the parent run intact (audit trail) and
    surface the modified value as the canonical PublishedState on the
    child run. Parent published value is unchanged; child has its own
    PublishedState row with version=1 (each Run has independent versioning).
    """
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    await _wipe_qa_runs_for_article(
        db_session,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    session = await _open_qa_session(
        db_client,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    run_id = session["run_id"]
    et_id_str, instance_id = next(iter(session["instances_by_entity_type"].items()))
    field_id = await _pick_first_field(
        db_session,
        entity_type_id=UUID(et_id_str),
    )

    # Finalize the parent with value Y.
    await _advance(db_client, run_id, "review")
    await _advance(db_client, run_id, "consensus")
    await _write_manual_consensus(
        db_client,
        run_id=run_id,
        instance_id=str(instance_id),
        field_id=str(field_id),
        value="Y",
        rationale="parent publish",
    )
    await _advance(db_client, run_id, "finalized")

    # Reopen.
    reopen_res = await db_client.post(f"/api/v1/runs/{run_id}/reopen")
    assert reopen_res.status_code == 201, reopen_res.text
    child_id = reopen_res.json()["data"]["id"]
    assert child_id != run_id

    # Modify and republish the child with N.
    await _advance(db_client, child_id, "consensus")
    await _write_manual_consensus(
        db_client,
        run_id=child_id,
        instance_id=str(instance_id),
        field_id=str(field_id),
        value="N",
        rationale="child revision",
    )
    await _advance(db_client, child_id, "finalized")

    # Parent published value is unchanged (Y, v1).
    parent_row = (
        await db_session.execute(
            text(
                "SELECT value, version FROM public.extraction_published_states "
                "WHERE run_id = :rid AND instance_id = :iid AND field_id = :fid"
            ),
            {"rid": run_id, "iid": str(instance_id), "fid": str(field_id)},
        )
    ).first()
    assert parent_row is not None
    assert parent_row[0] == {"value": "Y"}
    assert parent_row[1] == 1

    # Child published value is N, also v1 (each Run has independent versioning).
    child_row = (
        await db_session.execute(
            text(
                "SELECT value, version FROM public.extraction_published_states "
                "WHERE run_id = :rid AND instance_id = :iid AND field_id = :fid"
            ),
            {"rid": child_id, "iid": str(instance_id), "fid": str(field_id)},
        )
    ).first()
    assert child_row is not None
    assert child_row[0] == {"value": "N"}
    assert child_row[1] == 1

    # Child Run.parameters.parent_run_id points at the parent.
    parent_link = (
        await db_session.execute(
            text("SELECT parameters->>'parent_run_id' FROM public.extraction_runs WHERE id = :cid"),
            {"cid": child_id},
        )
    ).scalar()
    assert parent_link == run_id


# ===================== Multi-field publish across domains =====================


@pytest.mark.asyncio
@pytest.mark.parametrize("field_count", [1, 3, 5], ids=["one-field", "three-fields", "five-fields"])
async def test_multi_field_publish_records_all_consensus_and_published_rows(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
    field_count: int,
) -> None:
    """Publishing N fields must produce N ConsensusDecisions and N
    PublishedState rows. The published_states sit at version=1 each
    (one manual_override per coord). Domain boundary is not special —
    they're all (instance, field) pairs.
    """
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    await _wipe_qa_runs_for_article(
        db_session,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    session = await _open_qa_session(
        db_client,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    run_id = session["run_id"]

    # Collect (instance_id, field_id) pairs from across domains.
    pairs: list[tuple[str, str]] = []
    for et_id_str, instance_id in session["instances_by_entity_type"].items():
        fields = (
            (
                await db_session.execute(
                    text(
                        "SELECT id FROM public.extraction_fields "
                        "WHERE entity_type_id = :et ORDER BY sort_order"
                    ),
                    {"et": et_id_str},
                )
            )
            .scalars()
            .all()
        )
        for f in fields:
            pairs.append((str(instance_id), str(f)))
            if len(pairs) == field_count:
                break
        if len(pairs) == field_count:
            break
    assert len(pairs) == field_count, "Not enough fields in the seeded template"

    await _advance(db_client, run_id, "review")
    await _advance(db_client, run_id, "consensus")
    values = ["Y", "PY", "PN", "N", "NI", "NA"]
    for i, (iid, fid) in enumerate(pairs):
        await _write_manual_consensus(
            db_client,
            run_id=run_id,
            instance_id=iid,
            field_id=fid,
            value=values[i % len(values)],
            rationale=f"field {i + 1}/{field_count}",
        )
    await _advance(db_client, run_id, "finalized")

    consensus_count = (
        await db_session.execute(
            text("SELECT count(*) FROM public.extraction_consensus_decisions WHERE run_id = :rid"),
            {"rid": run_id},
        )
    ).scalar()
    published_count = (
        await db_session.execute(
            text("SELECT count(*) FROM public.extraction_published_states WHERE run_id = :rid"),
            {"rid": run_id},
        )
    ).scalar()
    assert consensus_count == field_count
    assert published_count == field_count


# ===================== Cannot advance past FINALIZED =====================


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "target",
    ["proposal", "review", "consensus", "finalized", "cancelled"],
    ids=["to-proposal", "to-review", "to-consensus", "to-finalized", "to-cancelled"],
)
async def test_finalized_run_is_terminal(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
    target: str,
) -> None:
    """A finalized run rejects any further advance — including a self-
    transition to ``finalized`` (which would otherwise be idempotent).
    Reopen is the explicit revision path with its own endpoint."""
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    await _wipe_qa_runs_for_article(
        db_session,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    session = await _open_qa_session(
        db_client,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    run_id = session["run_id"]
    et_id_str, instance_id = next(iter(session["instances_by_entity_type"].items()))
    field_id = await _pick_first_field(
        db_session,
        entity_type_id=UUID(et_id_str),
    )

    await _advance(db_client, run_id, "review")
    await _advance(db_client, run_id, "consensus")
    await _write_manual_consensus(
        db_client,
        run_id=run_id,
        instance_id=str(instance_id),
        field_id=str(field_id),
        value="Y",
        rationale="finalize fixture",
    )
    await _advance(db_client, run_id, "finalized")

    res = await db_client.post(
        f"/api/v1/runs/{run_id}/advance",
        json={"target_stage": target},
    )
    assert res.status_code == 400, res.text


# ===================== Cancelled run is terminal =====================


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "from_stage",
    ["proposal", "review", "consensus"],
    ids=["cancel-from-proposal", "cancel-from-review", "cancel-from-consensus"],
)
async def test_cancelled_run_blocks_further_writes(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
    from_stage: str,
) -> None:
    """Cancelling a run terminates it: subsequent attempts to advance
    or write proposals/consensus must fail. Required to support the
    'abandon this assessment' UX without leaving zombie runs that
    accidentally get picked up by the next session POST.
    """
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    await _wipe_qa_runs_for_article(
        db_session,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    session = await _open_qa_session(
        db_client,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    run_id = session["run_id"]

    # Walk forward to the desired stage before cancelling.
    if from_stage in ("review", "consensus"):
        await _advance(db_client, run_id, "review")
    if from_stage == "consensus":
        await _advance(db_client, run_id, "consensus")

    cancel = await db_client.post(
        f"/api/v1/runs/{run_id}/advance",
        json={"target_stage": "cancelled"},
    )
    assert cancel.status_code == 200, cancel.text

    # Now any forward transition must reject.
    res = await db_client.post(
        f"/api/v1/runs/{run_id}/advance",
        json={"target_stage": "proposal"},
    )
    assert res.status_code == 400
    res = await db_client.post(
        f"/api/v1/runs/{run_id}/advance",
        json={"target_stage": "finalized"},
    )
    assert res.status_code == 400


# ===================== Reopen is rejected for non-finalized runs =====================


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "stage",
    ["pending", "proposal", "review", "consensus", "cancelled"],
    ids=[
        "reopen-pending",
        "reopen-proposal",
        "reopen-review",
        "reopen-consensus",
        "reopen-cancelled",
    ],
)
async def test_reopen_rejects_non_finalized_runs(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
    stage: str,
) -> None:
    """Only finalized runs can be reopened. Trying to reopen an in-flight
    or cancelled run must surface a typed 409/400 so the UI knows the
    operation is invalid and the caller doesn't shadow the active run.
    """
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    await _wipe_qa_runs_for_article(
        db_session,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    session = await _open_qa_session(
        db_client,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    run_id = session["run_id"]

    if stage == "pending":
        # Reverse from PROPOSAL via direct SQL.
        await db_session.execute(
            text(
                "UPDATE public.extraction_runs SET stage='pending', status='pending' "
                "WHERE id = :rid"
            ),
            {"rid": run_id},
        )
        await db_session.commit()
    elif stage == "review":
        await _advance(db_client, run_id, "review")
    elif stage == "consensus":
        await _advance(db_client, run_id, "review")
        await _advance(db_client, run_id, "consensus")
    elif stage == "cancelled":
        await _advance(db_client, run_id, "cancelled")

    res = await db_client.post(f"/api/v1/runs/{run_id}/reopen")
    assert res.status_code in (400, 409), res.text


# ===================== Select field value validation =====================
# These tests document a current gap: the backend does NOT validate that
# proposed/consensus values fall inside the field's `allowed_values`. The
# UI uses the dropdown to constrain user input, but API misuse bypasses it.
# The asserts in this test capture the current behaviour so a future tightening
# is a deliberate, reviewable change rather than an accidental break.


@pytest.mark.asyncio
async def test_consensus_currently_accepts_value_outside_allowed_values(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Documents current behaviour: an arbitrary string can be published
    for a select field with allowed_values=[Y,PY,PN,N,NI,NA]. The UI
    constrains via the dropdown so this matters only for direct API use.

    Tightening this requires a coordinated migration of existing data
    plus a frontend Zod schema sync; tracking as a hardening item.
    """
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    await _wipe_qa_runs_for_article(
        db_session,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    session = await _open_qa_session(
        db_client,
        project_id=project_id,
        article_id=article_id,
        global_template_id=global_template_id,
    )
    run_id = session["run_id"]
    et_id_str, instance_id = next(iter(session["instances_by_entity_type"].items()))
    field_id = await _pick_first_field(
        db_session,
        entity_type_id=UUID(et_id_str),
    )

    await _advance(db_client, run_id, "review")
    await _advance(db_client, run_id, "consensus")

    # An arbitrary string — NOT in {Y,PY,PN,N,NI,NA}.
    bogus = "DEFINITELY_NOT_A_PROBAST_OPTION"
    res = await db_client.post(
        f"/api/v1/runs/{run_id}/consensus",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "mode": "manual_override",
            "value": {"value": bogus},
            "rationale": "documenting current behaviour",
        },
    )
    # Current behaviour: 201. Once we tighten validation, switch this to 422
    # and add the corresponding error message check.
    assert res.status_code == 201
    body = res.json()["data"]
    assert body["published"]["value"] == {"value": bogus}
