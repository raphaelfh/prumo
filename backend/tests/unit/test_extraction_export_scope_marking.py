"""Scope fidelity on the export ``value_map`` (§5).

A section the article's own study-type classification takes out of play used
to export as a BLANK cell while the run view showed a "Not applicable" badge.
The marking happens once, on ``value_map``, after the map is built and before
the level / matrix / appraisal builders read it — so no sub-builder receives
the schema and no builder signature changes.

The cells that matter are the ones nobody ever answered: an excluded domain
has no ``extraction_published_states`` row, hence no ``value_map`` entry to
mark. The marking therefore WRITES the canonical reader keys; a recorded answer
is kept and flagged out_of_scope, never replaced.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionFieldType,
)
from app.services.exports.descriptors import ValueKey, value_key
from app.services.exports.extraction_scope_marking import (
    mark_out_of_scope_values,
    reader_instance_ids,
)
from app.services.exports.extraction_snapshot_reader import AllowedValue
from app.services.exports.values import ExportValue, to_export_value
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportMode,
    ExtractionExportService,
    FieldDescriptor,
    SectionDescriptor,
)

_NOT_APPLICABLE = "Not applicable"
_ANY_SELECT = FieldDescriptor(
    field_id=uuid4(), label="Any", type=ExtractionFieldType.SELECT, allowed_values=()
)


def _v(code: str) -> ExportValue:
    return to_export_value({"value": code}, _ANY_SELECT, {})


def _stamped(v: ExportValue) -> bool:
    return v.out_of_scope and v.absent_code == "not_applicable"


_SCOPE_SECTION = UUID("aaaaaaaa-0000-0000-0000-000000000001")
_DEV_SECTION = UUID("aaaaaaaa-0000-0000-0000-000000000002")
_EVAL_SECTION = UUID("aaaaaaaa-0000-0000-0000-000000000003")

_STUDY_TYPE = UUID("bbbbbbbb-0000-0000-0000-000000000001")
_DEV_VERDICT = UUID("bbbbbbbb-0000-0000-0000-000000000002")
_EVAL_VERDICT = UUID("bbbbbbbb-0000-0000-0000-000000000003")
_EVAL_SIGNALLING = UUID("bbbbbbbb-0000-0000-0000-000000000004")

_SCHEMA: dict[str, Any] = {
    "scope_rules": {
        "classifier": {"section": "scope", "field": "study_type"},
        "excludes": {
            "development_only": ["eval_d1"],
            "evaluation_only": ["dev_d1"],
        },
    }
}


def _field(
    field_id: UUID,
    name: str,
    allowed: tuple[str, ...] = ("Low", "High"),
) -> FieldDescriptor:
    return FieldDescriptor(
        field_id=field_id,
        label=name.replace("_", " ").title(),
        type=ExtractionFieldType.SELECT,
        allowed_values=tuple(AllowedValue(x, x) for x in allowed),
        name=name,
    )


def _section(
    entity_type_id: UUID,
    name: str,
    fields: tuple[FieldDescriptor, ...],
    *,
    cardinality: ExtractionCardinality = ExtractionCardinality.ONE,
) -> SectionDescriptor:
    return SectionDescriptor(
        entity_type_id=entity_type_id,
        label=name.replace("_", " ").title(),
        parent_entity_type_id=None,
        fields=fields,
        cardinality=cardinality,
        name=name,
    )


def _sections() -> tuple[SectionDescriptor, ...]:
    return (
        _section(_SCOPE_SECTION, "scope", (_field(_STUDY_TYPE, "study_type"),)),
        _section(_DEV_SECTION, "dev_d1", (_field(_DEV_VERDICT, "risk_of_bias"),)),
        _section(
            _EVAL_SECTION,
            "eval_d1",
            (
                _field(_EVAL_VERDICT, "risk_of_bias"),
                _field(_EVAL_SIGNALLING, "signalling_1"),
            ),
        ),
    )


def _article(
    run_id: UUID,
    *,
    scope_inst: UUID,
    dev_inst: UUID,
    eval_insts: tuple[UUID, ...],
) -> ArticleDescriptor:
    return ArticleDescriptor(
        article_id=uuid4(),
        article_label="Gaca, 2011",
        run_id=run_id,
        version_id=None,
        entries={
            (_SCOPE_SECTION, None): (scope_inst,),
            (_DEV_SECTION, None): (dev_inst,),
            (_EVAL_SECTION, None): eval_insts,
        },
    )


def _mark(
    value_map: dict[ValueKey, ExportValue],
    *,
    articles: tuple[ArticleDescriptor, ...],
    raters: tuple[UUID | None, ...] = (None,),
    schema: Any = None,
    sections: tuple[SectionDescriptor, ...] | None = None,
) -> None:
    mark_out_of_scope_values(
        rules_by_article={a.article_id: _SCHEMA if schema is None else schema for a in articles},
        sections=_sections() if sections is None else sections,
        articles=articles,
        raters=raters,
        value_map=value_map,
    )


def test_marks_a_cell_that_was_never_answered() -> None:
    """The whole point: an excluded domain has NO published row to overwrite."""
    run, scope_i, dev_i, eval_i = uuid4(), uuid4(), uuid4(), uuid4()
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    value_map: dict[ValueKey, ExportValue] = {
        value_key(run, scope_i, _STUDY_TYPE): _v("development_only"),
        value_key(run, dev_i, _DEV_VERDICT): _v("Low"),
    }

    _mark(value_map, articles=(article,))

    assert _stamped(value_map[value_key(run, eval_i, _EVAL_VERDICT)])
    assert _stamped(value_map[value_key(run, eval_i, _EVAL_SIGNALLING)])


def test_leaves_in_scope_sections_and_the_classifier_alone() -> None:
    run, scope_i, dev_i, eval_i = uuid4(), uuid4(), uuid4(), uuid4()
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    value_map: dict[ValueKey, ExportValue] = {
        value_key(run, scope_i, _STUDY_TYPE): _v("development_only"),
        value_key(run, dev_i, _DEV_VERDICT): _v("High"),
    }

    _mark(value_map, articles=(article,))

    assert value_map[value_key(run, scope_i, _STUDY_TYPE)].value_text == "development_only"
    assert value_map[value_key(run, dev_i, _DEV_VERDICT)].value_text == "High"


def _answered(code: str) -> ExportValue:
    return ExportValue(raw={"value": code}, status="answered", value_text=code)


def test_keeps_a_recorded_answer_and_stamps_only_the_empty_cell() -> None:
    run, scope_i, dev_i, eval_i = uuid4(), uuid4(), uuid4(), uuid4()
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    recorded = _answered("High")
    value_map = {
        value_key(run, scope_i, _STUDY_TYPE): _answered("development_only"),
        value_key(run, eval_i, _EVAL_VERDICT): recorded,
    }

    _mark(value_map, articles=(article,))

    assert value_map[value_key(run, eval_i, _EVAL_VERDICT)] == replace(recorded, out_of_scope=True)
    stamp = value_map[value_key(run, eval_i, _EVAL_SIGNALLING)]
    assert (stamp.raw, stamp.status, stamp.absent_code, stamp.out_of_scope) == (
        None,
        "absent",
        "not_applicable",
        True,
    )


def test_a_cleared_value_is_recorded_not_empty() -> None:
    run, scope_i, dev_i, eval_i = uuid4(), uuid4(), uuid4(), uuid4()
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    cleared = ExportValue(raw={"value": None}, status="cleared")
    value_map = {
        value_key(run, scope_i, _STUDY_TYPE): _answered("development_only"),
        value_key(run, eval_i, _EVAL_VERDICT): cleared,
    }

    _mark(value_map, articles=(article,))

    assert value_map[value_key(run, eval_i, _EVAL_VERDICT)] == replace(cleared, out_of_scope=True)


def test_each_rater_slot_is_scoped_by_its_own_classifier_answer() -> None:
    run, scope_i, dev_i, eval_i, r1, r2 = (uuid4() for _ in range(6))
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    value_map = {
        value_key(run, scope_i, _STUDY_TYPE, r1): _answered("development_only"),
        value_key(run, scope_i, _STUDY_TYPE, r2): _answered("evaluation_only"),
    }

    _mark(value_map, articles=(article,), raters=(None, r1, r2))

    assert value_map[value_key(run, eval_i, _EVAL_VERDICT, r1)].out_of_scope
    assert value_key(run, dev_i, _DEV_VERDICT, r1) not in value_map
    assert value_map[value_key(run, dev_i, _DEV_VERDICT, r2)].out_of_scope
    assert value_key(run, eval_i, _EVAL_VERDICT, r2) not in value_map
    assert not any(k[3] is None and k[1] in (dev_i, eval_i) for k in value_map)


def test_single_user_slot_is_stamped_under_the_reviewer_key() -> None:
    run, scope_i, dev_i, eval_i, r = (uuid4() for _ in range(5))
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    value_map = {value_key(run, scope_i, _STUDY_TYPE, r): _answered("development_only")}

    _mark(value_map, articles=(article,), raters=(r,))

    assert value_map[value_key(run, eval_i, _EVAL_VERDICT, r)].out_of_scope
    assert not any(k[3] is None for k in value_map)


def test_a_reviewer_slot_never_marks_its_classifier_section() -> None:
    run, scope_i, dev_i, eval_i, r1 = (uuid4() for _ in range(5))
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    schema = {
        "scope_rules": {
            "classifier": {"section": "scope", "field": "study_type"},
            "excludes": {"development_only": ["eval_d1", "scope"]},
        }
    }
    answer = _answered("development_only")
    value_map = {value_key(run, scope_i, _STUDY_TYPE, r1): answer}

    _mark(value_map, articles=(article,), raters=(None, r1), schema=schema)

    assert value_map[value_key(run, scope_i, _STUDY_TYPE, r1)] == answer
    assert value_map[value_key(run, eval_i, _EVAL_VERDICT, r1)].out_of_scope


def test_marks_every_instance_of_a_many_cardinality_section() -> None:
    run, scope_i, dev_i = uuid4(), uuid4(), uuid4()
    eval_a, eval_b = uuid4(), uuid4()
    sections = (
        _section(_SCOPE_SECTION, "scope", (_field(_STUDY_TYPE, "study_type"),)),
        _section(_DEV_SECTION, "dev_d1", (_field(_DEV_VERDICT, "risk_of_bias"),)),
        _section(
            _EVAL_SECTION,
            "eval_d1",
            (_field(_EVAL_VERDICT, "risk_of_bias"),),
            cardinality=ExtractionCardinality.MANY,
        ),
    )
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_a, eval_b))
    value_map: dict[ValueKey, ExportValue] = {
        value_key(run, scope_i, _STUDY_TYPE): _v("development_only")
    }

    _mark(value_map, articles=(article,), sections=sections)

    assert _stamped(value_map[value_key(run, eval_a, _EVAL_VERDICT)])
    assert _stamped(value_map[value_key(run, eval_b, _EVAL_VERDICT)])


def test_a_template_without_scope_rules_is_untouched() -> None:
    """The early exit that keeps every extraction export byte-identical."""
    run, scope_i, dev_i, eval_i = uuid4(), uuid4(), uuid4(), uuid4()
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    value_map: dict[ValueKey, ExportValue] = {
        value_key(run, scope_i, _STUDY_TYPE): _v("development_only")
    }
    before = dict(value_map)

    _mark(value_map, articles=(article,), schema={})

    assert value_map == before


def test_each_article_is_marked_by_its_own_rules() -> None:
    """Articles pinned to different versions: only the one whose rules exclude
    the section is marked; an article absent from the map has no rules."""
    run_a, run_b, scope_a, scope_b, dev_i, eval_a, eval_b = (uuid4() for _ in range(7))
    article_a = _article(run_a, scope_inst=scope_a, dev_inst=dev_i, eval_insts=(eval_a,))
    article_b = _article(run_b, scope_inst=scope_b, dev_inst=dev_i, eval_insts=(eval_b,))
    value_map: dict[ValueKey, ExportValue] = {
        value_key(run_a, scope_a, _STUDY_TYPE): _v("development_only"),
        value_key(run_b, scope_b, _STUDY_TYPE): _v("development_only"),
    }

    mark_out_of_scope_values(
        rules_by_article={article_a.article_id: _SCHEMA},
        sections=_sections(),
        articles=(article_a, article_b),
        raters=(None,),
        value_map=value_map,
    )

    assert _stamped(value_map[value_key(run_a, eval_a, _EVAL_VERDICT)])
    assert value_key(run_b, eval_b, _EVAL_VERDICT) not in value_map


def test_an_unclassified_article_is_untouched() -> None:
    """Failing open: an unclassified run assesses the whole instrument."""
    run, scope_i, dev_i, eval_i = uuid4(), uuid4(), uuid4(), uuid4()
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    value_map: dict[ValueKey, ExportValue] = {value_key(run, dev_i, _DEV_VERDICT): _v("Low")}
    before = dict(value_map)

    _mark(value_map, articles=(article,))

    assert value_map == before


def test_an_article_with_no_run_is_skipped() -> None:
    article = ArticleDescriptor(
        article_id=uuid4(),
        article_label="No run",
        run_id=None,
        version_id=None,
        entries={},
    )
    value_map: dict[ValueKey, ExportValue] = {}

    _mark(value_map, articles=(article,))

    assert value_map == {}


def test_one_article_classification_never_marks_another() -> None:
    """The write keys carry the article's OWN run id."""
    run_a, run_b = uuid4(), uuid4()
    scope_a, dev_a, eval_a = uuid4(), uuid4(), uuid4()
    scope_b, dev_b, eval_b = uuid4(), uuid4(), uuid4()
    article_a = _article(run_a, scope_inst=scope_a, dev_inst=dev_a, eval_insts=(eval_a,))
    article_b = _article(run_b, scope_inst=scope_b, dev_inst=dev_b, eval_insts=(eval_b,))
    value_map: dict[ValueKey, ExportValue] = {
        value_key(run_a, scope_a, _STUDY_TYPE): _v("development_only"),
        value_key(run_b, scope_b, _STUDY_TYPE): _v("evaluation_only"),
        value_key(run_b, eval_b, _EVAL_VERDICT): _v("Low"),
    }

    _mark(value_map, articles=(article_a, article_b))

    assert _stamped(value_map[value_key(run_a, eval_a, _EVAL_VERDICT)])
    # B is evaluation_only — its eval domain stays in play, dev goes out.
    assert value_map[value_key(run_b, eval_b, _EVAL_VERDICT)].value_text == "Low"
    assert _stamped(value_map[value_key(run_b, dev_b, _DEV_VERDICT)])


