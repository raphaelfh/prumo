"""Scope fidelity for the export value map (§5).

A section the article's own study-type classification takes out of play used
to export as a BLANK cell while the run view showed a "Not applicable" badge.
This module stamps that state onto the typed ``value_map`` ONCE, in
``resolve_layout``, before any sheet builder reads it — so the matrix, the
per-section tidy tables and the appraisal summary all inherit the correction
without receiving the rules and without a signature change. The rules are
each article's own: those frozen in its run's pinned template version.

Lives beside ``extraction_snapshot_reader`` rather than in
``exports/extraction/`` on purpose: that package's ``__init__`` imports
``workbook``, which imports the export service, so a service-side import of
anything under it would close a cycle. Nothing here imports the service —
descriptor types are annotations only, and the slots arrive as raters.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any
from uuid import UUID

from app.models.extraction import ExtractionCardinality
from app.services.derived_judgment_service import (
    out_of_scope_sections,
    scope_classifier_coordinate,
)
from app.services.exports.descriptors import ValueKey, all_instances_of, root_instance, value_key
from app.services.exports.values import ExportValue
from app.services.value_semantics import ABSENT_REASON_LABELS, AbsentReason

if TYPE_CHECKING:  # pragma: no cover — annotations only, no runtime import
    from app.services.extraction_export_service import (
        ArticleDescriptor,
        SectionDescriptor,
    )

#: What an out-of-scope cell prints. Taken from the shared marker labels, not
#: written by hand: the run view renders the same words for the same state,
#: and a copy change moves both at once.
NOT_APPLICABLE = ABSENT_REASON_LABELS[AbsentReason.NOT_APPLICABLE.value]
_STAMP = ExportValue(raw=None, status="absent", absent_code="not_applicable", out_of_scope=True)


def article_values_by_coord(
    *,
    article: ArticleDescriptor,
    sections: tuple[SectionDescriptor, ...],
    value_map: dict[ValueKey, ExportValue],
    rater: UUID | None,
) -> dict[tuple[str, str], Any]:
    """``(section.name, field.name) -> stored value`` at ``rater``'s slot of one article's run.

    The projection the scope rules and the derived judgments are both resolved
    against. One helper, two callers, so the marking pass and the appraisal
    roll-up cannot disagree about which sections an article excludes.
    """
    run_id = article.run_id
    values_by_coord: dict[tuple[str, str], Any] = {}
    for section in sections:
        instance_id = root_instance(article, section.entity_type_id)
        if run_id is None or instance_id is None:
            continue
        for section_field in section.fields:
            v = value_map.get(value_key(run_id, instance_id, section_field.field_id, rater))
            if v is not None and v.raw is not None:
                values_by_coord[(section.name, section_field.name)] = v.raw
    return values_by_coord


def reader_instance_ids(
    section: SectionDescriptor,
    article: ArticleDescriptor,
) -> tuple[UUID, ...]:
    """The instance ids the matrix and tidy builders read for this section.

    Every instance of the section across its parents, which is what a
    records-as-rows sheet wants. A field-less repeating group contributes
    nothing: it is the axis, not a record.
    """
    if section.cardinality is ExtractionCardinality.MANY and not section.fields:
        return ()
    return all_instances_of(article, section.entity_type_id)


def mark_out_of_scope_values(
    *,
    rules_by_article: Mapping[UUID, Mapping[str, Any]],
    sections: tuple[SectionDescriptor, ...],
    articles: tuple[ArticleDescriptor, ...],
    raters: Sequence[UUID | None],
    value_map: dict[ValueKey, ExportValue],
) -> None:
    """Stamp "Not applicable" on the cells an article's own scope takes out of play.

    It WRITES the canonical reader keys rather than rewriting existing entries.
    The cells this exists to fix are the ones nobody ever answered — an excluded
    domain has no ``extraction_published_states`` row, so there is no entry to
    overwrite and a rewrite-only pass would leave the blank cell blank.

    **This cannot double-apply.** ``scope_filtered_values`` drops entries by
    SECTION NAME, never by value, so the derived overalls discard those
    coordinates whatever the map now holds for them. And the classifier's own
    section is never marked: ``_build_appraisal_model`` re-reads the map we just
    wrote, so a marked classifier would answer "Not applicable" to the question
    "which sections are out of scope?" and the exclusion would silently vanish
    from the appraisal while the matrix still showed it. A schema is not
    required to be sane about this; the skip makes it structural.

    *rules_by_article* maps ``article_id`` to the rules frozen in that
    article's pinned version; an article missing from it has no rules.
    *raters* lists the slots to stamp; the first classifies the article.
    """

    for article in articles:
        run_id = article.run_id
        if run_id is None:
            continue
        rules = rules_by_article.get(article.article_id, {})
        # A version without scope rules skips the article before any
        # projection is built — an extraction export does the work it did before.
        classifier = scope_classifier_coordinate(rules)
        if classifier is None:
            continue
        out_of_scope = out_of_scope_sections(
            rules,
            article_values_by_coord(
                article=article,
                sections=sections,
                value_map=value_map,
                rater=raters[0],
            ),
        )
        if not out_of_scope:
            continue
        for section in sections:
            if section.name not in out_of_scope or section.name == classifier[0]:
                continue
            for instance_id in reader_instance_ids(section, article):
                for section_field in section.fields:
                    for rater in raters:
                        key = value_key(run_id, instance_id, section_field.field_id, rater)
                        value_map[key] = _STAMP


__all__ = [
    "NOT_APPLICABLE",
    "article_values_by_coord",
    "mark_out_of_scope_values",
    "reader_instance_ids",
]
