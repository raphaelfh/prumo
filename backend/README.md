# Review Hub Backend

Backend FastAPI para Review Hub - Plataforma de Revisão Sistemática.

## Stack

- **FastAPI** - Framework web async
- **SQLAlchemy 2.0** - ORM com suporte async
- **Pydantic v2** - Validação e serialização
- **PostgreSQL** - Banco de dados (via Supabase)
- **OpenAI** - Integração com LLMs

## Requisitos

- Python 3.11+
- uv (recomendado) ou pip

## Setup

### 1. Instalar dependências

```bash
# Com uv (recomendado)
uv sync

# Ou com pip
pip install -e ".[dev]"
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
# Editar .env com suas credenciais
```

### 3. Executar em desenvolvimento

```bash
uvicorn app.main:app --reload --port 8000
```

## Estrutura

```
backend/
├── app/
│   ├── api/v1/          # Endpoints da API
│   ├── core/            # Config, security, deps
│   ├── models/          # SQLAlchemy models
│   ├── schemas/         # Pydantic schemas
│   ├── services/        # Business logic
│   └── utils/           # Utilities
├── tests/               # Testes
├── pyproject.toml       # Dependências
└── Dockerfile           # Container
```

## Endpoints

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/health` | GET | Health check |
| `/api/v1/zotero/{action}` | POST | Integração Zotero |
| `/api/v1/assessment/ai` | POST | Avaliação AI |
| `/api/v1/extraction/models` | POST | Extração de modelos |
| `/api/v1/extraction/sections` | POST | Extração de seções |

## Testes

```bash
pytest
```

### Banco para testes de integração

Os testes de integração esperam um Postgres com o schema do Supabase aplicado.

Para aplicar as migrations SQL localmente em um Postgres apontado por `DATABASE_URL`:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres_test \
  bash scripts/apply_supabase_migrations.sh
```

## Docker

```bash
docker build -t review-hub-backend .
docker run -p 8000:8000 --env-file .env review-hub-backend
```

## Licença

AGPL-3.0 - Veja [LICENSE](../LICENSE) para detalhes.

