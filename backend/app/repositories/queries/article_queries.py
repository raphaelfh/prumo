"""
Article Queries.

Queries otimizadas para read models de artigos.
"""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.article import Article, ArticleFile
from app.models.assessment import AIAssessment, Assessment
from app.models.extraction import ExtractionInstance
from app.models.project import Project
from app.schemas.read_models.article import (
    ArticleDetailReadModel,
    ArticleFileReadModel,
    ArticleListReadModel,
)


class ArticleQueries:
    """
    Queries otimizadas para artigos.
    
    Usa JOINs e subqueries para evitar N+1.
    """
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def list_by_project(
        self,
        project_id: UUID,
        *,
        skip: int = 0,
        limit: int = 50,
    ) -> list[ArticleListReadModel]:
        """
        Lista artigos de um projeto com estatísticas.
        
        Args:
            project_id: ID do projeto.
            skip: Offset.
            limit: Limite.
            
        Returns:
            Lista de ArticleListReadModel.
        """
        # Subquery para contar arquivos
        files_count_subq = (
            select(func.count(ArticleFile.id))
            .where(ArticleFile.article_id == Article.id)
            .correlate(Article)
            .scalar_subquery()
        )
        
        # Subquery para contar assessments
        assessments_count_subq = (
            select(func.count(Assessment.id))
            .where(Assessment.article_id == Article.id)
            .correlate(Article)
            .scalar_subquery()
        )
        
        # Subquery para verificar se tem PDF
        has_pdf_subq = (
            select(func.count(ArticleFile.id) > 0)
            .where(ArticleFile.article_id == Article.id)
            .where(ArticleFile.file_type.ilike("%pdf%"))
            .correlate(Article)
            .scalar_subquery()
        )
        
        # Query principal
        query = (
            select(
                Article.id,
                Article.title,
                Article.authors,
                Article.publication_year,
                Article.project_id,
                Project.name.label("project_name"),
                files_count_subq.label("files_count"),
                assessments_count_subq.label("assessments_count"),
                has_pdf_subq.label("has_pdf"),
                Article.created_at,
                Article.updated_at,
            )
            .join(Project, Article.project_id == Project.id)
            .where(Article.project_id == project_id)
            .offset(skip)
            .limit(limit)
            .order_by(Article.created_at.desc())
        )
        
        result = await self.db.execute(query)
        rows = result.all()
        
        return [
            ArticleListReadModel(
                id=row.id,
                title=row.title,
                authors=row.authors,
                publication_year=row.publication_year,
                project_id=row.project_id,
                project_name=row.project_name,
                files_count=row.files_count or 0,
                assessments_count=row.assessments_count or 0,
                has_pdf=bool(row.has_pdf),
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
            for row in rows
        ]
    
    async def get_detail(self, article_id: UUID) -> ArticleDetailReadModel | None:
        """
        Busca artigo com detalhes completos.
        
        Args:
            article_id: ID do artigo.
            
        Returns:
            ArticleDetailReadModel ou None.
        """
        # Buscar artigo com projeto
        query = (
            select(Article)
            .options(selectinload(Article.files))
            .join(Project, Article.project_id == Project.id)
            .add_columns(
                Project.name.label("project_name"),
                Project.review_title.label("review_title"),
            )
            .where(Article.id == article_id)
        )
        
        result = await self.db.execute(query)
        row = result.first()
        
        if not row:
            return None
        
        article = row[0]
        project_name = row.project_name
        review_title = row.review_title
        
        # Contar assessments
        assessments_stats = await self._get_assessment_stats(article_id)
        
        # Contar extrações
        extraction_stats = await self._get_extraction_stats(article_id)
        
        # Converter arquivos
        files = [
            ArticleFileReadModel(
                id=f.id,
                file_type=f.file_type,
                storage_key=f.storage_key,
                size_bytes=f.size_bytes if hasattr(f, 'size_bytes') else None,
            )
            for f in article.files
        ]
        
        has_pdf = any(f.file_type and "pdf" in f.file_type.lower() for f in article.files)
        
        # Calcular progresso
        assessment_progress = ArticleDetailReadModel.compute_progress(
            assessments_stats["completed"],
            assessments_stats["total"],
        )
        extraction_progress = ArticleDetailReadModel.compute_progress(
            extraction_stats["completed"],
            extraction_stats["total"],
        )
        overall_status = ArticleDetailReadModel.compute_overall_status(
            assessment_progress,
            extraction_progress,
        )
        
        return ArticleDetailReadModel(
            id=article.id,
            title=article.title,
            authors=article.authors,
            publication_year=article.publication_year,
            abstract=article.abstract if hasattr(article, 'abstract') else None,
            doi=article.doi if hasattr(article, 'doi') else None,
            journal=article.journal if hasattr(article, 'journal') else None,
            project_id=article.project_id,
            project_name=project_name,
            review_title=review_title,
            files=files,
            assessments_total=assessments_stats["total"],
            assessments_completed=assessments_stats["completed"],
            assessments_pending=assessments_stats["pending"],
            ai_assessments_count=assessments_stats["ai_count"],
            extractions_total=extraction_stats["total"],
            extractions_completed=extraction_stats["completed"],
            models_extracted=extraction_stats["models"],
            has_pdf=has_pdf,
            assessment_progress=assessment_progress,
            extraction_progress=extraction_progress,
            overall_status=overall_status,
            created_at=article.created_at,
            updated_at=article.updated_at,
        )
    
    async def _get_assessment_stats(self, article_id: UUID) -> dict:
        """Obtém estatísticas de assessments."""
        # Total assessments
        total_result = await self.db.execute(
            select(func.count(Assessment.id))
            .where(Assessment.article_id == article_id)
        )
        total = total_result.scalar_one()
        
        # AI assessments
        ai_result = await self.db.execute(
            select(func.count(AIAssessment.id))
            .where(AIAssessment.article_id == article_id)
        )
        ai_count = ai_result.scalar_one()
        
        # Completed (status = 'completed' ou 'approved')
        completed_result = await self.db.execute(
            select(func.count(Assessment.id))
            .where(Assessment.article_id == article_id)
            .where(Assessment.status.in_(["completed", "approved"]))
        )
        completed = completed_result.scalar_one()
        
        return {
            "total": total,
            "completed": completed,
            "pending": total - completed,
            "ai_count": ai_count,
        }
    
    async def _get_extraction_stats(self, article_id: UUID) -> dict:
        """Obtém estatísticas de extrações."""
        # Total instances
        total_result = await self.db.execute(
            select(func.count(ExtractionInstance.id))
            .where(ExtractionInstance.article_id == article_id)
        )
        total = total_result.scalar_one()
        
        # Completed
        completed_result = await self.db.execute(
            select(func.count(ExtractionInstance.id))
            .where(ExtractionInstance.article_id == article_id)
            .where(ExtractionInstance.status.in_(["completed", "reviewed"]))
        )
        completed = completed_result.scalar_one()
        
        # Models (instances de prediction_models)
        models_result = await self.db.execute(
            select(func.count(ExtractionInstance.id))
            .where(ExtractionInstance.article_id == article_id)
            .where(ExtractionInstance.parent_instance_id.is_(None))
        )
        models = models_result.scalar_one()
        
        return {
            "total": total,
            "completed": completed,
            "models": models,
        }
