"""
Optimized Queries.

Queries otimizadas para read models (CQRS).
"""

from app.repositories.queries.article_queries import ArticleQueries
from app.repositories.queries.project_queries import ProjectQueries

__all__ = [
    "ArticleQueries",
    "ProjectQueries",
]
