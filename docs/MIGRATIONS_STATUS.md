# Status das Migrations - Review Hub

## ✅ Correções Aplicadas

A migration `20250103000000_create_extraction_module.sql` foi corrigida para remover dependências de tabelas que são criadas em migrations posteriores:

1. **Função `set_updated_at()`**: Adicionada no início da migration
2. **Foreign Keys removidas temporariamente**: 
   - `projects` → será adicionada em migration posterior
   - `profiles` → será adicionada em migration posterior  
   - `articles` → será adicionada em migration posterior
   - `article_files` → será adicionada em migration posterior
3. **Políticas RLS simplificadas**:
   - Referências a `profiles` substituídas por `auth.uid() IS NOT NULL`
   - Funções `is_project_member()` e `is_project_manager()` substituídas temporariamente

## ⚠️ Problemas Encontrados

1. **Constraint violation**: Migration `20250103000001_seed_charms_template_fixed.sql` pode estar tentando inserir dados que violam constraints
2. **Ordem de migrations**: Algumas migrations dependem de estruturas criadas em migrations posteriores

## 🔧 Como Aplicar Migrations

### Opção 1: Reset Completo (Recomendado)

```bash
# Aplicar todas as migrations do zero
supabase db reset --local
```

### Opção 2: Aplicar Migrations Pendentes

```bash
# Verificar status
supabase migration list --local

# Aplicar pendentes
supabase migration up --local
```

### Opção 3: Aplicar Migration Específica

```bash
# Aplicar uma migration específica
supabase migration up --local --version <version>
```

## 📊 Status Atual

- **Total de migrations**: 45
- **Banco local**: ✅ Rodando
- **Migrations aplicadas**: Verificar com `supabase migration list --local`

## 🐳 Gerenciar Projetos Supabase

### Listar Projetos Ativos

```bash
# Ver containers Docker
docker ps --filter "name=supabase"

# Ver volumes (cada projeto tem volumes próprios)
docker volume ls --filter "label=com.supabase.cli.project"
```

### Identificar Project ID

O project ID está no arquivo `supabase/config.toml`:
```bash
cat supabase/config.toml | grep project_id
```

### Gerenciar Projeto Específico

```bash
# Parar projeto específico
supabase stop --project-id <project-id>

# Iniciar projeto específico  
supabase start --project-id <project-id>

# Ver status
supabase status --project-id <project-id>
```

### Parar Todos os Projetos

```bash
supabase stop
```

### Limpar Volumes Antigos (⚠️ CUIDADO!)

```bash
# Listar volumes
docker volume ls --filter "label=com.supabase.cli.project"

# Remover volume específico
docker volume rm <volume-name>
```

## 🔍 Troubleshooting

### Erro: "function does not exist"
- Verifique se a função está sendo criada antes de ser usada
- Use `supabase db reset --local` para aplicar todas na ordem

### Erro: "relation does not exist"  
- A migration está tentando referenciar tabela que ainda não existe
- Verifique a ordem das migrations: `ls -1 supabase/migrations/ | sort`

### Erro: "constraint violation"
- Dados de seed podem estar violando constraints
- Verifique os dados na migration de seed
- Temporariamente comente os inserts problemáticos

### Porta já em uso
```bash
# Ver qual processo está usando
lsof -i :54321

# Parar projeto Supabase
supabase stop
```

## 📝 Próximos Passos

1. ✅ Corrigir migration inicial (feito)
2. ⏳ Verificar e corrigir migrations de seed se necessário
3. ⏳ Adicionar foreign keys em migration posterior quando tabelas base existirem
4. ⏳ Ajustar políticas RLS em migration posterior
5. ⏳ Testar todas as migrations aplicadas

## 🔗 Referências

- [Guia Completo de Migrations](./MIGRATIONS_E_GERENCIAMENTO.md)
- [Setup Local](./SETUP_LOCAL.md)






