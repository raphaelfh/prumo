"""``AiExtraction.run_from_request``: dispatch, run lifecycle, failure
accounting, the re-run skip set and the per-entry batch.

Driven end to end with the recorded model fake. Sections are added to the
seeded template and published, so the run's pinned tree carries them.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.extractor import LlmUsage
from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.models.extraction_workflow import ExtractionReviewerDecisionType
from app.services.ai_extraction import (
    BatchAllSectionsFailed,
    BatchExtractionResult,
    SectionExtractionResult,
)
from app.services.extraction_review_service import ExtractionReviewService
from app.services.template_versioning import TemplateVersionService
from tests.fakes.recorded_llm import Call, RecordedLlm
from tests.integration.conftest import SEED, make_proposal
from tests.integration.helpers.ai_extraction import (
    extraction,
    request,
    run_in_extract,
    seed_article_text,
)
from tests.integration.helpers.template_fixtures import add_field, add_section
from tests.integration.test_extraction_attempt_repository import graph as attempt_graph

graph = attempt_graph

pytestmark = pytest.mark.asyncio


async def _sections(
    db: AsyncSession, *specs: tuple[str, tuple[str, ...]], parent: UUID | None = None
) -> list[UUID]:
    """Add sections (``(name, field names)``) to the seeded template and publish."""
    ids = []
    for order, (name, fields) in enumerate(specs):
        section = await add_section(
            db, SEED.primary_template, name, parent_id=parent, sort_order=100 + order
        )
        for field in fields:
            await add_field(db, section, field)
        ids.append(section)
    await TemplateVersionService(db).republish(
        project_id=SEED.primary_project,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    return ids


def _failing_on(section: str) -> Any:
    """A ``during`` hook that fails the field call of one section."""

    async def fail(call: Call) -> None:
        if f"Section: {section}\n" in call.user_prompt:
            raise RuntimeError(f"model down for {section}")

    return fail


def _asked(fake: RecordedLlm) -> list[list[str]]:
    return [call.field_names for call in fake.field_calls()]


async def _refreshed(db: AsyncSession, run_id: UUID) -> ExtractionRun:
    run = await db.get(ExtractionRun, run_id)
    assert run is not None
    await db.refresh(run)
    return run


async def _no_live_run(db: AsyncSession) -> None:
    await db.execute(
        text(
            "UPDATE extraction_runs SET stage='cancelled' WHERE article_id=:a AND template_id=:t "
            "AND stage NOT IN ('finalized','cancelled')"
        ),
        {"a": SEED.primary_article, "t": SEED.primary_template},
    )


# --------------------------------------------------------------------------
# Dispatch: first match wins
# --------------------------------------------------------------------------


async def test_dispatch_follows_the_request_shape(db_session: AsyncSession) -> None:
    """``entity_type_id`` → one section; ``parent_instance_id`` (even with the
    session ``run_id``) → that entry's child sections; ``run_id`` +
    ``extract_all_sections`` → the full pass; ``run_id`` → top-level."""
    (container,) = await _sections(db_session, ("container_x", ()))
    (child,) = await _sections(db_session, ("child_x", ("note",)), parent=container)
    run = await run_in_extract(db_session)
    parent = (
        await db_session.execute(
            text(
                "INSERT INTO extraction_instances (project_id, article_id, template_id, "
                "entity_type_id, label, created_by) VALUES (:p,:a,:t,:e,'parent',:u) RETURNING id"
            ),
            {
                "p": SEED.primary_project,
                "a": SEED.primary_article,
                "t": SEED.primary_template,
                "e": container,
                "u": SEED.primary_profile,
            },
        )
    ).scalar_one()
    await seed_article_text(db_session)

    async def run_with(**shape: Any) -> tuple[RecordedLlm, Any]:
        fake = RecordedLlm()
        return fake, await extraction(db_session, fake).run_from_request(
            request(run_id=run.id, **shape)
        )

    fake, single = await run_with(entity_type_id=SEED.primary_entity_type)
    assert isinstance(single, SectionExtractionResult)
    assert _asked(fake) == [["sample_size"]]

    fake, batch = await run_with(parent_instance_id=parent, extract_all_sections=True)
    assert isinstance(batch, BatchExtractionResult)
    assert [s["entity_type_id"] for s in batch.sections] == [str(child)]

    fake, top = await run_with()
    assert {s["entity_type_name"] for s in top.sections} >= {"participants", "container_x"}
    assert "child_x" not in {s["entity_type_name"] for s in top.sections}

    fake, full = await run_with(extract_all_sections=True)
    # The full pass is the top level plus every root entry's children — and
    # ``container_x`` is a singleton here, so it adds no entry pass.
    assert {s["entity_type_name"] for s in full.sections} == {
        s["entity_type_name"] for s in top.sections
    }
    assert run.id == UUID(full.extraction_run_id)


# --------------------------------------------------------------------------
# Lifecycle: a named run belongs to its session; a created one to the request
# --------------------------------------------------------------------------


async def test_a_session_run_is_reused_and_left_alone(db_session: AsyncSession) -> None:
    """``run_id`` given: proposals land on THAT run, which is neither started,
    completed nor advanced — further section clicks keep accumulating on it."""
    run = await run_in_extract(db_session)
    await seed_article_text(db_session)

    result = await extraction(
        db_session, RecordedLlm(fields={"sample_size": {"value": 7}})
    ).run_from_request(request(entity_type_id=SEED.primary_entity_type, run_id=run.id))

    assert result.extraction_run_id == str(run.id)
    refreshed = await _refreshed(db_session, run.id)
    assert refreshed.stage == ExtractionRunStage.EXTRACT.value
    assert refreshed.status != "completed"
    assert "suggestions_created" not in (refreshed.results or {})


async def test_a_standalone_section_resolves_runs_and_completes_its_own_run(
    db_session: AsyncSession,
) -> None:
    """No ``run_id``: the coordinate's live run is resolved or created, and the
    request owns that run — it is completed with the call's results and stays
    in EXTRACT (an auto-advance would skip the extract-stage hydration)."""
    await _no_live_run(db_session)
    await seed_article_text(db_session)

    result = await extraction(
        db_session, RecordedLlm(fields={"sample_size": {"value": 7}})
    ).run_from_request(request(entity_type_id=SEED.primary_entity_type))

    run = await _refreshed(db_session, UUID(result.extraction_run_id))
    assert run.stage == ExtractionRunStage.EXTRACT.value
    assert run.status == "completed"
    assert run.results["suggestions_created"] == 1
    assert run.results["tokens_total"] == 15
    assert run.results["fields_extracted"] == 1
    assert run.results["provenance"]["sections"], "completion merged, never replaced"


async def test_the_top_level_sweep_completes_the_run_without_advancing(
    db_session: AsyncSession,
) -> None:
    """``auto_advance_to_review`` is inert in the collapsed lifecycle — it is
    recorded for telemetry and the run stays in EXTRACT; the per-section
    provenance survives completion."""
    run = await run_in_extract(db_session)
    await seed_article_text(db_session)

    result = await extraction(db_session, RecordedLlm()).run_from_request(
        request(run_id=run.id, auto_advance_to_review=True)
    )

    refreshed = await _refreshed(db_session, run.id)
    assert refreshed.stage == ExtractionRunStage.EXTRACT.value
    assert refreshed.status == "completed"
    assert refreshed.results["total_sections"] == result.total_sections >= 1
    assert refreshed.results["kind"] == "extraction"
    assert refreshed.results["auto_advance_to_review"] is True
    assert refreshed.results["skip_fields_with_human_proposals"] is False
    assert str(SEED.primary_entity_type) in refreshed.results["provenance"]["sections"]


# --------------------------------------------------------------------------
# Failure accounting
# --------------------------------------------------------------------------


async def test_one_failing_section_is_recorded_and_the_sweep_completes(
    db_session: AsyncSession,
) -> None:
    await _sections(db_session, ("flaky", ("x",)))
    run = await run_in_extract(db_session)
    await seed_article_text(db_session)
    fake = RecordedLlm(during=_failing_on("flaky"))

    result = await extraction(db_session, fake).run_from_request(request(run_id=run.id))

    failed = [s for s in result.sections if not s["success"]]
    assert [(s["entity_type_name"], s["error"]) for s in failed] == [
        ("flaky", "model down for flaky")
    ]
    assert result.failed_sections == 1
    assert result.successful_sections == result.total_sections - 1
    assert (await _refreshed(db_session, run.id)).status == "completed"


async def test_a_sweep_where_every_section_fails_fails_the_run(graph, _engine) -> None:
    """Bug #3: an all-failed sweep must FAIL the run, never report success."""
    db, scope, _iid, _fid = graph
    await seed_article_text(db, project_id=scope.project_id, article_id=scope.article_id)
    await db.commit()
    fake = RecordedLlm(fail={"section_extraction": RuntimeError("llm down")})

    with pytest.raises(BatchAllSectionsFailed):
        await extraction(db, fake, owns_transactions=True).run_from_request(
            request(
                project_id=scope.project_id,
                article_id=scope.article_id,
                template_id=scope.template_id,
                run_id=scope.run_id,
            )
        )

    run = await _refreshed(db, scope.run_id)
    assert run.status == "failed"
    assert "All 1 section(s) failed" in (run.error_message or "")


