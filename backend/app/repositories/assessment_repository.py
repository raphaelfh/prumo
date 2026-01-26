"""
Assessment Repository.

Gerencia acesso a dados de assessments e instrumentos.
"""

from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.assessment import (
    AIAssessment,
    AIAssessmentConfig,
    AIAssessmentPrompt,
    AIAssessmentRun,
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


class AIAssessmentRunRepository(BaseRepository[AIAssessmentRun]):
    """
    Repository para AI assessment runs.

    Gerencia rastreamento de execuções de assessment por IA,
    similar ao ExtractionRunRepository.
    """

    def __init__(self, db: AsyncSession):
        super().__init__(db, AIAssessmentRun)

    async def create_run(
        self,
        project_id: UUID,
        article_id: UUID,
        instrument_id: UUID,
        created_by: UUID,
        stage: str,
        parameters: dict,
        extraction_instance_id: UUID | None = None,
    ) -> AIAssessmentRun:
        """
        Cria um novo assessment run com status 'pending'.

        Args:
            project_id: ID do projeto.
            article_id: ID do artigo.
            instrument_id: ID do instrumento.
            created_by: ID do usuário que criou.
            stage: Estágio da execução ('assess_single', 'assess_batch', 'assess_hierarchical').
            parameters: Parâmetros de entrada (model, temperature, item_ids, etc.).
            extraction_instance_id: ID da extraction instance (para PROBAST por modelo).

        Returns:
            Run criado.
        """
        run = AIAssessmentRun(
            project_id=project_id,
            article_id=article_id,
            instrument_id=instrument_id,
            extraction_instance_id=extraction_instance_id,
            stage=stage,
            status="pending",
            parameters=parameters,
            created_by=created_by,
        )

        self.db.add(run)
        await self.db.flush()
        await self.db.refresh(run)

        return run

    async def start_run(self, run_id: UUID) -> None:
        """
        Marca run como 'running' e define started_at.

        Args:
            run_id: ID do run.
        """
        await self.db.execute(
            update(AIAssessmentRun)
            .where(AIAssessmentRun.id == run_id)
            .values(status="running", started_at=func.now())
        )
        await self.db.flush()

    async def complete_run(self, run_id: UUID, results: dict) -> None:
        """
        Marca run como 'completed' e armazena resultados.

        Args:
            run_id: ID do run.
            results: Dicionário com métricas (tokens, duration, etc.).
        """
        await self.db.execute(
            update(AIAssessmentRun)
            .where(AIAssessmentRun.id == run_id)
            .values(
                status="completed",
                completed_at=func.now(),
                results=results,
            )
        )
        await self.db.flush()

    async def fail_run(self, run_id: UUID, error: str) -> None:
        """
        Marca run como 'failed' com mensagem de erro.

        Args:
            run_id: ID do run.
            error: Mensagem de erro.
        """
        await self.db.execute(
            update(AIAssessmentRun)
            .where(AIAssessmentRun.id == run_id)
            .values(
                status="failed",
                completed_at=func.now(),
                error_message=error,
            )
        )
        await self.db.flush()

    async def get_by_project(
        self,
        project_id: UUID,
        status: str | None = None,
    ) -> list[AIAssessmentRun]:
        """
        Lista runs de um projeto.

        Args:
            project_id: ID do projeto.
            status: Filtro por status (opcional).

        Returns:
            Lista de runs.
        """
        query = (
            select(AIAssessmentRun)
            .where(AIAssessmentRun.project_id == project_id)
            .order_by(AIAssessmentRun.created_at.desc())
        )

        if status:
            query = query.where(AIAssessmentRun.status == status)

        result = await self.db.execute(query)
        return list(result.scalars().all())


class AIAssessmentConfigRepository(BaseRepository[AIAssessmentConfig]):
    """
    Repository para AI assessment configs.

    Gerencia configurações de IA por projeto/instrumento.
    """

    def __init__(self, db: AsyncSession):
        super().__init__(db, AIAssessmentConfig)

    async def get_active(
        self,
        project_id: UUID,
        instrument_id: UUID | None = None,
    ) -> AIAssessmentConfig | None:
        """
        Busca configuração ativa para projeto/instrumento.

        Args:
            project_id: ID do projeto.
            instrument_id: ID do instrumento (opcional).

        Returns:
            Config ativa ou None.
        """
        query = (
            select(AIAssessmentConfig)
            .where(
                AIAssessmentConfig.project_id == project_id,
                AIAssessmentConfig.is_active == True,  # noqa: E712
            )
            .order_by(AIAssessmentConfig.created_at.desc())
        )

        if instrument_id:
            query = query.where(AIAssessmentConfig.instrument_id == instrument_id)

        result = await self.db.execute(query.limit(1))
        return result.scalar_one_or_none()


class AIAssessmentPromptRepository(BaseRepository[AIAssessmentPrompt]):
    """
    Repository para AI assessment prompts.

    Gerencia prompts customizados por assessment item.
    """

    def __init__(self, db: AsyncSession):
        super().__init__(db, AIAssessmentPrompt)

    async def get_by_item(
        self,
        assessment_item_id: UUID,
    ) -> AIAssessmentPrompt | None:
        """
        Busca prompt customizado para um assessment item.

        Args:
            assessment_item_id: ID do assessment item.

        Returns:
            Prompt customizado ou None.
        """
        result = await self.db.execute(
            select(AIAssessmentPrompt).where(
                AIAssessmentPrompt.assessment_item_id == assessment_item_id
            )
        )
        return result.scalar_one_or_none()

    async def get_or_create_default(
        self,
        assessment_item_id: UUID,
    ) -> AIAssessmentPrompt:
        """
        Busca prompt existente ou cria um com valores default.

        Args:
            assessment_item_id: ID do assessment item.

        Returns:
            Prompt (existente ou novo com defaults).
        """
        prompt = await self.get_by_item(assessment_item_id)

        if not prompt:
            prompt = AIAssessmentPrompt(assessment_item_id=assessment_item_id)
            self.db.add(prompt)
            await self.db.flush()
            await self.db.refresh(prompt)

        return prompt
