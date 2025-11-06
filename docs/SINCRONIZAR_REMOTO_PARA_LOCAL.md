# Guia: Sincronizar Projeto Supabase Remoto para Local

Este guia explica como capturar **tudo** do seu projeto Supabase online (tabelas, policies RLS, funções, triggers, extensões, etc.) e replicar no ambiente local.

## 📋 Pré-requisitos

1. **Supabase CLI instalado e atualizado**
   ```bash
   supabase --version
   # Se não tiver: npm install -g supabase
   ```

2. **Login no Supabase CLI**
   ```bash
   supabase login
   ```

3. **Projeto já linkado**
   ```bash
   # Verificar se está linkado
   cat supabase/config.toml | grep project_id
   
   # Se não estiver linkado:
   supabase link --project-ref <seu-project-ref>
   ```

4. **Docker rodando** (para o Supabase local)

## 🎯 Método 1: Sincronizar Migrations (Recomendado)

Este método sincroniza as migrations do projeto remoto que ainda não estão no local.

### Passo 1: Verificar Status Atual

```bash
# Ver migrations locais
supabase migration list --local

# Ver migrations remotas
supabase migration list --remote

# Comparar diferenças
supabase db diff
```

### Passo 2: Puxar Migrations Novas do Remoto

```bash
# Puxar todas as migrations que existem no remoto mas não no local
supabase db pull

# Isso criará novos arquivos em supabase/migrations/
```

### Passo 3: Aplicar no Local

```bash
# Iniciar Supabase local (se não estiver rodando)
supabase start

# Aplicar todas as migrations no local
supabase db reset --local
```

**⚠️ Atenção**: `db reset` apaga todos os dados locais e aplica todas as migrations do zero.

## 🔄 Método 2: Dump Completo do Schema (Políticas de RLS)

Se você criou policies RLS diretamente no dashboard (não via migrations), o método 1 não vai capturá-las. Use este método:

### Passo 1: Fazer Dump do Schema Remoto

```bash
# Fazer dump completo do schema (sem dados)
supabase db dump --remote --schema-only -f supabase/remote_schema_dump.sql

# Ou com dados também (se quiser)
supabase db dump --remote -f supabase/remote_full_dump.sql
```

### Passo 2: Analisar o Dump

```bash
# Ver o conteúdo do dump
cat supabase/remote_schema_dump.sql | less

# Procurar por policies RLS
grep -i "CREATE POLICY" supabase/remote_schema_dump.sql

# Procurar por funções
grep -i "CREATE FUNCTION" supabase/remote_schema_dump.sql

# Procurar por triggers
grep -i "CREATE TRIGGER" supabase/remote_schema_dump.sql
```

### Passo 3: Criar Migration com o Schema

Você pode criar uma nova migration manualmente ou aplicar o dump:

```bash
# Opção A: Criar migration manualmente
supabase migration new sync_remote_schema

# Depois copiar as partes relevantes do dump para a migration
# (apenas o que não está nas migrations existentes)

# Opção B: Aplicar o dump diretamente no local (não recomendado para produção)
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres < supabase/remote_schema_dump.sql
```

## 🔍 Método 3: Comparação Detalhada (Mais Preciso)

Este método compara o estado atual e mostra exatamente o que está diferente.

### Passo 1: Comparar Schema Local vs Remoto

```bash
# Ver diferenças de schema
supabase db diff

# Salvar diff em arquivo
supabase db diff > schema_diff.sql

# Ver o diff
cat schema_diff.sql
```

### Passo 2: Aplicar as Diferenças

```bash
# Se o diff mostrar apenas migrations, use:
supabase db pull

# Se o diff mostrar mudanças de schema diretas, crie uma migration:
supabase migration new apply_remote_changes
# Depois copie o conteúdo do schema_diff.sql para a migration
```

## 📊 Capturar Específicos

### Capturar Apenas Policies RLS

```bash
# Dump apenas de policies RLS
supabase db dump --remote --schema-only | grep -A 20 "CREATE POLICY" > supabase/rls_policies.sql

# Ver policies
cat supabase/rls_policies.sql
```

### Capturar Apenas Funções

```bash
# Dump apenas de funções
supabase db dump --remote --schema-only | grep -A 50 "CREATE FUNCTION" > supabase/functions_dump.sql

# Ver funções
cat supabase/functions_dump.sql
```

### Capturar Apenas Triggers

```bash
# Dump apenas de triggers
supabase db dump --remote --schema-only | grep -A 10 "CREATE TRIGGER" > supabase/triggers_dump.sql

# Ver triggers
cat supabase/triggers_dump.sql
```

## 🎯 Workflow Completo Recomendado

### Cenário: Primeira Sincronização (Setup Inicial)

