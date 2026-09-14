"""The caller's article progress per template (spec R7-R12). Per (instance_id, field_id): the current decision wins when
resolve_reviewer_value resolves it, else the newest non-empty human proposal; an absent_reason marker is filled (§IX)."""

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.article_progress_repository import ArticleProgressRepository
from app.schemas.article_progress import (
    ArticleProgressInstanceRead,
    ArticleProgressItemRead,
    ArticleProgressKind,
    ArticleProgressRead,
    ArticleProgressValueRead,
)
from app.services.project_template_active_service import owned_template
from app.services.value_semantics import is_value_empty, resolve_reviewer_value


async def get_article_progress(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    user_id: UUID,
    kind: ArticleProgressKind,
) -> ArticleProgressRead:
    await owned_template(db, project_id=project_id, template_id=template_id, kind=kind)
    repo = ArticleProgressRepository(db)
    instances = await repo.list_instances(project_id=project_id, template_id=template_id)
    if not instances:
        return ArticleProgressRead(articles=[])
    items: dict[UUID, ArticleProgressItemRead] = {}  # insertion order = article_id order
    article_of: dict[UUID, UUID] = {}
    for inst in instances:
        if inst.article_id not in items:
            items[inst.article_id] = ArticleProgressItemRead(
                article_id=inst.article_id, instances=[], values=[]
            )
        items[inst.article_id].instances.append(
            ArticleProgressInstanceRead(id=inst.id, entity_type_id=inst.entity_type_id)
        )
        article_of[inst.id] = inst.article_id
    rows = await repo.list_caller_values(
        project_id=project_id, template_id=template_id, user_id=user_id
    )
    winners: dict[tuple[UUID, UUID], Any] = {}
    for row in rows:  # pass 1: the caller's current decisions
        if row.source == "state" and row.decision is not None:
            resolved = resolve_reviewer_value(row.decision, row.value, row.proposed_value)
            if resolved is not None:
                winners.setdefault((row.instance_id, row.field_id), resolved)
    for row in rows:  # pass 2: human proposals, newest first (statement order)
        if row.source == "proposal" and not is_value_empty(row.value):
            winners.setdefault((row.instance_id, row.field_id), row.value)
    for (instance_id, field_id), value in winners.items():
        article_id = article_of.get(instance_id)  # None for an article-less instance
        if article_id is not None:
            items[article_id].values.append(
                ArticleProgressValueRead(instance_id=instance_id, field_id=field_id, value=value)
            )
    return ArticleProgressRead(articles=list(items.values()))
