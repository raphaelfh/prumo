---
description: Convenções de SQLAlchemy, queries async e integração com Supabase Postgres.
alwaysApply: false
priority: high
globs:
  - "backend/app/models/**/*.py"
  - "backend/app/services/**/*.py"
  - "backend/alembic/**/*.py"
  - "supabase/migrations/**/*.sql"
---

## Persona

Atue como um **Senior Backend Engineer** com foco em:
- SQLAlchemy 2.0 com operações async
- Performance de queries (índices, N+1)
- Segurança (RLS continua no Postgres)
- Migrations seguras e reversíveis

## Quando Aplicar Esta Regra

Esta regra se aplica quando trabalhar com:
- **Models SQLAlchemy** (`backend/app/models/`)
- **Queries e operações de banco** em services
- **Migrations SQL** (`supabase/migrations/`)
- **Configuração de conexão** com banco

## Prioridade

**Alta** - Aplicar sempre que trabalhar com banco de dados.

## Arquitetura

### Supabase Postgres + SQLAlchemy

O projeto usa:
- **Supabase Postgres** como banco de dados
- **SQLAlchemy 2.0** como ORM no backend FastAPI
- **RLS (Row Level Security)** permanece no Postgres
- **Migrations** via Supabase CLI (arquivos SQL)

```mermaid
flowchart LR
    FA[FastAPI] --> SA[SQLAlchemy]
    SA --> PG[(Supabase Postgres)]
    PG --> RLS{RLS Policies}
```

## Models SQLAlchemy

### Base Model e PostgreSQLEnumType

O projeto usa um `TypeDecorator` centralizado para ENUMs PostgreSQL nativos:

```python
from datetime import datetime
from uuid import UUID, uuid4
from typing import Any

from sqlalchemy import DateTime, String, TypeDecorator, func
from sqlalchemy.dialects.postgresql import ENUM as PG_ENUM, UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base para todos os models."""
    pass


# Mapeamento de ENUMs PostgreSQL (definidos em supabase/migrations/)
POSTGRESQL_ENUM_VALUES: dict[str, list[str]] = {
    "review_type": ["interventional", "predictive_model", "diagnostic", "prognostic", "qualitative", "other"],
    "project_member_role": ["manager", "reviewer", "viewer", "consensus"],
    "file_role": ["MAIN", "SUPPLEMENT", "PROTOCOL", "DATASET", "APPENDIX", "FIGURE", "OTHER"],
    "extraction_framework": ["CHARMS", "PICOS", "CUSTOM"],
    # ... outros ENUMs
}


class PostgreSQLEnumType(TypeDecorator):
    """
    TypeDecorator para ENUMs PostgreSQL nativos.
    
    Resolve o problema de ::VARCHAR casting com asyncpg.
    Permite usar ENUMs nativos do PostgreSQL de forma transparente.
    
    Uso:
        file_role: Mapped[str] = mapped_column(PostgreSQLEnumType("file_role"), default="MAIN")
    """
    
    impl = String
    cache_ok = True

    def __init__(self, enum_name: str, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)
        self.enum_name = enum_name
        enum_values = POSTGRESQL_ENUM_VALUES.get(enum_name)
        if enum_values is None:
            raise ValueError(f"ENUM '{enum_name}' não registrado em POSTGRESQL_ENUM_VALUES.")
        self._enum_type = PG_ENUM(*enum_values, name=enum_name, create_type=False, native_enum=True)

    def process_bind_param(self, value: Any, dialect: Any) -> str | None:
        if value is None:
            return None
        return str(value)  # Converte Enum Python para string

    def process_result_value(self, value: Any, dialect: Any) -> str | None:
        return value  # Retorna string do banco


class BaseModel(Base):
    """Model base com UUID e timestamps."""
    
    __abstract__ = True
    
    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
```

### Python ENUMs (para validação)

```python
from enum import Enum as PyEnum

class FileRole(str, PyEnum):
    """
    Papel do arquivo no artigo.
    
    IMPORTANTE: Valores devem corresponder exatamente ao ENUM PostgreSQL 'file_role'.
    Ver: supabase/migrations/0002_enums.sql
    """
    MAIN = "MAIN"
    SUPPLEMENT = "SUPPLEMENT"
    # ...
```

### Exemplo de Model com Índices

**Infrastructure as Code**: Índices devem ser declarados no Model via `__table_args__`:

