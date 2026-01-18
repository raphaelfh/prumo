# 🗄️ Guia: Fluxo de Alteração de Database

Este guia descreve o processo completo e correto para fazer alterações no banco de dados do Review Hub.

## 📋 Visão Geral do Fluxo

```
1. Planejar alteração
   ↓
2. Atualizar documentação (estrutura_database)
   ↓
3. Criar migration no Supabase
   ↓
4. Atualizar models SQLAlchemy
   ↓
5. Gerar migration Alembic (opcional)
   ↓
6. Atualizar schemas Pydantic
   ↓
7. Atualizar repositories/services
   ↓
8. Testar alterações
   ↓
9. Commit e deploy
```

---

## 🎯 Passo a Passo Detalhado

### 1️⃣ Planejar a Alteração

Antes de começar, documente:
- **O que** você vai alterar (nova tabela, novo campo, novo relacionamento)
- **Por que** essa alteração é necessária
- **Impacto** em código existente (breaking changes?)

**Exemplo:**
```
Adicionar campo `external_id` na tabela `articles` para integração com sistemas externos.
- Tipo: VARCHAR(255), nullable
- Índice: Sim (para busca rápida)
- Impacto: Nenhum breaking change (campo opcional)
```

---

### 2️⃣ Atualizar Documentação da Estrutura do Database

**IMPORTANTE**: Faça isso ANTES de criar a migration!

#### Arquivos a atualizar:

**a) `docs/estrutura_database/DATABASE_SCHEMA.md`**

Adicione/atualize a descrição da tabela:

```markdown
### articles

Armazena metadados bibliográficos dos artigos científicos.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | PK |
| project_id | UUID | FK → projects |
| title | TEXT | Título do artigo |
| external_id | VARCHAR(255) | ID em sistema externo (opcional) |
| ... | ... | ... |

**Índices:**
- `idx_articles_project_id` (project_id)
- `idx_articles_external_id` (external_id) ← NOVO
```

**b) `docs/estrutura_database/GUIA_RAPIDO.md`**

Atualize a referência rápida se necessário:

```markdown
## Tabelas de Artigos

- `articles` - Metadados (title, doi, abstract, **external_id**)
- `article_files` - PDFs e documentos
```

---

### 3️⃣ Criar Migration no Supabase

As migrations do Supabase são a **fonte da verdade** para o schema do banco.

#### Criar nova migration:

```bash
cd supabase
supabase migration new add_external_id_to_articles
```

Isso cria um arquivo em `supabase/migrations/YYYYMMDDHHMMSS_add_external_id_to_articles.sql`

#### Escrever a migration:

```sql
-- Migration: Add external_id to articles table
-- Description: Adiciona campo para integração com sistemas externos
-- Author: Seu Nome
-- Date: 2025-01-XX

-- Add column
ALTER TABLE public.articles
ADD COLUMN external_id VARCHAR(255) NULL;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_articles_external_id
ON public.articles(external_id)
WHERE external_id IS NOT NULL;

-- Add comment
COMMENT ON COLUMN public.articles.external_id IS
'ID do artigo em sistema externo (ex: PubMed ID, DOI alternativo)';
```

#### Aplicar a migration localmente:

```bash
# Ainda em supabase/
supabase db reset  # Reseta e aplica todas as migrations
```

**Ou use o Makefile:**
```bash
make reset-db
```

#### Verificar se funcionou:

```bash
# Conectar ao banco local
supabase db psql

# Verificar a estrutura
\d articles

# Sair
\q
```

---

### 4️⃣ Atualizar Models SQLAlchemy

Agora atualize os models do backend para refletir a mudança.

**Arquivo:** `backend/app/models/article.py`

