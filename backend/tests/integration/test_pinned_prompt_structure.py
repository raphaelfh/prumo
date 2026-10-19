"""B-2 divergence tests: prompt structure comes from the run-pinned snapshot.

Every test FORCES divergence between the pinned snapshot and live rows —
an implementation reading live rows (or the template's active version)
would leave a live==snapshot test green while violating the invariant.
"""

from __future__ import annotations

import json
import uuid
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.prompts import entry_identification
from app.models.extraction import (
    ExtractionField,
    ExtractionFieldType,
    ExtractionRun,
    TemplateKind,
)
from app.services.hitl_session_service import HITLSessionService
from tests.fakes.recorded_llm import Call, RecordedLlm
from tests.integration.helpers.ai_extraction import extraction, request, seed_article_text
from tests.integration.test_extraction_manual_only_flow import _coords


def _snapshot_field(field_id: str, name: str, *, llm_description: str | None = None) -> dict:
    return {
        "id": field_id,
        "name": name,
        "label": name,
        "description": None,
        "field_type": "text",
        "is_required": False,
        "validation_schema": None,
        "allowed_values": None,
        "unit": None,
        "allowed_units": None,
        "sort_order": 0,
        "llm_description": llm_description,
        "allow_other": False,
        "other_label": None,
        "other_placeholder": None,
        "allows_not_applicable": False,
        "allows_not_evaluated": False,
    }


def _snapshot_entity(
    et_id: str,
    name: str,
    *,
    parent: str | None = None,
    cardinality: str = "one",
    fields: list[dict] | None = None,
) -> dict:
    return {
        "id": et_id,
        "name": name,
        "label": name,
        "description": "pinned entity description",
        "parent_entity_type_id": parent,
        "cardinality": cardinality,
        # A repeating section always carries the word for one entry (0069).
        "entry_label": "entry" if cardinality == "many" else None,
        "sort_order": 0,
        "is_required": False,
        "fields": fields or [],
    }


async def _pin_run_to_snapshot(
    db: AsyncSession, *, run_id: UUID, template_id: UUID, profile_id: UUID, schema: dict
) -> UUID:
    version_id = uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_template_versions "
            "(id, project_template_id, version, schema, published_by, is_active) "
            "VALUES (:id, :tid, 980, CAST(:schema AS jsonb), :pub, false)"
        ),
        {
            "id": str(version_id),
            "tid": str(template_id),
            "schema": json.dumps(schema),
            "pub": str(profile_id),
        },
    )
    await db.execute(
        text("UPDATE public.extraction_runs SET version_id = :vid WHERE id = :rid"),
        {"vid": str(version_id), "rid": str(run_id)},
    )
    return version_id


async def _fresh_extract_run(db: AsyncSession, fx: tuple) -> ExtractionRun:
    project_id, article_id, template_id, profile_id, _instance_id, _field_a_id = fx
    await db.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :pid "
            "AND article_id = :aid AND template_id = :tid"
        ),
        {"pid": str(project_id), "aid": str(article_id), "tid": str(template_id)},
    )
    session = await HITLSessionService(db).open_or_resume(
        kind=TemplateKind.EXTRACTION,
        project_id=project_id,
        article_id=article_id,
        user_id=profile_id,
        project_template_id=template_id,
    )
    run = await db.get(ExtractionRun, session.run_id)
    assert run is not None
    return run


async def _run(db: AsyncSession, fx: tuple, run: ExtractionRun, **kwargs: object) -> tuple:
    """Run the request on ``run`` with the model faked; ``(fake, result)``."""
    project_id, article_id, template_id, profile_id, _instance_id, _field_a_id = fx
    await seed_article_text(db, project_id=project_id, article_id=article_id)
    fake = RecordedLlm()
    result = await extraction(db, fake, user_id=profile_id).run_from_request(
        request(
            project_id=project_id,
            article_id=article_id,
            template_id=template_id,
            run_id=run.id,
            **kwargs,
        )
    )
    return fake, result


def _descriptions(call: Call) -> dict[str, str | None]:
    """Field name -> the description the model is shown for it."""
    return {f.alias or n: f.description for n, f in call.output_model.model_fields.items()}