```python
from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel, PostgreSQLEnumType


class Article(BaseModel):
    """
    Artigo científico.
    
    Corresponde à tabela `articles` no Postgres.
    """
    
    __tablename__ = "articles"
    
    # Campos obrigatórios
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,  # Índice simples para FK
    )
    
    title: Mapped[str] = mapped_column(Text, nullable=False)
    
    # Campos opcionais
    abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    doi: Mapped[str | None] = mapped_column(String(255), nullable=True)
    
    # JSONB para dados flexíveis
    source_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    
    # ARRAY para listas
    keywords: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    
    # Relationships
    project: Mapped["Project"] = relationship(back_populates="articles")
    files: Mapped[list["ArticleFile"]] = relationship(
        back_populates="article",
        cascade="all, delete-orphan",
    )
    
    # ✅ ÍNDICES DECLARADOS NO MODEL (Infrastructure as Code)
    __table_args__ = (
        # Índice composto
        Index("idx_articles_year_journal", "publication_year", "journal_title"),
        
        # Índice GIN para busca textual (trigram)
        Index(
            "idx_articles_title_trgm", 
            "title", 
            postgresql_using="gin",
            postgresql_ops={"title": "gin_trgm_ops"}
        ),
        
        # Índices GIN para JSONB e ARRAY
        Index("idx_articles_keywords_gin", "keywords", postgresql_using="gin"),
        Index("idx_articles_source_payload_gin", "source_payload", postgresql_using="gin"),
        
        # Unique constraint parcial
        UniqueConstraint("project_id", "zotero_item_key", name="uq_articles_project_zotero_key"),
        
        {"schema": "public"},
    )


class ArticleFile(BaseModel):
    """Arquivo associado a um artigo."""
    
    __tablename__ = "article_files"
    
    article_id: Mapped[UUID] = mapped_column(
        ForeignKey("articles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,  # Sempre indexar FKs frequentes
    )
    
    # ✅ ENUM PostgreSQL nativo via PostgreSQLEnumType
    file_role: Mapped[str] = mapped_column(
        PostgreSQLEnumType("file_role"),
        default="MAIN",
        nullable=True,
    )
    
    __table_args__ = (
        Index("idx_article_files_article_role", "article_id", "file_role"),
        {"schema": "public"},
    )
```

### Tipos de Índices Suportados

```python
from sqlalchemy import Index

# 1. Índice B-tree simples (padrão)
Index("idx_name", "column")

# 2. Índice composto
Index("idx_name", "col1", "col2")

# 3. Índice GIN para JSONB
Index("idx_name", "jsonb_col", postgresql_using="gin")

# 4. Índice GIN com jsonb_path_ops (otimizado para @> operador)
Index("idx_name", "jsonb_col", postgresql_using="gin", postgresql_ops={"jsonb_col": "jsonb_path_ops"})

# 5. Índice GIN para ARRAY
Index("idx_name", "array_col", postgresql_using="gin")

# 6. Índice trigram para busca textual (requer extensão pg_trgm)
Index("idx_name", "text_col", postgresql_using="gin", postgresql_ops={"text_col": "gin_trgm_ops"})

# 7. Índice parcial
Index("idx_name", "col", postgresql_where="(deleted_at IS NULL)")
```

### Convenções de Naming

```python
# ✅ CORRETO
class ExtractionTemplate(BaseModel):
    __tablename__ = "extraction_templates"  # snake_case, plural

class ArticleFile(BaseModel):
    __tablename__ = "article_files"

# ❌ ERRADO
class ExtractionTemplate(BaseModel):
    __tablename__ = "ExtractionTemplate"  # PascalCase

class ArticleFile(BaseModel):
    __tablename__ = "articleFile"  # camelCase
```

## Queries Async

### Session Management

```python
from sqlalchemy.ext.asyncio import AsyncSession

# ✅ CORRETO: Usar dependency injection
async def get_article(
    db: AsyncSession,
    article_id: UUID,
) -> Article | None:
    result = await db.execute(
        select(Article).where(Article.id == article_id)
    )
    return result.scalar_one_or_none()

# ❌ ERRADO: Criar sessão manualmente
async def get_article(article_id: UUID) -> Article | None:
    async with AsyncSessionLocal() as db:  # Não gerenciado
        ...
```

### Select Queries

```python
from sqlalchemy import select
from sqlalchemy.orm import selectinload

# Query simples
async def get_article(db: AsyncSession, article_id: UUID) -> Article | None:
    result = await db.execute(
        select(Article).where(Article.id == article_id)
    )
    return result.scalar_one_or_none()

# Query com relacionamentos (evita N+1)
async def get_article_with_files(
    db: AsyncSession,
    article_id: UUID,
) -> Article | None:
    result = await db.execute(
        select(Article)
        .options(selectinload(Article.files))  # Carrega files em uma query
        .where(Article.id == article_id)
    )
    return result.scalar_one_or_none()

# Query com filtros
async def get_project_articles(
    db: AsyncSession,
    project_id: UUID,
    limit: int = 100,
    offset: int = 0,
) -> list[Article]:
    result = await db.execute(
        select(Article)
        .where(Article.project_id == project_id)
        .order_by(Article.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())
```

