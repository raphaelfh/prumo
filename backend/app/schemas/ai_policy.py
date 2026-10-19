"""Schemas for the per-project AI agents policy (``projects.settings['ai_policy']``)."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.extraction_batch import MAX_ARTICLES_PER_BATCH

AgentRuns = Literal["off", "managers", "reviewers"]
DAILY_AGENT_ARTICLE_CAP_MAX = 1000

_AGENT_RUNS = (
    "Who may start AI extraction runs through a connected agent: nobody (off), "
    "managers only, or reviewers and managers."
)
_MAX_PER_RUN = "Most articles one agent-started run may cover."
_DAILY_CAP = "Most articles agent-started runs may cover in this project per day."


class AiPolicyStored(BaseModel):
    """The stored AI agents policy; an unset or unreadable value reads as these defaults."""

    agent_runs: AgentRuns = Field(default="off", description=_AGENT_RUNS)
    max_articles_per_run: int = Field(
        default=25, ge=1, le=MAX_ARTICLES_PER_BATCH, description=_MAX_PER_RUN
    )
    daily_agent_article_cap: int = Field(
        default=100, ge=1, le=DAILY_AGENT_ARTICLE_CAP_MAX, description=_DAILY_CAP
    )
    updated_by: UUID | None = Field(
        default=None, description="Manager who last changed the policy."
    )
    updated_at: datetime | None = Field(default=None, description="When the policy last changed.")


class AiPolicyRead(AiPolicyStored):
    """The project's AI agents policy, as any member sees it."""


class AiPolicyUpdateRequest(BaseModel):
    """A manager's full replacement of the project's AI agents policy."""

    model_config = ConfigDict(extra="forbid")

    agent_runs: AgentRuns = Field(description=_AGENT_RUNS)
    max_articles_per_run: int = Field(ge=1, le=MAX_ARTICLES_PER_BATCH, description=_MAX_PER_RUN)
    daily_agent_article_cap: int = Field(
        ge=1, le=DAILY_AGENT_ARTICLE_CAP_MAX, description=_DAILY_CAP
    )
