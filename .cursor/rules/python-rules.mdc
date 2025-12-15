---
description: Padrões Python para o projeto (uv, ruff, mypy, typing).
alwaysApply: false
priority: medium
globs:
  - "backend/**/*.py"
  - "scripts/**/*.py"
---

## Persona

Atue como um **Senior Python Developer** com foco em:
- Código limpo, tipado e idiomático
- Ferramentas modernas (uv, ruff, mypy)
- Performance e manutenibilidade
- Testes e documentação

## Quando Aplicar Esta Regra

Esta regra se aplica quando trabalhar com:
- **Qualquer código Python** no projeto
- **Configuração de ferramentas** (pyproject.toml, ruff, mypy)
- **Scripts e automações** em Python
- **Testes** pytest

## Prioridade

**Média** - Aplicar em todo código Python.

## Ferramentas do Projeto

### Package Manager: uv

Usar [uv](https://github.com/astral-sh/uv) como package manager principal:

```bash
# Instalar dependências
uv sync

# Adicionar dependência
uv add fastapi

# Adicionar dev dependency
uv add --dev pytest

# Executar script
uv run python script.py

# Executar pytest
uv run pytest
```

### Linter/Formatter: ruff

Usar [ruff](https://github.com/astral-sh/ruff) para linting e formatting:

```bash
# Verificar erros
ruff check .

# Corrigir automaticamente
ruff check --fix .

# Formatar código
ruff format .
```

Configuração em `pyproject.toml`:

```toml
[tool.ruff]
target-version = "py311"
line-length = 100

[tool.ruff.lint]
select = [
    "E",      # pycodestyle errors
    "W",      # pycodestyle warnings
    "F",      # pyflakes
    "I",      # isort
    "B",      # flake8-bugbear
    "C4",     # flake8-comprehensions
    "UP",     # pyupgrade
    "ARG",    # flake8-unused-arguments
    "SIM",    # flake8-simplify
]
```

### Type Checker: mypy

Usar [mypy](https://mypy.readthedocs.io/) para verificação de tipos:

```bash
mypy backend/app
```

Configuração em `pyproject.toml`:

```toml
[tool.mypy]
python_version = "3.11"
strict = true
warn_return_any = true
warn_unused_configs = true
ignore_missing_imports = true
```

## Type Hints

### Sempre Tipar

```python
# ✅ CORRETO: Funções tipadas
async def process_article(
    article_id: UUID,
    options: ProcessOptions | None = None,
) -> ProcessResult:
    ...

# ❌ ERRADO: Sem tipos
async def process_article(article_id, options=None):
    ...
```

### Tipos Modernos (Python 3.10+)

```python
# ✅ CORRETO: Sintaxe moderna
from collections.abc import Sequence, Mapping

def process(items: list[str]) -> dict[str, int]:
    ...

def get_user(user_id: str) -> User | None:
    ...

async def fetch_all() -> AsyncGenerator[Item, None]:
    ...

# ❌ ERRADO: Sintaxe antiga
from typing import List, Dict, Optional, Union

def process(items: List[str]) -> Dict[str, int]:
    ...

def get_user(user_id: str) -> Optional[User]:
    ...
```

### TypedDict para Dicts Estruturados

```python
from typing import TypedDict

class ArticleData(TypedDict):
    id: str
    title: str
    abstract: str | None
    authors: list[str]

def process_article(data: ArticleData) -> None:
    ...
```

### Generics

```python
from typing import Generic, TypeVar

T = TypeVar("T")

class Repository(Generic[T]):
    async def get(self, id: UUID) -> T | None:
        ...
    
    async def create(self, data: T) -> T:
        ...
```

## Estilo de Código

### Docstrings (Google Style)

```python
async def extract_text(
    pdf_data: bytes,
    options: ExtractionOptions | None = None,
) -> str:
    """
    Extrai texto de um arquivo PDF.
    
    Args:
        pdf_data: Bytes do arquivo PDF.
        options: Opções de extração (opcional).
        
    Returns:
        Texto extraído do PDF.
        
    Raises:
        ValueError: Se PDF inválido.
        ProcessingError: Se falha na extração.
    """
    ...
```

### Classes com Dataclasses ou Pydantic

```python
# Para dados simples: dataclass
from dataclasses import dataclass

@dataclass
class ExtractionResult:
    text: str
    pages: int
    metadata: dict[str, Any]

# Para validação: Pydantic
from pydantic import BaseModel, Field

class ExtractionRequest(BaseModel):
    article_id: UUID = Field(..., description="ID do artigo")
    options: ExtractionOptions | None = None
```

### Context Managers para Recursos

```python
from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

@asynccontextmanager
async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    session = AsyncSessionLocal()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()

# Uso
async with get_db_session() as session:
    await session.execute(...)
```

### Evitar `Any`

```python
# ✅ CORRETO: Tipos específicos
def process_items(items: list[dict[str, str]]) -> list[ProcessedItem]:
    ...

# ❌ ERRADO: Any esconde erros
def process_items(items: Any) -> Any:
    ...

# Se realmente necessário, documente o porquê
def parse_json(data: str) -> dict[str, Any]:  # Any necessário para JSON genérico
    ...
```

## Patterns

### Dependency Injection

```python
# ✅ CORRETO: Dependências injetadas
class ArticleService:
    def __init__(
        self,
        db: AsyncSession,
        storage: StorageClient,
        logger: Logger,
    ):
        self.db = db
        self.storage = storage
        self.logger = logger

# ❌ ERRADO: Dependências hardcoded
class ArticleService:
    def __init__(self):
        self.db = create_session()  # Difícil de testar
        self.storage = S3Client()
```

### Factory Functions

```python
def create_extraction_pipeline(
    model: str = "gpt-4o-mini",
    max_tokens: int = 4000,
) -> ExtractionPipeline:
    """
    Factory para criar pipeline de extração.
    
    Centraliza configuração e permite fácil customização.
    """
    llm = OpenAIClient(model=model, max_tokens=max_tokens)
    processor = PDFProcessor()
    return ExtractionPipeline(llm=llm, processor=processor)
```

### Error Handling com Exceções Específicas

```python
# Definir exceções específicas
class ExtractionError(Exception):
    """Erro base de extração."""
    pass

class PDFProcessingError(ExtractionError):
    """Erro ao processar PDF."""
    pass

class LLMError(ExtractionError):
    """Erro na chamada ao LLM."""
    pass

# Usar em código
async def extract(pdf: bytes) -> str:
    try:
        text = await process_pdf(pdf)
    except PDFProcessingError:
        logger.warning("PDF processing failed, trying alternative method")
        text = await process_pdf_alternative(pdf)
    
    try:
        result = await call_llm(text)
    except LLMError as e:
        logger.error("LLM call failed", error=str(e))
        raise
    
    return result
```

## Async

### Preferir Async

```python
# ✅ CORRETO: Async para I/O
async def fetch_article(article_id: UUID) -> Article:
    async with httpx.AsyncClient() as client:
        response = await client.get(f"/articles/{article_id}")
        return Article(**response.json())

# ❌ ERRADO: Síncrono bloqueia event loop
def fetch_article(article_id: UUID) -> Article:
    response = requests.get(f"/articles/{article_id}")  # Bloqueia!
    return Article(**response.json())
```

### Concorrência com asyncio

```python
import asyncio

# Executar em paralelo
async def process_articles(article_ids: list[UUID]) -> list[Result]:
    tasks = [process_article(id) for id in article_ids]
    return await asyncio.gather(*tasks)

# Com limite de concorrência
async def process_with_limit(
    items: list[Item],
    max_concurrent: int = 5,
) -> list[Result]:
    semaphore = asyncio.Semaphore(max_concurrent)
    
    async def process_with_sem(item: Item) -> Result:
        async with semaphore:
            return await process(item)
    
    tasks = [process_with_sem(item) for item in items]
    return await asyncio.gather(*tasks)
```

## Testes

### Estrutura

```python
import pytest
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_extract_text_success():
    """Test successful text extraction."""
    # Arrange
    pdf_data = b"%PDF-1.4..."
    processor = PDFProcessor()
    
    # Act
    result = await processor.extract_text(pdf_data)
    
    # Assert
    assert isinstance(result, str)
    assert len(result) > 0

@pytest.mark.asyncio
async def test_extract_text_invalid_pdf():
    """Test error handling for invalid PDF."""
    # Arrange
    invalid_data = b"not a pdf"
    processor = PDFProcessor()
    
    # Act & Assert
    with pytest.raises(ValueError, match="Invalid PDF"):
        await processor.extract_text(invalid_data)
```

### Fixtures

```python
import pytest

@pytest.fixture
def sample_article() -> Article:
    """Fixture with sample article for tests."""
    return Article(
        id=UUID("12345678-1234-1234-1234-123456789012"),
        title="Test Article",
        abstract="Test abstract",
    )

@pytest.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Fixture with database session."""
    async with AsyncSessionLocal() as session:
        yield session
```

### Mocking

```python
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_service_calls_api():
    """Test that service calls external API correctly."""
    # Mock external dependency
    with patch("app.services.openai_service.httpx.AsyncClient") as mock_client:
        mock_response = AsyncMock()
        mock_response.json.return_value = {"choices": [{"message": {"content": "result"}}]}
        mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
        
        service = OpenAIService()
        result = await service.chat_completion([{"role": "user", "content": "test"}])
        
        assert result == "result"
```

## Checklist

Antes de considerar código Python completo:

- [ ] **Tipado**: Todas as funções têm type hints
- [ ] **Docstrings**: Funções públicas documentadas
- [ ] **Ruff**: Sem erros de lint
- [ ] **Mypy**: Sem erros de tipo
- [ ] **Async**: I/O usa async/await
- [ ] **Sem `Any`**: Tipos específicos quando possível
- [ ] **Exceções**: Específicas e documentadas
- [ ] **Testes**: Cobertura de casos principais
- [ ] **DRY**: Sem duplicação de código
- [ ] **KISS**: Simplicidade sobre complexidade

## Referências

- [Python Type Hints](https://docs.python.org/3/library/typing.html)
- [ruff Documentation](https://docs.astral.sh/ruff/)
- [mypy Documentation](https://mypy.readthedocs.io/)
- [pytest Documentation](https://docs.pytest.org/)
- `fastapi-backend-rules.mdc` - Regras específicas FastAPI
- `database-sqlalchemy-rules.mdc` - Regras de banco de dados
