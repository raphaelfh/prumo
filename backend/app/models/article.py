"""
Article Models.

Modelos for articles cientificos and seus files.
"""

from datetime import datetime
from enum import Enum as PyEnum
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel, PostgreSQLEnumType

if TYPE_CHECKING:
    from app.models.article_author import ArticleAuthorLink, ArticleSyncEvent
    from app.models.project import Project


class FileRole(str, PyEnum):
    """
    Papel/tipo do file do article.

    Valores alinhados with o enum 'file_role' in the PostgreSQL.
    """

    MAIN = "MAIN"
    SUPPLEMENT = "SUPPLEMENT"
    PROTOCOL = "PROTOCOL"
    DATASET = "DATASET"
    APPENDIX = "APPENDIX"
    FIGURE = "FIGURE"
    OTHER = "OTHER"


class Article(BaseModel):
    """
    Artigo cientifico incluido em um project de revisao.

    Contem metadata bibliograficos completos.

    Indices:
    - project_id: FK for project (index=True)
    - (publication_year, journal_title): busca por ano/periodico
    - title: trigram for busca por similaridade
    - keywords, mesh_terms: GIN for busca em arrays
    - source_payload: GIN for busca em JSONB
    - (project_id, zotero_item_key): unique parcial
    """

    __tablename__ = "articles"

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Campos basicos
    title: Mapped[str] = mapped_column(Text, nullable=False)
    abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    language: Mapped[str | None] = mapped_column(String, nullable=True)

    # Data de publicacao
    publication_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    publication_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    publication_day: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Informacoes do periodico
    journal_title: Mapped[str | None] = mapped_column(Text, nullable=True)
    journal_issn: Mapped[str | None] = mapped_column(String, nullable=True)
    journal_eissn: Mapped[str | None] = mapped_column(String, nullable=True)
    journal_publisher: Mapped[str | None] = mapped_column(Text, nullable=True)
    volume: Mapped[str | None] = mapped_column(String, nullable=True)
    issue: Mapped[str | None] = mapped_column(String, nullable=True)
    pages: Mapped[str | None] = mapped_column(String, nullable=True)

    # Tipo and status
    article_type: Mapped[str | None] = mapped_column(String, nullable=True)
    publication_status: Mapped[str | None] = mapped_column(String, nullable=True)
    open_access: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    license: Mapped[str | None] = mapped_column(String, nullable=True)

    # Identificadores
    doi: Mapped[str | None] = mapped_column(Text, nullable=True)
    pmid: Mapped[str | None] = mapped_column(Text, nullable=True)
    pmcid: Mapped[str | None] = mapped_column(Text, nullable=True)
    arxiv_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    pii: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Arrays de texto
    keywords: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    authors: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    mesh_terms: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)

    # URLs
    url_landing: Mapped[str | None] = mapped_column(Text, nullable=True)
    url_pdf: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Metadata adicionais
    study_design: Mapped[str | None] = mapped_column(String, nullable=True)
    registration: Mapped[dict] = mapped_column(JSONB, default={}, nullable=True)
    funding: Mapped[dict] = mapped_column(JSONB, default=[], nullable=True)
    conflicts_of_interest: Mapped[str | None] = mapped_column(Text, nullable=True)
    data_availability: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Controle de versao and ingestao
    hash_fingerprint: Mapped[str | None] = mapped_column(Text, nullable=True)
    ingestion_source: Mapped[str | None] = mapped_column(String, nullable=True)
    source_payload: Mapped[dict] = mapped_column(JSONB, default={}, nullable=True)
    row_version: Mapped[int] = mapped_column(BigInteger, default=1, nullable=False)

    # Campos Zotero
    zotero_item_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    zotero_collection_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    zotero_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sync_state: Mapped[str] = mapped_column(String, nullable=False, default="active")
    removed_at_source_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sync_conflict_log: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    pdf_extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    semantic_abstract_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    semantic_fulltext_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_lineage: Mapped[str | None] = mapped_column(String, nullable=True)

    # Relationships
    project: Mapped["Project"] = relationship(
        "Project",
        back_populates="articles",
    )
    files: Mapped[list["ArticleFile"]] = relationship(
        "ArticleFile",
        back_populates="article",
        cascade="all, delete-orphan",
    )
    author_links: Mapped[list["ArticleAuthorLink"]] = relationship(
        "ArticleAuthorLink",
        back_populates="article",
        cascade="all, delete-orphan",
    )
    sync_events: Mapped[list["ArticleSyncEvent"]] = relationship(
        "ArticleSyncEvent",
        back_populates="article",
    )

    # Indices definidos via __table_args__ (Infrastructure as Code)
    __table_args__ = (
        # Indice composto for busca por ano/periodico
        Index("idx_articles_biblio", "publication_year", "journal_title"),
        # Indice trigram for busca por similaridade in the titulo
        # Requer extensao pg_trgm habilitada
        Index(
            "idx_articles_trgm_title",
            "title",
            postgresql_using="gin",
            postgresql_ops={"title": "gin_trgm_ops"},
        ),
        # Indices GIN for arrays (busca eficiente with @> and &&)
        Index("idx_articles_keywords", "keywords", postgresql_using="gin"),
        Index("idx_articles_mesh", "mesh_terms", postgresql_using="gin"),
        # Indice GIN for JSONB
        Index("idx_articles_source_payload_gin", "source_payload", postgresql_using="gin"),
        # NOTA: o unique partial index uq_articles_project_zotero_item e gerenciado
        # via SQL in the migration inicial (CREATE UNIQUE INDEX ... WHERE zotero_item_key IS NOT NULL).
        # Nao definir UniqueConstraint aqui for evitar conflito with autogenerate.
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<Article {self.title[:50]}...>"


class ArticleFile(BaseModel):
    """
    Arquivo PDF or outro documento associado a um article.

    Indices:
    - project_id, article_id: FKs indexadas
    - (article_id, file_role): busca por tipo de file
    """

    __tablename__ = "article_files"

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    article_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.articles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    file_type: Mapped[str] = mapped_column(String, nullable=False)
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    original_filename: Mapped[str | None] = mapped_column(Text, nullable=True)
    bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    md5: Mapped[str | None] = mapped_column(Text, nullable=True)

    file_role: Mapped[str] = mapped_column(
        PostgreSQLEnumType("file_role"),
        default="MAIN",
        nullable=True,
    )

    # Texto extraido
    text_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    text_html: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Status de extraction
    extraction_status: Mapped[str] = mapped_column(
        String,
        default="pending",
        nullable=True,
    )
    extraction_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    extracted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Relationships
    article: Mapped["Article"] = relationship(
        "Article",
        back_populates="files",
    )

    # Indices definidos via __table_args__
    __table_args__ = (
        # Indice composto for busca por article and tipo de file
        Index("idx_article_files_article_role", "article_id", "file_role"),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ArticleFile {self.storage_key}>"
