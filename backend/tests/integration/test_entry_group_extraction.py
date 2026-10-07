"""Every repeating group is an entry group: identify → resolve → extract per entry.

The ``instances[0]`` collapse (identity spec §2) meant a repeating section's
AI extraction always wrote the first repeat and never filled repeats 2..N.
The pipeline under test is the model pipeline generalized to every
``cardinality='many'`` section at any depth: the group's declared key
(``is_entity_key``) names an entry, identification lists the entries the
article describes, the resolver reuses or creates one instance per entry at
its ``(article, entity_type, parent_instance)`` coordinate, and the fields
are extracted once per entry with the prompt scoped to that entry.

Drives ``AiExtraction.run_from_request`` against the database through all
three of its paths, with the one model seam faked (``RecordedLlm``):
identification answers a scripted list, and field extraction answers
``c_statistic`` from the entry the prompt is scoped to — so a value landing
on the wrong instance shows up as the wrong number rather than passing by
coincidence.
"""

from __future__ import annotations

import json
import re
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.prompts import entry_identification
from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.schemas.extraction import ExtractionErrorCode
from app.services.ai_extraction import BatchExtractionResult, SectionExtractionResult
from app.services.entity_key import MissingEntityKeyError, normalize_key, stamp
from app.services.extraction_errors import classify_extraction_error
from app.services.run_lifecycle_service import RunLifecycleService
from tests.fakes.recorded_llm import Call, RecordedLlm
from tests.integration.conftest import SEED, first_entity_type_id
from tests.integration.helpers.ai_extraction import extraction, request, seed_article_text
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
            "(id, project_template_id, name, label, cardinality, sort_order, "
            " parent_entity_type_id, entry_label) "
            "VALUES (:id, :tpl, :name, :label, :cardinality, 90, :parent, :entry_label)"
        ),
        {
            "id": entity_type_id,
            "tpl": SEED.primary_template,
            "name": f"perf_{entity_type_id.hex[:8]}",
            "label": label,
            "parent": parent,
            "cardinality": cardinality,
            # 0069's `ck_..._noun_on_repeating`: a repeating section always
            # carries the word for one entry. Callers that care about the
            # noun pass it; the rest get the default rather than a row the
            # schema refuses.
            "entry_label": entry_label or ("entry" if cardinality == "many" else None),
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
            "(id, project_template_id, name, label, cardinality, sort_order, entry_label) "
            "VALUES (:id, :tpl, :name, 'Prediction Models', 'many', 80, 'model')"
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
        "sort_order": 80,
        "is_required": False,
        "fields": [],
    }


# --------------------------------------------------------------------------
# The model seam
# --------------------------------------------------------------------------

_KEY_LINE = re.compile(r'^- Validation type: "(?P<key>[^"]*)"$', re.M)


def _fake(names: list[str], offset: float = 0.0) -> RecordedLlm:
    """Identification answers ``names`` (mutable — a test edits it between
    runs); field extraction answers each entry's key and its ``c_statistic``
    from the entry the prompt is scoped to (plus ``offset``, so a re-run can produce a genuinely new
    value — an identical replay lands no new row, by design). A singleton's
    prompt names no key: the flat 0.5."""
    fake = RecordedLlm(entries=names)

    def answer(call: Call) -> dict[str, dict[str, Any]]:
        key = _KEY_LINE.search(call.user_prompt)
        value = (
            round(C_STAT[normalize_key(key["key"])] + getattr(fake, "offset", offset), 2)
            if key
            else 0.5
        )
        answer = {"c_statistic": {"value": value, "reasoning": "r"}}
        if key:
            answer["validation_type"] = {"value": normalize_key(key["key"])}
        return answer

    fake.fields = answer
    return fake


def _scopes(fake: RecordedLlm) -> list[str]:
    """The entry-scope block of every field call, in order."""
    blocks = []
    for call in fake.field_calls():
        lines = call.user_prompt.splitlines()
        blocks.append(
            "\n".join(
                line
                for line in lines
                if line.startswith(("This section ", "- Validation type:", "- Within:"))
            )
        )
    return blocks


