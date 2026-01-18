# Arquitetura do Backend - Review Hub

Este guia explica didaticamente a estrutura completa do backend para novos desenvolvedores.

## Visão Geral

O backend do Review Hub utiliza uma arquitetura híbrida que combina:

- **FastAPI** (Python) → API REST, serviços de negócio, processamento de IA
- **Supabase** (PostgreSQL) → Banco de dados, autenticação, storage de arquivos

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│    Frontend     │────▶│    FastAPI      │────▶│    Supabase     │
│    (React)      │     │    (Python)     │     │   (PostgreSQL)  │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                      │                       │
        │                      │                       │
        └──────────────────────┴───────────────────────┘
                           │
                   Autenticação JWT
                   (Supabase Auth)
```

## Por Que Esta Arquitetura?

| Componente | Responsabilidade | Razão |
|------------|-----------------|-------|
| **FastAPI** | APIs de negócio, IA, processamento | Performance, Python ecosystem (OpenAI, PDF), sem timeouts |
| **Supabase Auth** | Autenticação, JWT, sessões | 91 policies RLS que usam `auth.uid()`, integração nativa |
| **Supabase DB** | Persistência, RLS, triggers | PostgreSQL robusto, RLS garante isolamento de dados |
| **Supabase Storage** | Arquivos PDF | Storage integrado com RLS, URLs assinadas |

## Estrutura de Pastas

```
backend/
├── app/
│   ├── api/                    # Endpoints da API
│   │   └── v1/
│   │       ├── endpoints/      # Endpoints organizados por domínio
│   │       │   ├── ai_assessment.py
│   │       │   ├── model_extraction.py
│   │       │   ├── section_extraction.py
│   │       │   └── zotero_import.py
│   │       └── router.py       # Agregador de rotas
│   │
│   ├── core/                   # Configurações centrais
│   │   ├── config.py           # Variáveis de ambiente
│   │   ├── deps.py             # Dependencies do FastAPI
│   │   ├── security.py         # Validação de JWT
│   │   ├── factories.py        # Factory functions
│   │   └── logging.py          # Logging estruturado
│   │
│   ├── models/                 # Models SQLAlchemy
│   │   ├── base.py             # Base model com UUID e timestamps
│   │   ├── article.py
│   │   ├── project.py
│   │   └── ...
│   │
│   ├── repositories/           # Acesso ao banco de dados
│   │   ├── base.py             # Repository genérico
│   │   ├── article_repository.py
│   │   └── ...
│   │
│   ├── schemas/                # Schemas Pydantic (validação)
│   │   ├── common.py           # ApiResponse, ErrorDetail
│   │   └── ...
│   │
│   ├── services/               # Lógica de negócio
│   │   ├── ai_assessment_service.py
│   │   ├── section_extraction_service.py
│   │   ├── model_extraction_service.py
│   │   ├── zotero_service.py
│   │   ├── openai_service.py
│   │   └── pdf_processor.py
│   │
│   ├── infrastructure/         # Integrações externas
│   │   └── storage/
│   │       └── supabase_storage.py  # StorageAdapter
│   │
│   └── main.py                 # Entry point FastAPI
│
├── tests/
│   ├── unit/                   # Testes unitários
│   └── integration/            # Testes de integração
│
└── pyproject.toml              # Dependências (uv)
```

## Camadas da Arquitetura

### 1. Endpoints (API Layer)

Os endpoints são responsáveis por:
- Receber requisições HTTP
- Validar entrada com Pydantic
- Delegar para services
- Retornar resposta padronizada

```python
# backend/app/api/v1/endpoints/section_extraction.py

@router.post("", response_model=ApiResponse)
@limiter.limit("10/minute")
async def extract_sections(
    request: SectionExtractionRequest,
    db: DbSession,                    # Injetado via Depends
    user: CurrentUser,                # JWT validado
    supabase: SupabaseClient,         # Cliente Supabase
) -> ApiResponse:
    """Extrai seções de um artigo PDF."""
    
    trace_id = str(uuid.uuid4())
    storage = create_storage_adapter(supabase)
    
    service = SectionExtractionService(
        db=db,
        user_id=user.sub,
        storage=storage,
        trace_id=trace_id,
    )
    
    result = await service.extract_section(
        project_id=request.project_id,
        article_id=request.article_id,
        template_id=request.template_id,
        entity_type_id=request.entity_type_id,
    )
    
    return ApiResponse(ok=True, data=result.__dict__)
