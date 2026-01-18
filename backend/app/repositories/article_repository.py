"""
Article Repository.

Gerencia acesso a dados de artigos e arquivos.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.article import Article, ArticleFile
from app.repositories.base import BaseRepository


class ArticleRepository(BaseRepository[Article]):
    """
    Repository para operações com artigos.
    
    Encapsula queries de artigos e arquivos relacionados.
    """
    
    def __init__(self, db: AsyncSession):
        super().__init__(db, Article)
    
    async def get_by_project(
        self,
        project_id: UUID | str,
        *,
        skip: int = 0,
        limit: int = 100,
        include_files: bool = False,
    ) -> list[Article]:
        """
        Lista artigos de um projeto.
        
        Args:
            project_id: ID do projeto.
            skip: Offset para paginação.
            limit: Limite de resultados.
            include_files: Se deve incluir arquivos.
            
        Returns:
            Lista de artigos do projeto.
        """
        if isinstance(project_id, str):
            project_id = UUID(project_id)
        
        query = select(Article).where(Article.project_id == project_id)
        
        if include_files:
            query = query.options(selectinload(Article.files))
        
        query = query.offset(skip).limit(limit)
        
        result = await self.db.execute(query)
        return list(result.scalars().all())
    
    async def get_with_files(self, article_id: UUID | str) -> Article | None:
        """
        Busca artigo com seus arquivos.
        
        Args:
            article_id: ID do artigo.
            
        Returns:
            Artigo com arquivos ou None.
        """
        if isinstance(article_id, str):
            article_id = UUID(article_id)
        
        result = await self.db.execute(
            select(Article)
            .options(selectinload(Article.files))
            .where(Article.id == article_id)
        )
        return result.scalar_one_or_none()
    
    async def count_by_project(self, project_id: UUID | str) -> int:
        """
        Conta artigos de um projeto.
        
        Args:
            project_id: ID do projeto.
            
        Returns:
            Número de artigos.
        """
        from sqlalchemy import func
        
        if isinstance(project_id, str):
            project_id = UUID(project_id)
        
        result = await self.db.execute(
            select(func.count())
            .where(Article.project_id == project_id)
        )
        return result.scalar_one()


class ArticleFileRepository(BaseRepository[ArticleFile]):
    """
    Repository para arquivos de artigos.
    
    Gerencia arquivos PDF e outros anexos.
    """
    
    def __init__(self, db: AsyncSession):
        super().__init__(db, ArticleFile)
    
    async def get_by_article(
        self,
        article_id: UUID | str,
        file_type: str | None = None,
    ) -> list[ArticleFile]:
        """
        Lista arquivos de um artigo.
        
        Args:
            article_id: ID do artigo.
            file_type: Filtro por tipo (opcional).
            
        Returns:
            Lista de arquivos.
        """
        if isinstance(article_id, str):
            article_id = UUID(article_id)
        
        query = select(ArticleFile).where(ArticleFile.article_id == article_id)
        
        if file_type:
            query = query.where(ArticleFile.file_type.ilike(f"%{file_type}%"))
        
        query = query.order_by(ArticleFile.created_at.desc())
        
        result = await self.db.execute(query)
        return list(result.scalars().all())
    
    async def get_latest_pdf(self, article_id: UUID | str) -> ArticleFile | None:
        """
        Busca o PDF mais recente de um artigo.
        
        Args:
            article_id: ID do artigo.
            
        Returns:
            Arquivo PDF ou None.
        """
        if isinstance(article_id, str):
            article_id = UUID(article_id)
        
        result = await self.db.execute(
            select(ArticleFile)
            .where(ArticleFile.article_id == article_id)
            .where(ArticleFile.file_type.ilike("%pdf%"))
            .order_by(ArticleFile.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()
    
    async def get_by_storage_key(self, storage_key: str) -> ArticleFile | None:
        """
        Busca arquivo por storage key.
        
        Args:
            storage_key: Chave do storage.
            
        Returns:
            Arquivo ou None.
        """
        result = await self.db.execute(
            select(ArticleFile).where(ArticleFile.storage_key == storage_key)
        )
        return result.scalar_one_or_none()
