# Guia de Migrations e Gerenciamento de Projetos Supabase Local

Este guia explica como aplicar migrations e gerenciar múltiplos projetos Supabase que rodam no Docker.

## 📋 Aplicar Migrations no Banco Local

### Método 1: Reset Completo (Recomendado para desenvolvimento)

Este método apaga todos os dados e aplica todas as migrations do zero:

```bash
# Resetar banco local e aplicar todas as migrations
supabase db reset --local
```

**Quando usar:**
- Quando você quer garantir que todas as migrations estão aplicadas
- Quando há conflitos ou erros nas migrations
- No início do desenvolvimento ou quando há problemas

**⚠️ Atenção:** Isso apaga TODOS os dados do banco local!

### Método 2: Aplicar Migrations Pendentes

Aplicar apenas as migrations que ainda não foram executadas:

```bash
# Aplicar migrations pendentes
supabase migration up --local

# Ou usar o comando mais direto
supabase db push --local
```

**Quando usar:**
- Quando você adicionou novas migrations
- Quando quer manter os dados existentes
- Em desenvolvimento contínuo

### Método 3: Aplicar Migration Específica

```bash
# Aplicar uma migration específica
supabase migration up --local --version 20251012000008
```

### Verificar Status das Migrations

```bash
# Ver todas as migrations (local e remoto)
supabase migration list

# Ver apenas migrations locais
supabase migration list --local

# Ver apenas migrations remotas
supabase migration list --remote
```

### Resolver Problemas de Migrations

#### Erro: "function does not exist"

Se você encontrar erros como `function set_updated_at() does not exist`, isso geralmente significa:

1. **Dependência de ordem**: Uma migration está tentando usar uma função que só é criada em uma migration posterior
2. **Migration faltando**: A função deveria estar definida em uma migration anterior

**Solução:**

```bash
# Reset completo para aplicar todas na ordem correta
supabase db reset --local

# Ou verificar a ordem das migrations
ls -la supabase/migrations/
```

#### Verificar Dependências

```bash
# Ver o conteúdo de uma migration específica
cat supabase/migrations/20250930180343_a79ea370-3769-4207-81fb-561bcfae23ec.sql | grep -A 10 "CREATE.*FUNCTION"

# Verificar se uma função existe no banco
supabase db execute --local "SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name = 'set_updated_at';"
```

## 🐳 Gerenciar Múltiplos Projetos Supabase no Docker

### Listar Todos os Projetos Supabase Locais

```bash
# Listar volumes Docker de projetos Supabase
docker volume ls --filter "label=com.supabase.cli.project"

# Listar containers ativos
docker ps --filter "name=supabase" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

### Identificar Projetos por Project ID

Cada projeto Supabase local tem um `project_id` único. Você pode verificar no arquivo `supabase/config.toml`:

```bash
cat supabase/config.toml | grep project_id
```

### Gerenciar Projeto Específico

```bash
# Parar projeto específico
supabase stop --project-id <project-id>

# Iniciar projeto específico
supabase start --project-id <project-id>

# Ver status de projeto específico
supabase status --project-id <project-id>
```

### Listar Projetos e Portas

Para ver quais projetos estão usando quais portas:

```bash
# Ver containers e portas
docker ps --filter "name=supabase" --format "table {{.Names}}\t{{.Ports}}"

# Ver volumes (cada projeto tem volumes próprios)
docker volume ls --filter "label=com.supabase.cli.project" --format "table {{.Name}}"
```

### Resolver Conflitos de Porta

Se você tentar iniciar um projeto e receber erro de porta já em uso:

```bash
# Ver qual projeto está usando a porta
docker ps | grep 54321

# Parar o projeto que está usando a porta
supabase stop

# Ou parar projeto específico
supabase stop --project-id <project-id>
```

### Limpar Volumes de Projetos Antigos

⚠️ **Cuidado**: Isso apaga dados permanentemente!

```bash
# Listar volumes de projetos Supabase
docker volume ls --filter "label=com.supabase.cli.project"

# Remover volume específico (substitua pelo nome do volume)
docker volume rm supabase_db_<project-id>