async def test_a_standalone_section_failure_fails_the_run_it_created(graph, _engine) -> None:
    db, scope, iid, _fid = graph
    entity_type_id = (
        await db.execute(
            text("SELECT entity_type_id FROM extraction_instances WHERE id=:i"), {"i": iid}
        )
    ).scalar_one()
    await db.execute(
        text("UPDATE extraction_runs SET stage='cancelled' WHERE id=:id"), {"id": scope.run_id}
    )
    await seed_article_text(db, project_id=scope.project_id, article_id=scope.article_id)
    await db.commit()
    fake = RecordedLlm(fail={"section_extraction": RuntimeError("llm down")})

    with pytest.raises(RuntimeError, match="llm down"):
        await extraction(db, fake, owns_transactions=True).run_from_request(
            request(
                project_id=scope.project_id,
                article_id=scope.article_id,
                template_id=scope.template_id,
                entity_type_id=entity_type_id,
            )
        )

    failed = (
        await db.execute(
            text(
                "SELECT status, error_message FROM extraction_runs WHERE article_id=:a "
                "AND template_id=:t AND id <> :old"
            ),
            {"a": scope.article_id, "t": scope.template_id, "old": scope.run_id},
        )
    ).one()
    assert (failed.status, failed.error_message) == ("failed", "llm down")


