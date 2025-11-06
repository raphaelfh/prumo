# Como o Cursor Agent Acessa Variáveis de Ambiente

## Visão Geral

O **Cursor agent pode ler arquivos `.env`**, mas por padrão ele pode estar bloqueado se o arquivo estiver no `.gitignore`. Para permitir o acesso, você precisa configurar o arquivo `.cursorignore`.

## Solução: Configurar `.cursorignore`

O Cursor usa um arquivo `.cursorignore` (similar ao `.gitignore`) para determinar quais arquivos o agent pode acessar. Se o `.env` estiver bloqueado, você precisa permitir explicitamente.

## Como Funciona

### 1. Criar/Configurar o `.cursorignore`

O arquivo `.cursorignore` controla o que o Cursor agent pode acessar. Para permitir acesso ao `.env`:

1. **Crie o arquivo `.cursorignore` na raiz do projeto** (se não existir)
2. **Adicione regras de permissão explícita** para arquivos `.env`:

```gitignore
# Permitir explicitamente arquivos .env
!.env
!.env.local
!.env.*
!.env.example
```

**Importante**: Use `!` antes do padrão para **permitir** (negando a exclusão).

### 2. O Agent Pode Ler o `.env` Após Configuração

Após configurar o `.cursorignore`, o Cursor agent pode usar:

- `read_file('.env')` - para ler o arquivo diretamente
- `grep` - para buscar por padrões no `.env`
- `codebase_search` - para buscar semanticamente

**Exemplo de uso pelo agent:**
```typescript
// O agent pode fazer isso após configurar .cursorignore:
read_file('.env')
// Ou
read_file('/Users/raphaelhaddad/PycharmProjects/review_hub/.env')
```

### 3. Criando o Arquivo `.env`

Se você ainda não tem um arquivo `.env`, crie a partir do template:

```bash
# Copiar o template
cp .env.example .env

# Editar com seus valores
# Use o editor de sua preferência ou:
nano .env
# ou
code .env
```

### 4. Estrutura do `.env`

O arquivo `.env` deve conter as variáveis necessárias:

```env
# Frontend (expostas ao cliente - VITE_*)
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=your_key_here
VITE_SUPABASE_ANON_KEY=your_key_here
VITE_SUPABASE_FUNCTIONS_URL=http://127.0.0.1:54321/functions/v1

# Edge Functions (privadas - configuradas via Supabase Dashboard)
# Estas NÃO vão no .env local, mas o agent pode ler se você documentar
# SUPABASE_URL=...
# SUPABASE_SERVICE_ROLE_KEY=...
# OPENAI_API_KEY=...
```

### 5. Quando o Agent Precisa do `.env`

O agent pode precisar ler o `.env` quando:

- **Desenvolvendo funcionalidades** que dependem de variáveis de ambiente
- **Debugging** problemas de configuração
- **Documentando** quais variáveis são necessárias
- **Criando scripts** que usam variáveis de ambiente
- **Validando** se todas as variáveis necessárias estão presentes

### 6. Exemplo de Uso pelo Agent

Quando você pedir algo como:

> "Verifique se as variáveis de ambiente estão configuradas corretamente"

O agent pode:

1. Ler o arquivo `.env`:
   ```typescript
   read_file('.env')
   ```

2. Ler o código que usa as variáveis:
   ```typescript
   read_file('src/config/app.config.ts')
   ```

3. Comparar e validar se todas as variáveis necessárias estão presentes

4. Reportar quais variáveis estão faltando ou incorretas

### 7. Segurança

**Importante:**
- O arquivo `.env` está no `.gitignore` e **não será commitado**
- Isso é seguro e correto para secrets
- O agent pode ler o `.env` local, mas ele não será exposto no repositório
- Variáveis `VITE_*` são expostas ao cliente (navegador) - não coloque secrets aqui
- Para Edge Functions, use variáveis de ambiente do Supabase Dashboard em produção

### 8. Obter Valores para o `.env`

#### Desenvolvimento Local (Supabase Local)

```bash
# Iniciar Supabase local
supabase start

# Obter credenciais
supabase status

# Copiar as credenciais para o .env
```

#### Produção (Supabase Cloud)

1. Acesse o Supabase Dashboard
2. Vá em Project Settings → API
3. Copie as URLs e chaves
4. Adicione ao `.env` (ou use variáveis de ambiente do sistema/CI)

### 9. Testando se o Agent Pode Ler

Você pode testar pedindo:

> "Leia o arquivo .env e me mostre quais variáveis estão configuradas"

O agent deve conseguir ler e mostrar o conteúdo (com cuidado para não expor secrets em conversas).

**Status atual**: ✅ O arquivo `.cursorignore` está configurado e o agent **tem acesso** ao `.env`.

## Resumo

✅ **O Cursor agent tem acesso ao `.env`** através do `.cursorignore` configurado  
✅ **O arquivo `.cursorignore` foi criado** com permissões explícitas para `.env`  
✅ **O agent pode ler, validar e usar as variáveis** do `.env`  
✅ **O `.env` está protegido** (não é commitado no Git, mas o agent pode acessar)  
✅ **Use `.env.example` como template** para novos desenvolvedores

## Como Funciona Internamente

1. **`.gitignore`** → Controla o que o Git rastreia (`.env` não é commitado)
2. **`.cursorignore`** → Controla o que o Cursor agent pode acessar
3. **Permissão explícita** → `!.env` no `.cursorignore` permite acesso mesmo que esteja no `.gitignore`  

## Arquivos Relacionados

- `.env.example` - Template com todas as variáveis
- `.gitignore` - Garante que `.env` não seja commitado
- `src/config/app.config.ts` - Usa as variáveis `VITE_*`
- `docs/SETUP_LOCAL.md` - Guia de setup local

