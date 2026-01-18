"""
Read Models (CQRS).

DTOs otimizados para leitura com dados desnormalizados.
Usados para queries complexas com JOINs.
"""

from app.schemas.read_models.article import ArticleDetailReadModel, ArticleListReadModel
from app.schemas.read_models.project import ProjectDetailReadModel, ProjectListReadModel

__all__ = [
    "ArticleListReadModel",
    "ArticleDetailReadModel",
    "ProjectListReadModel",
    "ProjectDetailReadModel",
]