@pytest.mark.asyncio
async def test_extract_section_prompts_from_pinned_entity_and_intersects_fields(
    db_session: AsyncSession,
) -> None:
    """The single-section path: pinned name/instruction win; the fields sent
    are snapshot ∩ live — a snapshot ghost (deleted live) is dropped, and a
    live-only field (added after the pin) is invisible."""
    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id, _instance_id, field_a_id = fx

    entity_type_id = (
        await db_session.execute(
            text("SELECT entity_type_id FROM public.extraction_fields WHERE id = :fid"),
            {"fid": str(field_a_id)},
        )
    ).scalar()
    entity_type_id = UUID(str(entity_type_id))

    # A live-only field: exists in the DB but NOT in the pinned snapshot.
    live_only = ExtractionField(
        entity_type_id=entity_type_id,
        name="live_only_field",
        label="Live only",
        field_type=ExtractionFieldType.TEXT.value,
    )
    db_session.add(live_only)
    await db_session.flush()

    run = await _fresh_extract_run(db_session, fx)
    ghost_field_id = str(uuid.uuid4())  # in the snapshot, deleted live
    await _pin_run_to_snapshot(
        db_session,
        run_id=run.id,
        template_id=template_id,
        profile_id=profile_id,
        schema={
            "entity_types": [
                _snapshot_entity(
                    str(entity_type_id),
                    "PINNED_SECTION_NAME",
                    fields=[
                        _snapshot_field(
                            str(field_a_id),
                            "field_a",
                            llm_description="PINNED FIELD INSTRUCTION",
                        ),
                        _snapshot_field(ghost_field_id, "ghost_field"),
                    ],
                )
            ]
        },
    )
    await db_session.refresh(run)

    fake, _ = await _run(db_session, fx, run, entity_type_id=entity_type_id)

    (call,) = fake.field_calls()
    assert "PINNED_SECTION_NAME" in call.user_prompt
    live_name = (await db_session.get(ExtractionField, field_a_id)).name
    assert call.field_names == [live_name], (
        "must send exactly snapshot ∩ live: ghost dropped, live-only invisible"
    )
    assert "PINNED FIELD INSTRUCTION" in _descriptions(call)[live_name]


@pytest.mark.asyncio
async def test_extract_for_run_iterates_the_pinned_top_level_set(
    db_session: AsyncSession,
) -> None:
    """The batch path: a live top-level section absent from the pinned
    snapshot is not extracted; the pinned set drives the loop."""
    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    _project_id, _article_id, template_id, profile_id, _instance_id, field_a_id = fx

    entity_type_id = (
        await db_session.execute(
            text("SELECT entity_type_id FROM public.extraction_fields WHERE id = :fid"),
            {"fid": str(field_a_id)},
        )
    ).scalar()
    entity_type_id = UUID(str(entity_type_id))

    # A live-only extra top-level section (added after the pin).
    live_extra_id = uuid.uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality, sort_order) "
            "VALUES (:id, :tid, 'live_extra', 'Live extra', 'one', 99)"
        ),
        {"id": str(live_extra_id), "tid": str(template_id)},
    )

    run = await _fresh_extract_run(db_session, fx)
    await _pin_run_to_snapshot(
        db_session,
        run_id=run.id,
        template_id=template_id,
        profile_id=profile_id,
        schema={
            "entity_types": [
                _snapshot_entity(
                    str(entity_type_id),
                    "pinned_top_level",
                    fields=[_snapshot_field(str(field_a_id), "field_a")],
                ),
                # A pinned CHILD must not be iterated by the top-level loop.
                _snapshot_entity(
                    str(uuid.uuid4()),
                    "pinned_child_not_top_level",
                    parent=str(entity_type_id),
                ),
            ]
        },
    )
    await db_session.refresh(run)

    _fake, result = await _run(db_session, fx, run, auto_advance_to_review=False)

    called_ids = {UUID(section["entity_type_id"]) for section in result.sections}
    assert called_ids == {entity_type_id}, (
        "live-only sections must be invisible until published into the pin"
    )


@pytest.mark.asyncio
async def test_child_entity_types_come_from_the_pinned_snapshot(
    db_session: AsyncSession,
) -> None:
    """The children path: snapshot children of the parent instance's entity
    type are returned; a live-only child is invisible."""
    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    _project_id, _article_id, template_id, profile_id, instance_id, field_a_id = fx

    entity_type_id = (
        await db_session.execute(
            text("SELECT entity_type_id FROM public.extraction_fields WHERE id = :fid"),
            {"fid": str(field_a_id)},
        )
    ).scalar()
    entity_type_id = UUID(str(entity_type_id))

    # Live-only child (added after the pin).
    live_child_id = uuid.uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality, sort_order, "
            " parent_entity_type_id) "
            "VALUES (:id, :tid, 'live_child', 'Live child', 'one', 1, :parent)"
        ),
        {
            "id": str(live_child_id),
            "tid": str(template_id),
            "parent": str(entity_type_id),
        },
    )

    run = await _fresh_extract_run(db_session, fx)
    pinned_child_id = str(uuid.uuid4())
    await _pin_run_to_snapshot(
        db_session,
        run_id=run.id,
        template_id=template_id,
        profile_id=profile_id,
        schema={
            "entity_types": [
                _snapshot_entity(str(entity_type_id), "parent", cardinality="many"),
                _snapshot_entity(
                    pinned_child_id,
                    "pinned_child",
                    parent=str(entity_type_id),
                ),
            ]
        },
    )
    await db_session.refresh(run)

    _fake, result = await _run(db_session, fx, run, parent_instance_id=instance_id)

    assert [section["entity_type_name"] for section in result.sections] == ["pinned_child"]


