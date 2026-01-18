"""
Assessment Repository.

Gerencia acesso a dados de assessments e instrumentos.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.assessment import (
    AIAssessment,
    Assessment,
    AssessmentInstrument,
    AssessmentItem,
)
from app.repositories.base import BaseRepository


class AssessmentInstrumentRepository(BaseRepository[AssessmentInstrument]):
    """
    Repository para instrumentos de assessment.
    
    Gerencia ROBINS-I, RoB 2, etc.
    """
    
    def __init__(self, db: AsyncSession):
        super().__init__(db, AssessmentInstrument)
    
    async def get_by_project(
        self,
        project_id: UUID | str,
    ) -> list[AssessmentInstrument]:
        """
        Lista instrumentos de um projeto.
        
        Args:
            project_id: ID do projeto.
            
        Returns:
            Lista de instrumentos.
        """
        if isinstance(project_id, str):
            project_id = UUID(project_id)
        
        result = await self.db.execute(
            select(AssessmentInstrument)
            .where(AssessmentInstrument.project_id == project_id)
        )
        return list(result.scalars().all())
    
    async def get_with_items(
        self,
        instrument_id: UUID | str,
    ) -> AssessmentInstrument | None:
        """
        Busca instrumento com seus items.
        
        Args:
            instrument_id: ID do instrumento.
            
        Returns:
            Instrumento com items ou None.
        """
        if isinstance(instrument_id, str):
            instrument_id = UUID(instrument_id)
        
        result = await self.db.execute(
            select(AssessmentInstrument)
            .options(selectinload(AssessmentInstrument.items))
            .where(AssessmentInstrument.id == instrument_id)
        )
        return result.scalar_one_or_none()


class AssessmentItemRepository(BaseRepository[AssessmentItem]):
    """
    Repository para items de assessment.
    
    Gerencia perguntas/critérios de avaliação.
    """
    
    def __init__(self, db: AsyncSession):
        super().__init__(db, AssessmentItem)
    
    async def get_by_instrument(
        self,
        instrument_id: UUID | str,
    ) -> list[AssessmentItem]:
        """
        Lista items de um instrumento.
        
        Args:
            instrument_id: ID do instrumento.
            
        Returns:
            Lista de items ordenados.
        """
        if isinstance(instrument_id, str):
            instrument_id = UUID(instrument_id)
        
        result = await self.db.execute(
            select(AssessmentItem)
            .where(AssessmentItem.instrument_id == instrument_id)
            .order_by(AssessmentItem.order_index)
        )
        return list(result.scalars().all())
    
    async def get_item_with_levels(
        self,
        item_id: UUID | str,
    ) -> AssessmentItem | None:
        """
        Busca item com níveis permitidos.
        
        Args:
            item_id: ID do item.
            
        Returns:
            Item ou None.
        """
        if isinstance(item_id, str):
            item_id = UUID(item_id)
        
        result = await self.db.execute(
            select(AssessmentItem).where(AssessmentItem.id == item_id)
        )
        return result.scalar_one_or_none()


class AssessmentRepository(BaseRepository[Assessment]):
    """
    Repository para assessments.
    
    Gerencia avaliações manuais de artigos.
    """
    
    def __init__(self, db: AsyncSession):
        super().__init__(db, Assessment)
    
    async def get_by_article(
        self,
        article_id: UUID | str,
        instrument_id: UUID | str | None = None,
    ) -> list[Assessment]:
        """
        Lista assessments de um artigo.
        
        Args:
            article_id: ID do artigo.
            instrument_id: Filtro por instrumento (opcional).
            
        Returns:
            Lista de assessments.
        """
        if isinstance(article_id, str):
            article_id = UUID(article_id)
        
        query = select(Assessment).where(Assessment.article_id == article_id)
        
        if instrument_id:
            if isinstance(instrument_id, str):
                instrument_id = UUID(instrument_id)
            query = query.where(Assessment.instrument_id == instrument_id)
        
        result = await self.db.execute(query)
        return list(result.scalars().all())
    
    async def get_by_project_and_user(
        self,
        project_id: UUID | str,
        user_id: UUID | str,
    ) -> list[Assessment]:
        """
        Lista assessments de um usuário em um projeto.
        
        Args:
            project_id: ID do projeto.
            user_id: ID do usuário.
            
        Returns:
            Lista de assessments.
        """
        if isinstance(project_id, str):
            project_id = UUID(project_id)
        if isinstance(user_id, str):
            user_id = UUID(user_id)
        
        result = await self.db.execute(
            select(Assessment)
            .where(Assessment.project_id == project_id)
            .where(Assessment.user_id == user_id)
        )
        return list(result.scalars().all())


class AIAssessmentRepository(BaseRepository[AIAssessment]):
    """
    Repository para AI assessments.
    
    Gerencia avaliações automáticas via OpenAI.
    """
    
    def __init__(self, db: AsyncSession):
        super().__init__(db, AIAssessment)
    
    async def get_by_article_and_item(
        self,
        article_id: UUID | str,
        assessment_item_id: UUID | str,
    ) -> AIAssessment | None:
        """
        Busca AI assessment específico.
        
        Args:
            article_id: ID do artigo.
            assessment_item_id: ID do item.
            
        Returns:
            AI assessment ou None.
        """
        if isinstance(article_id, str):
            article_id = UUID(article_id)
        if isinstance(assessment_item_id, str):
            assessment_item_id = UUID(assessment_item_id)
        
        result = await self.db.execute(
            select(AIAssessment)
            .where(AIAssessment.article_id == article_id)
            .where(AIAssessment.assessment_item_id == assessment_item_id)
            .order_by(AIAssessment.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()
    
    async def get_by_article(
        self,
        article_id: UUID | str,
    ) -> list[AIAssessment]:
        """
        Lista todos AI assessments de um artigo.
        
        Args:
            article_id: ID do artigo.
            
        Returns:
            Lista de AI assessments.
        """
        if isinstance(article_id, str):
            article_id = UUID(article_id)
        
        result = await self.db.execute(
            select(AIAssessment)
            .where(AIAssessment.article_id == article_id)
            .order_by(AIAssessment.created_at.desc())
        )
        return list(result.scalars().all())
    
    async def get_pending_review(
        self,
        project_id: UUID | str,
    ) -> list[AIAssessment]:
        """
        Lista AI assessments pendentes de review.
        
        Args:
            project_id: ID do projeto.
            
        Returns:
            Lista de AI assessments pendentes.
        """
        if isinstance(project_id, str):
            project_id = UUID(project_id)
        
        result = await self.db.execute(
            select(AIAssessment)
            .where(AIAssessment.project_id == project_id)
            .where(AIAssessment.status == "pending_review")
        )
        return list(result.scalars().all())
