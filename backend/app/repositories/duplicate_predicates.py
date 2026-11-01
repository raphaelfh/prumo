"""THE removal predicate (spec §8.3), in its own module so that both
``duplicate_repository`` and ``screening_repository`` import it without a cycle.

Imports models only; never import a repository here.
"""

from __future__ import annotations

from sqlalchemy import ColumnElement, and_, exists, or_, tuple_
from sqlalchemy.orm import aliased
from sqlalchemy.orm.util import AliasedClass

from app.models.article import Article
from app.models.article_duplicate import ArticleDuplicateVerdict


def removed_duplicate(article: type[Article] | AliasedClass[Article]) -> ColumnElement[bool]:
    """The article is the removed side of its pair's latest verdict, in its current project.

    EXISTS a ``duplicate`` row with ``article_id = article.id`` and
    ``project_id = article.project_id`` that no later row of the same unordered
    pair (same project) supersedes, whose kept article is still in
    ``article.project_id`` (R5: a keeper that left revives the record). Reused
    everywhere; never re-derived.
    """
    verdict = aliased(ArticleDuplicateVerdict)
    later = aliased(ArticleDuplicateVerdict)
    kept = aliased(Article)
    same_pair = or_(
        and_(
            later.article_id == verdict.article_id,
            later.kept_article_id == verdict.kept_article_id,
        ),
        and_(
            later.article_id == verdict.kept_article_id,
            later.kept_article_id == verdict.article_id,
        ),
    )
    superseded = exists().where(
        later.project_id == verdict.project_id,
        same_pair,
        tuple_(later.created_at, later.id) > tuple_(verdict.created_at, verdict.id),
    )
    # verdict.project_id equals article.project_id (outer WHERE); naming the
    # verdict keeps this EXISTS one correlation level deep.
    kept_in_project = exists().where(
        kept.id == verdict.kept_article_id, kept.project_id == verdict.project_id
    )
    return exists().where(
        verdict.article_id == article.id,
        verdict.project_id == article.project_id,
        verdict.verdict == "duplicate",
        kept_in_project,
        ~superseded,
    )
