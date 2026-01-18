# 🚀 Guia: Fluxo para Adicionar Novo Endpoint

Este guia descreve o processo completo para adicionar um novo endpoint na API do Review Hub.

## 📋 Visão Geral do Fluxo

```
1. Planejar endpoint (método, rota, payload)
   ↓
2. Criar/atualizar schemas Pydantic
   ↓
3. Criar/atualizar service (lógica de negócio)
   ↓
4. Criar endpoint no router
   ↓
5. Registrar rota no router principal
   ↓
6. Criar testes unitários
   ↓
7. Criar testes de integração
   ↓
8. Testar manualmente
   ↓
9. Documentar e commit
```

---

## 🎯 Passo a Passo Detalhado

### 1️⃣ Planejar o Endpoint

Defina claramente:

**Especificação:**
- **Método HTTP**: GET, POST, PUT, PATCH, DELETE
- **Rota**: `/api/v1/resource/{id}/action`
- **Autenticação**: Requer JWT? Quais permissões?
- **Rate Limiting**: Quantas requisições por minuto?
- **Payload**: Quais campos de entrada?
- **Resposta**: Quais campos de saída?

**Exemplo:**
```
Endpoint: Buscar artigos por external_id
- Método: GET
- Rota: /api/v1/articles/by-external-id/{external_id}
- Auth: Sim (JWT)
- Rate Limit: 30/minute
- Query Params: projectId (opcional)
- Response: ArticleResponse
```

---

### 2️⃣ Criar/Atualizar Schemas Pydantic

Os schemas definem a estrutura de entrada e saída da API.

**Arquivo:** `backend/app/schemas/article.py`

```python
from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime

# Schema de Request (entrada)
class ArticleByExternalIdRequest(BaseModel):
    """Request para buscar artigo por external_id."""
    project_id: UUID | None = Field(None, alias="projectId")

    model_config = {"populate_by_name": True}

# Schema de Response (saída)
class ArticleResponse(BaseModel):
    """Response com dados do artigo."""
    id: UUID
    project_id: UUID = Field(..., alias="projectId")
    title: str
    abstract: str | None = None
    doi: str | None = None
    external_id: str | None = Field(None, alias="externalId")
    created_at: datetime = Field(..., alias="createdAt")
    updated_at: datetime = Field(..., alias="updatedAt")

    model_config = {
        "populate_by_name": True,
        "from_attributes": True,  # Permite criar de ORM models
    }
```

**Convenções:**
- Use `alias` para converter snake_case → camelCase
- Use `Field(...)` para campos obrigatórios
- Use `Field(None, ...)` para campos opcionais
- Use `model_config` para configurações

---

### 3️⃣ Criar/Atualizar Service

O service contém a lógica de negócio, independente do HTTP.

**Arquivo:** `backend/app/services/article_service.py`

```python
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.article_repository import ArticleRepository
from app.models.article import Article
from app.core.logging import get_logger

logger = get_logger(__name__)

class ArticleService:
    """Serviço para operações com artigos."""

    def __init__(self, db: AsyncSession, user_id: str):
        self.db = db
        self.user_id = user_id
        self._articles = ArticleRepository(db)

    async def get_by_external_id(
        self,
        external_id: str,
        project_id: UUID | None = None,
    ) -> Article | None:
        """
        Busca artigo por external_id.

        Args:
            external_id: ID externo do artigo
            project_id: Filtrar por projeto (opcional)

        Returns:
            Article ou None se não encontrado

        Raises:
            ValueError: Se external_id for inválido
        """
        if not external_id or not external_id.strip():
            raise ValueError("external_id não pode ser vazio")

        logger.info(
            "searching_article_by_external_id",
            external_id=external_id,
            project_id=str(project_id) if project_id else None,
            user_id=self.user_id,
        )

        article = await self._articles.get_by_external_id(
            external_id=external_id,
            project_id=project_id,
        )

        if article:
            logger.info(
                "article_found",
                article_id=str(article.id),
                external_id=external_id,
            )
        else:
            logger.info(
                "article_not_found",
                external_id=external_id,
            )

        return article
```

