"""Article progress read model (spec R3): articles ordered by article_id, instances by id."""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel

ArticleProgressKind = Literal["extraction", "quality_assessment"]


class ArticleProgressInstanceRead(BaseModel):
    id: UUID
    entity_type_id: UUID


class ArticleProgressValueRead(BaseModel):
    instance_id: UUID
    field_id: UUID
    value: Any


class ArticleProgressItemRead(BaseModel):
    article_id: UUID
    instances: list[ArticleProgressInstanceRead]
    values: list[ArticleProgressValueRead]


class ArticleProgressRead(BaseModel):
    articles: list[ArticleProgressItemRead]
