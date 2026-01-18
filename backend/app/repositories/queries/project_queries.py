"""
Project Queries.

Queries otimizadas para read models de projetos.
"""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.article import Article
from app.models.assessment import AIAssessment, Assessment, AssessmentInstrument
from app.models.extraction import ExtractionInstance, ProjectExtractionTemplate
from app.models.project import Project, ProjectMember
from app.schemas.read_models.project import (
    ProjectDetailReadModel,
    ProjectListReadModel,
    ProjectMemberReadModel,
)


class ProjectQueries:
    """
    Queries otimizadas para projetos.
    
    Usa JOINs e subqueries para evitar N+1.
    """
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def list_by_user(
        self,
        user_id: UUID,
        *,
        skip: int = 0,
        limit: int = 50,
    ) -> list[ProjectListReadModel]:
        """
        Lista projetos acessíveis por um usuário.
        
        Args:
            user_id: ID do usuário.
            skip: Offset.
            limit: Limite.
            
        Returns:
            Lista de ProjectListReadModel.
        """
        # Subquery para contar artigos
        articles_count_subq = (
            select(func.count(Article.id))
            .where(Article.project_id == Project.id)
            .correlate(Project)
            .scalar_subquery()
        )
        
        # Subquery para contar membros
        members_count_subq = (
            select(func.count(ProjectMember.id))
            .where(ProjectMember.project_id == Project.id)
            .correlate(Project)
            .scalar_subquery()
        )
        
        # Subquery para contar instrumentos
        instruments_count_subq = (
            select(func.count(AssessmentInstrument.id))
            .where(AssessmentInstrument.project_id == Project.id)
            .correlate(Project)
            .scalar_subquery()
        )
        
        # Query principal
        query = (
            select(
                Project.id,
                Project.name,
                Project.review_title,
                Project.description,
                Project.org_id,
                articles_count_subq.label("articles_count"),
                members_count_subq.label("members_count"),
                instruments_count_subq.label("instruments_count"),
                Project.created_at,
                Project.updated_at,
            )
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(ProjectMember.user_id == user_id)
            .offset(skip)
            .limit(limit)
            .order_by(Project.updated_at.desc())
        )
        
        result = await self.db.execute(query)
        rows = result.all()
        
        return [
            ProjectListReadModel(
                id=row.id,
                name=row.name,
                review_title=row.review_title,
                description=row.description,
                org_id=row.org_id,
                articles_count=row.articles_count or 0,
                members_count=row.members_count or 0,
                instruments_count=row.instruments_count or 0,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
            for row in rows
        ]
    
    async def get_detail(self, project_id: UUID) -> ProjectDetailReadModel | None:
        """
        Busca projeto com detalhes completos.
        
        Args:
            project_id: ID do projeto.
            
        Returns:
            ProjectDetailReadModel ou None.
        """
        # Buscar projeto com membros
        query = (
            select(Project)
            .options(selectinload(Project.members))
            .where(Project.id == project_id)
        )
        
        result = await self.db.execute(query)
        project = result.scalar_one_or_none()
        
        if not project:
            return None
        
        # Estatísticas de artigos
        article_stats = await self._get_article_stats(project_id)
        
        # Estatísticas de assessments
        assessment_stats = await self._get_assessment_stats(project_id)
        
        # Estatísticas de extrações
        extraction_stats = await self._get_extraction_stats(project_id)
        
        # Converter membros
        members = [
            ProjectMemberReadModel(
                user_id=m.user_id,
                role=m.role.value if hasattr(m.role, 'value') else str(m.role),
                joined_at=m.created_at,
            )
            for m in project.members
        ]
        
        # Calcular progresso
        assessment_progress = ProjectDetailReadModel.compute_completion(
            assessment_stats["completed"],
            assessment_stats["total"],
        ) if assessment_stats["total"] > 0 else 0.0
        
        extraction_progress = ProjectDetailReadModel.compute_completion(
            extraction_stats["completed"],
            extraction_stats["total"],
        ) if extraction_stats["total"] > 0 else 0.0
        
        overall_progress = ProjectDetailReadModel.compute_overall_progress(
            assessment_progress,
            extraction_progress,
        )
        
        return ProjectDetailReadModel(
            id=project.id,
            name=project.name,
            review_title=project.review_title,
            description=project.description,
            condition_studied=project.condition_studied,
            eligibility_criteria=project.eligibility_criteria,
            study_design=project.study_design,
            org_id=project.org_id,
            created_by_id=project.created_by_id,
            members=members,
            articles_total=article_stats["total"],
            articles_pending=article_stats["pending"],
            articles_in_progress=article_stats["in_progress"],
            articles_completed=article_stats["completed"],
            assessments_total=assessment_stats["total"],
            assessments_completed=assessment_stats["completed"],
            ai_assessments_total=assessment_stats["ai_total"],
            ai_assessments_pending_review=assessment_stats["ai_pending_review"],
            extractions_total=extraction_stats["total"],
            extractions_completed=extraction_stats["completed"],
            models_extracted=extraction_stats["models"],
            assessment_progress=assessment_progress,
            extraction_progress=extraction_progress,
            overall_progress=overall_progress,
            created_at=project.created_at,
            updated_at=project.updated_at,
        )
    
    async def _get_article_stats(self, project_id: UUID) -> dict:
        """Obtém estatísticas de artigos."""
        # Total
        total_result = await self.db.execute(
            select(func.count(Article.id))
            .where(Article.project_id == project_id)
        )
        total = total_result.scalar_one()
        
        # Por status (simplificado)
        return {
            "total": total,
            "pending": total,  # Placeholder - idealmente viria de status
            "in_progress": 0,
            "completed": 0,
        }
    
    async def _get_assessment_stats(self, project_id: UUID) -> dict:
        """Obtém estatísticas de assessments."""
        # Total
        total_result = await self.db.execute(
            select(func.count(Assessment.id))
            .where(Assessment.project_id == project_id)
        )
        total = total_result.scalar_one()
        
        # Completed
        completed_result = await self.db.execute(
            select(func.count(Assessment.id))
            .where(Assessment.project_id == project_id)
            .where(Assessment.status.in_(["completed", "approved"]))
        )
        completed = completed_result.scalar_one()
        
        # AI total
        ai_total_result = await self.db.execute(
            select(func.count(AIAssessment.id))
            .where(AIAssessment.project_id == project_id)
        )
        ai_total = ai_total_result.scalar_one()
        
        # AI pending review
        ai_pending_result = await self.db.execute(
            select(func.count(AIAssessment.id))
            .where(AIAssessment.project_id == project_id)
            .where(AIAssessment.status == "pending_review")
        )
        ai_pending = ai_pending_result.scalar_one()
        
        return {
            "total": total,
            "completed": completed,
            "ai_total": ai_total,
            "ai_pending_review": ai_pending,
        }
    
    async def _get_extraction_stats(self, project_id: UUID) -> dict:
        """Obtém estatísticas de extrações."""
        # Total instances
        total_result = await self.db.execute(
            select(func.count(ExtractionInstance.id))
            .where(ExtractionInstance.project_id == project_id)
        )
        total = total_result.scalar_one()
        
        # Completed
        completed_result = await self.db.execute(
            select(func.count(ExtractionInstance.id))
            .where(ExtractionInstance.project_id == project_id)
            .where(ExtractionInstance.status.in_(["completed", "reviewed"]))
        )
        completed = completed_result.scalar_one()
        
        # Models (root instances)
        models_result = await self.db.execute(
            select(func.count(ExtractionInstance.id))
            .where(ExtractionInstance.project_id == project_id)
            .where(ExtractionInstance.parent_instance_id.is_(None))
        )
        models = models_result.scalar_one()
        
        return {
            "total": total,
            "completed": completed,
            "models": models,
        }