```

### 2. Services (Business Logic)

Os services encapsulam a lógica de negócio:
- Orquestram operações
- Chamam repositories e APIs externas
- São independentes do HTTP

```python
# backend/app/services/section_extraction_service.py

class SectionExtractionService:
    """Serviço para extração de seções de artigos."""
    
    def __init__(
        self,
        db: AsyncSession,
        user_id: str,
        storage: StorageAdapter,
        trace_id: str | None = None,
    ):
        self.db = db
        self.user_id = user_id
        self.storage = storage
        self.trace_id = trace_id
        
        # Repositories
        self._articles = ArticleFileRepository(db)
        self._templates = ExtractionTemplateRepository(db)
        self._entity_types = ExtractionEntityTypeRepository(db)
        self._suggestions = AISuggestionRepository(db)
        self._runs = ExtractionRunRepository(db)
        
        # Services externos
        self.openai_service = OpenAIService()
        self.pdf_processor = PDFProcessor()
    
    async def extract_section(
        self,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        entity_type_id: UUID,
    ) -> SectionExtractionResult:
        """Executa extração de uma seção."""
        
        # 1. Buscar PDF
        pdf_data = await self._get_pdf(project_id, article_id)
        
        # 2. Buscar template e entity type
        entity_type = await self._get_entity_type(entity_type_id)
        
        # 3. Extrair texto do PDF
        text = await self.pdf_processor.extract_text(pdf_data)
        
        # 4. Chamar LLM para extrair dados
        extracted = await self._extract_with_llm(text, entity_type)
        
        # 5. Criar sugestões no banco
        await self._create_suggestions(article_id, entity_type_id, extracted)
        
        return SectionExtractionResult(...)
```

### 3. Repositories (Data Access)

Os repositories abstraem o acesso ao banco:
- Operações CRUD tipadas
- Queries complexas encapsuladas
- Fácil de mockar em testes

```python
# backend/app/repositories/base.py

class BaseRepository(Generic[T]):
    """Repository base com operações CRUD."""
    
    def __init__(self, db: AsyncSession, model: type[T]):
        self.db = db
        self.model = model
    
    async def get_by_id(self, id: UUID) -> T | None:
        result = await self.db.execute(
            select(self.model).where(self.model.id == id)
        )
        return result.scalar_one_or_none()
    
    async def create(self, entity: T) -> T:
        self.db.add(entity)
        await self.db.commit()
        await self.db.refresh(entity)
        return entity
    
    async def update(self, entity: T) -> T:
        await self.db.commit()
        await self.db.refresh(entity)
        return entity
    
    async def delete(self, id: UUID) -> bool:
        entity = await self.get_by_id(id)
        if entity:
            await self.db.delete(entity)
            await self.db.commit()
            return True
        return False
```

### 4. Models (SQLAlchemy)

Os models representam as tabelas do banco:

```python
# backend/app/models/article.py

