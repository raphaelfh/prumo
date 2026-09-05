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
from app.llm.prompts import Ancestor, Scope, render_entry_scope_section
from app.llm.prompts.entry_identification import EntryIdentificationOutput, IdentifiedEntry
from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.schemas.extraction import ExtractionErrorCode
from app.services import entry_group_extraction as pipeline
from app.services import section_extraction_service as ses
from app.services.entity_key import MissingEntityKeyError, normalize_key, stamp
from app.services.extraction_errors import classify_extraction_error
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED, first_entity_type_id
from tests.integration.helpers.template_fixtures import add_instance, fresh_charms
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
    cardinality: str = "many",
    entry_label: str | None = None,
) -> tuple[UUID, UUID, UUID]:
    """A section, repeating by default: a select key + one value field. With
    ``cardinality='one'`` the key is inert and the section is a singleton.

    Returns ``(entity_type_id, key_field_id, value_field_id)``.
    """
    entity_type_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality, role, sort_order, "
            " parent_entity_type_id, entry_label) "
            "VALUES (:id, :tpl, :name, :label, :cardinality, :role, 90, :parent, :entry_label)"
        ),
        {
            "id": entity_type_id,
            "tpl": SEED.primary_template,
            "name": f"perf_{entity_type_id.hex[:8]}",
            "label": label,
            "role": role,
            "parent": parent,
            "cardinality": cardinality,
            "entry_label": entry_label,
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


async def _instance(
    db: AsyncSession, entity_type_id: UUID, key_value: str, *, parent: UUID | None = None
) -> UUID:
    instance_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_instances "
            "(id, project_id, article_id, template_id, entity_type_id, label, sort_order, "
            " metadata, created_by, parent_instance_id) "
            "VALUES (:id, :proj, :art, :tpl, :et, :label, 0, CAST(:md AS jsonb), :usr, :parent)"
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
            "parent": parent,
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
    entry_label: str | None = None,
) -> dict:
    return {
        "id": str(entity_type_id),
        "name": f"perf_{entity_type_id.hex[:8]}",
        "label": label,
        "description": "pinned description",
        "entry_label": entry_label,
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
        self.scopes: list[Scope | None] = []
        self.offset = 0.0


def _service(db: AsyncSession) -> tuple[ses.SectionExtractionService, _FakeExtractor]:
    """The real service with the article text and the field extraction faked."""
    service = ses.SectionExtractionService(
        db=db, user_id=str(SEED.primary_profile), storage=MagicMock(), trace_id="entry-group"
    )
    service._assemble_prompt_text = AsyncMock(return_value="ARTICLE")  # type: ignore[method-assign]
    fake = _FakeExtractor()

    async def fake_extract(**kwargs: Any) -> tuple[dict[str, Any], LlmUsage]:
        scope: Scope | None = kwargs.get("entry_scope")
        fake.scopes.append(scope)
        # A singleton's scope has no key: the flat 0.5. An entry's key still maps
        # through C_STAT — a mis-scoped entry must stay a wrong number.
        value = (
            round(C_STAT[normalize_key(scope.key_value)] + fake.offset, 2)
            if scope and scope.key_value
            else 0.5
        )
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

    async def fake_structured(**kwargs: Any) -> tuple[EntryIdentificationOutput, LlmUsage]:
        state["prompts"].append(kwargs["user_prompt"])
        return (
            EntryIdentificationOutput(entries=[IdentifiedEntry(name=n) for n in state["names"]]),
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
    """The values proposed on one field of one instance, as a sorted multiset.

    Inside the test's transaction ``created_at`` is not an order: rows
    written by two calls can share it (the #608 class — an unordered scan
    is not a contract), so callers assert WHICH values landed on the
    instance, never in what order."""
    rows = await db.execute(
        text(
            "SELECT proposed_value->'value' AS v FROM public.extraction_proposal_records "
            "WHERE instance_id = :iid AND field_id = :fid"
        ),
        {"iid": instance_id, "fid": field_id},
    )
    return sorted(float(row.v) for row in rows)


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
    # Identification was parameterized by THIS group: its label, its key
    # field and the key's choices — not by the model container's wording.
    first_prompt = identification["prompts"][0]
    assert 'for the section "Numeric performance"' in first_prompt
    assert "return its Validation type" in first_prompt
    assert "must be one of: apparent, internal, external" in first_prompt
    assert "belong to" not in first_prompt, "a top-level group has no parent to scope to"
    # The live group carries no noun: the prompt reads it as the one fallback.
    assert "identify every entry it describes" in first_prompt

    # Run 2: the model spells two entries differently, finds a third, and
    # reads a slightly different number this time.
    identification["names"][:] = ["  Internal ", "APPARENT", "external"]
    fake.offset = 0.01
    await service.extract_section(**_coord(), entity_type_id=entity_type_id, run_id=run.id)

    second = await _entries(db_session, entity_type_id)
    assert [key for _, key in second] == ["apparent", "internal", "external"]
    assert [iid for iid, _ in second[:2]] == [iid for iid, _ in first], "matched, not forked"
    assert await _proposed(db_session, first[1][0], value_id) == sorted(
        [C_STAT["internal"], round(C_STAT["internal"] + 0.01, 2)]
    ), "the re-run appended to the same instance"
    # Grounding: the second identification saw what the article already had.
    assert "already been identified" in identification["prompts"][1].lower()
    assert "apparent" in identification["prompts"][1]
    assert "already been identified" not in identification["prompts"][0].lower()


async def test_the_authored_noun_reaches_the_identification_prompt(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The pinned group's ``entry_label`` names the entry in the prompt; only
    a NULL noun falls back to ``DEFAULT_ENTRY_LABEL``."""
    entity_type_id, key_id, value_id = await _group(db_session)
    run = await _run_in_extract(db_session)
    await _pin_run_to_snapshot(
        db_session,
        run_id=run.id,
        template_id=SEED.primary_template,
        profile_id=SEED.primary_profile,
        schema={
            "entity_types": [
                _pinned_group(entity_type_id, key_id, value_id, key=True, entry_label="validation")
            ]
        },
    )
    await db_session.refresh(run)
    service, _fake = _service(db_session)
    identification = _fake_identification(monkeypatch, ["external"])

    await service.extract_section(**_coord(), entity_type_id=entity_type_id, run_id=run.id)

    assert "identify every validation it describes" in identification["prompts"][0]
    assert "identify every entry" not in identification["prompts"][0]


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
    identification = _fake_identification(monkeypatch, ["internal"])

    for parent in (parent_a, parent_b):
        await service.extract_section(
            **_coord(), entity_type_id=child, parent_instance_id=parent, run_id=run.id
        )

    under_a = await _entries(db_session, child, parent=parent_a)
    under_b = await _entries(db_session, child, parent=parent_b)
    assert [key for _, key in under_a] == ["internal"]
    assert [key for _, key in under_b] == ["internal"]
    assert under_a[0][0] != under_b[0][0]
    # Identification is scoped to the parent too, not only the grounding
    # list: asked under A, the prompt rules out what the article reports
    # for anything but A — or B's validations would land under A.
    asked_a, asked_b = identification["prompts"]
    assert 'belong to model "XGBoost"' in asked_a and "LightGBM" not in asked_a
    assert 'belong to model "LightGBM"' in asked_b and "XGBoost" not in asked_b
    # The per-entry prompt names the parent so the model reads the right block.
    assert [s.ancestors for s in fake.scopes if s] == [
        (Ancestor("model", "XGBoost"),),
        (Ancestor("model", "LightGBM"),),
    ]

    # Re-running under A matches A's repeat — never B's.
    await service.extract_section(
        **_coord(), entity_type_id=child, parent_instance_id=parent_a, run_id=run.id
    )
    assert len(await _entries(db_session, child, parent=parent_a)) == 1
    assert len(await _entries(db_session, child, parent=parent_b)) == 1


async def test_a_singleton_under_an_entry_is_scoped_to_that_entry(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Trees spec §1: 'Model Development' for model B used to be extracted
    from a prompt that never mentioned model B. The singleton's call now
    carries the chain it belongs to, and its proposal lands on the instance
    under that entry."""
    container = await _container(db_session)
    xgboost = await _instance(db_session, container, "XGBoost")
    development, _key_id, value_id = await _group(
        db_session,
        role="model_section",
        parent=container,
        cardinality="one",
        label="Model development",
    )
    run = await _run_in_extract(db_session)
    service, fake = _service(db_session)
    identification = _fake_identification(monkeypatch, [])

    result = await service.extract_section(
        **_coord(), entity_type_id=development, parent_instance_id=xgboost, run_id=run.id
    )

    assert result.suggestions_created == 1
    (scope,) = fake.scopes
    assert scope == Scope(entry_label="model", ancestors=(Ancestor("model", "XGBoost"),))
    assert identification["prompts"] == [], "a singleton is never identified"
    (materialized,) = await _entries(db_session, development, parent=xgboost)
    assert await _proposed(db_session, materialized[0], value_id) == [0.5]


async def test_a_section_at_depth_three_names_the_whole_chain(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A singleton under a validation under a model: the block reads
    ``model "XGBoost" › validation "external"``, outermost first, and a
    group asked under that validation is identified within the same chain.

    Trees B5: rebuild as a real entity-type chain once
    ``ck_extraction_entity_types_role_parent`` is dropped — until then the
    leaf and the subgroup are role-legal children of the container whose
    INSTANCES hang under the validation entry (nothing on
    ``extraction_instances`` couples the two), which is the path the walk
    reads.
    """
    container = await _container(db_session)
    validations, _key_id, _value_id = await _group(
        db_session, role="model_section", parent=container, entry_label="validation"
    )
    xgboost = await _instance(db_session, container, "XGBoost")
    external = await _instance(db_session, validations, "external", parent=xgboost)
    leaf, _leaf_key, leaf_value = await _group(
        db_session,
        role="model_section",
        parent=container,
        cardinality="one",
        label="Calibration plot",
    )
    run = await _run_in_extract(db_session)
    service, fake = _service(db_session)
    identification = _fake_identification(monkeypatch, ["apparent"])

    await service.extract_section(
        **_coord(), entity_type_id=leaf, parent_instance_id=external, run_id=run.id
    )
    (scope,) = fake.scopes
    assert scope == Scope(
        entry_label="validation",
        ancestors=(Ancestor("model", "XGBoost"), Ancestor("validation", "external")),
    )
    block = render_entry_scope_section(scope)
    assert "This section belongs to the validation identified below." in block
    assert '- Within: model "XGBoost" › validation "external"' in block
    (calibration,) = await _entries(db_session, leaf, parent=external)
    assert await _proposed(db_session, calibration[0], leaf_value) == [0.5]

    # A group hanging under the depth-two entry: its identification is scoped
    # to the same chain, its entry carries it too, and the value lands under
    # that entry (the fake maps a validation-type key to its C-statistic).
    subgroups, _sub_key, sub_value = await _group(
        db_session, role="model_section", parent=container, entry_label="subgroup"
    )
    await service.extract_section(
        **_coord(), entity_type_id=subgroups, parent_instance_id=external, run_id=run.id
    )
    assert len(identification["prompts"]) == 1
    assert 'belong to model "XGBoost" › validation "external"' in identification["prompts"][0]
    assert fake.scopes[-1] is not None
    assert fake.scopes[-1].key_value == "apparent"
    assert fake.scopes[-1].ancestors == scope.ancestors
    (entry,) = await _entries(db_session, subgroups, parent=external)
    assert await _proposed(db_session, entry[0], sub_value) == [C_STAT["apparent"]]


class _PromptCaptured(Exception):
    """Raised by the prompt-capturing fake so the call stops at the seam."""


async def test_the_chain_reaches_the_prompt_the_model_receives(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The seam the fake elsewhere replaces: ``_extract_with_llm`` renders the
    section prompt with the scope the pipeline built, so the block is in the
    text the model receives — not only in a test-side re-render."""
    container = await _container(db_session)
    xgboost = await _instance(db_session, container, "XGBoost")
    development, _key_id, _value_id = await _group(
        db_session,
        role="model_section",
        parent=container,
        cardinality="one",
        label="Model development",
    )
    run = await _run_in_extract(db_session)
    service = ses.SectionExtractionService(
        db=db_session, user_id=str(SEED.primary_profile), storage=MagicMock(), trace_id="chain"
    )
    service._assemble_prompt_text = AsyncMock(return_value="ARTICLE")  # type: ignore[method-assign]
    captured: dict[str, str] = {}

    async def capture(**kwargs: Any) -> None:
        captured["user_prompt"] = kwargs["user_prompt"]
        raise _PromptCaptured

    monkeypatch.setattr(ses, "extract_structured", capture)
    monkeypatch.setattr(ses, "build_model", lambda *_a, **_k: MagicMock())

    with pytest.raises(_PromptCaptured):
        await service.extract_section(
            **_coord(), entity_type_id=development, parent_instance_id=xgboost, run_id=run.id
        )

    prompt = captured["user_prompt"]
    assert "This section belongs to the model identified below." in prompt
    assert '- Within: model "XGBoost"' in prompt
    assert prompt.index("XGBoost") < prompt.index("Article text:")


async def test_a_stranger_parent_is_refused_before_any_llm_call(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """BOLA on the walk: a parent instance from another project's coordinate
    is refused by the run-scoped getter — for a singleton child and a group
    child alike — before identification or extraction spends a call, and
    before any instance is written under it."""
    container = await _container(db_session)
    development, _k, _v = await _group(
        db_session,
        role="model_section",
        parent=container,
        cardinality="one",
        label="Model development",
    )
    validations, _k2, _v2 = await _group(
        db_session, role="model_section", parent=container, entry_label="validation"
    )
    foreign_project, foreign_template, _ = await fresh_charms(db_session)
    stranger = await add_instance(
        db_session,
        project_id=foreign_project,
        template_id=foreign_template,
        entity_type_id=await first_entity_type_id(db_session, foreign_template),
    )
    run = await _run_in_extract(db_session)
    service, fake = _service(db_session)
    identification = _fake_identification(monkeypatch, ["apparent"])

    for child in (development, validations):
        with pytest.raises(ValueError, match=f"Parent instance not found: {stranger}"):
            await service.extract_section(
                **_coord(), entity_type_id=child, parent_instance_id=stranger, run_id=run.id
            )

    assert fake.scopes == [], "no extraction call was spent"
    assert identification["prompts"] == [], "no identification call was spent"
    assert await _entries(db_session, validations, parent=stranger) == []


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
    # The code the single-section job carries for this exact raise: the task
    # wraps whatever the service raises through ``classify_extraction_error``
    # (pinned by ``TestRunSectionExtractionTaskErrorCode``), so this is the
    # real-pipeline half of the section-path proof.
    assert classify_extraction_error(excinfo.value)[0] is ExtractionErrorCode.MISSING_ENTITY_KEY
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
    assert [s.ancestors for s in fake.scopes if s] == [(Ancestor("model", "XGBoost"),)] * 2
    assert await _proposed(db_session, entries[0][0], value_id) == [C_STAT["internal"]]
