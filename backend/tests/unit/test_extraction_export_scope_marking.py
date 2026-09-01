"""Scope fidelity on the export ``value_map`` (§5).

A section the article's own study-type classification takes out of play used
to export as a BLANK cell while the run view showed a "Not applicable" badge.
The marking happens once, on ``value_map``, after the map is built and before
the tidy / matrix / appraisal builders read it — so no sub-builder receives
the schema and no builder signature changes.

The cells that matter are the ones nobody ever answered: an excluded domain
has no ``extraction_published_states`` row, hence no ``value_map`` entry to
overwrite. The marking therefore WRITES the canonical reader keys rather than
rewriting existing ones.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionFieldType,
)
from app.services.exports.extraction_scope_marking import mark_out_of_scope_values
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportMode,
    ExtractionExportService,
    FieldDescriptor,
    ReviewerDescriptor,
    SectionDescriptor,
)

_NOT_APPLICABLE = "Not applicable"

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
        allowed_values=allowed,
        name=name,
    )


def _section(
    entity_type_id: UUID,
    name: str,
    fields: tuple[FieldDescriptor, ...],
    *,
    cardinality: ExtractionCardinality = ExtractionCardinality.ONE,
    role: ExtractionEntityRole = ExtractionEntityRole.STUDY_SECTION,
) -> SectionDescriptor:
    return SectionDescriptor(
        entity_type_id=entity_type_id,
        label=name.replace("_", " ").title(),
        role=role,
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
        header_label="Gaca, 2011",
        run_id=run_id,
        version_id=None,
        model_instances=(),
        section_instances={
            _SCOPE_SECTION: (scope_inst,),
            _DEV_SECTION: (dev_inst,),
            _EVAL_SECTION: eval_insts,
        },
    )


def _mark(
    value_map: dict[tuple[Any, ...], Any],
    *,
    articles: tuple[ArticleDescriptor, ...],
    mode: ExportMode = ExportMode.CONSENSUS,
    reviewers: tuple[ReviewerDescriptor, ...] = (),
    schema: Any = None,
    sections: tuple[SectionDescriptor, ...] | None = None,
) -> None:
    mark_out_of_scope_values(
        template_schema=_SCHEMA if schema is None else schema,
        sections=_sections() if sections is None else sections,
        articles=articles,
        reviewers=reviewers,
        value_map=value_map,
        is_all_users=mode is ExportMode.ALL_USERS,
    )


def test_marks_a_cell_that_was_never_answered() -> None:
    """The whole point: an excluded domain has NO published row to overwrite."""
    run, scope_i, dev_i, eval_i = uuid4(), uuid4(), uuid4(), uuid4()
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    value_map: dict[tuple[Any, ...], Any] = {
        (run, scope_i, _STUDY_TYPE): "development_only",
        (run, dev_i, _DEV_VERDICT): "Low",
    }

    _mark(value_map, articles=(article,))

    assert value_map[(run, eval_i, _EVAL_VERDICT)] == _NOT_APPLICABLE
    assert value_map[(run, eval_i, _EVAL_SIGNALLING)] == _NOT_APPLICABLE


def test_leaves_in_scope_sections_and_the_classifier_alone() -> None:
    run, scope_i, dev_i, eval_i = uuid4(), uuid4(), uuid4(), uuid4()
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    value_map: dict[tuple[Any, ...], Any] = {
        (run, scope_i, _STUDY_TYPE): "development_only",
        (run, dev_i, _DEV_VERDICT): "High",
    }

    _mark(value_map, articles=(article,))

    assert value_map[(run, scope_i, _STUDY_TYPE)] == "development_only"
    assert value_map[(run, dev_i, _DEV_VERDICT)] == "High"


def test_overwrites_a_value_recorded_before_the_reclassification() -> None:
    """Screen and workbook must agree; the run view already shows the badge."""
    run, scope_i, dev_i, eval_i = uuid4(), uuid4(), uuid4(), uuid4()
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    value_map: dict[tuple[Any, ...], Any] = {
        (run, scope_i, _STUDY_TYPE): "development_only",
        (run, eval_i, _EVAL_VERDICT): "High",
    }

    _mark(value_map, articles=(article,))

    assert value_map[(run, eval_i, _EVAL_VERDICT)] == _NOT_APPLICABLE


def test_all_users_marks_the_consensus_and_every_reviewer_sub_column() -> None:
    run, scope_i, dev_i, eval_i = uuid4(), uuid4(), uuid4(), uuid4()
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    r1, r2 = uuid4(), uuid4()
    reviewers = (
        ReviewerDescriptor(reviewer_id=r1, display_label="A"),
        ReviewerDescriptor(reviewer_id=r2, display_label="B"),
    )
    value_map: dict[tuple[Any, ...], Any] = {
        (run, scope_i, _STUDY_TYPE, None): "development_only",
    }

    _mark(value_map, articles=(article,), mode=ExportMode.ALL_USERS, reviewers=reviewers)

    for reviewer_slot in (None, r1, r2):
        assert value_map[(run, eval_i, _EVAL_VERDICT, reviewer_slot)] == _NOT_APPLICABLE


def test_all_users_classification_reads_the_consensus_sub_column() -> None:
    """A 3-tuple key must not be consulted in a 4-tuple world (or vice versa)."""
    run, scope_i, dev_i, eval_i = uuid4(), uuid4(), uuid4(), uuid4()
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    value_map: dict[tuple[Any, ...], Any] = {
        (run, scope_i, _STUDY_TYPE): "development_only",  # 3-tuple: wrong arity
    }

    _mark(value_map, articles=(article,), mode=ExportMode.ALL_USERS)

    assert (run, eval_i, _EVAL_VERDICT, None) not in value_map


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
    value_map: dict[tuple[Any, ...], Any] = {(run, scope_i, _STUDY_TYPE): "development_only"}

    _mark(value_map, articles=(article,), sections=sections)

    assert value_map[(run, eval_a, _EVAL_VERDICT)] == _NOT_APPLICABLE
    assert value_map[(run, eval_b, _EVAL_VERDICT)] == _NOT_APPLICABLE


def test_a_template_without_scope_rules_is_untouched() -> None:
    """The early exit that keeps every extraction export byte-identical."""
    run, scope_i, dev_i, eval_i = uuid4(), uuid4(), uuid4(), uuid4()
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    value_map: dict[tuple[Any, ...], Any] = {(run, scope_i, _STUDY_TYPE): "development_only"}
    before = dict(value_map)

    _mark(value_map, articles=(article,), schema={})

    assert value_map == before


def test_an_unclassified_article_is_untouched() -> None:
    """Failing open: an unclassified run assesses the whole instrument."""
    run, scope_i, dev_i, eval_i = uuid4(), uuid4(), uuid4(), uuid4()
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    value_map: dict[tuple[Any, ...], Any] = {(run, dev_i, _DEV_VERDICT): "Low"}
    before = dict(value_map)

    _mark(value_map, articles=(article,))

    assert value_map == before


def test_an_article_with_no_run_is_skipped() -> None:
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="No run",
        run_id=None,
        version_id=None,
        model_instances=(),
        section_instances={},
    )
    value_map: dict[tuple[Any, ...], Any] = {}

    _mark(value_map, articles=(article,))

    assert value_map == {}


def test_one_article_classification_never_marks_another() -> None:
    """The write keys carry the article's OWN run id."""
    run_a, run_b = uuid4(), uuid4()
    scope_a, dev_a, eval_a = uuid4(), uuid4(), uuid4()
    scope_b, dev_b, eval_b = uuid4(), uuid4(), uuid4()
    article_a = _article(run_a, scope_inst=scope_a, dev_inst=dev_a, eval_insts=(eval_a,))
    article_b = _article(run_b, scope_inst=scope_b, dev_inst=dev_b, eval_insts=(eval_b,))
    value_map: dict[tuple[Any, ...], Any] = {
        (run_a, scope_a, _STUDY_TYPE): "development_only",
        (run_b, scope_b, _STUDY_TYPE): "evaluation_only",
        (run_b, eval_b, _EVAL_VERDICT): "Low",
    }

    _mark(value_map, articles=(article_a, article_b))

    assert value_map[(run_a, eval_a, _EVAL_VERDICT)] == _NOT_APPLICABLE
    # B is evaluation_only — its eval domain stays in play, dev goes out.
    assert value_map[(run_b, eval_b, _EVAL_VERDICT)] == "Low"
    assert value_map[(run_b, dev_b, _DEV_VERDICT)] == _NOT_APPLICABLE


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
    value_map: dict[tuple[Any, ...], Any] = {(run, scope_i, _STUDY_TYPE): "development_only"}

    _mark(value_map, articles=(article,), schema=schema)

    assert value_map[(run, scope_i, _STUDY_TYPE)] == "development_only"
    assert value_map[(run, eval_i, _EVAL_VERDICT)] == _NOT_APPLICABLE


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
    value_map: dict[tuple[Any, ...], Any],
    article: ArticleDescriptor,
) -> tuple[str | None, ...]:
    model = ExtractionExportService._build_appraisal_model(
        sections=_derived_sections(),
        articles=(article,),
        reviewers=(),
        value_map=value_map,
        mode=ExportMode.CONSENSUS,
        template_schema=_DERIVED_SCHEMA,
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
    unmarked: dict[tuple[Any, ...], Any] = {
        (run, scope_i, _STUDY_TYPE): "development_only",
        (run, dev_i, _DEV_VERDICT): "Low",
        (run, eval_i, _EVAL_VERDICT): "High",  # poison: out of scope
    }
    before = _derived_values(unmarked, article)

    marked = dict(unmarked)
    _mark(marked, articles=(article,), schema=_DERIVED_SCHEMA, sections=_derived_sections())
    after = _derived_values(marked, article)

    assert marked[(run, eval_i, _EVAL_VERDICT)] == _NOT_APPLICABLE  # marking DID run
    assert after == before
    # Non-vacuous: the in-scope overall really computes, and the out-of-scope
    # one really reports inapplicable — the poison "High" never counts either way.
    assert before == ("Low", _NOT_APPLICABLE)
