"""Scope fidelity for the export value map (§5).

A section the article's own study-type classification takes out of play used
to export as a BLANK cell while the run view showed a "Not applicable" badge.
This module stamps that label onto the resolved ``value_map`` ONCE, in
``resolve_layout``, before any sheet builder reads it — so the matrix, the
per-section tidy tables and the appraisal summary all inherit the correction
without receiving the template schema and without a signature change.

Lives beside ``extraction_snapshot_reader`` rather than in
``exports/extraction/`` on purpose: that package's ``__init__`` imports
``workbook``, which imports the export service, so a service-side import of
anything under it would close a cycle. Nothing here imports the service —
descriptor types are annotations only, and the mode arrives as a bool.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from app.models.extraction import ExtractionEntityRole
from app.services.derived_judgment_service import (
    out_of_scope_sections,
    scope_classifier_coordinate,
)
from app.services.value_semantics import ABSENT_REASON_LABELS, AbsentReason

if TYPE_CHECKING:  # pragma: no cover — annotations only, no runtime import
    from app.services.extraction_export_service import (
        ArticleDescriptor,
        ReviewerDescriptor,
        SectionDescriptor,
    )

#: What an out-of-scope cell prints. Taken from the shared marker labels, not
#: written by hand: the run view renders the same words for the same state,
#: and a copy change moves both at once.
NOT_APPLICABLE = ABSENT_REASON_LABELS[AbsentReason.NOT_APPLICABLE.value]


def article_values_by_coord(
    *,
    article: ArticleDescriptor,
    sections: tuple[SectionDescriptor, ...],
    value_map: dict[tuple[Any, ...], Any],
    is_all_users: bool,
) -> dict[tuple[str, str], Any]:
    """``(section.name, field.name) -> value`` for one article's own run.

    The projection the scope rules and the derived judgments are both resolved
    against. One helper, two callers, so the marking pass and the appraisal
    roll-up cannot disagree about which sections an article excludes.
    """
    run_id = article.run_id
    values_by_coord: dict[tuple[str, str], Any] = {}
    for section in sections:
        instance_ids = article.section_instances.get(section.entity_type_id, ())
        instance_id = instance_ids[0] if instance_ids else None
        for section_field in section.fields:
            key = (
                (run_id, instance_id, section_field.field_id, None)
                if is_all_users
                else (run_id, instance_id, section_field.field_id)
            )
            raw = value_map.get(key)
            if raw is not None:
                values_by_coord[(section.name, section_field.name)] = raw
    return values_by_coord


def reader_instance_ids(
    section: SectionDescriptor,
    article: ArticleDescriptor,
) -> tuple[UUID, ...]:
    """The instance ids the matrix and tidy builders read for this section.

    Role first, then cardinality — the same selection
    ``matrix._resolve_instance_id`` and ``_build_tidy_tables`` make. A model
    container has no own fields.
    """
    if section.role is ExtractionEntityRole.MODEL_CONTAINER:
        return ()
    if section.role is ExtractionEntityRole.MODEL_SECTION:
        return article.model_instances
    return article.section_instances.get(section.entity_type_id, ())


def mark_out_of_scope_values(
    *,
    template_schema: Any,
    sections: tuple[SectionDescriptor, ...],
    articles: tuple[ArticleDescriptor, ...],
    reviewers: tuple[ReviewerDescriptor, ...],
    value_map: dict[tuple[Any, ...], Any],
    is_all_users: bool,
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
    """
    # Every template without scope rules exits here, before any projection is
    # built — an extraction export does exactly the work it did before.
    classifier = scope_classifier_coordinate(template_schema)
    if classifier is None:
        return
    classifier_section = classifier[0]

    reviewer_slots: tuple[UUID | None, ...] = (
        (None, *(r.reviewer_id for r in reviewers)) if is_all_users else ()
    )

    for article in articles:
        run_id = article.run_id
        if run_id is None:
            continue
        out_of_scope = out_of_scope_sections(
            template_schema,
            article_values_by_coord(
                article=article,
                sections=sections,
                value_map=value_map,
                is_all_users=is_all_users,
            ),
        )
        if not out_of_scope:
            continue
        for section in sections:
            if section.name not in out_of_scope or section.name == classifier_section:
                continue
            for instance_id in reader_instance_ids(section, article):
                for section_field in section.fields:
                    field_id = section_field.field_id
                    if is_all_users:
                        for slot in reviewer_slots:
                            value_map[(run_id, instance_id, field_id, slot)] = NOT_APPLICABLE
                    else:
                        value_map[(run_id, instance_id, field_id)] = NOT_APPLICABLE


__all__ = [
    "NOT_APPLICABLE",
    "article_values_by_coord",
    "mark_out_of_scope_values",
    "reader_instance_ids",
]