```python
from sqlalchemy import String, Text, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from uuid import UUID

from app.models.base import BaseModel

class Article(BaseModel):
    """Model para artigos científicos."""

    __tablename__ = "articles"

    # Campos existentes
    project_id: Mapped[UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    doi: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # NOVO CAMPO
    external_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        index=True,
        comment="ID do artigo em sistema externo",
    )

    # Relationships
    project: Mapped["Project"] = relationship(back_populates="articles")
    files: Mapped[list["ArticleFile"]] = relationship(back_populates="article")

    # Índices (se não estiverem definidos inline)
    __table_args__ = (
        Index("idx_articles_external_id", "external_id"),
    )
```

**Importante:**
- Use `Mapped[str | None]` para campos nullable
- Use `Mapped[str]` para campos NOT NULL
- Adicione `index=True` se houver índice
- Adicione `comment=` para documentação

---

### 5️⃣ Gerar Migration Alembic (Opcional)

O Alembic é usado para manter sincronia entre models e banco em ambientes de desenvolvimento.

**Nota:** Como usamos Supabase migrations como fonte da verdade, o Alembic é **opcional** e serve principalmente para:
- Validar que os models estão sincronizados
- Facilitar desenvolvimento local sem Supabase

#### Gerar migration:

```bash
cd backend

# Gerar migration automática
uv run alembic revision --autogenerate -m "add external_id to articles"
```

Isso cria um arquivo em `backend/alembic/versions/XXXXX_add_external_id_to_articles.py`

#### Revisar a migration gerada:

```python
"""add external_id to articles

Revision ID: abc123def456
Revises: previous_revision
Create Date: 2025-01-XX 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = 'abc123def456'
down_revision = 'previous_revision'
branch_labels = None
depends_on = None

def upgrade() -> None:
    # ### commands auto generated by Alembic ###
    op.add_column('articles',
        sa.Column('external_id', sa.String(length=255), nullable=True)
    )
    op.create_index(
        'idx_articles_external_id',
        'articles',
        ['external_id'],
        unique=False
    )
    # ### end Alembic commands ###

def downgrade() -> None:
    # ### commands auto generated by Alembic ###
    op.drop_index('idx_articles_external_id', table_name='articles')
    op.drop_column('articles', 'external_id')
    # ### end Alembic commands ###
```

#### Aplicar migration (se necessário):

```bash
uv run alembic upgrade head
```

---

### 6️⃣ Atualizar Schemas Pydantic

Atualize os schemas de validação para incluir o novo campo.

**Arquivo:** `backend/app/schemas/article.py`

```python
from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime

class ArticleBase(BaseModel):
    """Schema base para Article."""
    title: str = Field(..., min_length=1, max_length=1000)
    abstract: str | None = None
    doi: str | None = Field(None, max_length=255)
    external_id: str | None = Field(None, max_length=255)  # NOVO

class ArticleCreate(ArticleBase):
    """Schema para criação de Article."""
    project_id: UUID = Field(..., alias="projectId")

    model_config = {"populate_by_name": True}

class ArticleUpdate(BaseModel):
    """Schema para atualização de Article."""
    title: str | None = Field(None, min_length=1, max_length=1000)
    abstract: str | None = None
    doi: str | None = Field(None, max_length=255)
    external_id: str | None = Field(None, max_length=255)  # NOVO

class ArticleResponse(ArticleBase):
    """Schema de resposta para Article."""
    id: UUID
    project_id: UUID = Field(..., alias="projectId")
    created_at: datetime = Field(..., alias="createdAt")
    updated_at: datetime = Field(..., alias="updatedAt")
    external_id: str | None = Field(None, alias="externalId")  # NOVO

    model_config = {"populate_by_name": True, "from_attributes": True}
```

---

### 7️⃣ Atualizar Repositories/Services (se necessário)

Se você precisa de queries específicas para o novo campo:

**Arquivo:** `backend/app/repositories/article_repository.py`

