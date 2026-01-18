"""
Import Zotero Use Case.

Orquestra importação de itens do Zotero.
"""

import base64
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from app.core.logging import LoggerMixin
from app.infrastructure.storage import StorageAdapter
from app.models.article import Article, ArticleFile
from app.repositories import UnitOfWork
from app.services.zotero_service import ZoteroService


@dataclass
class ImportZoteroRequest:
    """Request para importação do Zotero."""
    
    project_id: UUID
    collection_key: str
    user_id: str
    trace_id: str
    import_pdfs: bool = True
    max_items: int = 100


@dataclass
class ZoteroItemResult:
    """Resultado de importação de um item."""
    
    zotero_key: str
    title: str
    success: bool
    article_id: str | None = None
    error: str | None = None
    has_pdf: bool = False


@dataclass
class ImportZoteroResponse:
    """Response da importação do Zotero."""
    
    total_items: int
    imported: int
    failed: int
    skipped: int
    results: list[ZoteroItemResult] = field(default_factory=list)


class ImportZoteroUseCase(LoggerMixin):
    """
    Use case para importação do Zotero.
    
    Orquestra:
    1. Conexão com Zotero
    2. Fetch de items da collection
    3. Criação de artigos
    4. Download e upload de PDFs
    """
    
    def __init__(
        self,
        uow: UnitOfWork,
        zotero: ZoteroService,
        storage: StorageAdapter,
    ):
        self.uow = uow
        self.zotero = zotero
        self.storage = storage
    
    async def execute(self, request: ImportZoteroRequest) -> ImportZoteroResponse:
        """
        Executa importação do Zotero.
        
        Args:
            request: Dados da requisição.
            
        Returns:
            Response com resultado da importação.
        """
        self.logger.info(
            "import_zotero_start",
            trace_id=request.trace_id,
            collection_key=request.collection_key,
            project_id=str(request.project_id),
        )
        
        # 1. Fetch items do Zotero
        items_result = await self.zotero.fetch_items(
            collection_key=request.collection_key,
            limit=request.max_items,
        )
        
        items = items_result.get("items", [])
        total = len(items)
        
        imported = 0
        failed = 0
        skipped = 0
        results: list[ZoteroItemResult] = []
        
        # 2. Processar cada item
        for item in items:
            try:
                result = await self._process_item(
                    item=item,
                    request=request,
                )
                
                if result.success:
                    imported += 1
                elif result.error and "already exists" in result.error:
                    skipped += 1
                else:
                    failed += 1
                
                results.append(result)
                
            except Exception as e:
                failed += 1
                results.append(ZoteroItemResult(
                    zotero_key=item.get("key", "unknown"),
                    title=item.get("data", {}).get("title", "Unknown"),
                    success=False,
                    error=str(e),
                ))
                
                self.logger.error(
                    "zotero_item_import_failed",
                    trace_id=request.trace_id,
                    zotero_key=item.get("key"),
                    error=str(e),
                )
        
        await self.uow.commit()
        
        self.logger.info(
            "import_zotero_complete",
            trace_id=request.trace_id,
            total=total,
            imported=imported,
            failed=failed,
            skipped=skipped,
        )
        
        return ImportZoteroResponse(
            total_items=total,
            imported=imported,
            failed=failed,
            skipped=skipped,
            results=results,
        )
    
    async def _process_item(
        self,
        item: dict[str, Any],
        request: ImportZoteroRequest,
    ) -> ZoteroItemResult:
        """Processa um item do Zotero."""
        zotero_key = item.get("key", "")
        data = item.get("data", {})
        title = data.get("title", "Untitled")
        
        # Verificar se já existe
        # TODO: Implementar verificação por zotero_key
        
        # Criar artigo
        article = Article(
            project_id=request.project_id,
            title=title,
            authors=self._format_authors(data.get("creators", [])),
            publication_year=self._extract_year(data.get("date", "")),
            abstract=data.get("abstractNote"),
            doi=data.get("DOI"),
            journal=data.get("publicationTitle"),
            volume=data.get("volume"),
            issue=data.get("issue"),
            pages=data.get("pages"),
            zotero_key=zotero_key,
        )
        
        saved_article = await self.uow.articles.create(article)
        
        has_pdf = False
        
        # Importar PDF se solicitado
        if request.import_pdfs:
            has_pdf = await self._import_pdf(
                article_id=saved_article.id,
                zotero_key=zotero_key,
                project_id=request.project_id,
            )
        
        return ZoteroItemResult(
            zotero_key=zotero_key,
            title=title,
            success=True,
            article_id=str(saved_article.id),
            has_pdf=has_pdf,
        )
    
    async def _import_pdf(
        self,
        article_id: UUID,
        zotero_key: str,
        project_id: UUID,
    ) -> bool:
        """Importa PDF de um item do Zotero."""
        try:
            # Buscar attachments
            attachments_result = await self.zotero.fetch_attachments(zotero_key)
            attachments = attachments_result.get("attachments", [])
            
            # Filtrar por PDF
            pdf_attachments = [
                a for a in attachments
                if a.get("data", {}).get("contentType") == "application/pdf"
            ]
            
            if not pdf_attachments:
                return False
            
            # Baixar primeiro PDF
            attachment = pdf_attachments[0]
            attachment_key = attachment.get("key")
            
            download_result = await self.zotero.download_attachment(attachment_key)
            
            # Upload para storage
            pdf_bytes = base64.b64decode(download_result["base64"])
            storage_key = f"{project_id}/{article_id}/{download_result['filename']}"
            
            await self.storage.upload(
                bucket="articles",
                path=storage_key,
                data=pdf_bytes,
                content_type="application/pdf",
            )
            
            # Criar registro de arquivo
            article_file = ArticleFile(
                article_id=article_id,
                file_type="application/pdf",
                storage_key=storage_key,
                size_bytes=len(pdf_bytes),
                original_filename=download_result["filename"],
            )
            
            await self.uow.article_files.create(article_file)
            
            return True
            
        except Exception as e:
            self.logger.warning(
                "pdf_import_failed",
                article_id=str(article_id),
                zotero_key=zotero_key,
                error=str(e),
            )
            return False
    
    def _format_authors(self, creators: list[dict]) -> str:
        """Formata lista de autores."""
        authors = []
        for creator in creators:
            if creator.get("creatorType") == "author":
                name = f"{creator.get('lastName', '')}, {creator.get('firstName', '')}".strip(", ")
                if name:
                    authors.append(name)
        return "; ".join(authors)
    
    def _extract_year(self, date_str: str) -> int | None:
        """Extrai ano de uma string de data."""
        if not date_str:
            return None
        
        import re
        match = re.search(r"\d{4}", date_str)
        return int(match.group()) if match else None