def test_the_classifier_own_section_is_never_marked() -> None:
    """A schema that excludes its own classifier must not erase the answer.

    ``_build_appraisal_model`` re-reads the map this pass writes; a marked
    classifier would answer "Not applicable" to "which sections are out of
    scope?" and the exclusion would vanish from the appraisal while the matrix
    still showed it.
    """
    run, scope_i, dev_i, eval_i = uuid4(), uuid4(), uuid4(), uuid4()
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    schema = {
        "scope_rules": {
            "classifier": {"section": "scope", "field": "study_type"},
            "excludes": {"development_only": ["eval_d1", "scope"]},
        }
    }
    value_map: dict[ValueKey, ExportValue] = {
        value_key(run, scope_i, _STUDY_TYPE): _v("development_only")
    }

    _mark(value_map, articles=(article,), schema=schema)

    assert value_map[value_key(run, scope_i, _STUDY_TYPE)].value_text == "development_only"
    assert _stamped(value_map[value_key(run, eval_i, _EVAL_VERDICT)])


# ---------------------------------------------------------------------------
# The derived column is unchanged by the marking — a differential, not a
# hardcoded literal: the same spec is computed against the map BEFORE and
# AFTER, so the assertion cannot pass by agreeing with a stale expectation.
# ---------------------------------------------------------------------------