### Insert/Update/Delete

```python
# Insert
async def create_article(
    db: AsyncSession,
    data: ArticleCreate,
) -> Article:
    article = Article(**data.model_dump())
    db.add(article)
    await db.commit()
    await db.refresh(article)
    return article

# Update
async def update_article(
    db: AsyncSession,
    article_id: UUID,
    data: ArticleUpdate,
) -> Article | None:
    article = await get_article(db, article_id)
    if not article:
        return None
    
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(article, key, value)
    
    await db.commit()
    await db.refresh(article)
    return article

# Delete
async def delete_article(
    db: AsyncSession,
    article_id: UUID,
) -> bool:
    article = await get_article(db, article_id)
    if not article:
        return False
    
    await db.delete(article)
    await db.commit()
    return True
```

### Transações Explícitas

```python
async def transfer_article(
    db: AsyncSession,
    article_id: UUID,
    new_project_id: UUID,
) -> None:
    """
    Transfere artigo para outro projeto.
    
    Usa transação explícita para garantir atomicidade.
    """
    async with db.begin():  # Transação explícita
        article = await get_article(db, article_id)
        if not article:
            raise ValueError("Article not found")
        
        # Atualizar projeto
        article.project_id = new_project_id
        
        # Atualizar arquivos relacionados
        await db.execute(
            update(ArticleFile)
            .where(ArticleFile.article_id == article_id)
            .values(project_id=new_project_id)
        )
        
        # Commit automático ao sair do context manager
```

## Repository Pattern e Unit of Work

### Filosofia: flush() vs commit()

O projeto usa o padrão Repository com Unit of Work para gerenciar transações:

- **`flush()`**: Sincroniza objetos pendentes com o banco (INSERT/UPDATE/DELETE), 
  mas NÃO finaliza a transação. Permite obter IDs gerados.
- **`commit()`**: Finaliza a transação de forma PERMANENTE. Só o UnitOfWork faz commit.

### BaseRepository

```python
# backend/app/repositories/base.py

class BaseRepository(Generic[ModelType]):
    """
    Repositório genérico com operações CRUD.
    
    IMPORTANTE: Métodos usam flush(), NÃO commit().
    O commit() é responsabilidade do UnitOfWork.
    """
    
    async def create(self, obj_in: dict[str, Any] | BaseModel) -> ModelType:
        """
        Cria nova entidade.
        
        NOTA: Usa flush() para sincronizar com banco e obter ID.
        A transação só é commitada quando UnitOfWork.__aexit__ é chamado.
        """
        db_obj = self.model(**obj_data)
        self.session.add(db_obj)
        await self.session.flush()  # Sincroniza, não commita
        await self.session.refresh(db_obj)  # Carrega campos gerados
        return db_obj
    
    async def update(self, db_obj: ModelType, obj_in: dict[str, Any]) -> ModelType:
        """
        Atualiza entidade existente.
        
        NOTA: Usa flush() para sincronizar mudanças.
        """
        for field, value in obj_in.items():
            setattr(db_obj, field, value)
        await self.session.flush()
        await self.session.refresh(db_obj)
        return db_obj
    
    async def delete(self, db_obj: ModelType) -> None:
        """
        Remove entidade.
        
        NOTA: Usa flush() para marcar como deletado.
        Remoção real só ocorre após commit do UnitOfWork.
        """
        await self.session.delete(db_obj)
        await self.session.flush()
```

### UnitOfWork

```python
# backend/app/repositories/unit_of_work.py

class UnitOfWork:
    """
    Gerencia transações atômicas com múltiplos repositories.
    
    Benefícios:
        - Atomicidade: Todas as operações commitam juntas ou fazem rollback
        - Consistência: Estado do banco sempre válido
        - Organização: Agrupa repositories relacionados
        - Segurança: Rollback automático em caso de exceção
    
    Uso:
        async with UnitOfWork() as uow:
            project = await uow.projects.create({"name": "Novo"})
            member = await uow.project_members.create({
                "project_id": project.id,
                "user_id": user_id,
            })
            await uow.commit()  # Ambas operações commitam juntas
    """
    
    async def __aenter__(self) -> "UnitOfWork":
        self.session = async_session_factory()
        self.projects = ProjectRepository(self.session)
        self.articles = ArticleRepository(self.session)
        # ... outros repositories
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        if exc_type is not None:
            await self.rollback()  # Rollback automático em erro
        await self.session.close()
    
    async def commit(self) -> None:
        """Finaliza a transação de forma PERMANENTE."""
        await self.session.commit()
    
    async def rollback(self) -> None:
        """Desfaz todas as mudanças pendentes."""
        await self.session.rollback()
```