@pytest.mark.asyncio
async def test_entry_identification_uses_pinned_label_and_instruction(
    db_session: AsyncSession,
) -> None:
    """Entry identification: the group label, entry noun, key field and
    description come from the PINNED tree, and the template-level instruction
    leads the prompt.

    Was ``test_model_identification_uses_pinned_label_and_instruction``,
    driving the retired ``ModelExtractionService._identify_models``. The
    behaviour outlived the service — every repeating group is identified the
    same way — so the guard moved rather than retiring with the file that
    happened to hold it (trees B6). It goes through the PUBLIC seam
    (``run_from_request``), which is what a caller actually reaches.
    """
    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id, _instance_id, field_a_id = fx

    entity_type_id = (
        await db_session.execute(
            text("SELECT entity_type_id FROM public.extraction_fields WHERE id = :fid"),
            {"fid": str(field_a_id)},
        )
    ).scalar()
    entity_type_id = UUID(str(entity_type_id))

    run = await _fresh_extract_run(db_session, fx)
    await _pin_run_to_snapshot(
        db_session,
        run_id=run.id,
        template_id=template_id,
        profile_id=profile_id,
        schema={
            "llm_template_instruction": "PINNED GENERAL INSTRUCTION",
            "entity_types": [
                {
                    **_snapshot_entity(
                        str(entity_type_id),
                        "models",
                        fields=[
                            {
                                **_snapshot_field(str(field_a_id), "pinned_key"),
                                "is_entity_key": True,
                            }
                        ],
                    ),
                    "label": "PINNED MODELS LABEL",
                    "description": "PINNED CONTAINER DESCRIPTION",
                    "cardinality": "many",
                    "entry_label": "algorithm",
                }
            ],
        },
    )
    await db_session.refresh(run)

    fake, _ = await _run(db_session, fx, run, entity_type_id=entity_type_id)
    prompts = fake.prompts(entry_identification.NAME)
    captured = {"user_prompt": prompts[-1]} if prompts else {}

    assert "user_prompt" in captured, (
        "identification never ran — the pinned section must repeat AND declare "
        "an entry key, or extract_into_instances takes the singleton branch and "
        "this test asserts nothing"
    )
    assert "PINNED MODELS LABEL" in captured["user_prompt"]
    assert "identify every algorithm" in captured["user_prompt"]
    assert "return its pinned_key" in captured["user_prompt"]
    assert "Section instructions: PINNED CONTAINER DESCRIPTION" in captured["user_prompt"]
    assert captured["user_prompt"].startswith(
        "General instructions for this review:\nPINNED GENERAL INSTRUCTION\n\n"
    )


@pytest.mark.asyncio
async def test_pinned_but_deleted_live_paths(db_session: AsyncSession) -> None:
    """Both 'pinned but deleted live' branches: the single section raises the
    live-path error; the full-run sweep skips it without a model call."""
    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id, _instance_id, _field_a_id = fx

    run = await _fresh_extract_run(db_session, fx)
    ghost_entity_id = uuid.uuid4()  # in the pin, never existed live
    await _pin_run_to_snapshot(
        db_session,
        run_id=run.id,
        template_id=template_id,
        profile_id=profile_id,
        schema={
            "entity_types": [
                _snapshot_entity(
                    str(ghost_entity_id),
                    "ghost_section",
                    fields=[_snapshot_field(str(uuid.uuid4()), "ghost_field")],
                )
            ]
        },
    )
    await db_session.refresh(run)

    with pytest.raises(ValueError, match="Entity type not found"):
        await _run(db_session, fx, run, entity_type_id=ghost_entity_id)

    fake, result = await _run(db_session, fx, run)
    assert [(s["entity_type_name"], s["skipped"]) for s in result.sections] == [
        ("ghost_section", True)
    ]
    assert fake.calls == []


@pytest.mark.asyncio
async def test_live_rename_carries_live_name_into_the_prompt_bridge(
    db_session: AsyncSession,
) -> None:
    """A field renamed live (same id) must reach the LLM under its LIVE name —
    the write layer resolves the LLM's output key against live names, so a
    pinned name would silently drop the extracted value. Semantic content
    (llm_description) stays pinned."""
    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id, _instance_id, field_a_id = fx

    entity_type_id = (
        await db_session.execute(
            text("SELECT entity_type_id FROM public.extraction_fields WHERE id = :fid"),
            {"fid": str(field_a_id)},
        )
    ).scalar()
    entity_type_id = UUID(str(entity_type_id))

    run = await _fresh_extract_run(db_session, fx)
    await _pin_run_to_snapshot(
        db_session,
        run_id=run.id,
        template_id=template_id,
        profile_id=profile_id,
        schema={
            "entity_types": [
                _snapshot_entity(
                    str(entity_type_id),
                    "section",
                    fields=[
                        _snapshot_field(
                            str(field_a_id),
                            "old_pinned_name",
                            llm_description="PINNED INSTRUCTION",
                        )
                    ],
                )
            ]
        },
    )
    await db_session.execute(
        text("UPDATE public.extraction_fields SET name = 'renamed_live' WHERE id = :fid"),
        {"fid": str(field_a_id)},
    )
    await db_session.refresh(run)

    fake, _ = await _run(db_session, fx, run, entity_type_id=entity_type_id)

    (call,) = fake.field_calls()
    assert call.field_names == ["renamed_live"]
    assert "PINNED INSTRUCTION" in _descriptions(call)["renamed_live"]
