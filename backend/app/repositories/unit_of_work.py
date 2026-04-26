"""
Unit of Work Pattern.

Coordena transacoes and garante consistencia entre repositories.

O QUE E UNIT OF WORK?
=====================

O padrao Unit of Work (UoW) e uma abstracao que:
1. Agrupa multiplas operacoes de banco em uma unica transacao
2. Controla quando as mudancas sao commitadas
3. Faz rollback automatico se algo falhar
4. Centraliza o acesso a todos os repositories

POR QUE USAR?
=============

1. ATOMICIDADE: Multiplas operacoes sao tratadas como uma so
   - Se criar article and file falhar in the file, ambos sao revertidos

2. CONSISTENCIA: Evita estados inconsistentes in the banco
   - Nao ha commits parciais

3. ORGANIZACAO: Um ponto de entrada for todos os repositories
   - Nao precisa criar repositories manualmente

4. SEGURANCA: Rollback automatico em excecoes
   - async with garante cleanup adequado

COMO USAR
=========

Exemplo basico:
    async with UnitOfWork(session) as uow:
        article = await uow.articles.get_by_id(article_id)
        await uow.articles.update(article, {"title": "Novo titulo"})
        await uow.commit()  # Persiste a mudanca

Exemplo with multiplas operacoes:
    async with UnitOfWork(session) as uow:
        # Criar article
        article = Article(title="Novo", project_id=project_id)
        await uow.articles.create(article)

        # Criar file do article (usa article.id ja disponivel)
        file = ArticleFile(article_id=article.id, file_type="pdf")
        await uow.article_files.create(file)

        # Commit de tudo de uma vez
        await uow.commit()

Example with error handling:
    async with UnitOfWork(session) as uow:
        try:
            await uow.articles.create(article)
            await uow.commit()
        except Exception as e:
            # Rollback e automatico via __aexit__
            raise

WITHOUT UoW (not recommended):
    # Isso funciona, mas voce perde as garantias de transacao
    repo = ArticleRepository(session)
    await repo.create(article)
    await session.commit()  # Voce controla o commit
"""

from typing import Self

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.article_author_repository import (
    ArticleAuthorLinkRepository,
    ArticleAuthorRepository,
)
from app.repositories.article_repository import (
    ArticleFileRepository,
    ArticleRepository,
    ArticleSyncEventRepository,
    ArticleSyncRunRepository,
)
from app.repositories.extraction_repository import (
    AISuggestionRepository,
    ExtractionEntityTypeRepository,
    ExtractionInstanceRepository,
    ExtractionTemplateRepository,
    GlobalTemplateRepository,
)
from app.repositories.integration_repository import ZoteroIntegrationRepository
from app.repositories.project_repository import ProjectMemberRepository, ProjectRepository


class UnitOfWork:
    """
    Unit of Work for coordenacao de transacoes.

    Agrupa repositories and controla commit/rollback.
    Deve SEMPRE ser usado with 'async with' for garantir cleanup.

    Attributes:
        session: Sessao SQLAlchemy subjacente
        articles: Repository de articles
        article_files: Repository de files de articles
        projects: Repository de projects
        project_members: Repository de membros de projects
        ... (outros repositories)

    Example:
        # Uso basico
        async with UnitOfWork(session) as uow:
            article = await uow.articles.get_by_id(article_id)
            await uow.articles.update(article, {"title": "New Title"})
            await uow.commit()

        # Multiplas operacoes atomicas
        async with UnitOfWork(session) as uow:
            project = await uow.projects.create(Project(name="Novo"))
            member = await uow.project_members.create(
                ProjectMember(project_id=project.id, user_id=user_id)
            )
            await uow.commit()  # Ambos sao criados or nenhum

    Warning:
        NUNCA use repositories fora do contexto 'async with'.
        O rollback automatico so funciona dentro do context manager.
    """

    def __init__(self, session: AsyncSession):
        """
        Inicializa Unit of Work.

        Args:
            session: Sessao async do SQLAlchemy.
        """
        self.session = session
        self._init_repositories()

    def _init_repositories(self) -> None:
        """Inicializa todos os repositories."""
        # Articles
        self.articles = ArticleRepository(self.session)
        self.article_files = ArticleFileRepository(self.session)
        self.article_authors = ArticleAuthorRepository(self.session)
        self.article_author_links = ArticleAuthorLinkRepository(self.session)
        self.article_sync_runs = ArticleSyncRunRepository(self.session)
        self.article_sync_events = ArticleSyncEventRepository(self.session)

        # Projects
        self.projects = ProjectRepository(self.session)
        self.project_members = ProjectMemberRepository(self.session)

        # Extractions
        self.extraction_templates = ExtractionTemplateRepository(self.session)
        self.global_templates = GlobalTemplateRepository(self.session)
        self.entity_types = ExtractionEntityTypeRepository(self.session)
        self.extraction_instances = ExtractionInstanceRepository(self.session)
        self.ai_suggestions = AISuggestionRepository(self.session)

        # Integrations
        self.zotero_integrations = ZoteroIntegrationRepository(self.session)

    async def commit(self) -> None:
        """
        Confirma transacao atual.

        IMPORTANTE: Sempre chame commit() explicitamente quando terminar
        as operacoes. Sem commit(), as mudancas NAO sao persistidas.

        Example:
            async with UnitOfWork(session) as uow:
                await uow.articles.create(article)
                await uow.commit()  # OBRIGATORIO for persistir
        """
        await self.session.commit()

    async def rollback(self) -> None:
        """
        Reverte transacao atual.

        Discard all pending changes (flush but no commit).
        Chamado automaticamente se excecao ocorrer in the 'async with'.

        Example:
            async with UnitOfWork(session) as uow:
                await uow.articles.create(article)
                await uow.rollback()  # Descarta a criacao
        """
        await self.session.rollback()

    async def flush(self) -> None:
        """
        Sincroniza mudancas pendentes with o banco.

        Envia os comandos SQL for o banco, mas NAO faz commit.
        Util for obter IDs gerados or forcar validacao de constraints.
        Os repositories ja fazem flush() automaticamente.
        """
        await self.session.flush()

    async def refresh(self, obj: object) -> None:
        """
        Update objeto with data atuais do banco.

        Util for recarregar relacionamentos or verificar mudancas
        feitas por triggers/defaults do banco.

        Args:
            obj: Qualquer objeto de modelo SQLAlchemy
        """
        await self.session.refresh(obj)

    async def __aenter__(self) -> Self:
        """
        Entra in the contexto async.

        Return self for uso with 'async with'.
        """
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """
        Sai do contexto async.

        IMPORTANTE: Faz rollback AUTOMATICO se excecao ocorrer.
        This ensures partial operations are not committed.

        If there is no exception and you forgot to call commit(),
        changes will be lost (not committed).
        """
        if exc_type is not None:
            await self.rollback()