**Boas práticas:**
- Services são independentes de HTTP
- Validações de negócio ficam aqui
- Use logging estruturado
- Docstrings completas
- Type hints em tudo

---

### 4️⃣ Criar Endpoint no Router

O endpoint é a camada HTTP que recebe requisições e chama o service.

**Arquivo:** `backend/app/api/v1/endpoints/articles.py`

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from uuid import UUID

from app.core.deps import DbSession, CurrentUser
from app.schemas.common import ApiResponse
from app.schemas.article import ArticleResponse
from app.services.article_service import ArticleService
from app.utils.rate_limiter import limiter

router = APIRouter()

@router.get(
    "/by-external-id/{external_id}",
    response_model=ApiResponse[ArticleResponse],
    summary="Buscar artigo por external_id",
    description="Busca um artigo pelo seu ID externo (ex: PubMed ID)",
)
@limiter.limit("30/minute")
async def get_article_by_external_id(
    external_id: str,
    project_id: UUID | None = Query(None, alias="projectId"),
    db: DbSession = Depends(),
    user: CurrentUser = Depends(),
) -> ApiResponse[ArticleResponse]:
    """
    Busca artigo por external_id.

    Args:
        external_id: ID externo do artigo
        project_id: Filtrar por projeto (opcional)
        db: Sessão do banco (injetada)
        user: Usuário autenticado (injetado)

    Returns:
        ApiResponse com ArticleResponse

    Raises:
        HTTPException 404: Artigo não encontrado
        HTTPException 400: external_id inválido
    """
    service = ArticleService(db=db, user_id=user.sub)

    try:
        article = await service.get_by_external_id(
            external_id=external_id,
            project_id=project_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not article:
        raise HTTPException(
            status_code=404,
            detail=f"Artigo com external_id '{external_id}' não encontrado",
        )

    return ApiResponse(
        ok=True,
        data=ArticleResponse.model_validate(article),
    )
```

**Elementos importantes:**
- `@router.get/post/put/delete` - Define método HTTP
- `response_model` - Schema de resposta (para docs)
- `summary` e `description` - Aparecem no Swagger
- `@limiter.limit()` - Rate limiting
- `Depends()` - Injeção de dependências
- `ApiResponse` - Resposta padronizada

---

### 5️⃣ Registrar Rota no Router Principal

**Arquivo:** `backend/app/api/v1/router.py`

```python
from fastapi import APIRouter

from app.api.v1.endpoints import (
    articles,  # Importar o router
    ai_assessment,
    model_extraction,
    section_extraction,
    zotero_import,
)

api_router = APIRouter()

# Registrar routers
api_router.include_router(
    articles.router,
    prefix="/articles",
    tags=["Articles"],
)

api_router.include_router(
    ai_assessment.router,
    prefix="/assessment",
    tags=["AI Assessment"],
)

# ... outros routers
```

**Se o arquivo `articles.py` não existir, crie:**

```python
# backend/app/api/v1/endpoints/articles.py
from fastapi import APIRouter

router = APIRouter()

# Seus endpoints aqui
```

---

### 6️⃣ Criar Testes Unitários

Teste o service isoladamente com mocks.

**Arquivo:** `backend/tests/unit/test_article_service.py`

```python
import pytest
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.services.article_service import ArticleService
from app.models.article import Article

@pytest.fixture
def mock_db():
    """Mock da sessão do banco."""
    return MagicMock()

@pytest.fixture
def article_service(mock_db):
    """Fixture do ArticleService."""
    return ArticleService(db=mock_db, user_id="test-user-id")

@pytest.mark.asyncio
async def test_get_by_external_id_found(article_service):
    """Testa busca bem-sucedida por external_id."""
    # Arrange
    external_id = "PMID:12345678"
    project_id = uuid4()

    mock_article = Article(
        id=uuid4(),
        project_id=project_id,
        title="Test Article",
        external_id=external_id,
    )

    article_service._articles.get_by_external_id = AsyncMock(
        return_value=mock_article
    )

    # Act
    result = await article_service.get_by_external_id(
        external_id=external_id,
        project_id=project_id,
    )

    # Assert
    assert result is not None
    assert result.external_id == external_id
    assert result.title == "Test Article"
    article_service._articles.get_by_external_id.assert_called_once_with(
        external_id=external_id,
        project_id=project_id,
    )

@pytest.mark.asyncio
async def test_get_by_external_id_not_found(article_service):
    """Testa busca quando artigo não existe."""
    # Arrange
    article_service._articles.get_by_external_id = AsyncMock(
        return_value=None
    )

    # Act
    result = await article_service.get_by_external_id(
        external_id="PMID:99999999"
    )

    # Assert
    assert result is None

@pytest.mark.asyncio
async def test_get_by_external_id_invalid_input(article_service):
    """Testa validação de entrada."""
    # Act & Assert
    with pytest.raises(ValueError, match="não pode ser vazio"):
        await article_service.get_by_external_id(external_id="")
```

**Executar testes:**
```bash
cd backend
uv run pytest tests/unit/test_article_service.py -v
```

---

### 7️⃣ Criar Testes de Integração

Teste o endpoint completo com TestClient.

**Arquivo:** `backend/tests/integration/test_article_endpoints.py`

```python
import pytest
from httpx import AsyncClient
from uuid import uuid4

from app.models.article import Article

@pytest.mark.asyncio
async def test_get_article_by_external_id_success(
    client: AsyncClient,
    auth_headers: dict,
    db_session,
):
    """Testa busca bem-sucedida por external_id."""
    # Arrange - Criar artigo no banco
    project_id = uuid4()
    article = Article(
        project_id=project_id,
        title="Test Article",
        external_id="PMID:12345678",
    )
    db_session.add(article)
    await db_session.commit()

    # Act
    response = await client.get(
        f"/api/v1/articles/by-external-id/PMID:12345678",
        headers=auth_headers,
    )

    # Assert
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["data"]["externalId"] == "PMID:12345678"
    assert data["data"]["title"] == "Test Article"

@pytest.mark.asyncio
async def test_get_article_by_external_id_not_found(
    client: AsyncClient,
    auth_headers: dict,
):
    """Testa busca quando artigo não existe."""
    # Act
    response = await client.get(
        "/api/v1/articles/by-external-id/PMID:99999999",
        headers=auth_headers,
    )

    # Assert
    assert response.status_code == 404
    data = response.json()
    assert "não encontrado" in data["detail"]

@pytest.mark.asyncio
async def test_get_article_by_external_id_unauthorized(
    client: AsyncClient,
):
    """Testa acesso sem autenticação."""
    # Act
    response = await client.get(
        "/api/v1/articles/by-external-id/PMID:12345678",
    )

    # Assert
    assert response.status_code == 401

@pytest.mark.asyncio
async def test_get_article_by_external_id_with_project_filter(
    client: AsyncClient,
    auth_headers: dict,
    db_session,
):
    """Testa busca com filtro de projeto."""
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
    response = await client.get(
        f"/api/v1/articles/by-external-id/PMID:12345678?projectId={project_id}",
        headers=auth_headers,
    )

    # Assert
    assert response.status_code == 200
    data = response.json()
    assert data["data"]["projectId"] == str(project_id)
```

**Executar testes:**
```bash
cd backend
uv run pytest tests/integration/test_article_endpoints.py -v
```

---

### 8️⃣ Testar Manualmente

#### a) Iniciar o backend:

```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000
```

#### b) Acessar documentação interativa:

Abra no navegador: `http://localhost:8000/api/v1/docs`

#### c) Testar com curl:

```bash
# Obter token (substitua com suas credenciais)
TOKEN="seu-jwt-token-aqui"

# Testar endpoint
curl -X GET \
  "http://localhost:8000/api/v1/articles/by-external-id/PMID:12345678" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

# Com filtro de projeto
curl -X GET \
  "http://localhost:8000/api/v1/articles/by-external-id/PMID:12345678?projectId=uuid-here" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

#### d) Testar com Swagger UI:

1. Acesse `http://localhost:8000/api/v1/docs`
2. Clique em "Authorize" e cole seu token
3. Encontre seu endpoint na lista
4. Clique em "Try it out"
5. Preencha os parâmetros
6. Clique em "Execute"

---

### 9️⃣ Documentar e Commit

#### Atualizar documentação (se necessário):

**Arquivo:** `docs/guias/ARQUITETURA_BACKEND.md`

Adicione uma seção sobre o novo endpoint se for significativo.

#### Commit:

```bash
git add .
git commit -m "feat(api): add endpoint to get article by external_id

- Add GET /api/v1/articles/by-external-id/{external_id}
- Add ArticleService.get_by_external_id method
- Add ArticleRepository.get_by_external_id method
- Add unit and integration tests
- Add rate limiting (30/minute)

Refs: #123"
```

---

## 📝 Checklist Completo

- [ ] **Planejamento**
  - [ ] Defini método HTTP, rota e payload
  - [ ] Defini autenticação e rate limiting
  - [ ] Identifiquei dependências (repositories, services)

- [ ] **Schemas**
  - [ ] Criei/atualizei schemas de request
  - [ ] Criei/atualizei schemas de response
  - [ ] Usei `alias` para camelCase
  - [ ] Adicionei validações (Field, min_length, etc)

- [ ] **Service**
  - [ ] Criei/atualizei service com lógica de negócio
  - [ ] Adicionei validações de entrada
  - [ ] Adicionei logging estruturado
  - [ ] Adicionei docstrings completas
  - [ ] Adicionei type hints

- [ ] **Repository (se necessário)**
  - [ ] Criei método no repository
  - [ ] Método é assíncrono
  - [ ] Queries são eficientes

- [ ] **Endpoint**
  - [ ] Criei endpoint no router
  - [ ] Adicionei decoradores (@router.get, @limiter.limit)
  - [ ] Adicionei summary e description
  - [ ] Usei Depends() para injeção
  - [ ] Tratei erros com HTTPException
  - [ ] Retornei ApiResponse

- [ ] **Registro**
  - [ ] Registrei router em `api/v1/router.py`
  - [ ] Defini prefix e tags

- [ ] **Testes**
  - [ ] Criei testes unitários do service
  - [ ] Criei testes de integração do endpoint
  - [ ] Testei casos de sucesso
  - [ ] Testei casos de erro (404, 400, 401)
  - [ ] Todos os testes passam

- [ ] **Teste Manual**
  - [ ] Testei via Swagger UI
  - [ ] Testei via curl
  - [ ] Verifiquei resposta e status codes

- [ ] **Qualidade**
  - [ ] Código passa no linter (`make lint-backend`)
  - [ ] Código passa no type checker
  - [ ] Documentação está clara

- [ ] **Deploy**
  - [ ] Commit com mensagem descritiva
  - [ ] Push para repositório

---

## 🔄 Exemplos de Endpoints Comuns

### POST - Criar Recurso

```python
@router.post("", response_model=ApiResponse[ArticleResponse])
@limiter.limit("10/minute")
async def create_article(
    request: ArticleCreateRequest,
    db: DbSession,
    user: CurrentUser,
) -> ApiResponse[ArticleResponse]:
    """Cria um novo artigo."""
    service = ArticleService(db=db, user_id=user.sub)
    article = await service.create(request)
    return ApiResponse(ok=True, data=ArticleResponse.model_validate(article))
```

### GET - Listar Recursos

```python
@router.get("", response_model=ApiResponse[list[ArticleResponse]])
@limiter.limit("30/minute")
async def list_articles(
    project_id: UUID = Query(..., alias="projectId"),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: DbSession = Depends(),
    user: CurrentUser = Depends(),
) -> ApiResponse[list[ArticleResponse]]:
    """Lista artigos de um projeto."""
    service = ArticleService(db=db, user_id=user.sub)
    articles = await service.list_by_project(
        project_id=project_id,
        skip=skip,
        limit=limit,
    )
    return ApiResponse(
        ok=True,
        data=[ArticleResponse.model_validate(a) for a in articles],
    )
```

### PUT - Atualizar Recurso Completo

```python
@router.put("/{article_id}", response_model=ApiResponse[ArticleResponse])
@limiter.limit("20/minute")
async def update_article(
    article_id: UUID,
    request: ArticleUpdateRequest,
    db: DbSession,
    user: CurrentUser,
) -> ApiResponse[ArticleResponse]:
    """Atualiza um artigo completamente."""
    service = ArticleService(db=db, user_id=user.sub)
    article = await service.update(article_id=article_id, data=request)
    return ApiResponse(ok=True, data=ArticleResponse.model_validate(article))
```

### PATCH - Atualizar Recurso Parcial

```python
@router.patch("/{article_id}", response_model=ApiResponse[ArticleResponse])
@limiter.limit("20/minute")
async def partial_update_article(
    article_id: UUID,
    request: ArticlePartialUpdateRequest,
    db: DbSession,
    user: CurrentUser,
) -> ApiResponse[ArticleResponse]:
    """Atualiza campos específicos de um artigo."""
    service = ArticleService(db=db, user_id=user.sub)
    article = await service.partial_update(
        article_id=article_id,
        data=request.model_dump(exclude_unset=True),
    )
    return ApiResponse(ok=True, data=ArticleResponse.model_validate(article))
```

### DELETE - Deletar Recurso

```python
@router.delete("/{article_id}", response_model=ApiResponse[None])
@limiter.limit("10/minute")
async def delete_article(
    article_id: UUID,
    db: DbSession,
    user: CurrentUser,
) -> ApiResponse[None]:
    """Deleta um artigo."""
    service = ArticleService(db=db, user_id=user.sub)
    await service.delete(article_id=article_id)
    return ApiResponse(ok=True, data=None)
```

---

## 🚨 Troubleshooting

### Erro: "Router not found"

**Causa:** Esqueceu de registrar o router em `api/v1/router.py`.

**Solução:**
```python
# backend/app/api/v1/router.py
api_router.include_router(
    your_router.router,
    prefix="/your-prefix",
    tags=["Your Tag"],
)
```

### Erro: "Validation error" no Swagger

**Causa:** Schema de request não está correto.

**Solução:**
- Verifique se os campos obrigatórios estão marcados com `Field(...)`
- Verifique se os tipos estão corretos
- Verifique se `alias` está configurado

### Erro: "Dependency not found"

**Causa:** Importação incorreta ou circular.

**Solução:**
```python
# Use TYPE_CHECKING para evitar imports circulares
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.project import Project
```

### Endpoint não aparece no Swagger

**Causa:** Router não foi registrado ou servidor não foi reiniciado.

**Solução:**
1. Verifique `api/v1/router.py`
2. Reinicie o servidor (`Ctrl+C` e `uvicorn` novamente)
3. Limpe cache do navegador

---

## 📚 Referências

- [Arquitetura do Backend](./ARQUITETURA_BACKEND.md)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Pydantic V2 Documentation](https://docs.pydantic.dev/latest/)
- [SQLAlchemy 2.0 Documentation](https://docs.sqlalchemy.org/en/20/)

---

**Última atualização:** Janeiro 2025
