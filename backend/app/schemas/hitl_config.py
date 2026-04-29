"""Schemas for HITL config CRUD endpoints.

These power the Project Settings → Review consensus UI. The same
schemas serve both project-scoped and template-scoped configs; the URL
path determines the scope, the body never names it.
"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

ConsensusRuleLiteral = Literal["unanimous", "majority", "arbitrator"]
HitlScopeLiteral = Literal["project", "template", "system_default"]


class HitlConfigPayload(BaseModel):
    """Editable fields for an HITL config.

    The ``arbitrator_id`` is required when ``consensus_rule == 'arbitrator'``;
    the database also enforces this via a check constraint, but we surface
    the rule here so 422 messages are friendly.
    """

    reviewer_count: int = Field(..., ge=1, le=20)
    consensus_rule: ConsensusRuleLiteral
    arbitrator_id: UUID | None = None

    @model_validator(mode="after")
    def _arbitrator_required_when_rule_is_arbitrator(self) -> "HitlConfigPayload":
        if self.consensus_rule == "arbitrator" and self.arbitrator_id is None:
            raise ValueError(
                "arbitrator_id is required when consensus_rule is 'arbitrator'"
            )
        return self


class HitlConfigRead(BaseModel):
    """Resolved view of an HITL config with provenance.

    ``scope_kind`` reports where the value came from:

    * ``project`` — explicit project-scoped row
    * ``template`` — explicit template-scoped row
    * ``system_default`` — no row exists; values come from
      :data:`SYSTEM_DEFAULT_HITL_CONFIG` (1 reviewer, unanimous)

    ``inherited`` is true when the resolved config came from a broader
    scope than the one being queried (e.g. asking for a template's
    config and getting back the project default).
    """

    scope_kind: HitlScopeLiteral
    scope_id: UUID | None = None
    reviewer_count: int
    consensus_rule: ConsensusRuleLiteral
    arbitrator_id: UUID | None = None
    inherited: bool


class HitlConfigUpdateResponse(BaseModel):
    """Response for upsert/delete operations."""

    config: HitlConfigRead
