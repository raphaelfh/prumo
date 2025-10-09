# Guia de Deployment - Review Hub

Este documento contém instruções para fazer deploy de migrations e edge functions no Supabase.

## Pré-requisitos

- Supabase CLI instalado (`npm install -g supabase`)
- Projeto Supabase configurado
- Credenciais de acesso ao projeto

## Configuração Inicial

### 1. Login no Supabase

```bash
supabase login
```

### 2. Link com o Projeto

```bash
supabase link --project-ref <your-project-ref>
```

Você pode encontrar o `project-ref` no dashboard do Supabase em Settings → General.

## Aplicar Migrations

### Aplicar Todas as Migrations Pendentes

```bash
supabase db push
```

Este comando irá:
1. Conectar ao banco de dados remoto
2. Verificar quais migrations ainda não foram aplicadas
3. Aplicar as migrations pendentes em ordem

### Aplicar Migration Específica

```bash
supabase db push --file supabase/migrations/<migration_file>.sql
```

### Verificar Status das Migrations

```bash
supabase migration list
```

## Deploy de Edge Functions

### Deploy de Todas as Edge Functions

```bash
supabase functions deploy
```

### Deploy de Edge Function Específica

```bash
# Zotero Import Function
supabase functions deploy zotero-import

# AI Assessment Function  
supabase functions deploy ai-assessment
```

### Configurar Variáveis de Ambiente

Edge functions podem precisar de variáveis de ambiente. Configure-as no dashboard:

1. Acesse **Edge Functions → Settings**
2. Adicione as variáveis necessárias
3. Redeploy a function

**Variáveis comuns**:
- `SUPABASE_URL` - URL do projeto (configurado automaticamente)
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (configurado automaticamente)

## Integração Zotero

A integração Zotero requer componentes específicos:

### 1. Migration

A migration `20251010000000_add_zotero_integration.sql` inclui:
- Habilitação das extensões `pgsodium` e `supabase_vault`
- Criação da tabela `zotero_integrations`
- Adição de colunas tracking do Zotero em `articles`
- Funções para gerenciar credenciais no Vault

**Status**: ✅ Aplicada com sucesso via Supabase MCP

### 2. Edge Function

A edge function `zotero-import` fornece:
- Proxy seguro para API do Zotero
- Gestão de credenciais via Vault
- Endpoints para listar collections e importar items

**Status**: ✅ Deployed com sucesso

### 3. Verificar Vault

O Supabase Vault deve estar habilitado. Verifique no SQL Editor:

```sql
select * from pg_extension where extname = 'supabase_vault';
```

Se não estiver habilitado:

```sql
create extension if not exists pgsodium;
create extension if not exists supabase_vault;
```

## Troubleshooting

### Migration Falha

**Problema**: Migration retorna erro de permissões

**Solução**: 
1. Verifique se você tem permissões de admin no projeto
2. Tente aplicar via SQL Editor no dashboard
3. Verifique se há conflitos com migrations anteriores

### Edge Function com CORS Error

**Problema**: Erro de CORS ao chamar edge function

**Solução**:
1. Verifique se a function retorna headers CORS corretos
2. Teste a function diretamente via curl:

```bash
curl -i --location --request POST 'https://<project-ref>.supabase.co/functions/v1/zotero-import' \
--header 'Authorization: Bearer <anon-key>' \
--header 'Content-Type: application/json' \
--data '{"action": "test-connection"}'
```

### Vault não Disponível

**Problema**: Erro "extension supabase_vault does not exist"

**Solução**:
1. Habilite a extensão via SQL Editor
2. Reaplique a migration de Zotero
3. Verifique o plano do Supabase (Vault pode não estar disponível no plano free)

### Edge Function Timeout

**Problema**: Edge function atinge timeout

**Solução**:
1. Otimize queries no código
2. Adicione caching quando apropriado
3. Aumente o timeout no código (máximo 150s)

## Rollback

### Reverter Migration

⚠️ **Cuidado**: Rollback pode causar perda de dados

```bash
# Listar migrations
supabase migration list

# Reverter para uma versão específica
supabase db reset --version <migration_version>
```

### Remover Edge Function

```bash
# Via dashboard: Edge Functions → Delete
# Ou recrie/redeploy com código vazio
```

## Monitoring

### Logs de Edge Functions

```bash
# Ver logs em tempo real
supabase functions serve zotero-import

# Logs no dashboard
Edge Functions → <function-name> → Logs
```

### Performance

Monitore no dashboard:
- **Database → Performance**: Query performance
- **Edge Functions → Invocations**: Uso e latência
- **Storage → Usage**: Uso de storage

## Checklist de Deploy

- [ ] Fazer backup do banco de dados
- [ ] Testar migrations localmente (se possível)
- [ ] Aplicar migrations em produção
- [ ] Verificar logs de migrations
- [ ] Deploy de edge functions
- [ ] Testar endpoints das functions
- [ ] Verificar CORS e autenticação
- [ ] Testar integração completa
- [ ] Monitorar logs por 24h

## Comandos Úteis

```bash
# Status do projeto
supabase status

# Reset database local (desenvolvimento)
supabase db reset

# Gerar tipos TypeScript
supabase gen types typescript --local > src/integrations/supabase/types.ts

# Ver configuração
supabase projects list
```

## Suporte

- [Documentação oficial do Supabase](https://supabase.com/docs)
- [Supabase CLI Reference](https://supabase.com/docs/reference/cli)
- [Community Discord](https://discord.supabase.com/)

