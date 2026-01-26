"""
Zotero Import Service.

Orquestra importacao de itens do Zotero para o banco e storage.
Mantem a logica de integracao separada do cliente Zotero.
"""

import base64
import re
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import LoggerMixin
from app.infrastructure.storage import StorageAdapter
from app.models.article import Article, ArticleFile
from app.repositories.article_repository import ArticleFileRepository, ArticleRepository
from app.services.zotero_service import ZoteroService


@dataclass
class ZoteroImportItemResult:
    """Resultado de importacao de um item."""

    zotero_key: str
    title: str
    success: bool
    article_id: str | None = None
    error: str | None = None
    pdf_imported: bool = False


@dataclass
class ZoteroImportResult:
    """Resultado agregado da importacao."""

    total_items: int
    imported: int
    failed: int
    skipped: int
    results: list[ZoteroImportItemResult] = field(default_factory=list)


class ZoteroImportService(LoggerMixin):
    """
    Service para importacao de itens do Zotero.

    Responsavel por:
    - Fetch de itens via ZoteroService
    - Criacao de artigos e arquivos
    - Upload de PDFs para storage
    """

    def __init__(
        self,
        db: AsyncSession,
        user_id: str,
        storage: StorageAdapter,
        trace_id: str,
    ):
        self.db = db
        self.user_id = user_id
        self.storage = storage
        self.trace_id = trace_id

        self._zotero = ZoteroService(db=db, user_id=user_id)
        self._articles = ArticleRepository(db)
        self._article_files = ArticleFileRepository(db)

    async def import_collection(
        self,
        project_id: UUID,
        collection_key: str,
        max_items: int = 100,
        import_pdfs: bool = True,
    ) -> ZoteroImportResult:
        """
        Importa itens de uma collection do Zotero.

        Args:
            project_id: ID do projeto.
            collection_key: Key da collection.
            max_items: Maximo de itens a importar.
            import_pdfs: Se deve importar PDFs.

        Returns:
            ZoteroImportResult com estatisticas.
        """
        self.logger.info(
            "zotero_import_start",
            trace_id=self.trace_id,
            project_id=str(project_id),
            collection_key=collection_key,
            max_items=max_items,
            import_pdfs=import_pdfs,
        )

        items_result = await self._zotero.fetch_items(
            collection_key=collection_key,
            limit=max_items,
        )
        items = items_result.get("items", [])

        imported = 0
        failed = 0
        skipped = 0
        results: list[ZoteroImportItemResult] = []

        for item in items:
            try:
                result = await self._process_item(
                    item=item,
                    project_id=project_id,
                    collection_key=collection_key,
                    import_pdfs=import_pdfs,
                )
                results.append(result)

                if result.success:
                    imported += 1
                elif result.error and "already exists" in result.error:
                    skipped += 1
                else:
                    failed += 1
            except Exception as exc:
                failed += 1
                results.append(
                    ZoteroImportItemResult(
                        zotero_key=item.get("key", "unknown"),
                        title=item.get("data", {}).get("title", "Unknown"),
                        success=False,
                        error=str(exc),
                    )
                )
                self.logger.error(
                    "zotero_item_import_failed",
                    trace_id=self.trace_id,
                    zotero_key=item.get("key"),
                    error=str(exc),
                )

        self.logger.info(
            "zotero_import_complete",
            trace_id=self.trace_id,
            total_items=len(items),
            imported=imported,
            failed=failed,
            skipped=skipped,
        )

        return ZoteroImportResult(
            total_items=len(items),
            imported=imported,
            failed=failed,
            skipped=skipped,
            results=results,
        )

    async def _process_item(
        self,
        item: dict[str, Any],
        project_id: UUID,
        collection_key: str,
        import_pdfs: bool,
    ) -> ZoteroImportItemResult:
        """Processa um item do Zotero."""
        zotero_key = item.get("key", "")
        data = item.get("data", {})
        title = data.get("title") or "Untitled"

        existing = await self._articles.get_by_zotero_item_key(
            project_id=project_id,
            zotero_item_key=zotero_key,
        )
        if existing:
            return ZoteroImportItemResult(
                zotero_key=zotero_key,
                title=title,
                success=False,
                article_id=str(existing.id),
                error="Article already exists",
            )

        article = Article(
            project_id=project_id,
            title=title,
            abstract=data.get("abstractNote"),
            publication_year=self._extract_year(data.get("date")),
            journal_title=data.get("publicationTitle"),
            journal_issn=data.get("ISSN"),
            volume=data.get("volume"),
            issue=data.get("issue"),
            pages=data.get("pages"),
            doi=data.get("DOI"),
            url_landing=data.get("url"),
            authors=self._format_authors(data.get("creators", [])),
            keywords=self._extract_keywords(data.get("tags", [])),
            ingestion_source="zotero",
            source_payload=item,
            zotero_item_key=zotero_key,
            zotero_collection_key=collection_key,
            zotero_version=item.get("version"),
        )

        saved_article = await self._articles.create(article)

        pdf_imported = False
        if import_pdfs:
            pdf_imported = await self._import_pdf(
                article_id=saved_article.id,
                project_id=project_id,
                zotero_key=zotero_key,
            )

        return ZoteroImportItemResult(
            zotero_key=zotero_key,
            title=title,
            success=True,
            article_id=str(saved_article.id),
            pdf_imported=pdf_imported,
        )

    async def _import_pdf(
        self,
        article_id: UUID,
        project_id: UUID,
        zotero_key: str,
    ) -> bool:
        """Importa o primeiro PDF disponivel para o item."""
        try:
            attachments_result = await self._zotero.fetch_attachments(zotero_key)
            attachments = attachments_result.get("attachments", [])

            pdf_attachments = [
                attachment
                for attachment in attachments
                if attachment.get("data", {}).get("contentType") == "application/pdf"
            ]
            if not pdf_attachments:
                return False

            attachment = pdf_attachments[0]
            attachment_key = attachment.get("key")
            if not attachment_key:
                return False

            download_result = await self._zotero.download_attachment(attachment_key)
            pdf_bytes = base64.b64decode(download_result["base64"])

            storage_key = f"{project_id}/{article_id}/{download_result['filename']}"
            await self.storage.upload(
                bucket="articles",
                path=storage_key,
                data=pdf_bytes,
                content_type=download_result.get("content_type", "application/pdf"),
            )

            article_file = ArticleFile(
                project_id=project_id,
                article_id=article_id,
                file_type=download_result.get("content_type", "application/pdf"),
                storage_key=storage_key,
                original_filename=download_result.get("filename"),
                bytes=len(pdf_bytes),
                file_role="MAIN",
            )

            await self._article_files.create(article_file)
            return True
        except Exception as exc:
            self.logger.warning(
                "zotero_pdf_import_failed",
                trace_id=self.trace_id,
                article_id=str(article_id),
                zotero_key=zotero_key,
                error=str(exc),
            )
            return False

    def _format_authors(self, creators: list[dict[str, Any]]) -> list[str] | None:
        """Converte creators do Zotero em lista de autores."""
        authors: list[str] = []
        for creator in creators:
            if creator.get("creatorType") != "author":
                continue

            name = creator.get("name")
            if name:
                authors.append(name)
                continue

            first = creator.get("firstName", "")
            last = creator.get("lastName", "")
            full_name = f"{last}, {first}".strip(", ")
            if full_name:
                authors.append(full_name)

        return authors or None

    def _extract_year(self, date_str: str | None) -> int | None:
        """Extrai ano de uma string de data."""
        if not date_str:
            return None

        match = re.search(r"\d{4}", date_str)
        return int(match.group()) if match else None

    def _extract_keywords(self, tags: list[dict[str, Any]]) -> list[str] | None:
        """Extrai keywords a partir de tags do Zotero."""
        keywords = [tag.get("tag") for tag in tags if tag.get("tag")]
        return keywords or None