```python
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.models.article import Article
from app.repositories.base import BaseRepository

class ArticleRepository(BaseRepository[Article]):
    """Repository para Article."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, Article)

    # NOVO MÉTODO
    async def get_by_external_id(
        self,
        external_id: str,
        project_id: UUID | None = None,
    ) -> Article | None:
        """Busca artigo por external_id."""
        query = select(Article).where(Article.external_id == external_id)

        if project_id:
            query = query.where(Article.project_id == project_id)

        result = await self.db.execute(query)
        return result.scalar_one_or_none()
```

---

### 8️⃣ Testar as Alterações

#### a) Testes Unitários

Crie/atualize testes para o novo campo:

**Arquivo:** `backend/tests/unit/test_article_repository.py`

```python
import pytest
from uuid import uuid4

@pytest.mark.asyncio
async def test_get_by_external_id(article_repository, db_session):
    """Testa busca por external_id."""
    # Arrange
    project_id = uuid4()
    article = Article(
        project_id=project_id,
        title="Test Article",
        external_id="PMID:12345678",
    )
    db_session.add(article)
    await db_session.commit()

    # Act
    found = await article_repository.get_by_external_id("PMID:12345678")

    # Assert
    assert found is not None
    assert found.external_id == "PMID:12345678"
    assert found.title == "Test Article"
```

#### b) Testes de Integração

Teste o endpoint completo:

```bash
cd backend
uv run pytest tests/integration/test_article_endpoints.py -v
```

#### c) Teste Manual

```bash
# Iniciar backend
cd backend
uv run uvicorn app.main:app --reload

# Em outro terminal, testar com curl
curl -X POST http://localhost:8000/api/v1/articles \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "uuid-here",
    "title": "Test Article",
    "externalId": "PMID:12345678"
  }'
```

---

### 9️⃣ Commit e Deploy

#### Commit das alterações:

```bash
git add .
git commit -m "feat(database): add external_id field to articles table

- Add external_id column to articles (VARCHAR 255, nullable)
- Add index for performance
- Update SQLAlchemy models
- Update Pydantic schemas
- Add repository method get_by_external_id
- Update documentation

Refs: #123"
```

#### Deploy:

**Supabase (Production):**
```bash
# As migrations são aplicadas automaticamente no deploy
supabase db push
```

**Backend (Render/Vercel):**
```bash
# Push para main/production branch
git push origin main
```

---

## 🔄 Casos Especiais

### Adicionar ENUM

#### 1. Atualizar `backend/app/models/base.py`:

```python
POSTGRESQL_ENUM_VALUES: dict[str, list[str]] = {
    # ... enums existentes ...

    # NOVO ENUM
    "article_status": ["draft", "published", "retracted", "corrected"],
}
```

#### 2. Criar migration Supabase:

```sql
-- Create ENUM type
CREATE TYPE public.article_status AS ENUM (
    'draft',
    'published',
    'retracted',
    'corrected'
);

-- Add column using the ENUM
ALTER TABLE public.articles
ADD COLUMN status public.article_status NOT NULL DEFAULT 'draft';

-- Add index if needed
CREATE INDEX idx_articles_status ON public.articles(status);
```

#### 3. Atualizar model:

```python
from app.models.base import PostgreSQLEnumType

class Article(BaseModel):
    status: Mapped[str] = mapped_column(
        PostgreSQLEnumType("article_status"),
        default="draft",
        nullable=False,
    )
```

---

### Adicionar Relacionamento

#### Exemplo: Adicionar `author_id` em `articles`

**1. Migration Supabase:**
```sql
ALTER TABLE public.articles
ADD COLUMN author_id UUID NULL
REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX idx_articles_author_id ON public.articles(author_id);
```

**2. Model:**
```python
class Article(BaseModel):
    author_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("profiles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Relationship
    author: Mapped["Profile"] = relationship(back_populates="articles")
```

---

### Remover Campo (Breaking Change)

**⚠️ CUIDADO:** Remover campos pode quebrar código existente!

**1. Deprecar primeiro (recomendado):**
```python
# Marcar como deprecated
class Article(BaseModel):
    old_field: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="DEPRECATED: Use new_field instead. Will be removed in v2.0",
    )
```

