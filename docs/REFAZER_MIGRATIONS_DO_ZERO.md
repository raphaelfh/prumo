# Guia: Refazer Migrations do Zero

Este guia explica como refazer completamente as migrations do Supabase, partindo do estado atual do projeto remoto (que está correto) e criando uma migration inicial limpa.

## 🎯 Objetivo

- **Problema**: Migrations confusas, duplicadas, com dados incongruentes
- **Solução**: Criar uma única migration inicial baseada no estado atual do remoto
- **Resultado**: Schema limpo e organizado, sem histórico de migrations problemáticas

## ⚠️ ATENÇÃO: Este Processo é Destrutivo

Este processo vai:
1. **Fazer backup** de todas as migrations atuais
2. **Limpar** todas as migrations antigas
3. **Criar** uma nova migration inicial baseada no estado remoto
4. **Aplicar** no local e depois no remoto

**IMPORTANTE**: Sempre faça backup antes de começar!

## 📋 Pré-requisitos

1. **Acesso ao projeto Supabase remoto** (você tem)
2. **Supabase CLI instalado e logado**
   ```bash
   supabase login
   supabase link --project-ref <seu-project-ref>
   ```
3. **Docker rodando** (para Supabase local)
4. **Backup do banco remoto** (recomendado fazer via dashboard)

## 🚀 Processo Completo

### Passo 1: Fazer Backup de Tudo

```bash
# 1. Backup das migrations atuais
mkdir -p supabase/migrations_backup
cp -r supabase/migrations/* supabase/migrations_backup/

# 2. Backup do schema remoto
supabase db dump --remote --schema-only -f supabase/backup_schema_remoto_$(date +%Y%m%d).sql

# 3. Backup dos dados (opcional, mas recomendado)
supabase db dump --remote --data-only -f supabase/backup_dados_remoto_$(date +%Y%m%d).sql
```

### Passo 2: Analisar o Schema Remoto

```bash
# Ver o dump do schema
cat supabase/backup_schema_remoto_*.sql | less

# Contar tabelas, policies, funções
grep -c "CREATE TABLE" supabase/backup_schema_remoto_*.sql
grep -c "CREATE POLICY" supabase/backup_schema_remoto_*.sql
grep -c "CREATE FUNCTION" supabase/backup_schema_remoto_*.sql
grep -c "CREATE TRIGGER" supabase/backup_schema_remoto_*.sql
```

### Passo 3: Limpar Migrations Antigas

```bash
# ATENÇÃO: Isso vai remover todas as migrations
# Certifique-se de ter feito backup (Passo 1)

# Mover migrations antigas para backup
mv supabase/migrations/*.sql supabase/migrations_backup/

# Ou deletar (se tiver certeza)
# rm supabase/migrations/*.sql
```

### Passo 4: Criar Nova Migration Inicial

```bash
# Criar nova migration inicial
supabase migration new initial_schema

# Isso cria: supabase/migrations/YYYYMMDDHHMMSS_initial_schema.sql
```

### Passo 5: Popular a Nova Migration

Agora você precisa copiar o conteúdo do dump do schema remoto para a nova migration. Mas antes, vamos limpar e organizar o dump:

```bash
# 1. Gerar dump limpo e organizado
supabase db dump --remote --schema-only -f supabase/schema_limpo.sql

# 2. Editar o arquivo da migration
# Abra: supabase/migrations/YYYYMMDDHHMMSS_initial_schema.sql
```

**O que incluir na migration inicial:**
- ✅ Extensões (`CREATE EXTENSION`)
- ✅ Tipos ENUM (`CREATE TYPE`)
- ✅ Funções (`CREATE FUNCTION`)
- ✅ Tabelas (`CREATE TABLE`)
- ✅ Constraints, índices, foreign keys
- ✅ Triggers (`CREATE TRIGGER`)
- ✅ Policies RLS (`CREATE POLICY`)
- ✅ Views (`CREATE VIEW`)
- ❌ Dados (não incluir `INSERT` statements)

**O que NÃO incluir:**
- ❌ Dados de seed/insert
- ❌ Comentários de debug temporários
- ❌ Código experimental

### Passo 6: Limpar e Organizar o Dump

O dump do Supabase pode ter algumas coisas desnecessárias. Use este script para limpar:

```bash
# Executar script de limpeza (veja scripts/clean-schema-dump.sh)
./scripts/clean-schema-dump.sh supabase/schema_limpo.sql
```

### Passo 7: Testar Localmente

```bash
# 1. Resetar banco local
supabase db reset --local

# 2. Verificar se aplicou sem erros
supabase status

# 3. Verificar schema
supabase db execute --local "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"

# 4. Verificar policies
supabase db execute --local "SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public';"

# 5. Gerar tipos TypeScript
supabase gen types typescript --local > src/integrations/supabase/types.ts
```

### Passo 8: Verificar Diferenças

```bash
# Comparar local com remoto (deve mostrar apenas diferenças de dados, não schema)
supabase db diff
```

Se houver diferenças de schema, ajuste a migration e repita o Passo 7.

### Passo 9: Aplicar no Remoto (CUIDADO!)

**⚠️ ATENÇÃO**: Isso vai resetar o histórico de migrations no remoto!

```bash
# 1. Verificar status atual das migrations no remoto
supabase migration list --remote

# 2. Fazer backup final do remoto
supabase db dump --remote --schema-only -f supabase/backup_final_antes_reset.sql

# 3. Resetar migrations no remoto
# ATENÇÃO: Isso marca todas as migrations como aplicadas sem executá-las
supabase db remote commit

# 4. Aplicar a nova migration
supabase db push
```

**OU** se você quiser fazer isso de forma mais controlada:

