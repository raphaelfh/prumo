"""
Read Models (CQRS).

DTOs otimizados for leitura with data desnormalizados.
Usados for queries complexas with JOINs.
"""

from app.schemas.read_models.article import ArticleDetailReadModel, ArticleListReadModel
from app.schemas.read_models.project import ProjectDetailReadModel, ProjectListReadModel

__all__ = [
    "ArticleListReadModel",
    "ArticleDetailReadModel",
    "ProjectListReadModel",
    "ProjectDetailReadModel",
]