_DERIVED_SCHEMA: dict[str, Any] = {
    "scope_rules": {
        "classifier": {"section": "scope", "field": "study_type"},
        "excludes": {"development_only": ["eval_d1"]},
    },
    # One overall per group, the way PROBAST+AI declares them: an out-of-scope
    # group must not gate the other group's overall to None.
    "derived_judgments": [
        {
            "id": "overall_dev",
            "label": "Development overall",
            "rule": "worst_domain",
            "inputs": [{"section": "dev_d1", "field": "risk_of_bias"}],
        },
        {
            "id": "overall_eval",
            "label": "Evaluation overall",
            "rule": "worst_domain",
            "inputs": [{"section": "eval_d1", "field": "risk_of_bias"}],
        },
    ],
}


def _derived_sections() -> tuple[SectionDescriptor, ...]:
    """Same shape as ``_sections`` but the classifier is not a risk verdict."""
    return (
        _section(
            _SCOPE_SECTION,
            "scope",
            (_field(_STUDY_TYPE, "study_type", allowed=("development_only", "both")),),
        ),
        _section(_DEV_SECTION, "dev_d1", (_field(_DEV_VERDICT, "risk_of_bias"),)),
        _section(_EVAL_SECTION, "eval_d1", (_field(_EVAL_VERDICT, "risk_of_bias"),)),
    )