### Uso Correto

```python
# ✅ CORRETO: Usar UnitOfWork para operações que modificam dados
async def create_project_with_member(
    user_id: UUID,
    project_data: dict,
) -> Project:
    async with UnitOfWork() as uow:
        project = await uow.projects.create(project_data)
        await uow.project_members.create({
            "project_id": project.id,
            "user_id": user_id,
            "role": "manager",
        })
        await uow.commit()  # Ambos são salvos atomicamente
        return project

# ❌ ERRADO: Usar repository diretamente sem UnitOfWork
async def create_project_wrong(data: dict) -> Project:
    async with get_session() as session:
        repo = ProjectRepository(session)
        project = await repo.create(data)
        # BUG: Sem commit(), nada é salvo!
        return project
```

## Evitar N+1

### Problema

```python
# ❌ ERRADO: N+1 queries
async def get_all_articles(db: AsyncSession) -> list[dict]:
    result = await db.execute(select(Article))
    articles = result.scalars().all()
    
    output = []
    for article in articles:
        # Cada acesso a article.files dispara uma query!
        files_count = len(article.files)
        output.append({"title": article.title, "files": files_count})
    
    return output
```

### Solução

```python
# ✅ CORRETO: Carregamento eager
async def get_all_articles(db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(Article)
        .options(selectinload(Article.files))  # Carrega em 2 queries total
    )
    articles = result.scalars().all()
    
    return [
        {"title": a.title, "files": len(a.files)}
        for a in articles
    ]

# ✅ ALTERNATIVA: Usar subquery
from sqlalchemy import func

async def get_articles_with_count(db: AsyncSession) -> list[tuple[Article, int]]:
    subq = (
        select(ArticleFile.article_id, func.count(ArticleFile.id).label("count"))
        .group_by(ArticleFile.article_id)
        .subquery()
    )
    
    result = await db.execute(
        select(Article, subq.c.count)
        .outerjoin(subq, Article.id == subq.c.article_id)
    )
    return list(result.all())
```

## Integração com Supabase Client

Para operações que precisam do Supabase Client (Storage, RPC, etc):

```python
from supabase import Client

class ArticleService:
    def __init__(
        self,
        db: AsyncSession,
        supabase: Client,
        user_id: str,
    ):
        self.db = db
        self.supabase = supabase
        self.user_id = user_id
    
    async def upload_pdf(
        self,
        article_id: UUID,
        pdf_data: bytes,
        filename: str,
    ) -> str:
        """Upload PDF para Supabase Storage e registra no banco."""
        # 1. Upload para Storage (via Supabase Client)
        storage_key = f"{article_id}/{filename}"
        self.supabase.storage.from_("articles").upload(
            storage_key,
            pdf_data,
            {"content-type": "application/pdf"},
        )
        
        # 2. Registrar no banco (via SQLAlchemy)
        article_file = ArticleFile(
            article_id=article_id,
            storage_key=storage_key,
            original_filename=filename,
            file_type="application/pdf",
            bytes=len(pdf_data),
        )
        self.db.add(article_file)
        await self.db.commit()
        
        return storage_key
```

## RLS (Row Level Security)

### RLS Permanece no Postgres

O RLS é configurado via migrations SQL e funciona transparentemente:

```sql
-- supabase/migrations/0012_rls_policies.sql

-- Habilitar RLS
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

-- Política: Usuários só veem artigos de seus projetos
CREATE POLICY "users_select_own_articles" ON articles
  FOR SELECT USING (
    project_id IN (
      SELECT project_id FROM project_members 
      WHERE user_id = auth.uid()
    )
  );
```

### Bypass RLS com Service Role

O backend FastAPI usa `SUPABASE_SERVICE_ROLE_KEY` que bypassa RLS.
Para respeitar RLS, use o token do usuário:

```python
# Opção 1: Service role (bypassa RLS) - usar com cuidado
supabase = create_client(url, service_role_key)

# Opção 2: User token (respeita RLS) - quando necessário
supabase = create_client(url, anon_key)
supabase.auth.set_session(user_access_token)
```