**2. Após período de transição, remover:**

```sql
-- Migration Supabase
ALTER TABLE public.articles
DROP COLUMN old_field;
```

```python
# Remover do model
# class Article(BaseModel):
#     old_field: ...  ← REMOVER
```

---

## 📝 Checklist Completo

Use este checklist para garantir que não esqueceu nada:

- [ ] **Planejamento**
  - [ ] Documentei o que vou alterar
  - [ ] Identifiquei breaking changes
  - [ ] Revisei impacto em código existente

- [ ] **Documentação**
  - [ ] Atualizei `docs/estrutura_database/DATABASE_SCHEMA.md`
  - [ ] Atualizei `docs/estrutura_database/GUIA_RAPIDO.md` (se necessário)

- [ ] **Migrations**
  - [ ] Criei migration Supabase (`supabase migration new`)
  - [ ] Migration tem comentários explicativos
  - [ ] Testei migration localmente (`supabase db reset`)
  - [ ] Verifiquei schema no banco (`\d table_name`)

- [ ] **Backend**
  - [ ] Atualizei models SQLAlchemy (`backend/app/models/`)
  - [ ] Atualizei `POSTGRESQL_ENUM_VALUES` (se for ENUM)
  - [ ] Gerei migration Alembic (opcional)
  - [ ] Atualizei schemas Pydantic (`backend/app/schemas/`)
  - [ ] Atualizei repositories (se necessário)
  - [ ] Atualizei services (se necessário)

- [ ] **Testes**
  - [ ] Criei/atualizei testes unitários
  - [ ] Criei/atualizei testes de integração
  - [ ] Todos os testes passam (`make test-backend`)
  - [ ] Testei manualmente via API

- [ ] **Qualidade**
  - [ ] Código passa no linter (`make lint-backend`)
  - [ ] Código passa no type checker (`uv run mypy .`)
  - [ ] Sem erros de importação

- [ ] **Deploy**
  - [ ] Commit com mensagem descritiva
  - [ ] Push para repositório
  - [ ] Migration aplicada em produção
  - [ ] Verificado funcionamento em produção

---

## 🚨 Troubleshooting

### Erro: "type X does not exist"

**Causa:** ENUM não foi criado no banco.

**Solução:**
```sql
-- Criar o ENUM manualmente
CREATE TYPE public.my_enum AS ENUM ('value1', 'value2');
```

### Erro: "column X does not exist"

**Causa:** Migration não foi aplicada.

**Solução:**
```bash
cd supabase
supabase db reset
```

### Erro: "ENUM X not registered in POSTGRESQL_ENUM_VALUES"

**Causa:** Esqueceu de adicionar o ENUM em `base.py`.

**Solução:**
```python
# backend/app/models/base.py
POSTGRESQL_ENUM_VALUES: dict[str, list[str]] = {
    "my_enum": ["value1", "value2"],  # ADICIONAR AQUI
}
```

### Alembic detecta mudanças que não existem

**Causa:** Models desincronizados com banco.

**Solução:**
```bash
# Resetar banco para aplicar todas as migrations
make reset-db

# Gerar nova migration
cd backend
uv run alembic revision --autogenerate -m "sync models"
```

---

## 📚 Referências

- [Documentação do Schema](../estrutura_database/DATABASE_SCHEMA.md)
- [Guia Rápido do Schema](../estrutura_database/GUIA_RAPIDO.md)
- [Arquitetura do Backend](./ARQUITETURA_BACKEND.md)
- [Supabase Migrations](https://supabase.com/docs/guides/cli/local-development#database-migrations)
- [SQLAlchemy 2.0 Docs](https://docs.sqlalchemy.org/en/20/)
- [Alembic Tutorial](https://alembic.sqlalchemy.org/en/latest/tutorial.html)

---

**Última atualização:** Janeiro 2025
