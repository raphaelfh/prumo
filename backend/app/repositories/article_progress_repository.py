"""Set-based reads behind the article progress read (spec R8-R12); no statement binds a Python id list. list_caller_values
is ONE statement: current-decision states (LEFT JOIN accepted proposal) UNION ALL human proposals; instances filter project+template."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import String, and_, cast, literal_column, null, select, union_all
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.extraction import ExtractionInstance
from app.models.extraction_workflow import (
    ExtractionProposalRecord,
    ExtractionReviewerDecision,
    ExtractionReviewerState,
)


@dataclass(frozen=True)
class ProgressInstanceRow:
    id: UUID
    article_id: UUID
    entity_type_id: UUID


@dataclass(frozen=True)
class CallerValueRow:
    source: Literal["state", "proposal"]
    instance_id: UUID
    field_id: UUID
    decision: str | None
    value: Any
    proposed_value: Any
    created_at: datetime
    id: UUID


class ArticleProgressRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def list_instances(
        self, *, project_id: UUID, template_id: UUID
    ) -> list[ProgressInstanceRow]:
        inst = ExtractionInstance
        stmt = (
            select(inst.id, inst.article_id, inst.entity_type_id)
            .where(inst.project_id == project_id, inst.template_id == template_id)
            .where(inst.article_id.is_not(None))
            .order_by(inst.article_id, inst.id)
        )
        return [ProgressInstanceRow(*row) for row in (await self.db.execute(stmt)).all()]

    async def list_caller_values(
        self, *, project_id: UUID, template_id: UUID, user_id: UUID
    ) -> list[CallerValueRow]:
        inst, state, dec, prop = (
            ExtractionInstance,
            ExtractionReviewerState,
            ExtractionReviewerDecision,
            ExtractionProposalRecord,
        )
        accepted = aliased(ExtractionProposalRecord)
        states = (
            select(
                literal_column("'state'", String).label("source"),
                state.instance_id,
                state.field_id,
                cast(dec.decision, String).label("decision"),
                dec.value.label("value"),
                accepted.proposed_value.label("proposed_value"),
                dec.created_at,
                dec.id,
            )
            .select_from(state)
            .join(dec, and_(dec.id == state.current_decision_id, dec.run_id == state.run_id))
            .outerjoin(accepted, accepted.id == dec.proposal_record_id)
            .join(inst, inst.id == state.instance_id)
            .where(inst.project_id == project_id, inst.template_id == template_id)
            .where(state.reviewer_id == user_id)
        )
        proposals = (
            select(
                literal_column("'proposal'", String).label("source"),
                prop.instance_id,
                prop.field_id,
                cast(null(), String).label("decision"),
                prop.proposed_value.label("value"),
                cast(null(), JSONB).label("proposed_value"),
                prop.created_at,
                prop.id,
            )
            .select_from(prop)
            .join(inst, inst.id == prop.instance_id)
            .where(inst.project_id == project_id, inst.template_id == template_id)
            .where(prop.source == "human", prop.source_user_id == user_id)
        )
        values = union_all(states, proposals).subquery("caller_values")
        stmt = select(values).order_by(
            values.c.created_at.desc(), values.c.id.desc()
        )  # proposals newest first
        return [CallerValueRow(*row) for row in (await self.db.execute(stmt)).all()]
