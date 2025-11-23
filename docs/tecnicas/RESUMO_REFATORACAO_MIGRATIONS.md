# 🎯 Resumo: Refatoração de Migrations

## Problema Atual
- ✅ 45+ migrations com histórico confuso
- ✅ Migrations duplicadas (ex: `20251011000003` tem 2 versões)
- ✅ Migrations de "cleanup" e "reset" que complicam o histórico
- ✅ Dados incongruentes entre migrations
- ✅ Dificuldade de entender o estado atual do schema

## Solução Proposta
**Refazer do zero**: Criar uma única migration inicial baseada no estado atual do remoto (que está correto).

## Processo Rápido (3 Passos)

### 1️⃣ Executar Script Automatizado
```bash
./scripts/refazer-migrations.sh
```

O script vai:
- ✅ Fazer backup de tudo
- ✅ Gerar dump do schema remoto
- ✅ Limpar migrations antigas
- ✅ Criar nova migration inicial

### 2️⃣ Editar a Nova Migration
1. Abra o arquivo criado: `supabase/migrations/YYYYMMDDHHMMSS_initial_schema_from_remote.sql`
2. Copie o conteúdo do dump: `supabase/schema_remoto_*.sql`
3. Limpe o dump (remova INSERTs, comentários de debug)
   - Ou use: `./scripts/clean-schema-dump.sh supabase/schema_remoto_*.sql`

### 3️⃣ Testar e Aplicar
```bash
# Testar localmente
supabase db reset --local

# Verificar se está tudo OK
supabase db diff

# Gerar tipos TypeScript
supabase gen types typescript --local > src/integrations/supabase/types.ts
```

## 📋 Checklist Completo

### Antes de Começar
- [ ] Backup do banco remoto feito (via dashboard)
- [ ] Supabase CLI logado (`supabase login`)
- [ ] Projeto linkado (`supabase link`)
- [ ] Docker rodando

### Durante o Processo
- [ ] Script executado (`./scripts/refazer-migrations.sh`)
- [ ] Backup automático criado
- [ ] Dump do schema gerado
- [ ] Nova migration criada
- [ ] Migration editada e limpa

### Após Criar a Migration
- [ ] Testada localmente (`supabase db reset --local`)
- [ ] Schema local idêntico ao remoto (`supabase db diff`)
- [ ] Tipos TypeScript gerados
- [ ] Aplicação funciona localmente

### Antes de Aplicar no Remoto
- [ ] Backup final do remoto feito
- [ ] Migration testada e validada localmente
- [ ] Documentação atualizada
- [ ] Time avisado (se aplicável)

## 🚨 Atenções Importantes

### ⚠️ O que será perdido
- **Histórico de migrations**: O histórico incremental será substituído por uma migration única
- **Dados de desenvolvimento local**: `supabase db reset` apaga dados locais

### ✅ O que será preservado
- **Dados do remoto**: Nenhum dado será perdido no remoto
- **Schema completo**: Todo o schema será preservado
- **Backups**: Todas as migrations antigas serão salvas em backup

### 🔄 Estratégias de Migração

#### Opção 1: Reset Completo (Recomendado para Dev)
```bash
# Local: reset completo
supabase db reset --local

# Remoto: aplicar nova migration como baseline
supabase db push
```

#### Opção 2: Baseline Sem Reset (Mais Seguro)
```bash
# Criar migration de baseline vazia
supabase migration new baseline_current_state
# Deixar vazia (apenas marca o estado atual)

# A partir daí, novas migrations incrementais
```

## 📁 Estrutura de Arquivos Após Refatoração

```
supabase/
├── migrations/
│   └── YYYYMMDDHHMMSS_initial_schema_from_remote.sql  ← Nova migration única
├── migrations_backup_YYYYMMDD_HHMMSS/                  ← Backup das antigas
│   └── [todas as migrations antigas]
├── schema_remoto_YYYYMMDD_HHMMSS.sql                  ← Dump do schema
└── schema_remoto_YYYYMMDD_HHMMSS_limpo.sql           ← Dump limpo (opcional)
```

## 🔍 Comandos Úteis

### Verificar Estado Atual
```bash
# Ver migrations locais
supabase migration list --local

# Ver migrations remotas
supabase migration list --remote

# Comparar schema
supabase db diff
```

### Validar Migration
```bash
# Reset local
supabase db reset --local

# Verificar tabelas
supabase db execute --local "
  SELECT table_name 
  FROM information_schema.tables 
  WHERE table_schema = 'public';
"

# Verificar policies
supabase db execute --local "
  SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public';
"
```

### Limpar e Organizar
```bash
# Limpar dump do schema
./scripts/clean-schema-dump.sh supabase/schema_remoto_*.sql

# Ver estatísticas do schema
grep -c "CREATE TABLE" supabase/schema_remoto_*.sql
grep -c "CREATE POLICY" supabase/schema_remoto_*.sql
```

## 📚 Documentação Completa

- **Guia detalhado**: `docs/REFAZER_MIGRATIONS_DO_ZERO.md`
- **Sincronização remoto→local**: `docs/SINCRONIZAR_REMOTO_PARA_LOCAL.md`
- **Setup local**: `docs/SETUP_LOCAL.md`
- **Gerenciamento**: `docs/MIGRATIONS_E_GERENCIAMENTO.md`

## 🆘 Precisa de Ajuda?

### Erros Comuns

**"Migration already applied"**
```bash
supabase db reset --local
```

**"Function does not exist"**
- Verifique a ordem: funções devem vir antes das tabelas/triggers

**"Schema diferente do remoto"**
```bash
supabase db diff > diff.sql
cat diff.sql
# Ajuste a migration conforme necessário
```

## ✅ Resultado Final

Após a refatoração, você terá:
- ✅ **1 migration inicial** limpa e organizada
- ✅ **Schema completo** baseado no estado atual (correto)
- ✅ **Histórico limpo** sem migrations confusas
- ✅ **Fácil manutenção** para futuras migrations
- ✅ **Backup completo** de tudo que foi removido


