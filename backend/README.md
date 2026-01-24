# Review Hub Backend

Backend FastAPI para Review Hub - Plataforma de Revisão Sistemática.

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

## Architecture: Supabase-First

Este projeto usa uma arquitetura **Supabase-First**:

### Schema Management
- **Source of Truth**: Supabase migrations (`supabase/migrations/*.sql`)
- **Schema Changes**: Use `supabase db diff` e `supabase db push`
- **No Alembic**: Migrations são gerenciadas pelo Supabase CLI

### Data Access Patterns
| Layer | Tool | Use Case |
|-------|------|----------|
| Frontend | Supabase JS SDK | CRUD simples, real-time, autenticação |
| Backend | SQLAlchemy (async) | Queries complexas, ML pipelines, computação pesada |

### Workflow para Mudanças no Schema

```bash
# 1. Fazer mudança no Supabase Dashboard ou escrever migration SQL
supabase db diff -f add_new_feature

# 2. Revisar migration gerada
cat supabase/migrations/[timestamp]_add_new_feature.sql

# 3. Aplicar localmente
supabase db push

# 4. Atualizar SQLAlchemy models manualmente
# Editar backend/app/models/*.py para refletir mudanças

# 5. Deploy para produção
supabase db push --linked
```

### Por que Supabase-First?

- **Frontend Velocity**: React acessa diretamente via Supabase SDK (RLS nativo)
- **Backend Focus**: FastAPI dedicado a ML/compute (PyTorch, LLMs), não CRUD
- **Database Branching**: Supabase oferece branching estilo git (2026 feature)
- **Type Safety**: SQLAlchemy models servem como type hints, não como schema source

## Docker

```bash
docker build -t review-hub-backend .
docker run -p 8000:8000 --env-file .env review-hub-backend
```

## Licença

AGPL-3.0 - Veja [LICENSE](../LICENSE) para detalhes.

