# Variáveis de Ambiente - Produção

Template para configurar env vars no Render e Vercel.

## 🔴 Backend (Render)

Configure no [Render Dashboard](https://dashboard.render.com) → Environment:

```bash
# Database (obter no Supabase: Settings > Database)
DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres

# Supabase (obter no Supabase: Settings > API)
SUPABASE_ENV=production
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# OpenAI (opcional, se não usar BYOK)
OPENAI_API_KEY=sk-...

# Security (clicar "Generate" no Render para criar automaticamente)
ENCRYPTION_KEY=<auto-generate>

# Config
DEBUG=false
PYTHON_VERSION=3.11.0
```

## 🔵 Frontend (Vercel)

Configure no [Vercel Dashboard](https://vercel.com/dashboard) → Settings → Environment Variables:

```bash
# Supabase (mesmos valores do backend)
VITE_SUPABASE_ENV=production
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# API URL (URL do backend no Render)
VITE_API_URL=https://review-hub-api.onrender.com
```

### Variáveis Alternativas Suportadas

O frontend suporta fallback chain para compatibilidade com diferentes ambientes:

| Variável | Alternativas suportadas |
|----------|-------------------------|
| URL | `VITE_SUPABASE_URL` → `SUPABASE_URL` → `NEXT_PUBLIC_SUPABASE_URL` |
| KEY | `VITE_SUPABASE_PUBLISHABLE_KEY` → `VITE_SUPABASE_ANON_KEY` → `SUPABASE_ANON_KEY` → `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

> **Tip:** Se usar a [Supabase Integration do Vercel](https://vercel.com/integrations/supabase), 
> as variáveis são injetadas automaticamente para preview branches!

## 🔑 Como obter as credenciais

### Supabase

1. Acesse [supabase.com/dashboard](https://supabase.com/dashboard)
2. Selecione seu projeto
3. **Para API keys:**
   - Settings → API
   - Copie: `Project URL`, `anon public`, `service_role secret`
4. **Para DATABASE_URL:**
   - Settings → Database
   - Connection string → URI mode
   - Copie e substitua `[YOUR-PASSWORD]` pela senha

### OpenAI

1. Acesse [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create new secret key
3. Copie (não será mostrada novamente)

## 🔒 Segurança

- ✅ **NUNCA** commite secrets no Git
- ✅ Use "Generate" no Render para `ENCRYPTION_KEY`
- ✅ `SUPABASE_SERVICE_ROLE_KEY` tem acesso total - mantenha secreto
- ✅ Em desenvolvimento local, use `.env` (gitignored)

## 📝 Comandos úteis

```bash
# Gerar ENCRYPTION_KEY localmente (se precisar)
openssl rand -hex 32

# Testar conexão com Supabase
curl https://xxxxx.supabase.co/rest/v1/ \
  -H "apikey: YOUR_ANON_KEY"
```