# --------------------------------------------------------------------------
# The re-run skip set
# --------------------------------------------------------------------------


async def _decide(db: AsyncSession, run: ExtractionRun, field_id: UUID, decision: Any) -> None:
    await ExtractionReviewService(db).record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=field_id,
        reviewer_id=SEED.primary_profile,
        decision=decision,
        value={"value": "settled"} if decision is ExtractionReviewerDecisionType.EDIT else None,
    )


async def _rerun(db: AsyncSession, run: ExtractionRun, *, skip: bool = True) -> RecordedLlm:
    fake = RecordedLlm()
    await extraction(db, fake).run_from_request(
        request(run_id=run.id, skip_fields_with_human_proposals=skip)
    )
    return fake


async def test_only_the_settled_field_leaves_the_rerun(db_session: AsyncSession) -> None:
    """Field-scoped: a settled field is not re-asked, its sibling is — and the
    live field collection (delete-orphan cascaded) is never mutated."""
    second = await add_field(db_session, SEED.primary_entity_type, "second_field")
    await TemplateVersionService(db_session).republish(
        project_id=SEED.primary_project,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    run = await run_in_extract(db_session)
    await seed_article_text(db_session)
    await _decide(db_session, run, SEED.primary_field, ExtractionReviewerDecisionType.EDIT)

    fake = await _rerun(db_session, run)

    participants = [names for names in _asked(fake) if "second_field" in names]
    assert participants == [["second_field"]]
    still = (
        await db_session.execute(
            text("SELECT count(*) FROM extraction_fields WHERE id IN (:a, :b)"),
            {"a": SEED.primary_field, "b": second},
        )
    ).scalar_one()
    assert still == 2


async def test_without_the_skip_flag_every_field_is_asked(db_session: AsyncSession) -> None:
    run = await run_in_extract(db_session)
    await seed_article_text(db_session)
    await _decide(db_session, run, SEED.primary_field, ExtractionReviewerDecisionType.EDIT)

    fake = await _rerun(db_session, run, skip=False)

    assert ["sample_size"] in _asked(fake)


async def test_a_latest_human_proposal_settles_the_field(db_session: AsyncSession) -> None:
    """The QA track: a pre-D8 ``human`` proposal is the newest word on the field."""
    run = await run_in_extract(db_session)
    await seed_article_text(db_session)
    await make_proposal(
        db_session,
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        user_id=SEED.primary_profile,
    )

    fake = await _rerun(db_session, run)

    assert ["sample_size"] not in _asked(fake)


async def test_a_decision_on_another_run_settles_nothing(db_session: AsyncSession) -> None:
    """Run-scoped: what a reviewer settled on a cancelled run does not keep
    the field off the coordinate's next run."""
    old = await run_in_extract(db_session)
    await seed_article_text(db_session)
    await _decide(db_session, old, SEED.primary_field, ExtractionReviewerDecisionType.EDIT)
    await db_session.execute(
        text("UPDATE extraction_runs SET stage='cancelled' WHERE id=:id"), {"id": old.id}
    )
    run = await run_in_extract(db_session)

    fake = await _rerun(db_session, run)

    assert ["sample_size"] in _asked(fake)


# --------------------------------------------------------------------------
# The per-entry batch
# --------------------------------------------------------------------------


async def _entry_with_children(
    db: AsyncSession, *children: tuple[str, tuple[str, ...]]
) -> tuple[UUID, list[UUID]]:
    (container,) = await _sections(db, ("batch_parent", ()))
    child_ids = await _sections(db, *children, parent=container)
    parent = (
        await db.execute(
            text(
                "INSERT INTO extraction_instances (project_id, article_id, template_id, "
                "entity_type_id, label, created_by) VALUES (:p,:a,:t,:e,'parent',:u) RETURNING id"
            ),
            {
                "p": SEED.primary_project,
                "a": SEED.primary_article,
                "t": SEED.primary_template,
                "e": container,
                "u": SEED.primary_profile,
            },
        )
    ).scalar_one()
    return parent, child_ids


async def test_each_child_section_reads_what_the_previous_ones_found(
    db_session: AsyncSession,
) -> None:
    """Summarized memory: a later section's prompt carries the earlier
    sections' first three values (``...`` when there are more), never the
    first section's own prompt."""
    parent, _children = await _entry_with_children(
        db_session, ("first_child", ("a", "b", "c", "d")), ("second_child", ("e",))
    )
    run = await run_in_extract(db_session)
    await seed_article_text(db_session)
    fake = RecordedLlm(fields={"a": {"value": "alpha"}, "b": {"value": "beta"}})

    result = await extraction(db_session, fake).run_from_request(
        request(parent_instance_id=parent, run_id=run.id, extract_all_sections=True)
    )

    assert result.successful_sections == 2
    first, second = (c.user_prompt for c in fake.field_calls())
    assert "CONTEXT FROM PREVIOUSLY EXTRACTED SECTIONS" not in first
    assert "1. first_child: first_child: a: alpha, b: beta, c: None..." in second


async def test_an_entry_without_child_sections_is_an_empty_batch(
    db_session: AsyncSession,
) -> None:
    parent, _ = await _entry_with_children(db_session)
    run = await run_in_extract(db_session)
    await seed_article_text(db_session)
    fake = RecordedLlm()

    result = await extraction(db_session, fake).run_from_request(
        request(parent_instance_id=parent, run_id=run.id, extract_all_sections=True)
    )

    assert (result.total_sections, result.failed_sections) == (0, 0)
    assert fake.calls == []


async def test_a_batch_on_the_session_run_raises_but_leaves_the_run(
    db_session: AsyncSession,
) -> None:
    """Every child failing is a failed batch — but the session owns its run,
    so the run is neither failed nor completed here."""
    parent, _ = await _entry_with_children(db_session, ("only_child", ("x",)))
    run = await run_in_extract(db_session)
    await seed_article_text(db_session)
    fake = RecordedLlm(during=_failing_on("only_child"))

    with pytest.raises(BatchAllSectionsFailed, match="All 1 section"):
        await extraction(db_session, fake).run_from_request(
            request(parent_instance_id=parent, run_id=run.id, extract_all_sections=True)
        )

    refreshed = await _refreshed(db_session, run.id)
    assert refreshed.status not in {"failed", "completed"}


async def test_supplied_article_text_still_anchors_evidence(db_session: AsyncSession) -> None:
    """A caller may pass ``pdf_text``; the model reads it, and the article's
    parsed blocks are still loaded so evidence anchors."""
    quote = "Each child cites this sentence."
    parent, _ = await _entry_with_children(db_session, ("cited_child", ("x",)))
    run = await run_in_extract(db_session)
    file_id = await seed_article_text(db_session, quote)
    fake = RecordedLlm(
        fields={"x": {"value": "v", "evidence": [{"text": quote, "page_number": 1}]}}
    )

    await extraction(db_session, fake).run_from_request(
        request(
            parent_instance_id=parent,
            run_id=run.id,
            extract_all_sections=True,
            pdf_text="SUPPLIED TEXT",
        )
    )

    assert "SUPPLIED TEXT" in fake.field_calls()[0].user_prompt
    anchored = (
        await db_session.execute(
            text("SELECT article_file_id FROM extraction_evidence WHERE run_id=:r"),
            {"r": run.id},
        )
    ).scalar_one()
    assert anchored == file_id


async def test_the_full_pass_merges_every_entry_and_counts_a_failed_one_once(
    db_session: AsyncSession,
) -> None:
    """Top-level sections, then every root entry's child sections on the SAME
    run, counts merged. An entry whose child sections all fail is ONE failed
    section — the article completes with issues instead of failing whole."""
    (group,) = await _sections(db_session, ("models_x", ("model_name",)))
    await db_session.execute(
        text(
            "UPDATE extraction_entity_types SET cardinality='many', entry_label='model' "
            "WHERE id=:id"
        ),
        {"id": group},
    )
    await db_session.execute(
        text("UPDATE extraction_fields SET is_entity_key=true WHERE entity_type_id=:id"),
        {"id": group},
    )
    await _sections(db_session, ("model_child", ("auc",)), parent=group)
    run = await run_in_extract(db_session)
    await seed_article_text(db_session)

    async def fail_under_b(call: Call) -> None:
        if 'Within: model "B"' in call.user_prompt:
            raise RuntimeError("model down for B")

    top = await extraction(db_session, RecordedLlm(entries=["A", "B"])).run_from_request(
        request(run_id=run.id)
    )
    fake = RecordedLlm(entries=["A", "B"], during=fail_under_b)

    result = await extraction(db_session, fake).run_from_request(
        request(run_id=run.id, extract_all_sections=True)
    )

    assert result.extraction_run_id == str(run.id)
    assert result.total_sections == top.total_sections + 2
    assert result.successful_sections == top.successful_sections + 1
    assert result.failed_sections == top.failed_sections + 1
    (entry_failure,) = [s for s in result.sections if not s["success"]]
    assert "All 1 section(s) failed" in entry_failure["error"]
    # Entry A's child section landed on the same run, merged into the count.
    assert result.total_suggestions_created > top.total_suggestions_created


# --------------------------------------------------------------------------
# The worker's lock discipline
# --------------------------------------------------------------------------


async def test_a_worker_holds_no_run_lock_across_external_work(graph, _engine) -> None:
    """A worker-owned session commits before PDF assembly and before every
    model call: a reviewer's decision or a stage advance never waits on
    storage or on the model. Probed from a second session with NOWAIT."""
    from sqlalchemy.ext.asyncio import async_sessionmaker

    db, scope, iid, _fid = graph
    entity_type_id = (
        await db.execute(
            text("SELECT entity_type_id FROM extraction_instances WHERE id=:i"), {"i": iid}
        )
    ).scalar_one()
    sessions = async_sessionmaker(_engine, expire_on_commit=False)
    probes: list[str] = []

    async def lock_is_free(where: str) -> None:
        async with sessions() as other:
            await other.execute(
                text("SELECT 1 FROM extraction_runs WHERE id=:id FOR UPDATE NOWAIT"),
                {"id": scope.run_id},
            )
            await other.rollback()
        probes.append(where)

    class _Storage:
        """The article has a PDF but no parsed blocks: assembly downloads it."""

        async def download(self, *_a: Any, **_k: Any) -> bytes:
            await lock_is_free("assembly")
            raise FileNotFoundError("stop after the probe")

    await db.execute(
        text(
            "INSERT INTO article_files (project_id, article_id, file_type, storage_key, "
            "extraction_status) VALUES (:p, :a, 'application/pdf', 'x.pdf', 'pending')"
        ),
        {"p": scope.project_id, "a": scope.article_id},
    )
    await db.commit()
    with pytest.raises(Exception):  # noqa: B017 - the stop raised after the probe
        await extraction(
            db, RecordedLlm(), owns_transactions=True, storage=_Storage()
        ).run_from_request(
            request(
                project_id=scope.project_id,
                article_id=scope.article_id,
                template_id=scope.template_id,
                entity_type_id=entity_type_id,
                run_id=scope.run_id,
            )
        )
    await db.rollback()

    await seed_article_text(db, project_id=scope.project_id, article_id=scope.article_id)
    await db.commit()

    async def at_the_model(_call: Call) -> None:
        await lock_is_free("model")

    await extraction(db, RecordedLlm(during=at_the_model), owns_transactions=True).run_from_request(
        request(
            project_id=scope.project_id,
            article_id=scope.article_id,
            template_id=scope.template_id,
            entity_type_id=entity_type_id,
            run_id=scope.run_id,
        )
    )
    assert probes == ["assembly", "model"]


# --------------------------------------------------------------------------
# Small things the run results report
# --------------------------------------------------------------------------


async def test_a_section_without_fields_spends_no_model_call(db_session: AsyncSession) -> None:
    (empty,) = await _sections(db_session, ("empty_section", ()))
    run = await run_in_extract(db_session)
    await seed_article_text(db_session)
    fake = RecordedLlm(usage=LlmUsage(prompt_tokens=1, completion_tokens=1))

    result = await extraction(db_session, fake).run_from_request(
        request(entity_type_id=empty, run_id=run.id)
    )

    assert result.suggestions_created == 0
    assert fake.calls == []
    refreshed = await _refreshed(db_session, run.id)
    assert str(empty) not in ((refreshed.results or {}).get("provenance") or {}).get("sections", {})