def _derived_values(
    value_map: dict[ValueKey, ExportValue],
    article: ArticleDescriptor,
) -> tuple[str | None, ...]:
    model = ExtractionExportService._build_appraisal_model(
        sections=_derived_sections(),
        articles=(article,),
        reviewers=(),
        value_map=value_map,
        mode=ExportMode.CONSENSUS,
        reviewer_id=None,
        rules_by_article={article.article_id: _DERIVED_SCHEMA},
    )
    assert model is not None
    return model.rows[0].derived_values


def test_marking_does_not_change_the_derived_overall() -> None:
    """``scope_filtered_values`` drops by SECTION NAME, never by value.

    The excluded domain carries a POISON value ("High"): were the marking to
    leak into the derivation, the overall would move off "Low" — a blank and
    "Not applicable" both rank -1, so an unanswered domain would make this
    assertion vacuous.
    """
    run, scope_i, dev_i, eval_i = uuid4(), uuid4(), uuid4(), uuid4()
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    unmarked: dict[ValueKey, ExportValue] = {
        value_key(run, scope_i, _STUDY_TYPE): _v("development_only"),
        value_key(run, dev_i, _DEV_VERDICT): _v("Low"),
        value_key(run, eval_i, _EVAL_VERDICT): _v("High"),  # poison: out of scope
    }
    before = _derived_values(unmarked, article)

    marked = dict(unmarked)
    _mark(marked, articles=(article,), schema=_DERIVED_SCHEMA, sections=_derived_sections())
    after = _derived_values(marked, article)

    poison = marked[value_key(run, eval_i, _EVAL_VERDICT)]
    assert poison.out_of_scope and poison.value_text == "High"  # marking DID run, value kept
    assert after == before
    # Non-vacuous: the in-scope overall really computes, and the out-of-scope
    # one really reports inapplicable — the poison "High" never counts either way.
    assert before == ("Low", _NOT_APPLICABLE)


