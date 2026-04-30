# Prumo Backend

Backend FastAPI para Prumo - Plataforma de Revisão Sistemática.

## Stack

- **FastAPI** - Framework web async para endpoints de compute/ML
- **SQLAlchemy 2.0** - ORM com suporte async (type-safe queries)
- **Pydantic v2** - Validação e serialização
- **Supabase** - Database + Auth + Storage (source of truth)
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

## Architecture: Alembic + Supabase

Este projeto usa arquitetura híbrida:

- **Alembic** como trilha principal de migrations do backend (`backend/alembic/versions`)
- **Supabase SQL migrations** para recursos de plataforma (`supabase/migrations`)
- **SQLAlchemy async** para acesso transacional no backend
- **Supabase JS SDK** no frontend para fluxos diretos e autenticação

### Schema management recomendado

1. Alterar models/contratos no backend.
2. Gerar/aplicar migration Alembic para schema `public`.
3. Manter migrations de `supabase/migrations` para recursos específicos (por exemplo, `storage` e triggers em `auth`).
4. Validar boundaries de migration antes do merge (`scripts/validate_migration_boundaries.sh`).

### Observabilidade de extração (E2E + DB)

- Endpoints e serviços de extração emitem logs estruturados com `trace_id`, `run_id` e `duration_ms`.
- Repositórios de extração emitem latência de operações de banco (`db_duration_ms`).
- Para baseline completo (browser + API + banco remoto), execute a suíte Playwright em `frontend/e2e`.
- Guia completo: `docs/extraction-e2e-observability.md`.

## Docker

```bash
docker build -t review-hub-backend .
docker run -p 8000:8000 --env-file .env review-hub-backend
```

## Licença

AGPL-3.0 - Veja [LICENSE](../LICENSE) para detalhes.