```bash
# 1. Verificar link com projeto remoto
supabase link --project-ref <seu-project-ref>

# 2. Puxar todas as migrations do remoto
supabase db pull

# 3. Iniciar Supabase local
supabase start

# 4. Aplicar todas as migrations
supabase db reset --local

# 5. Fazer dump do schema remoto para verificar policies/triggers
supabase db dump --remote --schema-only -f supabase/remote_schema_dump.sql

# 6. Comparar com o que foi aplicado
supabase db diff

# 7. Se houver diferenças, criar migration manual
supabase migration new sync_missing_policies
# Editar o arquivo criado com as policies/triggers faltantes

# 8. Aplicar nova migration
supabase db reset --local

# 9. Verificar que está tudo sincronizado
supabase db diff

# 10. Gerar tipos TypeScript
supabase gen types typescript --local > src/integrations/supabase/types.ts
```

### Cenário: Sincronização Contínua (Durante Desenvolvimento)

```bash
# 1. Verificar se há mudanças no remoto
supabase db diff

# 2. Se houver mudanças, puxar migrations
supabase db pull

# 3. Aplicar no local
supabase migration up --local

# 4. Verificar se está tudo OK
supabase db diff
```

## 🔍 Verificar o Que Foi Capturado

### Ver Todas as Tabelas

```bash
# Local
supabase db execute --local "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"

# Remoto (via psql ou dashboard)
```

### Ver Todas as Policies RLS

```bash
# Local
supabase db execute --local "SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;"

# Ou via SQL dump
supabase db dump --local --schema-only | grep "CREATE POLICY"
```

### Ver Todas as Funções

```bash
# Local
supabase db execute --local "SELECT routine_name, routine_type FROM information_schema.routines WHERE routine_schema = 'public' ORDER BY routine_name;"

# Ou via SQL dump
supabase db dump --local --schema-only | grep "CREATE FUNCTION"
```

### Ver Todas as Extensões

```bash
# Local
supabase db execute --local "SELECT extname, extversion FROM pg_extension ORDER BY extname;"
```

## ⚠️ Cuidados Importantes

### 1. Policies Criadas via Dashboard

Se você criou policies RLS diretamente no dashboard do Supabase, elas **NÃO** estarão nas migrations. Você precisa:

- Criar uma migration manualmente com essas policies
- Ou usar `supabase db dump` para capturá-las

### 2. Funções e Triggers Customizados

Funções e triggers criados via dashboard também precisam ser migrados manualmente.

### 3. Dados de Seed

Se você tem dados de seed no remoto que não estão em migrations:

```bash
# Dump apenas de dados (sem schema)
supabase db dump --remote --data-only -f supabase/seed_data.sql

# Aplicar no local
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres < supabase/seed_data.sql
```

### 4. Storage Buckets e Configurações

Storage buckets e suas políticas não são capturadas automaticamente. Você precisa:

1. Criar manualmente no local via Studio ou CLI
2. Ou documentar e criar via migrations

```bash
# Ver buckets no remoto (via dashboard ou API)
# Criar no local via Studio: http://127.0.0.1:54323
```

## 🛠️ Troubleshooting

### Erro: "Project not linked"

```bash
# Fazer login
supabase login

# Linkar projeto
supabase link --project-ref <seu-project-ref>
```

### Erro: "Cannot connect to remote database"

```bash
# Verificar se está logado
supabase projects list

# Verificar link
cat supabase/config.toml
```

### Dump muito grande ou lento

```bash
# Dump apenas schema (sem dados) - muito mais rápido
supabase db dump --remote --schema-only -f schema.sql

# Dump apenas de tabelas específicas
supabase db dump --remote --table public.users --table public.projects -f partial_dump.sql
```

### Policies não aparecem no dump

```bash
# Verificar se policies estão sendo capturadas
supabase db dump --remote --schema-only | grep -i "policy"

# Se não aparecer, pode ser que estejam em um schema diferente
supabase db dump --remote --schema-only | grep -i "policy" -A 5
```

## 📝 Checklist de Sincronização

Após sincronizar, verifique:

- [ ] Todas as migrations foram aplicadas (`supabase migration list --local`)
- [ ] Todas as tabelas existem (`supabase db execute --local "SELECT ..."`)
- [ ] Todas as policies RLS foram aplicadas (`grep "CREATE POLICY"`)
- [ ] Todas as funções foram criadas (`grep "CREATE FUNCTION"`)
- [ ] Todas as extensões estão habilitadas (`SELECT extname FROM pg_extension`)
- [ ] Tipos TypeScript foram gerados (`supabase gen types typescript --local`)
- [ ] Não há diferenças entre local e remoto (`supabase db diff`)

## 🔗 Referências

- [Supabase CLI: db pull](https://supabase.com/docs/reference/cli/supabase-db-pull)
- [Supabase CLI: db dump](https://supabase.com/docs/reference/cli/supabase-db-dump)
- [Supabase CLI: db diff](https://supabase.com/docs/reference/cli/supabase-db-diff)
- [Supabase Migrations Guide](https://supabase.com/docs/guides/cli/local-development#database-migrations)