class _Stop(Exception):
    """Aborts resolve_layout right after the scope-marking call."""


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("mode", "expected_primary"),
    [(ExportMode.SINGLE_USER, "reviewer"), (ExportMode.CONSENSUS, None)],
    ids=["single_user_marks_the_reviewer_slot", "consensus_marks_slot_none"],
)
async def test_resolve_layout_marks_the_primary_rater_slot(monkeypatch, mode, expected_primary):
    """resolve_layout hands scope marking the slot readers will read: the
    reviewer in single_user, consensus (None) otherwise."""
    from app.services import extraction_export_service as svc

    reviewer = uuid4()
    seen: dict[str, Any] = {}

    def _spy(**kwargs: Any) -> None:
        seen["raters"] = kwargs["raters"]
        raise _Stop

    monkeypatch.setattr(svc, "mark_out_of_scope_values", _spy)
    monkeypatch.setattr(svc, "pinned_template_rules", AsyncMock(return_value={}))
    service = ExtractionExportService(db=MagicMock(), user_id="u")
    monkeypatch.setattr(
        service, "_load_active_template_version", AsyncMock(return_value=(MagicMock(), MagicMock()))
    )
    monkeypatch.setattr(service, "_resolve_project_name", AsyncMock(return_value="P"))
    monkeypatch.setattr(service, "_load_sections", AsyncMock(return_value=()))
    monkeypatch.setattr(service, "_load_article_refs", AsyncMock(return_value={}))
    monkeypatch.setattr(
        service, "_resolve_articles_for_single_user", AsyncMock(return_value=((), {}))
    )
    monkeypatch.setattr(
        service, "_resolve_articles_for_consensus", AsyncMock(return_value=((), {}))
    )
    monkeypatch.setattr(service, "_build_single_user_value_map", AsyncMock(return_value={}))
    monkeypatch.setattr(service, "_build_consensus_value_map", AsyncMock(return_value={}))

    with pytest.raises(_Stop):
        await service.resolve_layout(
            project_id=uuid4(),
            template_id=uuid4(),
            mode=mode,
            article_ids=[],
            include_ai_metadata=False,
            anonymize_reviewer_names=False,
            reviewer_id=reviewer,
        )

    assert seen["raters"] == ((reviewer if expected_primary == "reviewer" else None),)


def test_reader_instance_ids_follows_the_walk() -> None:
    many = ExtractionCardinality.MANY
    g = _section(uuid4(), "groups", (), cardinality=many)  # fieldless MANY, owns items
    items = replace(
        _section(uuid4(), "items", (_field(uuid4(), "x"),), cardinality=many),
        parent_entity_type_id=g.entity_type_id,
    )
    empty = _section(uuid4(), "empty", (), cardinality=many)  # fieldless subtree
    e1, p1, p2, x1 = uuid4(), uuid4(), uuid4(), uuid4()
    art = ArticleDescriptor(
        article_id=uuid4(),
        article_label="A",
        run_id=uuid4(),
        version_id=None,
        entries={
            (g.entity_type_id, None): (e1,),
            (items.entity_type_id, e1): (p1, p2),
            (empty.entity_type_id, None): (x1,),
        },
    )
    secs = (g, items, empty)
    assert reader_instance_ids(g, art, secs) == (e1,)
    assert reader_instance_ids(items, art, secs) == (p1, p2)
    assert reader_instance_ids(empty, art, secs) == ()
