"""Every repeating group is an entry group: identify → resolve → extract per entry.

The ``instances[0]`` collapse (identity spec §2) meant a repeating section's
AI extraction always wrote the first repeat and never filled repeats 2..N.
The pipeline under test is the model pipeline generalized to every
``cardinality='many'`` section at any depth: the group's declared key
(``is_entity_key``) names an entry, identification lists the entries the
article describes, the resolver reuses or creates one instance per entry at
its ``(article, entity_type, parent_instance)`` coordinate, and the fields
are extracted once per entry with the prompt scoped to that entry.

Drives the real ``SectionExtractionService`` against the database through
all three of its paths. The two LLM seams are faked: identification through
``extract_structured`` in the pipeline module, field extraction through
``_extract_with_llm`` — whose fake answers from the entry scope it was
handed, so a value landing on the wrong instance shows up as the wrong
number rather than passing by coincidence.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.extractor import LlmUsage
from app.llm.prompts import EntryScope
from app.llm.prompts.model_identification import IdentifiedModel, ModelIdentificationOutput
from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.services import entry_group_extraction as pipeline
from app.services import section_extraction_service as ses
from app.services.entity_key import MissingEntityKeyError, normalize_key, stamp
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED
from tests.integration.test_pinned_prompt_structure import _pin_run_to_snapshot

pytestmark = pytest.mark.asyncio

VALIDATION_TYPES = ["apparent", "internal", "external"]
#: What the fake extractor answers for ``c_statistic`` — per entry, so the
#: assertions can tell which entry's prompt produced which proposal.
C_STAT = {"apparent": 0.91, "internal": 0.84, "external": 0.77}


# --------------------------------------------------------------------------
# Fixtures (raw SQL, like the sibling identity suites)
# --------------------------------------------------------------------------


async def _group(
    db: AsyncSession,
    *,
    with_key: bool = True,
    role: str = "study_section",
    parent: UUID | None = None,
    label: str = "Numeric performance",
) -> tuple[UUID, UUID, UUID]:
    """A ``cardinality='many'`` section: a select key + one value field.

    Returns ``(entity_type_id, key_field_id, value_field_id)``.
    """
    entity_type_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality, role, sort_order, "
            " parent_entity_type_id) "
            "VALUES (:id, :tpl, :name, :label, 'many', :role, 90, :parent)"
        ),
        {
            "id": entity_type_id,
            "tpl": SEED.primary_template,
            "name": f"perf_{entity_type_id.hex[:8]}",
            "label": label,
            "role": role,
            "parent": parent,
        },
    )
    key_id, value_id = uuid4(), uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, sort_order, is_entity_key, "
            " allowed_values) "
            "VALUES (:id, :et, 'validation_type', 'Validation type', 'select', 0, :key, "
            " CAST(:allowed AS jsonb))"
        ),
        {
            "id": key_id,
            "et": entity_type_id,
            "key": with_key,
            "allowed": json.dumps(VALIDATION_TYPES),
        },
    )
    await db.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, sort_order) "
            "VALUES (:id, :et, 'c_statistic', 'C-statistic', 'number', 1)"
        ),
        {"id": value_id, "et": entity_type_id},
    )
    await db.flush()
    return entity_type_id, key_id, value_id


async def _container(db: AsyncSession) -> UUID:
    """A keyed model container — the only role allowed to parent a section."""
    entity_type_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality, role, sort_order, entry_label) "
            "VALUES (:id, :tpl, :name, 'Prediction Models', 'many', 'model_container', 80, 'model')"
        ),
        {
            "id": entity_type_id,
            "tpl": SEED.primary_template,
            "name": f"models_{entity_type_id.hex[:8]}",
        },
    )
    await db.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, sort_order, is_entity_key) "
            "VALUES (:id, :et, 'model_name', 'Model Name', 'text', 0, true)"
        ),
        {"id": uuid4(), "et": entity_type_id},
    )
    await db.flush()
    return entity_type_id


async def _instance(db: AsyncSession, entity_type_id: UUID, key_value: str) -> UUID:
    instance_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_instances "
            "(id, project_id, article_id, template_id, entity_type_id, label, sort_order, "
            " metadata, created_by) "
            "VALUES (:id, :proj, :art, :tpl, :et, :label, 0, CAST(:md AS jsonb), :usr)"
        ),
        {
            "id": instance_id,
            "proj": SEED.primary_project,
            "art": SEED.primary_article,
            "tpl": SEED.primary_template,
            "et": entity_type_id,
            "label": key_value,
            "md": json.dumps(stamp({"ai_extracted": True}, key_value)),
            "usr": SEED.primary_profile,
        },
    )
    await db.flush()
    return instance_id


async def _run_in_extract(db: AsyncSession) -> ExtractionRun:
    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    run = await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=SEED.primary_profile
    )
    await db.flush()
    return run


def _pinned_field(field_id: UUID, name: str, label: str, field_type: str, *, key: bool) -> dict:
    return {
        "id": str(field_id),
        "name": name,
        "label": label,
        "description": None,
        "field_type": field_type,
        "is_required": False,
        "validation_schema": None,
        "allowed_values": VALIDATION_TYPES if field_type == "select" else None,
        "unit": None,
        "allowed_units": None,
        "sort_order": 0,
        "llm_description": None,
        "allow_other": False,
        "other_label": None,
        "other_placeholder": None,
        "allows_not_applicable": False,
        "allows_not_evaluated": False,
        "allows_no_information": True,
        "is_entity_key": key,
    }


def _pinned_group(
    entity_type_id: UUID,
    key_id: UUID,
    value_id: UUID,
    *,
    key: bool,
    role: str = "study_section",
    parent: UUID | None = None,
    label: str = "Numeric performance",
) -> dict:
    return {
        "id": str(entity_type_id),
        "name": f"perf_{entity_type_id.hex[:8]}",
        "label": label,
        "description": "pinned description",
        "entry_label": None,
        "parent_entity_type_id": str(parent) if parent else None,
        "cardinality": "many",
        "role": role,
        "sort_order": 90,
        "is_required": False,
        "fields": [
            _pinned_field(key_id, "validation_type", "Validation type", "select", key=key),
            _pinned_field(value_id, "c_statistic", "C-statistic", "number", key=False),
        ],
    }


def _pinned_container(entity_type_id: UUID) -> dict:
    return {
        "id": str(entity_type_id),
        "name": f"models_{entity_type_id.hex[:8]}",
        "label": "Prediction Models",
        "description": None,
        "entry_label": "model",
        "parent_entity_type_id": None,
        "cardinality": "many",
        "role": "model_container",
        "sort_order": 80,
        "is_required": False,
        "fields": [],
    }


# --------------------------------------------------------------------------
# The two LLM seams
# --------------------------------------------------------------------------


class _FakeExtractor:
    """Stands in for ``_extract_with_llm``: answers ``c_statistic`` from the
    entry scope it is handed (plus ``offset``, so a re-run can be made to
    produce a genuinely new value — ``record_proposal`` treats a replayed
    identical value as a no-op, by design) and records every scope so a
    test can assert what each call was told."""

    def __init__(self) -> None:
        self.scopes: list[EntryScope | None] = []
        self.offset = 0.0


def _service(db: AsyncSession) -> tuple[ses.SectionExtractionService, _FakeExtractor]:
    """The real service with the article text and the field extraction faked."""
    service = ses.SectionExtractionService(
        db=db, user_id=str(SEED.primary_profile), storage=MagicMock(), trace_id="entry-group"
    )
    service._assemble_prompt_text = AsyncMock(return_value="ARTICLE")  # type: ignore[method-assign]
    fake = _FakeExtractor()

    async def fake_extract(**kwargs: Any) -> tuple[dict[str, Any], LlmUsage]:
        scope: EntryScope | None = kwargs.get("entry_scope")
        fake.scopes.append(scope)
        value = round(C_STAT[normalize_key(scope.key_value)] + fake.offset, 2) if scope else 0.5
        return (
            {
                "c_statistic": {
                    "value": value,
                    "confidence": 0.9,
                    "reasoning": "r",
                    "evidence": None,
                    "status": "found",
                }
            },
            LlmUsage(prompt_tokens=10, completion_tokens=5),
        )

    service._extract_with_llm = fake_extract  # type: ignore[method-assign]
    return service, fake


def _fake_identification(monkeypatch: pytest.MonkeyPatch, names: list[str]) -> dict[str, Any]:
    """Identification answers ``names`` (mutable — a test edits it between
    runs) and records each prompt it was sent."""
    state: dict[str, Any] = {"names": names, "prompts": []}

    async def fake_structured(**kwargs: Any) -> tuple[ModelIdentificationOutput, LlmUsage]:
        state["prompts"].append(kwargs["user_prompt"])
        return (
            ModelIdentificationOutput(models=[IdentifiedModel(name=n) for n in state["names"]]),
            LlmUsage(prompt_tokens=7, completion_tokens=3),
        )

    monkeypatch.setattr(pipeline, "extract_structured", fake_structured)
    monkeypatch.setattr(ses, "build_model", lambda *_a, **_k: MagicMock())
    return state


# --------------------------------------------------------------------------
# Reads
# --------------------------------------------------------------------------


async def _entries(
    db: AsyncSession, entity_type_id: UUID, *, parent: UUID | None = None
) -> list[tuple[UUID, str | None]]:
    """``(instance_id, entity_key)`` at the coordinate, in display order."""
    rows = await db.execute(
        text(
            "SELECT id, metadata->>'entity_key' AS entity_key "
            "FROM public.extraction_instances "
            "WHERE article_id = :art AND entity_type_id = :et "
            "AND parent_instance_id IS NOT DISTINCT FROM :parent "
            "ORDER BY sort_order, created_at"
        ),
        {"art": SEED.primary_article, "et": entity_type_id, "parent": parent},
    )
    return [(row.id, row.entity_key) for row in rows]


async def _proposed(db: AsyncSession, instance_id: UUID, field_id: UUID) -> list[float]:
    rows = await db.execute(
        text(
            "SELECT proposed_value->'value' AS v FROM public.extraction_proposal_records "
            "WHERE instance_id = :iid AND field_id = :fid ORDER BY created_at"
        ),
        {"iid": instance_id, "fid": field_id},
    )
    return [float(row.v) for row in rows]


def _coord(**overrides: Any) -> dict[str, Any]:
    return {
        "project_id": SEED.primary_project,
        "article_id": SEED.primary_article,
        "template_id": SEED.primary_template,
        **overrides,
    }


# --------------------------------------------------------------------------
# extract_section — the per-section ✨ button
# --------------------------------------------------------------------------


async def test_repeats_get_their_own_instances_and_a_rerun_matches_them(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Spec §8: a select-keyed repeating section fills repeats 2..N on their
    own instances, and a re-run lands on the instances it already created."""
    entity_type_id, _key_id, value_id = await _group(db_session)
    run = await _run_in_extract(db_session)
    service, fake = _service(db_session)
    identification = _fake_identification(monkeypatch, ["apparent", "internal"])

    result = await service.extract_section(**_coord(), entity_type_id=entity_type_id, run_id=run.id)

    first = await _entries(db_session, entity_type_id)
    assert [key for _, key in first] == ["apparent", "internal"], "one instance per entry"
    assert result.suggestions_created == 2
    # Each entry's value landed on ITS instance: the prompt was scoped per entry.
    assert await _proposed(db_session, first[0][0], value_id) == [C_STAT["apparent"]]
    assert await _proposed(db_session, first[1][0], value_id) == [C_STAT["internal"]]
    assert [s.key_value for s in fake.scopes if s] == ["apparent", "internal"]
    assert all(s.key_label == "Validation type" for s in fake.scopes if s)

    # Run 2: the model spells two entries differently, finds a third, and
    # reads a slightly different number this time.
    identification["names"][:] = ["  Internal ", "APPARENT", "external"]
    fake.offset = 0.01
    await service.extract_section(**_coord(), entity_type_id=entity_type_id, run_id=run.id)

    second = await _entries(db_session, entity_type_id)
    assert [key for _, key in second] == ["apparent", "internal", "external"]
    assert [iid for iid, _ in second[:2]] == [iid for iid, _ in first], "matched, not forked"
    assert await _proposed(db_session, first[1][0], value_id) == [
        C_STAT["internal"],
        round(C_STAT["internal"] + 0.01, 2),
    ], "the re-run appended to the same instance"
    # Grounding: the second identification saw what the article already had.
    assert "already been identified" in identification["prompts"][1].lower()
    assert "apparent" in identification["prompts"][1]
    assert "already been identified" not in identification["prompts"][0].lower()


