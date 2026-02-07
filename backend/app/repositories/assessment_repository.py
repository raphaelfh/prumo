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
    AssessmentEvidence,
    AssessmentInstance,
    AssessmentInstrument,
    AssessmentItem,
    AssessmentResponse,
    ProjectAssessmentInstrument,
    ProjectAssessmentItem,
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


# =================== REMOVED: LEGACY AssessmentRepository ===================
# A tabela "assessments" foi removida na migração 0032 (2026-01-28).
# Use:
# - AssessmentInstanceRepository (para instances)
# - AssessmentResponseRepository (para respostas individuais)
# - AssessmentEvidenceRepository (para evidências)
#
# Veja abaixo as novas repositories (linha ~520)
# =============================================================================


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


# =================== NEW REPOSITORIES (Assessment 2.0 - Extraction Pattern) ===================


class AssessmentInstanceRepository(BaseRepository[AssessmentInstance]):
    """
    Repository para assessment instances.

    Análogo a ExtractionInstanceRepository. Gerencia instances de avaliação
    (PROBAST por artigo ou por modelo).
    """

    def __init__(self, db: AsyncSession):
        super().__init__(db, AssessmentInstance)

    async def get_by_article(
        self,
        article_id: UUID | str,
        instrument_id: UUID | str | None = None,
    ) -> list[AssessmentInstance]:
        """
        Lista instances de um artigo.

        Args:
            article_id: ID do artigo.
            instrument_id: Filtro por instrumento (opcional).

        Returns:
            Lista de assessment instances.
        """
        if isinstance(article_id, str):
            article_id = UUID(article_id)

        query = select(AssessmentInstance).where(
            AssessmentInstance.article_id == article_id
        )

        if instrument_id:
            if isinstance(instrument_id, str):
                instrument_id = UUID(instrument_id)
            query = query.where(AssessmentInstance.instrument_id == instrument_id)

        query = query.order_by(AssessmentInstance.created_at.desc())

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_by_extraction_instance(
        self,
        extraction_instance_id: UUID | str,
    ) -> list[AssessmentInstance]:
        """
        Lista assessment instances vinculadas a uma extraction instance.

        Útil para buscar PROBAST de um modelo específico.

        Args:
            extraction_instance_id: ID da extraction instance (modelo).

        Returns:
            Lista de assessment instances (ex: PROBAST do modelo).
        """
        if isinstance(extraction_instance_id, str):
            extraction_instance_id = UUID(extraction_instance_id)

        result = await self.db.execute(
            select(AssessmentInstance)
            .where(
                AssessmentInstance.extraction_instance_id == extraction_instance_id
            )
            .order_by(AssessmentInstance.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_with_responses(
        self,
        instance_id: UUID | str,
    ) -> AssessmentInstance | None:
        """
        Busca instance com suas responses carregadas.

        Args:
            instance_id: ID da instance.

        Returns:
            AssessmentInstance com responses ou None.
        """
        if isinstance(instance_id, str):
            instance_id = UUID(instance_id)

        result = await self.db.execute(
            select(AssessmentInstance)
            .options(selectinload(AssessmentInstance.responses))
            .where(AssessmentInstance.id == instance_id)
        )
        return result.scalar_one_or_none()

    async def get_children(
        self,
        parent_instance_id: UUID | str,
    ) -> list[AssessmentInstance]:
        """
        Lista child instances de uma instance.

        Útil para hierarquias (ex: PROBAST root → Domain instances).

        Args:
            parent_instance_id: ID da parent instance.

        Returns:
            Lista de child instances.
        """
        if isinstance(parent_instance_id, str):
            parent_instance_id = UUID(parent_instance_id)

        result = await self.db.execute(
            select(AssessmentInstance)
            .where(AssessmentInstance.parent_instance_id == parent_instance_id)
            .order_by(AssessmentInstance.created_at)
        )
        return list(result.scalars().all())

    async def get_by_project_and_reviewer(
        self,
        project_id: UUID | str,
        reviewer_id: UUID | str,
        status: str | None = None,
    ) -> list[AssessmentInstance]:
        """
        Lista instances de um revisor em um projeto.

        Args:
            project_id: ID do projeto.
            reviewer_id: ID do revisor.
            status: Filtro por status (opcional).

        Returns:
            Lista de assessment instances.
        """
        if isinstance(project_id, str):
            project_id = UUID(project_id)
        if isinstance(reviewer_id, str):
            reviewer_id = UUID(reviewer_id)

        query = (
            select(AssessmentInstance)
            .where(AssessmentInstance.project_id == project_id)
            .where(AssessmentInstance.reviewer_id == reviewer_id)
        )

        if status:
            query = query.where(AssessmentInstance.status == status)

        query = query.order_by(AssessmentInstance.updated_at.desc())

        result = await self.db.execute(query)
        return list(result.scalars().all())


class AssessmentResponseRepository(BaseRepository[AssessmentResponse]):
    """
    Repository para assessment responses.

    Análogo a ExtractedValueRepository. Gerencia respostas individuais
    a assessment items (granularidade total: 1 linha = 1 resposta).
    """

    def __init__(self, db: AsyncSession):
        super().__init__(db, AssessmentResponse)

    async def get_by_instance(
        self,
        assessment_instance_id: UUID | str,
    ) -> list[AssessmentResponse]:
        """
        Lista responses de uma assessment instance.

        Args:
            assessment_instance_id: ID da instance.

        Returns:
            Lista de responses.
        """
        if isinstance(assessment_instance_id, str):
            assessment_instance_id = UUID(assessment_instance_id)

        result = await self.db.execute(
            select(AssessmentResponse)
            .where(
                AssessmentResponse.assessment_instance_id == assessment_instance_id
            )
            .order_by(AssessmentResponse.created_at)
        )
        return list(result.scalars().all())

    async def get_by_instance_and_item(
        self,
        assessment_instance_id: UUID | str,
        assessment_item_id: UUID | str,
    ) -> AssessmentResponse | None:
        """
        Busca response específica de uma instance para um item.

        Args:
            assessment_instance_id: ID da instance.
            assessment_item_id: ID do item.

        Returns:
            Response ou None.
        """
        if isinstance(assessment_instance_id, str):
            assessment_instance_id = UUID(assessment_instance_id)
        if isinstance(assessment_item_id, str):
            assessment_item_id = UUID(assessment_item_id)

        result = await self.db.execute(
            select(AssessmentResponse).where(
                AssessmentResponse.assessment_instance_id == assessment_instance_id,
                AssessmentResponse.assessment_item_id == assessment_item_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_by_article(
        self,
        article_id: UUID | str,
        reviewer_id: UUID | str | None = None,
    ) -> list[AssessmentResponse]:
        """
        Lista responses de um artigo.

        Args:
            article_id: ID do artigo.
            reviewer_id: Filtro por revisor (opcional).

        Returns:
            Lista de responses.
        """
        if isinstance(article_id, str):
            article_id = UUID(article_id)

        query = select(AssessmentResponse).where(
            AssessmentResponse.article_id == article_id
        )

        if reviewer_id:
            if isinstance(reviewer_id, str):
                reviewer_id = UUID(reviewer_id)
            query = query.where(AssessmentResponse.reviewer_id == reviewer_id)

        query = query.order_by(AssessmentResponse.created_at.desc())

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_by_level(
        self,
        project_id: UUID | str,
        selected_level: str,
        instrument_id: UUID | str | None = None,
    ) -> list[AssessmentResponse]:
        """
        Lista responses de um projeto com nível específico.

        Útil para queries como "todos os High risk" ou "todos os Low risk".

        Args:
            project_id: ID do projeto.
            selected_level: Nível selecionado (ex: "Low", "High", "Unclear").
            instrument_id: Filtro por instrumento (opcional).

        Returns:
            Lista de responses.
        """
        if isinstance(project_id, str):
            project_id = UUID(project_id)

        query = (
            select(AssessmentResponse)
            .where(AssessmentResponse.project_id == project_id)
            .where(AssessmentResponse.selected_level == selected_level)
        )

        if instrument_id:
            if isinstance(instrument_id, str):
                instrument_id = UUID(instrument_id)
            # Join com assessment_instances para filtrar por instrumento
            query = query.join(AssessmentInstance).where(
                AssessmentInstance.instrument_id == instrument_id
            )

        query = query.order_by(AssessmentResponse.created_at.desc())

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def bulk_create(
        self,
        responses: list[AssessmentResponse],
    ) -> list[AssessmentResponse]:
        """
        Cria múltiplas responses em batch.

        Útil para aceitar múltiplas sugestões de IA de uma vez.

        Args:
            responses: Lista de responses a criar.

        Returns:
            Lista de responses criadas.
        """
        self.db.add_all(responses)
        await self.db.flush()

        # Refresh para carregar IDs e timestamps
        for response in responses:
            await self.db.refresh(response)

        return responses


class AssessmentEvidenceRepository(BaseRepository[AssessmentEvidence]):
    """
    Repository para assessment evidence.

    Análogo a ExtractionEvidenceRepository. Gerencia evidências
    que suportam responses ou instances.
    """

    def __init__(self, db: AsyncSession):
        super().__init__(db, AssessmentEvidence)

    async def get_by_response(
        self,
        response_id: UUID | str,
    ) -> list[AssessmentEvidence]:
        """
        Lista evidências de uma response.

        Args:
            response_id: ID da response.

        Returns:
            Lista de evidências.
        """
        if isinstance(response_id, str):
            response_id = UUID(response_id)

        result = await self.db.execute(
            select(AssessmentEvidence).where(
                AssessmentEvidence.target_type == "response",
                AssessmentEvidence.target_id == response_id,
            )
        )
        return list(result.scalars().all())

    async def get_by_instance(
        self,
        instance_id: UUID | str,
    ) -> list[AssessmentEvidence]:
        """
        Lista evidências de uma instance.

        Args:
            instance_id: ID da instance.

        Returns:
            Lista de evidências.
        """
        if isinstance(instance_id, str):
            instance_id = UUID(instance_id)

        result = await self.db.execute(
            select(AssessmentEvidence).where(
                AssessmentEvidence.target_type == "instance",
                AssessmentEvidence.target_id == instance_id,
            )
        )
        return list(result.scalars().all())

    async def get_by_article(
        self,
        article_id: UUID | str,
    ) -> list[AssessmentEvidence]:
        """
        Lista todas evidências de um artigo.

        Args:
            article_id: ID do artigo.

        Returns:
            Lista de evidências.
        """
        if isinstance(article_id, str):
            article_id = UUID(article_id)

        result = await self.db.execute(
            select(AssessmentEvidence)
            .where(AssessmentEvidence.article_id == article_id)
            .order_by(AssessmentEvidence.created_at.desc())
        )
        return list(result.scalars().all())


# =================== PROJECT INSTRUMENT REPOSITORIES ===================


class ProjectAssessmentInstrumentRepository(BaseRepository[ProjectAssessmentInstrument]):
    """
    Repository para project assessment instruments.

    Gerencia instrumentos customizados por projeto (clonados ou criados).
    """

    def __init__(self, db: AsyncSession):
        super().__init__(db, ProjectAssessmentInstrument)

    async def get_by_project(
        self,
        project_id: UUID | str,
        active_only: bool = True,
    ) -> list[ProjectAssessmentInstrument]:
        """
        Lista instrumentos de um projeto.

        Args:
            project_id: ID do projeto.
            active_only: Se True, retorna apenas instrumentos ativos.

        Returns:
            Lista de instrumentos do projeto.
        """
        if isinstance(project_id, str):
            project_id = UUID(project_id)

        query = select(ProjectAssessmentInstrument).where(
            ProjectAssessmentInstrument.project_id == project_id
        )

        if active_only:
            query = query.where(ProjectAssessmentInstrument.is_active == True)  # noqa: E712

        query = query.order_by(ProjectAssessmentInstrument.created_at.desc())

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_with_items(
        self,
        instrument_id: UUID | str,
    ) -> ProjectAssessmentInstrument | None:
        """
        Busca instrumento com seus items carregados.

        Args:
            instrument_id: ID do instrumento.

        Returns:
            Instrumento com items ou None.
        """
        if isinstance(instrument_id, str):
            instrument_id = UUID(instrument_id)

        result = await self.db.execute(
            select(ProjectAssessmentInstrument)
            .options(selectinload(ProjectAssessmentInstrument.items))
            .where(ProjectAssessmentInstrument.id == instrument_id)
        )
        return result.scalar_one_or_none()

    async def get_by_tool_type(
        self,
        project_id: UUID | str,
        tool_type: str,
    ) -> ProjectAssessmentInstrument | None:
        """
        Busca instrumento por tipo em um projeto.

        Args:
            project_id: ID do projeto.
            tool_type: Tipo do instrumento (PROBAST, ROBIS, etc.).

        Returns:
            Instrumento ou None.
        """
        if isinstance(project_id, str):
            project_id = UUID(project_id)

        result = await self.db.execute(
            select(ProjectAssessmentInstrument)
            .where(
                ProjectAssessmentInstrument.project_id == project_id,
                ProjectAssessmentInstrument.tool_type == tool_type,
                ProjectAssessmentInstrument.is_active == True,  # noqa: E712
            )
            .order_by(ProjectAssessmentInstrument.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_by_global_instrument(
        self,
        project_id: UUID | str,
        global_instrument_id: UUID | str,
    ) -> ProjectAssessmentInstrument | None:
        """
        Busca instrumento clonado de um global em um projeto.

        Args:
            project_id: ID do projeto.
            global_instrument_id: ID do instrumento global.

        Returns:
            Instrumento do projeto ou None.
        """
        if isinstance(project_id, str):
            project_id = UUID(project_id)
        if isinstance(global_instrument_id, str):
            global_instrument_id = UUID(global_instrument_id)

        result = await self.db.execute(
            select(ProjectAssessmentInstrument).where(
                ProjectAssessmentInstrument.project_id == project_id,
                ProjectAssessmentInstrument.global_instrument_id == global_instrument_id,
            )
        )
        return result.scalar_one_or_none()


class ProjectAssessmentItemRepository(BaseRepository[ProjectAssessmentItem]):
    """
    Repository para project assessment items.

    Gerencia items de instrumentos customizados.
    """

    def __init__(self, db: AsyncSession):
        super().__init__(db, ProjectAssessmentItem)

    async def get_by_instrument(
        self,
        project_instrument_id: UUID | str,
    ) -> list[ProjectAssessmentItem]:
        """
        Lista items de um instrumento.

        Args:
            project_instrument_id: ID do instrumento do projeto.

        Returns:
            Lista de items ordenados por sort_order.
        """
        if isinstance(project_instrument_id, str):
            project_instrument_id = UUID(project_instrument_id)

        result = await self.db.execute(
            select(ProjectAssessmentItem)
            .where(ProjectAssessmentItem.project_instrument_id == project_instrument_id)
            .order_by(ProjectAssessmentItem.sort_order)
        )
        return list(result.scalars().all())

    async def get_by_domain(
        self,
        project_instrument_id: UUID | str,
        domain: str,
    ) -> list[ProjectAssessmentItem]:
        """
        Lista items de um domínio específico.

        Args:
            project_instrument_id: ID do instrumento do projeto.
            domain: Nome do domínio (ex: "participants", "predictors").

        Returns:
            Lista de items do domínio ordenados.
        """
        if isinstance(project_instrument_id, str):
            project_instrument_id = UUID(project_instrument_id)

        result = await self.db.execute(
            select(ProjectAssessmentItem)
            .where(
                ProjectAssessmentItem.project_instrument_id == project_instrument_id,
                ProjectAssessmentItem.domain == domain,
            )
            .order_by(ProjectAssessmentItem.sort_order)
        )
        return list(result.scalars().all())

    async def get_by_item_code(
        self,
        project_instrument_id: UUID | str,
        item_code: str,
    ) -> ProjectAssessmentItem | None:
        """
        Busca item por código único dentro do instrumento.

        Args:
            project_instrument_id: ID do instrumento do projeto.
            item_code: Código do item (ex: "1.1", "2.3").

        Returns:
            Item ou None.
        """
        if isinstance(project_instrument_id, str):
            project_instrument_id = UUID(project_instrument_id)

        result = await self.db.execute(
            select(ProjectAssessmentItem).where(
                ProjectAssessmentItem.project_instrument_id == project_instrument_id,
                ProjectAssessmentItem.item_code == item_code,
            )
        )
        return result.scalar_one_or_none()

    async def bulk_create(
        self,
        items: list[ProjectAssessmentItem],
    ) -> list[ProjectAssessmentItem]:
        """
        Cria múltiplos items em batch.

        Útil para clonar todos os items de um instrumento global.

        Args:
            items: Lista de items a criar.

        Returns:
            Lista de items criados.
        """
        self.db.add_all(items)
        await self.db.flush()

        for item in items:
            await self.db.refresh(item)

        return items