class Article(BaseModel):
    """Model para artigos científicos."""
    
    __tablename__ = "articles"
    
    project_id: Mapped[UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    
    title: Mapped[str] = mapped_column(Text, nullable=False)
    abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    doi: Mapped[str | None] = mapped_column(String(255), nullable=True)
    
    # Relationships
    project: Mapped["Project"] = relationship(back_populates="articles")
    files: Mapped[list["ArticleFile"]] = relationship(back_populates="article")
```

## Fluxo de uma Requisição

```
1. Request HTTP
       ↓
2. FastAPI valida JWT (core/security.py)
       ↓
3. Dependencies injetadas (core/deps.py)
       ↓
4. Pydantic valida payload (schemas/)
       ↓
5. Endpoint chama Service
       ↓
6. Service usa Repositories + APIs externas
       ↓
7. Repository executa query via SQLAlchemy
       ↓
8. Supabase PostgreSQL processa (RLS aplicado)
       ↓
9. Response retorna via ApiResponse
```

## Autenticação

A autenticação usa **Supabase Auth** com JWT:

```python
# backend/app/core/security.py

async def get_current_user(
    authorization: str = Header(...),
) -> TokenPayload:
    """Valida JWT do Supabase e extrai dados do usuário."""
    
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization")
    
    token = authorization.replace("Bearer ", "")
    
    try:
        # Decodifica e valida o JWT
        payload = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
        
        return TokenPayload(
            sub=payload.get("sub"),
            email=payload.get("email"),
            role=payload.get("role"),
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
```

### Por que manter Supabase Auth?

1. **RLS (Row Level Security)**: 91 policies no banco usam `auth.uid()`
2. **Storage RLS**: Políticas de acesso a arquivos
3. **Triggers**: Criação automática de perfil de usuário
4. **Frontend integrado**: `supabase.auth` já implementado
5. **Sessões**: Refresh tokens gerenciados automaticamente

## Storage de Arquivos

O acesso a arquivos usa o `StorageAdapter`:

```python
# backend/app/infrastructure/storage/supabase_storage.py

class SupabaseStorageAdapter(StorageAdapter):
    """Adapter para Supabase Storage."""
    
    def __init__(self, client: Client):
        self.client = client
    
    async def download(self, bucket: str, path: str) -> bytes:
        """Baixa arquivo do storage."""
        response = self.client.storage.from_(bucket).download(path)
        return response
    
    async def upload(
        self,
        bucket: str,
        path: str,
        data: bytes,
        content_type: str,
    ) -> str:
        """Faz upload de arquivo."""
        self.client.storage.from_(bucket).upload(
            path,
            data,
            {"content-type": content_type},
        )
        return path
    
    def get_public_url(self, bucket: str, path: str) -> str:
        """Retorna URL pública do arquivo."""
        return self.client.storage.from_(bucket).get_public_url(path)
```

## Serviços Principais

### 1. OpenAIService

Wrapper para chamadas à API da OpenAI:

```python
# backend/app/services/openai_service.py

class OpenAIService:
    """Serviço para interação com OpenAI API."""
    
    async def chat_completion_full(
        self,
        messages: list[dict],
        model: str = "gpt-4o-mini",
        response_format: dict | None = None,
    ) -> OpenAIResponse:
        """Executa chat completion com tracking de tokens."""
        
        start_time = time.time()
        
        response = await self.client.chat.completions.create(
            model=model,
            messages=messages,
            response_format=response_format,
        )
        
        duration_ms = (time.time() - start_time) * 1000
        
        return OpenAIResponse(
            content=response.choices[0].message.content,
            usage=OpenAIUsage(
                prompt_tokens=response.usage.prompt_tokens,
                completion_tokens=response.usage.completion_tokens,
                total_tokens=response.usage.total_tokens,
            ),
            model=model,
            duration_ms=duration_ms,
        )
```

### 2. SectionExtractionService

Extrai seções de artigos usando IA:

```
PDF → Texto → Prompt + Schema → LLM → JSON estruturado → Sugestões no DB
```

### 3. ModelExtractionService

Identifica e extrai modelos de predição:

```
PDF → Texto → Identificação de modelos → Criação de instâncias no DB
```

### 4. AIAssessmentService

Avalia artigos com base em critérios:

```
PDF + Questão → LLM (Responses API) → Avaliação + Evidências → DB
```

### 5. ZoteroService

Integração com Zotero API:

```python
class ZoteroService:
    """Serviço para integração com Zotero."""
    
    # Credenciais são criptografadas com Fernet
    # Chave derivada do user_id (única por usuário)
    
    async def save_credentials(
        self,
        zotero_user_id: str,
        api_key: str,
        library_type: str,
    ) -> dict:
        """Salva credenciais criptografadas."""
        encrypted_key = self._encrypt(api_key)
        # Salva no banco via repository
        ...
    
    async def fetch_items(
        self,
        collection_key: str | None = None,
        limit: int = 100,
    ) -> dict:
        """Busca itens da biblioteca Zotero."""
        credentials = await self._get_credentials()
        # Faz requisição para API Zotero
        ...
```

## Banco de Dados

### Migrations

As migrations ficam em `supabase/migrations/`:

```
supabase/migrations/
├── 0001_base_schema.sql        # Extensions, helpers
├── 0002_enums.sql              # ENUMs (status, roles)
├── 0003_core_tables.sql        # Tabelas principais
├── 0004_annotations.sql        # Anotações de usuário
├── 0005_extraction_templates.sql
├── 0006_extraction_data.sql
├── 0007_extraction_ai.sql      # AI extraction
├── 0008_assessment.sql         # Avaliação
├── 0009_integrations.sql       # Zotero
├── 0010_feedback.sql
├── 0012_rls_policies.sql       # RLS (91 policies!)
└── 0014_storage_bucket_articles.sql
```

### RLS (Row Level Security)

O RLS garante que usuários só acessam seus dados:

```sql
-- Exemplo: usuários só veem artigos de seus projetos
CREATE POLICY "users_select_own_articles" ON articles
  FOR SELECT USING (
    project_id IN (
      SELECT project_id FROM project_members 
      WHERE user_id = auth.uid()
    )
  );
```

**Importante**: O backend FastAPI usa `service_role_key` que bypassa RLS.
A segurança é garantida pela validação de JWT e verificações no código.

## Testes

### Testes Unitários

Testam services isoladamente com mocks:

```python
# backend/tests/unit/test_section_extraction_service.py

@pytest.mark.asyncio
async def test_extract_section_full_flow(service, mock_storage):
    """Testa fluxo completo de extração."""
    
    # Setup mocks
    mock_storage.download = AsyncMock(return_value=b"%PDF test")
    service._entity_types.get_with_fields = AsyncMock(return_value=mock_entity)
    service.openai_service.chat_completion_full = AsyncMock(
        return_value=OpenAIResponse(
            content=json.dumps({"field_1": "value"}),
            usage=OpenAIUsage(prompt_tokens=100, completion_tokens=50, total_tokens=150),
            model="gpt-4o-mini",
        )
    )
    
    # Execute
    result = await service.extract_section(
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=entity_type_id,
    )
    
    # Assert
    assert result.run_id is not None
    assert result.tokens_total == 150
```

### Testes de Integração

Testam endpoints com TestClient:

```python
# backend/tests/integration/test_extraction_endpoints.py

@pytest.mark.asyncio
async def test_section_extraction_validation(client):
    """Testa validação de entrada."""
    
    response = await client.post(
        "/api/v1/extraction/sections",
        json={},  # Payload vazio
        headers={"Authorization": "Bearer valid_token"},
    )
    
    assert response.status_code == 422  # Validation error
```

### Executando Testes

```bash
# Instalar dependências
cd backend
uv sync

# Rodar todos os testes
uv run pytest

# Rodar apenas testes unitários
uv run pytest tests/unit/ -v

# Rodar com cobertura
uv run pytest --cov=app --cov-report=html
```

## Variáveis de Ambiente

```env
# backend/.env

# Supabase
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=your-jwt-secret

# OpenAI
OPENAI_API_KEY=sk-...

# Database (conexão direta para SQLAlchemy)
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:54322/postgres
```

## Iniciando o Backend

```bash
# 1. Entrar no diretório
cd backend

# 2. Instalar dependências
uv sync

# 3. Configurar variáveis de ambiente
cp .env.example .env
# Editar .env com suas credenciais

# 4. Iniciar servidor de desenvolvimento
uv run uvicorn app.main:app --reload --port 8000

# 5. Acessar documentação
# Swagger: http://localhost:8000/docs
# ReDoc: http://localhost:8000/redoc
```

## Adicionando um Novo Endpoint

### 1. Criar Schema (se necessário)

```python
# backend/app/schemas/my_feature.py
from pydantic import BaseModel, Field
from uuid import UUID

class MyFeatureRequest(BaseModel):
    project_id: UUID = Field(..., alias="projectId")
    data: str = Field(..., min_length=1)
    
    model_config = {"populate_by_name": True}
```

### 2. Criar Service

```python
# backend/app/services/my_feature_service.py
class MyFeatureService:
    def __init__(self, db: AsyncSession, user_id: str):
        self.db = db
        self.user_id = user_id
        self._repo = MyRepository(db)
    
    async def process(self, request: MyFeatureRequest) -> dict:
        # Lógica de negócio
        ...
```

### 3. Criar Endpoint

```python
# backend/app/api/v1/endpoints/my_feature.py
from fastapi import APIRouter, Depends
from app.core.deps import DbSession, CurrentUser
from app.schemas.common import ApiResponse
from app.services.my_feature_service import MyFeatureService

router = APIRouter()

@router.post("", response_model=ApiResponse)
async def process_feature(
    request: MyFeatureRequest,
    db: DbSession,
    user: CurrentUser,
) -> ApiResponse:
    service = MyFeatureService(db=db, user_id=user.sub)
    result = await service.process(request)
    return ApiResponse(ok=True, data=result)
```

### 4. Registrar Rota

```python
# backend/app/api/v1/router.py
from app.api.v1.endpoints import my_feature

api_router.include_router(
    my_feature.router,
    prefix="/my-feature",
    tags=["My Feature"],
)
```

### 5. Criar Testes

```python
# backend/tests/unit/test_my_feature_service.py
# backend/tests/integration/test_my_feature_endpoints.py
```

## Padrões e Convenções

### Nomenclatura

| Tipo | Convenção | Exemplo |
|------|-----------|---------|
| Arquivos | snake_case | `section_extraction_service.py` |
| Classes | PascalCase | `SectionExtractionService` |
| Funções | snake_case | `async def extract_section()` |
| Variáveis | snake_case | `project_id` |
| Constantes | UPPER_SNAKE_CASE | `MAX_TOKENS` |

### Resposta Padronizada

Todas as APIs retornam `ApiResponse`:

```python
class ApiResponse(BaseModel, Generic[T]):
    ok: bool
    data: T | None = None
    error: ErrorDetail | None = None
    trace_id: str | None = None

# Sucesso
return ApiResponse(ok=True, data={"id": "123"})

# Erro
return ApiResponse(
    ok=False,
    error=ErrorDetail(code="VALIDATION_ERROR", message="Invalid input"),
)
```

### Logging

Use logging estruturado:

```python
from app.core.logging import get_logger

logger = get_logger(__name__)

logger.info(
    "operation_completed",
    trace_id=trace_id,
    user_id=user_id,
    duration_ms=duration,
)
```

## Troubleshooting

### Erro: "Invalid or expired token"

**Causa**: JWT expirado ou inválido.
**Solução**: Verificar se o frontend está enviando o token correto no header `Authorization: Bearer <token>`.

### Erro: "Service role key required"

**Causa**: Operação precisa de permissão elevada.
**Solução**: Verificar se `SUPABASE_SERVICE_ROLE_KEY` está configurado.

### Erro: "Database connection failed"

**Causa**: Supabase local não está rodando.
**Solução**: 
```bash
cd supabase
supabase start
```

### Erro em Testes: "greenlet required"

**Causa**: Dependência faltando para async SQLAlchemy.
**Solução**:
```bash
uv add greenlet
```

## Referências

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [SQLAlchemy 2.0 Documentation](https://docs.sqlalchemy.org/en/20/)
- [Supabase Documentation](https://supabase.com/docs)
- [Pydantic V2 Documentation](https://docs.pydantic.dev/latest/)

## Próximos Passos

1. **Ler código existente**: Comece por `main.py` e siga o fluxo
2. **Rodar testes**: Entenda como os services funcionam
3. **Fazer uma feature pequena**: Adicione um campo ou endpoint simples
4. **Revisar RLS**: Entenda como o banco protege os dados

---

*Última atualização: Janeiro 2026*