async def test_nested_group_entries_are_scoped_by_their_parent(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two models each own an 'internal' validation: two instances, one per parent."""
    container = await _container(db_session)
    parent_a = await _instance(db_session, container, "XGBoost")
    parent_b = await _instance(db_session, container, "LightGBM")
    child, _key_id, _value_id = await _group(db_session, role="model_section", parent=container)
    run = await _run_in_extract(db_session)
    service, fake = _service(db_session)
    _fake_identification(monkeypatch, ["internal"])

    for parent in (parent_a, parent_b):
        await service.extract_section(
            **_coord(), entity_type_id=child, parent_instance_id=parent, run_id=run.id
        )

    under_a = await _entries(db_session, child, parent=parent_a)
    under_b = await _entries(db_session, child, parent=parent_b)
    assert [key for _, key in under_a] == ["internal"]
    assert [key for _, key in under_b] == ["internal"]
    assert under_a[0][0] != under_b[0][0]
    # The per-entry prompt names the parent so the model reads the right block.
    assert [s.parent_label for s in fake.scopes if s] == ["XGBoost", "LightGBM"]

    # Re-running under A matches A's repeat — never B's.
    await service.extract_section(
        **_coord(), entity_type_id=child, parent_instance_id=parent_a, run_id=run.id
    )
    assert len(await _entries(db_session, child, parent=parent_a)) == 1
    assert len(await _entries(db_session, child, parent=parent_b)) == 1


async def test_a_keyless_repeating_group_is_refused_before_any_write_or_llm_call(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    entity_type_id, _key_id, _value_id = await _group(db_session, with_key=False)
    run = await _run_in_extract(db_session)
    service, fake = _service(db_session)
    identification = _fake_identification(monkeypatch, ["apparent"])

    with pytest.raises(MissingEntityKeyError) as excinfo:
        await service.extract_section(**_coord(), entity_type_id=entity_type_id, run_id=run.id)

    assert "'Numeric performance'" in str(excinfo.value)
    assert await _entries(db_session, entity_type_id) == []
    assert identification["prompts"] == [], "no identification call was spent"
    assert fake.scopes == [], "no extraction call was spent"


async def test_the_key_is_read_from_the_pinned_snapshot_not_the_live_row(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Closes the #798 residual: the run extracts against its pinned tree, so
    the key it honours is the pinned one. Live keyless + pinned keyed runs."""
    entity_type_id, key_id, value_id = await _group(db_session, with_key=False)
    run = await _run_in_extract(db_session)
    await _pin_run_to_snapshot(
        db_session,
        run_id=run.id,
        template_id=SEED.primary_template,
        profile_id=SEED.primary_profile,
        schema={"entity_types": [_pinned_group(entity_type_id, key_id, value_id, key=True)]},
    )
    await db_session.refresh(run)
    service, _fake = _service(db_session)
    _fake_identification(monkeypatch, ["external"])

    await service.extract_section(**_coord(), entity_type_id=entity_type_id, run_id=run.id)

    assert [key for _, key in await _entries(db_session, entity_type_id)] == ["external"]


async def test_a_live_key_does_not_rescue_a_pinned_keyless_group(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The inverse: a key added in an unpublished draft gates nothing until Publish."""
    entity_type_id, key_id, value_id = await _group(db_session, with_key=True)
    run = await _run_in_extract(db_session)
    await _pin_run_to_snapshot(
        db_session,
        run_id=run.id,
        template_id=SEED.primary_template,
        profile_id=SEED.primary_profile,
        schema={"entity_types": [_pinned_group(entity_type_id, key_id, value_id, key=False)]},
    )
    await db_session.refresh(run)
    service, _fake = _service(db_session)
    _fake_identification(monkeypatch, ["external"])

    with pytest.raises(MissingEntityKeyError):
        await service.extract_section(**_coord(), entity_type_id=entity_type_id, run_id=run.id)
    assert await _entries(db_session, entity_type_id) == []


# --------------------------------------------------------------------------
# extract_for_run — the full-run sweep (top-level sections)
# --------------------------------------------------------------------------


async def test_the_full_run_sweep_fills_every_repeat_of_a_top_level_group(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``_find_instance_for_entity_type`` used to hand this path ``instances[0]``."""
    entity_type_id, key_id, value_id = await _group(db_session)
    run = await _run_in_extract(db_session)
    await _pin_run_to_snapshot(
        db_session,
        run_id=run.id,
        template_id=SEED.primary_template,
        profile_id=SEED.primary_profile,
        schema={"entity_types": [_pinned_group(entity_type_id, key_id, value_id, key=True)]},
    )
    await db_session.refresh(run)
    service, _fake = _service(db_session)
    _fake_identification(monkeypatch, ["apparent", "external"])

    result = await service.extract_for_run(run_id=run.id, skip_fields_with_human_proposals=True)

    entries = await _entries(db_session, entity_type_id)
    assert [key for _, key in entries] == ["apparent", "external"]
    assert result.total_suggestions_created == 2
    assert await _proposed(db_session, entries[1][0], value_id) == [C_STAT["external"]]


# --------------------------------------------------------------------------
# extract_all_sections — the per-model batch (child sections)
# --------------------------------------------------------------------------


async def test_the_per_model_batch_routes_a_nested_group_through_the_pipeline(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    container = await _container(db_session)
    parent_a = await _instance(db_session, container, "XGBoost")
    child, key_id, value_id = await _group(db_session, role="model_section", parent=container)
    run = await _run_in_extract(db_session)
    await _pin_run_to_snapshot(
        db_session,
        run_id=run.id,
        template_id=SEED.primary_template,
        profile_id=SEED.primary_profile,
        schema={
            "entity_types": [
                _pinned_container(container),
                _pinned_group(
                    child, key_id, value_id, key=True, role="model_section", parent=container
                ),
            ]
        },
    )
    await db_session.refresh(run)
    service, fake = _service(db_session)
    _fake_identification(monkeypatch, ["internal", "external"])

    result = await service.extract_all_sections(
        **_coord(), parent_instance_id=parent_a, run_id=run.id
    )

    entries = await _entries(db_session, child, parent=parent_a)
    assert [key for _, key in entries] == ["internal", "external"]
    assert result.total_suggestions_created == 2
    assert [s.parent_label for s in fake.scopes if s] == ["XGBoost", "XGBoost"]
    assert await _proposed(db_session, entries[0][0], value_id) == [C_STAT["internal"]]