# Remover todos os volumes de um projeto específico
docker volume ls --filter "label=com.supabase.cli.project=<project-id>" -q | xargs docker volume rm
```

### Backup e Restore de Dados

```bash
# Fazer backup do banco local
supabase db dump --local -f backup.sql

# Restaurar backup
supabase db reset --local
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres < backup.sql
```

## 🔄 Workflow de Desenvolvimento Recomendado

### Setup Inicial

```bash
# 1. Iniciar Supabase local
supabase start

# 2. Aplicar todas as migrations
supabase db reset --local

# 3. Verificar status
supabase status

# 4. Copiar credenciais para .env
# (veja SETUP_LOCAL.md)
```

### Durante Desenvolvimento

```bash
# 1. Criar nova migration
supabase migration new nome_da_migration

# 2. Editar o arquivo SQL em supabase/migrations/

# 3. Aplicar migration localmente
supabase migration up --local

# 4. Testar aplicação
npm run dev

# 5. Se tudo OK, aplicar no remoto
supabase db push
```

### Quando Adicionar Novas Migrations

```bash
# 1. Criar migration
supabase migration new add_nova_feature

# 2. Editar arquivo criado
# Arquivo: supabase/migrations/YYYYMMDDHHMMSS_add_nova_feature.sql

# 3. Aplicar localmente
supabase migration up --local

# 4. Verificar se aplicou
supabase migration list --local
```

## 📊 Comandos Úteis

### Verificar Estrutura do Banco

```bash
# Conectar ao banco local via psql
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres

# Ou usar o comando do Supabase
supabase db execute --local "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';"
```

### Gerar Tipos TypeScript

Após aplicar migrations, gere os tipos TypeScript:

```bash
supabase gen types typescript --local > src/integrations/supabase/types.ts
```

### Ver Logs

```bash
# Logs do Supabase local
supabase logs

# Logs de um serviço específico
supabase logs --db
supabase logs --api
supabase logs --auth
```

### Verificar Health dos Serviços

```bash
# Status completo
supabase status

# Verificar containers Docker
docker ps --filter "name=supabase"
```

## 🛠️ Troubleshooting

### Problema: Migrations não aplicam

**Sintomas:**
- `supabase migration list` mostra migrations pendentes
- `supabase migration up` falha

**Soluções:**

```bash
# 1. Reset completo
supabase db reset --local

# 2. Verificar ordem das migrations
ls -1 supabase/migrations/ | sort

# 3. Verificar erros nas migrations
supabase migration up --local --debug
```

### Problema: Porta já em uso

**Sintomas:**
- `Bind for 0.0.0.0:54321 failed: port is already allocated`

**Soluções:**

```bash
# 1. Ver qual processo está usando a porta
lsof -i :54321

# 2. Parar projeto Supabase
supabase stop

# 3. Ou parar projeto específico
supabase stop --project-id <project-id>

# 4. Verificar se ainda está rodando
docker ps | grep supabase
```

### Problema: Múltiplos projetos conflitando

**Sintomas:**
- Erro ao iniciar Supabase
- Portas conflitando

**Soluções:**

```bash
# 1. Listar todos os projetos
docker ps --filter "name=supabase"

# 2. Parar todos
supabase stop

# 3. Iniciar apenas o projeto atual
cd /caminho/do/projeto
supabase start

# 4. Verificar qual projeto está ativo
supabase status
```

### Problema: Dados perdidos após reset

**Solução:**
- Sempre faça backup antes de reset:
```bash
supabase db dump --local -f backup_$(date +%Y%m%d).sql
```

## 📝 Checklist de Migrations

Antes de aplicar migrations em produção:

- [ ] Testar migrations localmente com `supabase db reset --local`
- [ ] Verificar se não há erros de sintaxe SQL
- [ ] Verificar dependências entre migrations
- [ ] Fazer backup do banco de produção
- [ ] Aplicar migrations em staging primeiro
- [ ] Verificar logs após aplicar
- [ ] Gerar novos tipos TypeScript
- [ ] Testar aplicação após migrations

## 🔗 Referências

- [Supabase CLI Documentation](https://supabase.com/docs/reference/cli)
- [Supabase Migrations Guide](https://supabase.com/docs/guides/cli/local-development#database-migrations)
- [Docker Volume Management](https://docs.docker.com/storage/volumes/)






