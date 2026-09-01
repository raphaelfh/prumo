"""Which fields the review workflow already references (B-9b2a D5).

Promoted here out of ``template_discard_service`` so its destructive-delete
gate and the config-diff read's ``affects_recorded_data`` flag cannot
diverge: they are the same question ("has a human or the AI recorded
anything for this field?") asked by two features, and a second copy of the
UNION is a second chance to answer it differently.

Plain ``self.db`` rather than ``BaseRepository[Model]``: this is a five-model
union with no single owning model (same shape as
``ExtractionProposalRepository``).
"""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import Select, or_, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionField, ExtractionInstance
from app.models.extraction_workflow import (
    ExtractionConsensusDecision,
    ExtractionProposalRecord,
    ExtractionPublishedState,
    ExtractionReviewerDecision,
    ExtractionReviewerState,
)

#: Tables whose ``field_id`` means "a human or the AI recorded something for
#: this field". Every one of them is an ON DELETE RESTRICT reference, which
#: is what lets a caller treat "absent from the live tree" as "provably holds
#: no recorded work" — the delete would have been refused otherwise.
_WORKFLOW_TABLES = (
    ExtractionProposalRecord,
    ExtractionReviewerDecision,
    ExtractionReviewerState,
    ExtractionConsensusDecision,
    ExtractionPublishedState,
)

#: The same references seen from the schema side: every RESTRICT FK that means
#: "recorded work" plus the ``extraction_instances`` one that guards a section.
#: Names are literals on purpose — they are frozen by shipped migrations, and
#: the services layer must not depend on migration internals to reconstruct
#: them. Callers use these to remap a 23503 they lost a race to.
RESTRICT_FKS = frozenset(
    {
        "extraction_instances_entity_type_id_fkey",
        "extraction_proposal_records_field_id_fkey",
        "extraction_reviewer_decisions_field_id_fkey",
        "extraction_reviewer_states_field_id_fkey",
        "extraction_consensus_decisions_field_id_fkey",
        "extraction_published_states_field_id_fkey",
    }
)


class ExtractionFieldReferenceRepository:
    """Read access across the five ``field_id`` RESTRICT tables."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def fields_with_recorded_work(self, field_ids: Sequence[UUID]) -> frozenset[UUID]:
        """Which of ``field_ids`` the review workflow already references."""
        if not field_ids:
            return frozenset()
        rows = await self.db.execute(
            union(
                *(
                    select(model.field_id).where(model.field_id.in_(field_ids))
                    for model in _WORKFLOW_TABLES
                )
            )
        )
        return frozenset(rows.scalars().all())

    async def sections_with_recorded_work(
        self, sections: Select[tuple[UUID]] | Sequence[UUID]
    ) -> frozenset[UUID]:
        """Which of ``sections`` the review workflow already references.

        The section-scoped sibling of :meth:`fields_with_recorded_work`, and
        here for the same reason: one UNION over the five tables, so a second
        feature asking "has anything been recorded here?" cannot answer it
        differently. Two callers need two shapes of the answer — Discard
        needs WHICH sections to keep, ``delete_section`` only whether the set
        is empty — and one predicate returning the set serves both.

        ``sections`` may be a SELECT of entity-type ids, so a caller whose
        subtree is itself a query pays no round trip for it.

        Matched on BOTH coordinates. ``instance_id`` is the normal path;
        ``field_id`` catches work recorded before the field was moved into
        this section, whose instance still points at where it used to live.

        Deliberately NOT "the section owns an ``extraction_instances`` row":
        ``HITLSessionService.open_or_resume`` seeds one EMPTY instance per
        top-level cardinality-one section the moment an article is opened, so
        instance ownership answers "was this template ever opened", not "was
        anything recorded". That distinction is the whole point of this
        method — both callers shipped the wrong one first.
        """
        if not isinstance(sections, Select) and not sections:
            return frozenset()
        # Correlated EXISTS, so each hit is attributed to ITS section; the
        # two legs are unioned rather than OR-ed because they start from
        # different tables.
        by_instance = select(ExtractionInstance.entity_type_id).where(
            ExtractionInstance.entity_type_id.in_(sections),
            or_(
                *(
                    select(model.id).where(model.instance_id == ExtractionInstance.id).exists()
                    for model in _WORKFLOW_TABLES
                )
            ),
        )
        by_field = select(ExtractionField.entity_type_id).where(
            ExtractionField.entity_type_id.in_(sections),
            or_(
                *(
                    select(model.id).where(model.field_id == ExtractionField.id).exists()
                    for model in _WORKFLOW_TABLES
                )
            ),
        )
        rows = await self.db.execute(union(by_instance, by_field))
        return frozenset(rows.scalars().all())
