"""get_review_question / set_review_question tool-logic tests: the in-memory
SDK client, so handler lines register coverage (the ASGI blind spot)."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp.tools import review_question as review_question_tool
from app.services.project_ai_context import get_review_question_view
from tests.integration.conftest import SEED
from tests.integration.mcp.tool_calls import call_tool, error_payload, structured

P = SEED.primary_project
_APPLIED_NOTE = (
    "Runs that already made their first AI call keep the review question they started with."
)


class _Pg(Exception):
    sqlstate = "40P01"


async def _audit_count(db: AsyncSession, *, outcome: str, error_code: str | None = None) -> int:
    sql = (
        "SELECT count(*) FROM public.agent_actions "
        "WHERE outcome = :o AND tool = 'set_review_question'"
    )
    params = {"o": outcome}
    if error_code is not None:
        sql += " AND error_code = :c"
        params["c"] = error_code
    return (await db.execute(text(sql), params)).scalar_one()


async def _set_protocol(
    db: AsyncSession,
    *,
    picots: dict | None = None,
    eligibility: dict | None = None,
    study_design: dict | None = None,
) -> None:
    await db.execute(
        text(
            "UPDATE public.projects SET picots_config_ai_review = CAST(:p AS jsonb), "
            "eligibility_criteria = CAST(:e AS jsonb), study_design = CAST(:d AS jsonb), "
            "settings = settings - 'ai_context' WHERE id = :id"
        ),
        {
            "p": json.dumps(picots or {}),
            "e": json.dumps(eligibility or {}),
            "d": json.dumps(study_design or {}),
            "id": str(P),
        },
    )
    await db.flush()


async def _read(mcp_client, pat) -> dict:
    return structured(
        await call_tool(mcp_client, pat, "get_review_question", {"project_id": str(P)})
    )


async def _write(mcp_client, pat, **arguments) -> object:
    return await call_tool(
        mcp_client, pat, "set_review_question", {"project_id": str(P), **arguments}
    )


async def _row(db: AsyncSession) -> dict:
    return dict(
        (
            await db.execute(
                text(
                    "SELECT picots_config_ai_review, protocol_revision "
                    "FROM public.projects WHERE id = :id"
                ),
                {"id": str(P)},
            )
        )
        .mappings()
        .one()
    )


_ADULTS = {"description": "Adults", "inclusion": ["ICU"], "exclusion": []}


async def test_round_trip_changes_preview_and_revision(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    await _set_protocol(db_session)
    read = await _read(mcp_client, pat_primary_rw)
    r = read["revision"]

    body = structured(
        await _write(mcp_client, pat_primary_rw, expected_revision=r, slots={"population": _ADULTS})
    )

    assert body["revision"] == r + 1
    assert body["preview"] == "- Population: Adults\n  Include: ICU"
    assert body["slots"]["population"] == {"label": "Population", **_ADULTS}
    assert body["note"] == _APPLIED_NOTE
    assert await _audit_count(db_session, outcome="applied") == 1
    row = (
        (
            await db_session.execute(
                text(
                    "SELECT before, after, template_id FROM public.agent_actions "
                    "WHERE outcome = 'applied' AND tool = 'set_review_question'"
                )
            )
        )
        .mappings()
        .one()
    )
    assert row["template_id"] is None
    assert row["before"]["revision"] == r
    assert row["after"]["revision"] == r + 1
    assert row["after"]["slots"] == {"population": _ADULTS}
    assert row["before"]["slots"] == {
        "population": {"description": "", "inclusion": [], "exclusion": []}
    }
    # The read now reflects the write.
    assert (await _read(mcp_client, pat_primary_rw))["preview"] == body["preview"]


async def test_picots_enabled_only_write_mutes_the_preview(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    await _set_protocol(db_session, picots={"population": _ADULTS})
    r = (await _read(mcp_client, pat_primary_rw))["revision"]

    body = structured(
        await _write(mcp_client, pat_primary_rw, expected_revision=r, picots_enabled=False)
    )

    assert body["picots_enabled"] is False
    assert body["preview"] is None
    assert body["revision"] == r + 1
    row = (
        (
            await db_session.execute(
                text(
                    "SELECT after FROM public.agent_actions "
                    "WHERE outcome = 'applied' AND tool = 'set_review_question'"
                )
            )
        )
        .mappings()
        .one()
    )
    assert row["after"]["picots_enabled"] is False
    assert row["after"]["slots"] == {}


async def test_stale_revision_is_refused(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    await _set_protocol(db_session)
    r0 = (await _read(mcp_client, pat_primary_rw))["revision"]
    structured(
        await _write(
            mcp_client, pat_primary_rw, expected_revision=r0, slots={"population": _ADULTS}
        )
    )
    r = r0 + 1
    before = await _row(db_session)

    error = error_payload(
        await _write(
            mcp_client,
            pat_primary_rw,
            expected_revision=r - 1,
            slots={"outcomes": {"description": "Mortality"}},
        )
    )

    assert error["code"] == "STALE_VALUE"
    assert error["message"] == "The review question changed since it was read."
    assert error["current_revision"] == r
    assert error["current"]["revision"] == r
    assert error["current"]["slots"]["population"]["description"] == "Adults"
    assert error["untrusted_content"] is True
    assert error["untrusted_fields"] == ["current", "project_name"]
    assert await _row(db_session) == before
    assert await _audit_count(db_session, outcome="refused", error_code="STALE_VALUE") == 1


async def test_partial_slots_leave_others_alone(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    outcomes = {"description": "Mortality", "inclusion": [], "exclusion": ["Surrogates"]}
    await _set_protocol(db_session, picots={"outcomes": outcomes})
    r = (await _read(mcp_client, pat_primary_rw))["revision"]

    body = structured(
        await _write(mcp_client, pat_primary_rw, expected_revision=r, slots={"population": _ADULTS})
    )

    assert body["slots"]["outcomes"] == {"label": "Outcome(s)", **outcomes}
    assert body["slots"]["population"]["description"] == "Adults"


async def test_nothing_to_change_is_invalid_argument(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    r = (await _read(mcp_client, pat_primary_rw))["revision"]

    error = error_payload(await _write(mcp_client, pat_primary_rw, expected_revision=r))

    assert error["code"] == "INVALID_ARGUMENT"
    assert error["message"] == "name at least one of slots or picots_enabled"
    assert error["field"] == "slots"
    assert await _audit_count(db_session, outcome="refused", error_code="INVALID_ARGUMENT") == 1


async def test_unknown_slot_is_invalid_argument(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    r = (await _read(mcp_client, pat_primary_rw))["revision"]

    error = error_payload(
        await _write(mcp_client, pat_primary_rw, expected_revision=r, slots={"species": _ADULTS})
    )

    assert error["code"] == "INVALID_ARGUMENT"
    assert error["field"] == "slots.species"
    assert await _audit_count(db_session, outcome="refused", error_code="INVALID_ARGUMENT") == 1


@pytest.mark.parametrize(
    ("slot", "field"),
    [
        ({"description": "x" * 2001}, "slots.population.description"),
        ({"colour": "red"}, "slots.population.colour"),
        ("Adults", "slots.population"),
    ],
    ids=["too-long", "extra-key", "not-an-object"],
)
async def test_malformed_slot_is_invalid_argument(
    mcp_client, pat_primary_rw, db_session: AsyncSession, slot: object, field: str
) -> None:
    r = (await _read(mcp_client, pat_primary_rw))["revision"]
    before = await _row(db_session)

    error = error_payload(
        await _write(mcp_client, pat_primary_rw, expected_revision=r, slots={"population": slot})
    )

    assert error["code"] == "INVALID_ARGUMENT"
    assert error["field"] == field
    assert await _row(db_session) == before
    assert await _audit_count(db_session, outcome="refused", error_code="INVALID_ARGUMENT") == 1


async def test_nul_is_invalid_argument(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    r = (await _read(mcp_client, pat_primary_rw))["revision"]

    error = error_payload(
        await _write(
            mcp_client,
            pat_primary_rw,
            expected_revision=r,
            slots={"population": {"description": "a\u0000b"}},
        )
    )

    assert error["code"] == "INVALID_ARGUMENT"
    assert error["field"] == "slots.population.description"
    assert await _audit_count(db_session, outcome="refused", error_code="INVALID_ARGUMENT") == 1


async def test_deadlock_maps_to_retry(
    mcp_client, pat_primary_rw, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    r = (await _read(mcp_client, pat_primary_rw))["revision"]

    async def _raise(*_a: object, **_k: object) -> None:
        raise DBAPIError("UPDATE", {}, _Pg())

    monkeypatch.setattr(review_question_tool, "set_ai_context", _raise)

    error = error_payload(
        await _write(mcp_client, pat_primary_rw, expected_revision=r, picots_enabled=False)
    )

    assert error["code"] == "RETRY"
    assert await _audit_count(db_session, outcome="refused", error_code="RETRY") == 1


async def test_unexpected_db_error_is_internal_with_no_row(
    mcp_client, pat_primary_rw, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    r = (await _read(mcp_client, pat_primary_rw))["revision"]

    async def _raise(*_a: object, **_k: object) -> None:
        raise DBAPIError("UPDATE", {}, Exception("other"))

    monkeypatch.setattr(review_question_tool, "set_ai_context", _raise)

    error = error_payload(
        await _write(mcp_client, pat_primary_rw, expected_revision=r, picots_enabled=False)
    )

    assert error["code"] == "INTERNAL_ERROR"
    assert await _audit_count(db_session, outcome="refused") == 0


async def test_read_token_cannot_see_or_call_write(
    mcp_client, pat_primary_read, db_session: AsyncSession
) -> None:
    async with mcp_client(pat_primary_read) as client:
        names = {t.name for t in (await client.list_tools()).tools}
    assert "get_review_question" in names
    assert "set_review_question" not in names

    error = error_payload(
        await _write(mcp_client, pat_primary_read, expected_revision=1, picots_enabled=False)
    )
    assert error["code"] == "SCOPE_INSUFFICIENT"
    assert await _audit_count(db_session, outcome="refused") == 0


async def test_reviewer_is_manager_required(
    mcp_client, pat_reviewer_rw, db_session: AsyncSession
) -> None:
    error = error_payload(
        await _write(mcp_client, pat_reviewer_rw, expected_revision=1, picots_enabled=False)
    )
    assert error["code"] == "MANAGER_REQUIRED"
    assert await _audit_count(db_session, outcome="refused") == 0


async def test_reviewer_can_read(mcp_client, pat_reviewer_rw) -> None:
    assert (await _read(mcp_client, pat_reviewer_rw))["project_id"] == str(P)


async def test_empty_project_reads_note(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    await _set_protocol(db_session)

    body = await _read(mcp_client, pat_primary_rw)

    assert body["preview"] is None
    assert body["note"] == "No review question yet"
    assert set(body["slots"]) == {
        "population",
        "index_models",
        "comparator_models",
        "outcomes",
        "timing",
        "setting_and_intended_use",
    }
    assert all(
        (s["description"], s["inclusion"], s["exclusion"]) == ("", [], [])
        for s in body["slots"].values()
    )
    assert body["eligibility"] == {"inclusion": [], "exclusion": [], "notes": ""}
    assert body["study_design"] == {"types": [], "notes": ""}


async def test_read_carries_eligibility_design_and_labels(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    await _set_protocol(
        db_session,
        picots={"index_models": {"description": "Model X"}},
        eligibility={"inclusion": ["RCT", 3, " "], "exclusion": "junk", "notes": "manager note"},
        study_design={"types": ["Cohort"]},
    )
    await db_session.execute(
        text("UPDATE public.projects SET review_type = 'predictive_model' WHERE id = :id"),
        {"id": str(P)},
    )
    await db_session.flush()

    body = await _read(mcp_client, pat_primary_rw)

    assert body["note"] is None
    assert body["review_type"] == "predictive_model"
    assert body["slots"]["index_models"]["label"] == "Index model(s)"
    assert body["eligibility"] == {"inclusion": ["RCT"], "exclusion": [], "notes": "manager note"}
    assert body["study_design"] == {"types": ["Cohort"], "notes": ""}
    assert body["preview"] == (
        "- Index model(s): Model X\nEligibility:\n  Include: RCT\nEligible study designs: Cohort"
    )


async def test_eligibility_alone_is_not_empty(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    await _set_protocol(db_session, study_design={"types": ["Cohort"]})

    body = await _read(mcp_client, pat_primary_rw)

    assert body["note"] is None
    assert body["preview"] == "Eligible study designs: Cohort"


async def test_results_carry_project_name(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    long_name = "N" * 300
    await db_session.execute(
        text("UPDATE public.projects SET name = :n WHERE id = :id"), {"n": long_name, "id": str(P)}
    )
    await db_session.flush()

    read = await _read(mcp_client, pat_primary_rw)
    written = structured(
        await _write(
            mcp_client, pat_primary_rw, expected_revision=read["revision"], picots_enabled=True
        )
    )

    for body in (read, written):
        assert body["project_name"] == "N" * 200
        assert body["untrusted_content"] is True
        assert "project_name" in body["untrusted_fields"]


async def test_view_matches_build_review_question_text(db_session: AsyncSession) -> None:
    from app.services.project_ai_context import build_review_question

    await _set_protocol(
        db_session, picots={"population": _ADULTS}, eligibility={"exclusion": ["Kids"]}
    )

    view = await get_review_question_view(db_session, P)
    built = await build_review_question(db_session, P)

    assert built is not None
    assert view.preview == built.text
    assert view.revision == built.revision
    assert view.note is None


async def test_tool_annotations(mcp_client, pat_primary_rw) -> None:
    async with mcp_client(pat_primary_rw) as client:
        tools = {t.name: t for t in (await client.list_tools()).tools}
    read, write = tools["get_review_question"], tools["set_review_question"]
    assert read.annotations.read_only_hint is True
    assert write.annotations.read_only_hint is False
    assert write.annotations.destructive_hint is False
    assert write.annotations.idempotent_hint is True
    assert "expected_revision" in write.input_schema["required"]
    slots = write.input_schema["properties"]["slots"]
    assert "$ref" not in json.dumps(slots)
    assert "update_project_details" in write.description
    assert "set_review_question" in read.description
