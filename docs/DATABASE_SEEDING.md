# Database Seeding Guide

Este guia explica como aplicar seed data (dados iniciais) no banco de dados após migrations.

## O que é seed data?

O seed data inclui:

- **PROBAST**: Instrumento de avaliação global para estudos de modelos preditivos (20 items em 4 domínios)
- **CHARMS 2.0**: Template global de extração para dados de modelos preditivos (14 tipos de entidades, ~80 campos)

## 🏠 Ambiente Local (Desenvolvimento)

### Método Automático (Recomendado)

Após fazer `make reset-db`, o seed é aplicado automaticamente.

```bash
make reset-db    # Reset + Seed automático
```

### Método Manual

Se quiser aplicar o seed separadamente:

```bash
make seed        # Aplica apenas o seed data
```

Ou diretamente:

```bash
cd backend
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  uv run python -m app.seed
```

## ☁️ Ambiente de Produção (Supabase Online)

### Pré-requisitos

1. Banco de dados criado no Supabase
2. Todas as migrations aplicadas (via Supabase CLI ou Alembic)
3. DATABASE_URL do ambiente de produção
4. Acesso ao servidor/container onde o backend roda

### Opção 1: Via Render.com (Deploy Automático)

O seed é aplicado automaticamente no primeiro deploy via script de inicialização.

```yaml
# render.yaml
startCommand: |
  alembic upgrade head && \
  python -m app.seed && \
  gunicorn -k uvicorn.workers.UvicornWorker -w 4 app.main:app
```

### Opção 2: Manual (SSH / Script)

1. **Obtenha o DATABASE_URL do Supabase:**

```bash
# No dashboard do Supabase:
# Settings > Database > Connection String > URI
# Exemplo: postgresql://postgres:PASSWORD@HOST:5432/postgres
```

2. **Execute o seed script:**

```bash
# Defina a variável de ambiente
export DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@db.xxx.supabase.co:5432/postgres"

# Execute o seed
cd backend
uv run python -m app.seed
```

3. **Verifique os dados:**

```bash
# Via psql
psql "$DATABASE_URL" -c "SELECT name, version FROM assessment_instruments;"
psql "$DATABASE_URL" -c "SELECT name, framework FROM extraction_templates_global;"
```

### Opção 3: Via Supabase SQL Editor

Se não tiver acesso SSH/CLI, você pode rodar o seed via SQL diretamente no Supabase Dashboard:

1. Vá para **SQL Editor** no Supabase Dashboard
2. Execute os scripts SQL de seed manualmente (disponíveis em `supabase/migrations/0029_seed_probast_instrument.sql`)

⚠️ **Nota**: Esta opção só funciona se os seeds estiverem como migrations SQL. Para o seed Python completo, use as
opções 1 ou 2.

## 🔄 Re-seed (Aplicar novamente)

O script de seed é **idempotente** - pode ser executado múltiplas vezes com segurança:

- Se PROBAST já existe: pula a criação
- Se CHARMS já existe: pula a criação
- Se não existem: cria os dados

```bash
# Seguro executar múltiplas vezes
make seed
```

## 🧪 Verificação

### Verificar PROBAST

```sql
-- Via psql ou Supabase SQL Editor
SELECT name,
       version,
       tool_type,
       (SELECT COUNT(*) FROM assessment_items WHERE instrument_id = assessment_instruments.id) as items_count
FROM assessment_instruments
WHERE tool_type = 'PROBAST';
```

Resultado esperado:

- **name**: "PROBAST"
- **version**: "1.0.0"
- **items_count**: 20

### Verificar CHARMS

```sql
SELECT name,
       framework,
       version,
       (SELECT COUNT(*)
        FROM extraction_entity_types
        WHERE template_id = extraction_templates_global.id)    as entity_types_count,
       (SELECT COUNT(*)
        FROM extraction_fields ef
                 INNER JOIN extraction_entity_types et ON ef.entity_type_id = et.id
        WHERE et.template_id = extraction_templates_global.id) as fields_count
FROM extraction_templates_global
WHERE framework = 'CHARMS';
```

Resultado esperado:

- **name**: "CHARMS"
- **version**: "1.0.0"
- **entity_types_count**: 14
- **fields_count**: ~80

## 📋 Fluxo Completo de Deploy

### Desenvolvimento Local

```bash
# 1. Inicia Supabase local
make supabase-start

# 2. Aplica migrations Supabase
cd supabase && supabase db reset

# 3. Aplica migrations Alembic
cd backend && alembic upgrade head

# 4. Aplica seed data
make seed

# 5. Inicia backend
make backend-start
```

### Produção (Render.com)

```bash
# 1. Push código para GitHub
git push origin main

# 2. Render detecta push e faz deploy:
#    a. Build: pip install uv && uv pip install --system -e .
#    b. Start: alembic upgrade head && python -m app.seed && gunicorn ...

# 3. Verificar logs no Render Dashboard
```

### Produção (Manual)

```bash
# 1. SSH no servidor
ssh user@your-server.com

# 2. Atualiza código
git pull origin main

# 3. Aplica migrations Alembic
cd backend
alembic upgrade head

# 4. Aplica seed
DATABASE_URL="$PROD_DATABASE_URL" uv run python -m app.seed

# 5. Restart aplicação
systemctl restart review-hub-backend
```

## ⚠️ Troubleshooting

### Erro: "column target_mode does not exist"

**Causa**: Migrations do Supabase foram aplicadas, mas Alembic não.

**Solução**:

```bash
cd backend
alembic upgrade head
make seed
```

### Erro: "DATABASE_URL pointing to wrong database"

**Causa**: Variável de ambiente `DATABASE_URL` definida na shell está sobrescrevendo o .env.

**Solução**:

```bash
# Opção 1: Unset a variável
unset DATABASE_URL
make seed

# Opção 2: Override explicitamente
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" make seed
```

### Seed parece não fazer nada

**Causa**: Dados já existem (seed é idempotente).

**Verificação**:

```bash
# Verifica se já existem
psql "$DATABASE_URL" -c "SELECT name FROM assessment_instruments WHERE tool_type='PROBAST';"
psql "$DATABASE_URL" -c "SELECT name FROM extraction_templates_global WHERE framework='CHARMS';"
```

## 📚 Referências

- Script de seed: `backend/app/seed.py`
- Makefile: `Makefile` (comando `seed`)
- Render config: `backend/render.yaml`
- PROBAST definition: [www.probast.org](https://www.probast.org/)
- CHARMS checklist: [TRIPOD+AI guidelines](https://www.tripod-statement.org/)