async def _extract(
    db: AsyncSession, fake: RecordedLlm, **kwargs: Any
) -> SectionExtractionResult | BatchExtractionResult:
    await seed_article_text(db)
    return await extraction(db, fake).run_from_request(request(**kwargs))


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
# One section — the per-section ✨ button
# --------------------------------------------------------------------------

IDENTIFY = entry_identification.NAME


async def test_repeats_get_their_own_instances_and_a_rerun_matches_them(
    db_session: AsyncSession,
) -> None:
    """Spec §8: a select-keyed repeating section fills repeats 2..N on their
    own instances, and a re-run lands on the instances it already created."""
    entity_type_id, _key_id, value_id = await _group(db_session)
    run = await _run_in_extract(db_session)
    fake = _fake(["apparent", "internal"])

    result = await _extract(db_session, fake, entity_type_id=entity_type_id, run_id=run.id)

    first = await _entries(db_session, entity_type_id)
    assert [key for _, key in first] == ["apparent", "internal"], "one instance per entry"
    assert result.suggestions_created == 4, "key + value, per entry"
    # Each entry's value landed on ITS instance: the prompt was scoped per entry.
    assert await _proposed(db_session, first[0][0], value_id) == [C_STAT["apparent"]]
    assert await _proposed(db_session, first[1][0], value_id) == [C_STAT["internal"]]
    assert [_KEY_LINE.search(b)["key"] for b in _scopes(fake)] == ["apparent", "internal"]
    # Identification was parameterized by THIS group: its label, its key
    # field and the key's choices — not by the model container's wording.
    first_prompt = fake.prompts(IDENTIFY)[0]
    assert 'for the section "Numeric performance"' in first_prompt
    assert "return its Validation type" in first_prompt
    assert "must be one of: apparent, internal, external" in first_prompt
    assert "belong to" not in first_prompt, "a top-level group has no parent to scope to"
    # The live group carries no noun: the prompt reads it as the one fallback.
    assert "identify every entry it describes" in first_prompt

    # Run 2: the model spells two entries differently, finds a third, and
    # reads a slightly different number this time.
    fake.entries[:] = ["  Internal ", "APPARENT", "external"]
    fake.offset = 0.01
    await _extract(db_session, fake, entity_type_id=entity_type_id, run_id=run.id)

    second = await _entries(db_session, entity_type_id)
    assert [key for _, key in second] == ["apparent", "internal", "external"]
    assert [iid for iid, _ in second[:2]] == [iid for iid, _ in first], "matched, not forked"
    assert await _proposed(db_session, first[1][0], value_id) == sorted(
        [C_STAT["internal"], round(C_STAT["internal"] + 0.01, 2)]
    ), "the re-run appended to the same instance"
    # Grounding: the second identification saw what the article already had.
    assert "already been identified" in fake.prompts(IDENTIFY)[1].lower()
    assert "apparent" in fake.prompts(IDENTIFY)[1]
    assert "already been identified" not in first_prompt.lower()