## Migrations (Estratégia Híbrida)

### Supabase como Fonte da Verdade

O projeto usa **estratégia híbrida**:

1. **Supabase migrations** (`supabase/migrations/`) = **Fonte da verdade** para schema
2. **SQLAlchemy models** = Espelho do schema para ORM
3. **Alembic** = Validação de sincronização (não para aplicar migrations)

```
supabase/migrations/*.sql  ──►  PostgreSQL  ◄──  SQLAlchemy models
         (DDL real)              (banco)           (validação)
                                    │
                                    ▼
                              Alembic autogenerate
                            (detecta drift entre
                             models e banco real)
```

### Workflow de Alterações

```bash
# 1. Criar migration SQL no Supabase
# supabase/migrations/0025_add_summary_field.sql

# 2. Atualizar model SQLAlchemy correspondente
# backend/app/models/article.py

# 3. Validar sincronização com Alembic
cd backend
alembic revision --autogenerate -m "validate_sync"

# Se detectar mudanças → models e SQL não estão sincronizados
# Migration gerada deve estar VAZIA se tudo estiver correto
```

### Template de Migration SQL

```sql
-- supabase/migrations/0025_add_summary_field.sql

-- UP: Adicionar campo
ALTER TABLE articles ADD COLUMN IF NOT EXISTS 
    summary text;

-- Índice se necessário
CREATE INDEX IF NOT EXISTS idx_articles_summary_trgm 
    ON articles USING gin (summary gin_trgm_ops);

-- DOWN (comentário):
-- DROP INDEX IF EXISTS idx_articles_summary_trgm;
-- ALTER TABLE articles DROP COLUMN IF EXISTS summary;
```

### Sincronizar Models SQLAlchemy

```python
# backend/app/models/article.py

class Article(BaseModel):
    # ... campos existentes ...
    
    # Novo campo adicionado na migration
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    __table_args__ = (
        # ... índices existentes ...
        
        # Novo índice correspondente à migration
        Index(
            "idx_articles_summary_trgm", 
            "summary", 
            postgresql_using="gin", 
            postgresql_ops={"summary": "gin_trgm_ops"}
        ),
        {"schema": "public"},
    )
```

## Checklist

Antes de considerar código de banco completo:

### Models
- [ ] **Herda BaseModel**: id, created_at, updated_at
- [ ] **Tablename**: snake_case, plural
- [ ] **Tipos corretos**: Mapped[T], nullable explícito
- [ ] **ENUMs**: Usar `PostgreSQLEnumType("nome_enum")` para ENUMs nativos
- [ ] **Python Enums**: Subclasse de `str, Enum` com valores correspondentes
- [ ] **__table_args__**: Declarar índices compostos, GIN, trigram

### Índices (Infrastructure as Code)
- [ ] **ForeignKeys**: `index=True` em FKs frequentemente consultadas
- [ ] **Índices compostos**: Via `Index()` em `__table_args__`
- [ ] **Índices GIN**: Para campos JSONB e ARRAY
- [ ] **Índices trigram**: Para busca textual (`gin_trgm_ops`)
- [ ] **Sincronizado**: Índices nos models correspondem às migrations SQL

### Repository Pattern
- [ ] **UnitOfWork**: Operações que modificam dados usam UnitOfWork
- [ ] **flush() vs commit()**: Repositories usam flush(), UnitOfWork faz commit()
- [ ] **Atomicidade**: Múltiplas operações dentro do mesmo UnitOfWork

### Queries
- [ ] **Async**: Usa AsyncSession e await
- [ ] **Select com options**: Evita N+1
- [ ] **Transações**: Via UnitOfWork para operações múltiplas

### Migrations
- [ ] **SQL no Supabase**: Migrations em `supabase/migrations/` (fonte da verdade)
- [ ] **Models sincronizados**: Atualizar SQLAlchemy models
- [ ] **Rollback documentado**: Comentários DOWN
- [ ] **Validação Alembic**: `alembic revision --autogenerate` não detecta mudanças

### Performance
- [ ] **Índices**: Declarados no model e criados via migration
- [ ] **Joins otimizados**: Evitar N+1
- [ ] **Limites**: Paginação em listagens
- [ ] **Profiling**: Verificar queries geradas em DEBUG

## Referências

- [SQLAlchemy 2.0 Documentation](https://docs.sqlalchemy.org/en/20/)
- [asyncpg Documentation](https://magicstack.github.io/asyncpg/)
- `fastapi-backend-rules.mdc` - Integração com FastAPI
- `database-supabase-rules.mdc` - RLS e migrations (legado)