1. No dashboard do Supabase, vá em **Database → Migrations**
2. Marque manualmente que a nova migration foi aplicada
3. Ou use `supabase migration repair` se necessário

## 🔄 Alternativa: Método Mais Seguro (Sem Reset no Remoto)

Se você não quiser resetar o histórico no remoto, pode fazer assim:

### Opção A: Criar Migration "Baseline"

```bash
# 1. Criar migration de baseline que marca o estado atual
supabase migration new baseline_current_state

# 2. Deixar a migration vazia (apenas comentário)
# Isso marca que o estado atual está correto

# 3. A partir daí, todas as novas migrations serão incrementais
```

### Opção B: Migrations Incrementais a Partir do Zero

```bash
# 1. Manter migrations antigas em backup
# 2. Criar nova migration inicial limpa
# 3. Aplicar apenas no local para desenvolvimento
# 4. No remoto, continuar usando as migrations antigas
# 5. Quando estiver tudo testado, migrar o remoto
```

## 📝 Estrutura Recomendada da Migration Inicial

A migration inicial deve estar organizada assim:

```sql
-- =====================================================
-- MIGRATION INICIAL: Schema Completo do Review Hub
-- =====================================================
-- Data: YYYY-MM-DD
-- Descrição: Schema completo baseado no estado atual do projeto remoto
-- =====================================================

-- =================== EXTENSÕES ===================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- ... outras extensões

-- =================== TIPOS ENUM ===================
CREATE TYPE extraction_framework AS ENUM (...);
-- ... outros tipos

-- =================== FUNÇÕES ===================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- ... outras funções

-- =================== TABELAS ===================
-- Ordem: tabelas sem dependências primeiro
CREATE TABLE users (...);
CREATE TABLE projects (...);
-- ... outras tabelas

-- =================== CONSTRAINTS E ÍNDICES ===================
-- Foreign keys
ALTER TABLE projects ADD CONSTRAINT fk_projects_user_id 
  FOREIGN KEY (user_id) REFERENCES users(id);

-- Índices
CREATE INDEX idx_projects_user_id ON projects(user_id);

-- =================== TRIGGERS ===================
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =================== ROW LEVEL SECURITY ===================
-- Policies RLS
CREATE POLICY "Users can view own projects"
  ON projects FOR SELECT
  USING (auth.uid() = user_id);

-- =================== VIEWS ===================
CREATE VIEW project_summary AS
SELECT ...;
```

## 🛠️ Scripts Auxiliares

### Script 1: Limpar Dump do Schema

```bash
#!/bin/bash
# scripts/clean-schema-dump.sh

# Remove comentários de debug, ajusta formatação, etc.
# (veja scripts/clean-schema-dump.sh)
```

### Script 2: Validar Migration

```bash
#!/bin/bash
# scripts/validate-migration.sh

# Valida se a migration tem tudo necessário
# (veja scripts/validate-migration.sh)
```

## ✅ Checklist Final

Antes de considerar completo:

- [ ] Backup das migrations antigas feito
- [ ] Backup do schema remoto feito
- [ ] Backup dos dados remotos feito (opcional)
- [ ] Nova migration inicial criada
- [ ] Migration testada localmente (`supabase db reset --local`)
- [ ] Schema local idêntico ao remoto (`supabase db diff` mostra apenas dados)
- [ ] Tipos TypeScript gerados
- [ ] Aplicação funciona localmente
- [ ] Documentação atualizada
- [ ] Migrations antigas movidas para backup (não deletadas)

## 🔍 Verificações Pós-Migração

```bash
# 1. Verificar tabelas
supabase db execute --local "
  SELECT table_name 
  FROM information_schema.tables 
  WHERE table_schema = 'public' 
  ORDER BY table_name;
"

# 2. Verificar policies RLS
supabase db execute --local "
  SELECT tablename, policyname, cmd 
  FROM pg_policies 
  WHERE schemaname = 'public' 
  ORDER BY tablename, policyname;
"

# 3. Verificar funções
supabase db execute --local "
  SELECT routine_name, routine_type 
  FROM information_schema.routines 
  WHERE routine_schema = 'public' 
  ORDER BY routine_name;
"

# 4. Verificar triggers
supabase db execute --local "
  SELECT trigger_name, event_object_table, action_statement 
  FROM information_schema.triggers 
  WHERE trigger_schema = 'public' 
  ORDER BY event_object_table, trigger_name;
"

# 5. Comparar com remoto
supabase db diff
```

## 🚨 Troubleshooting

### Erro: "Migration already applied"

```bash
# Resetar histórico local
supabase db reset --local
```

### Erro: "Function does not exist"

Verifique a ordem: funções devem vir antes das tabelas/triggers que as usam.

### Erro: "Policy already exists"

O dump pode ter duplicatas. Use o script de limpeza ou remova manualmente.

### Schema diferente do esperado

```bash
# Comparar novamente
supabase db diff > diff.sql
cat diff.sql
# Ajustar migration conforme necessário
```

## 📚 Próximos Passos

Após refazer as migrations:

1. **Documentar mudanças**: Crie um `CHANGELOG.md` com o que foi consolidado
2. **Padronizar**: Estabeleça padrões para futuras migrations
3. **Versionar**: Use tags no git para marcar este ponto
4. **Testar**: Rode todos os testes após a mudança

## 🔗 Referências

- [Supabase Migrations Guide](https://supabase.com/docs/guides/cli/local-development#database-migrations)
- [Supabase CLI: db dump](https://supabase.com/docs/reference/cli/supabase-db-dump)
- [Supabase CLI: db reset](https://supabase.com/docs/reference/cli/supabase-db-reset)