async def test_the_authored_noun_reaches_the_identification_prompt(
    db_session: AsyncSession,
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
    fake = _fake(["external"])

    await _extract(db_session, fake, entity_type_id=entity_type_id, run_id=run.id)

    assert "identify every validation it describes" in fake.prompts(IDENTIFY)[0]
    assert "identify every entry" not in fake.prompts(IDENTIFY)[0]


async def test_nested_group_entries_are_scoped_by_their_parent(db_session: AsyncSession) -> None:
    """Two models each own an 'internal' validation: two instances, one per parent."""
    container = await _container(db_session)
    parent_a = await _instance(db_session, container, "XGBoost")
    parent_b = await _instance(db_session, container, "LightGBM")
    child, _key_id, _value_id = await _group(db_session, parent=container)
    run = await _run_in_extract(db_session)
    fake = _fake(["internal"])

    for parent in (parent_a, parent_b):
        await _extract(
            db_session, fake, entity_type_id=child, parent_instance_id=parent, run_id=run.id
        )

    under_a = await _entries(db_session, child, parent=parent_a)
    under_b = await _entries(db_session, child, parent=parent_b)
    assert [key for _, key in under_a] == ["internal"]
    assert [key for _, key in under_b] == ["internal"]
    assert under_a[0][0] != under_b[0][0]
    # Identification is scoped to the parent too, not only the grounding
    # list: asked under A, the prompt rules out what the article reports
    # for anything but A — or B's validations would land under A.
    asked_a, asked_b = fake.prompts(IDENTIFY)
    assert 'belong to model "XGBoost"' in asked_a and "LightGBM" not in asked_a
    assert 'belong to model "LightGBM"' in asked_b and "XGBoost" not in asked_b
    # The per-entry prompt names the parent so the model reads the right block.
    assert [b.splitlines()[-1] for b in _scopes(fake)] == [
        '- Within: model "XGBoost"',
        '- Within: model "LightGBM"',
    ]

    # Re-running under A matches A's repeat — never B's.
    await _extract(
        db_session, fake, entity_type_id=child, parent_instance_id=parent_a, run_id=run.id
    )
    assert len(await _entries(db_session, child, parent=parent_a)) == 1
    assert len(await _entries(db_session, child, parent=parent_b)) == 1


async def test_a_singleton_under_an_entry_is_scoped_to_that_entry(
    db_session: AsyncSession,
) -> None:
    """Trees spec §1: 'Model Development' for model B used to be extracted
    from a prompt that never mentioned model B. The singleton's call now
    carries the chain it belongs to, and its proposal lands on the instance
    under that entry."""
    container = await _container(db_session)
    xgboost = await _instance(db_session, container, "XGBoost")
    development, _key_id, value_id = await _group(
        db_session,
        parent=container,
        cardinality="one",
        label="Model development",
    )
    run = await _run_in_extract(db_session)
    fake = _fake([])

    result = await _extract(
        db_session, fake, entity_type_id=development, parent_instance_id=xgboost, run_id=run.id
    )

    # c_statistic, plus the unanswered (inert) key as a no-information proposal.
    assert result.suggestions_created == 2
    assert _scopes(fake) == [
        "This section belongs to the model identified below. Extract ONLY the values "
        "that describe that model; ignore values that describe a different model.\n"
        '- Within: model "XGBoost"'
    ]
    assert fake.prompts(IDENTIFY) == [], "a singleton is never identified"
    (materialized,) = await _entries(db_session, development, parent=xgboost)
    assert await _proposed(db_session, materialized[0], value_id) == [0.5]


async def test_a_section_at_depth_three_names_the_whole_chain(db_session: AsyncSession) -> None:
    """A singleton under a validation under a model: the block reads
    ``model "XGBoost" › validation "external"``, outermost first, and a
    group asked under that validation is identified within the same chain.

    The leaf and the subgroup are children of the container whose INSTANCES
    hang under the validation entry (nothing on ``extraction_instances``
    couples the two), which is the path the walk reads.
    """
    container = await _container(db_session)
    validations, _key_id, _value_id = await _group(
        db_session, parent=container, entry_label="validation"
    )
    xgboost = await _instance(db_session, container, "XGBoost")
    external = await _instance(db_session, validations, "external", parent=xgboost)
    leaf, _leaf_key, leaf_value = await _group(
        db_session,
        parent=container,
        cardinality="one",
        label="Calibration plot",
    )
    run = await _run_in_extract(db_session)
    fake = _fake(["apparent"])

    await _extract(
        db_session, fake, entity_type_id=leaf, parent_instance_id=external, run_id=run.id
    )
    (block,) = _scopes(fake)
    assert "This section belongs to the validation identified below." in block
    assert '- Within: model "XGBoost" › validation "external"' in block
    # The chain is in the text the model receives, ahead of the article.
    prompt = fake.field_calls()[0].user_prompt
    assert prompt.index("XGBoost") < prompt.index("Article text:")
    (calibration,) = await _entries(db_session, leaf, parent=external)
    assert await _proposed(db_session, calibration[0], leaf_value) == [0.5]

    # A group hanging under the depth-two entry: its identification is scoped
    # to the same chain, its entry carries it too, and the value lands under
    # that entry (the fake maps a validation-type key to its C-statistic).
    subgroups, _sub_key, sub_value = await _group(
        db_session, parent=container, entry_label="subgroup"
    )
    await _extract(
        db_session, fake, entity_type_id=subgroups, parent_instance_id=external, run_id=run.id
    )
    assert len(fake.prompts(IDENTIFY)) == 1
    assert 'belong to model "XGBoost" › validation "external"' in fake.prompts(IDENTIFY)[0]
    last = _scopes(fake)[-1]
    assert '- Validation type: "apparent"' in last
    assert '- Within: model "XGBoost" › validation "external"' in last
    (entry,) = await _entries(db_session, subgroups, parent=external)
    assert await _proposed(db_session, entry[0], sub_value) == [C_STAT["apparent"]]


async def test_a_stranger_parent_is_refused_before_any_llm_call(db_session: AsyncSession) -> None:
    """BOLA on the walk: a parent instance from another project's coordinate
    is refused by the run-scoped getter — for a singleton child and a group
    child alike — before identification or extraction spends a call, and
    before any instance is written under it."""
    container = await _container(db_session)
    development, _k, _v = await _group(
        db_session,
        parent=container,
        cardinality="one",
        label="Model development",
    )
    validations, _k2, _v2 = await _group(db_session, parent=container, entry_label="validation")
    foreign_project, foreign_template, _ = await fresh_charms(db_session)
    stranger = await add_instance(
        db_session,
        project_id=foreign_project,
        template_id=foreign_template,
        entity_type_id=await first_entity_type_id(db_session, foreign_template),
    )
    run = await _run_in_extract(db_session)
    fake = _fake(["apparent"])

    for child in (development, validations):
        with pytest.raises(ValueError, match=f"Parent instance not found: {stranger}"):
            await _extract(
                db_session, fake, entity_type_id=child, parent_instance_id=stranger, run_id=run.id
            )

    assert fake.calls == [], "no identification or extraction call was spent"
    assert await _entries(db_session, validations, parent=stranger) == []


async def test_a_cycle_in_the_parent_graph_is_refused_not_walked_forever(
    db_session: AsyncSession,
) -> None:
    """Nothing in the schema stops an instance pointing at its own descendant:
    the walk refuses the cycle like a stranger, before any model call — never
    a RecursionError."""
    container = await _container(db_session)
    first = await _instance(db_session, container, "XGBoost")
    second = await _instance(db_session, container, "LightGBM", parent=first)
    await db_session.execute(
        text("UPDATE extraction_instances SET parent_instance_id = :p WHERE id = :id"),
        {"p": second, "id": first},
    )
    development, _k, _v = await _group(
        db_session, parent=container, cardinality="one", label="Model development"
    )
    run = await _run_in_extract(db_session)
    fake = _fake([])

    with pytest.raises(ValueError, match="Parent instance not found"):
        await _extract(
            db_session, fake, entity_type_id=development, parent_instance_id=first, run_id=run.id
        )
    assert fake.calls == []


async def test_a_keyless_repeating_group_is_refused_before_any_write_or_llm_call(
    db_session: AsyncSession,
) -> None:
    entity_type_id, _key_id, _value_id = await _group(db_session, with_key=False)
    run = await _run_in_extract(db_session)
    fake = _fake(["apparent"])

    with pytest.raises(MissingEntityKeyError) as excinfo:
        await _extract(db_session, fake, entity_type_id=entity_type_id, run_id=run.id)

    assert "'Numeric performance'" in str(excinfo.value)
    # The code the single-section job carries for this exact raise: the task
    # wraps whatever the service raises through ``classify_extraction_error``
    # (pinned by ``TestRunSectionExtractionTaskErrorCode``), so this is the
    # real-pipeline half of the section-path proof.
    assert classify_extraction_error(excinfo.value)[0] is ExtractionErrorCode.MISSING_ENTITY_KEY
    assert await _entries(db_session, entity_type_id) == []
    assert fake.calls == [], "no model call was spent"


async def test_the_key_is_read_from_the_pinned_snapshot_not_the_live_row(
    db_session: AsyncSession,
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

    await _extract(db_session, _fake(["external"]), entity_type_id=entity_type_id, run_id=run.id)

    assert [key for _, key in await _entries(db_session, entity_type_id)] == ["external"]


async def test_a_live_key_does_not_rescue_a_pinned_keyless_group(
    db_session: AsyncSession,
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

    with pytest.raises(MissingEntityKeyError):
        await _extract(
            db_session, _fake(["external"]), entity_type_id=entity_type_id, run_id=run.id
        )
    assert await _entries(db_session, entity_type_id) == []


# --------------------------------------------------------------------------
# The full-run sweep (top-level sections)
# --------------------------------------------------------------------------


async def test_the_full_run_sweep_fills_every_repeat_of_a_top_level_group(
    db_session: AsyncSession,
) -> None:
    """The sweep used to hand a repeating group ``instances[0]``."""
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

    result = await _extract(
        db_session,
        _fake(["apparent", "external"]),
        run_id=run.id,
        skip_fields_with_human_proposals=True,
    )

    entries = await _entries(db_session, entity_type_id)
    assert [key for _, key in entries] == ["apparent", "external"]
    assert result.total_suggestions_created == 4, "key + value, per entry"
    assert await _proposed(db_session, entries[1][0], value_id) == [C_STAT["external"]]


async def test_a_settled_field_is_skipped_on_its_own_entry_only(
    db_session: AsyncSession,
) -> None:
    """The skip set is per INSTANCE: a reviewer who settled ``c_statistic`` on
    the 'apparent' entry keeps that entry's field off the re-run, while the
    'external' entry is still asked."""
    from app.models.extraction_workflow import ExtractionReviewerDecisionType
    from app.services.extraction_review_service import ExtractionReviewService

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
    await _extract(db_session, _fake(["apparent", "external"]), run_id=run.id)
    apparent, _external = await _entries(db_session, entity_type_id)
    await ExtractionReviewService(db_session).record_decision(
        run_id=run.id,
        instance_id=apparent[0],
        field_id=value_id,
        reviewer_id=SEED.primary_profile,
        decision=ExtractionReviewerDecisionType.EDIT,
        value={"value": 0.5},
    )

    rerun = _fake(["apparent", "external"])
    await _extract(db_session, rerun, run_id=run.id, skip_fields_with_human_proposals=True)

    asked = {_KEY_LINE.search(c.user_prompt)["key"]: c.field_names for c in rerun.field_calls()}
    assert "c_statistic" not in asked.get("apparent", [])
    assert "c_statistic" in asked["external"]


# --------------------------------------------------------------------------
# The per-entry batch (child sections)
# --------------------------------------------------------------------------


async def test_the_per_model_batch_routes_a_nested_group_through_the_pipeline(
    db_session: AsyncSession,
) -> None:
    container = await _container(db_session)
    parent_a = await _instance(db_session, container, "XGBoost")
    child, key_id, value_id = await _group(db_session, parent=container)
    run = await _run_in_extract(db_session)
    await _pin_run_to_snapshot(
        db_session,
        run_id=run.id,
        template_id=SEED.primary_template,
        profile_id=SEED.primary_profile,
        schema={
            "entity_types": [
                _pinned_container(container),
                _pinned_group(child, key_id, value_id, key=True, parent=container),
            ]
        },
    )
    await db_session.refresh(run)
    fake = _fake(["internal", "external"])

    result = await _extract(db_session, fake, parent_instance_id=parent_a, run_id=run.id)

    entries = await _entries(db_session, child, parent=parent_a)
    assert [key for _, key in entries] == ["internal", "external"]
    assert result.total_suggestions_created == 4, "key + value, per entry"
    assert [b.splitlines()[-1] for b in _scopes(fake)] == ['- Within: model "XGBoost"'] * 2
    assert await _proposed(db_session, entries[0][0], value_id) == [C_STAT["internal"]]
