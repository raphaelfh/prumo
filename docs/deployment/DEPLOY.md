# Deploy Moderno - Review Hub
**Stack:** Vercel (Frontend) + Render (Backend) + Supabase (Database)

## Por que essa stack?

- ✅ **KISS**: Cada plataforma faz uma coisa bem feita
- ✅ **Zero configuração**: Sem Dockerfiles, sem Nginx manual
- ✅ **Auto-deploy**: Git push = deploy automático
- ✅ **Free tier**: Começa grátis, escala quando precisar
- ✅ **Managed**: SSL, CDN, backups automáticos

---

## 📦 Setup em 15 minutos

### 1️⃣ Supabase (Database + Auth + Storage)

```bash
# Criar projeto em supabase.com
# Obter credenciais em Settings > API:
```

Copie:
- `SUPABASE_URL` → Project URL
- `SUPABASE_ANON_KEY` → anon public key
- `SUPABASE_SERVICE_ROLE_KEY` → service_role key (secret!)
- `DATABASE_URL` → Settings > Database > Connection string (URI mode)

---

### 2️⃣ Backend no Render

**Opção A: Via Dashboard (mais fácil)**

1. Acesse [dashboard.render.com](https://dashboard.render.com)
2. New + → Web Service
3. Conecte GitHub: `seu-repo`
4. Configurações:
   ```
   Name: review-hub-api
   Region: Oregon (ou mais próximo)
   Root Directory: review-hub/backend
   Runtime: Python 3
   Build Command: pip install -e .
   Start Command: gunicorn -k uvicorn.workers.UvicornWorker -w 4 -b 0.0.0.0:$PORT app.main:app
   ```

5. Environment Variables:
   ```bash
   DATABASE_URL=postgresql://...
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
   SUPABASE_ANON_KEY=eyJhbGc...
   OPENAI_API_KEY=sk-...
   ENCRYPTION_KEY=<auto-generate>
   DEBUG=false
   PYTHON_VERSION=3.11.0
   ```

6. Deploy!

**Opção B: Via render.yaml (recomendado)**

1. Arquivo já existe em `backend/render.yaml`
2. No Render: New + → Blueprint
3. Conecte repo e configure env vars
4. Deploy automático!

Sua API estará em: `https://review-hub-api.onrender.com`

---

### 3️⃣ Frontend no Vercel

**Opção A: Via Dashboard**

1. Acesse [vercel.com/new](https://vercel.com/new)
2. Import Git Repository
3. Configure:
   ```
   Framework Preset: Vite
   Root Directory: review-hub
   Build Command: npm run build
   Output Directory: dist
   ```

4. Environment Variables:
   ```bash
   VITE_SUPABASE_URL=https://xxxxx.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGc... (mesmo que SUPABASE_ANON_KEY)
   VITE_API_URL=https://review-hub-api.onrender.com
   VITE_USE_FASTAPI=true
   ```

5. Deploy!

**Opção B: Via CLI**

```bash
# Instalar Vercel CLI
npm i -g vercel

# Deploy
cd review-hub
vercel

# Seguir prompts e configurar env vars
```

Seu app estará em: `https://review-hub.vercel.app`

---

## ✅ Verificação

```bash
# Backend health
curl https://review-hub-api.onrender.com/health

# Deve retornar:
# {"status":"healthy","version":"0.1.0"}

# Frontend
# Abra https://review-hub.vercel.app
# Tente fazer login
```

---

## 🔧 Configuração Extra

### CORS

No backend, `CORS_ORIGINS` será configurado automaticamente com a URL do Vercel.

Se precisar adicionar domínios customizados:

```bash
# No Render, adicionar env var:
CORS_ORIGINS=https://review-hub.vercel.app,https://seudominio.com
```

### Domínio Customizado

**Vercel:**
1. Settings → Domains
2. Add Domain: `app.seudominio.com`
3. Configurar DNS (A record ou CNAME)
4. SSL automático

**Render:**
1. Settings → Custom Domains
2. Add Domain: `api.seudominio.com`
3. Configurar DNS (CNAME)
4. SSL automático

---

## 🚀 Deploy Automático (CI/CD)

Já está configurado! 🎉

- **Push para `main`** → Vercel e Render fazem deploy automático
- **Pull Request** → Preview deployments automáticos (Vercel)
- **Rollback** → Interface visual em ambas plataformas

---

## 💰 Custo

| Serviço | Free Tier | Produção |
|---------|-----------|----------|
| Vercel | ✅ Unlimited (hobby) | $20/mês (Pro) |
| Render | ✅ 750h/mês | $7-25/mês |
| Supabase | ✅ 500MB DB, 1GB storage | $25/mês (Pro) |
| **Total** | **$0** | **$32-70/mês** |

---

## 🔥 Otimizações

### Performance

**Frontend (Vercel já faz automaticamente):**
- ✅ Edge CDN global
- ✅ Automatic compression (Brotli/Gzip)
- ✅ Image optimization
- ✅ Code splitting

**Backend (já configurado):**
- ✅ Gunicorn com 4 workers
- ✅ Uvicorn async workers
- ✅ Connection pooling (SQLAlchemy)

### Monitoring

**Vercel:**
- Analytics integrado (gratuito)
- Web Vitals automático

**Render:**
- Metrics integrado
- Logs em tempo real

**Adicionar (opcional):**
```bash
# Sentry para error tracking
npm install @sentry/react

# Instalar no backend:
pip install sentry-sdk[fastapi]
```

---

## 🐛 Troubleshooting

### Backend não inicia

```bash
# Ver logs no Render Dashboard
# Ou via CLI:
render logs -s review-hub-api

# Causas comuns:
# 1. Env vars faltando
# 2. DATABASE_URL incorreto
# 3. Dependências faltando (rodar: pip install -e .)
```

### CORS Error

```bash
# Verificar CORS_ORIGINS inclui URL do Vercel
# No Render Dashboard → Environment → Edit:
CORS_ORIGINS=https://review-hub.vercel.app
```

### Build Error no Vercel

```bash
# Verificar vercel.json na raiz do projeto
# Verificar root directory: review-hub
# Verificar build command: npm run build
```

---

## 📚 Arquivos Importantes

```
review-hub/
├── vercel.json                    # Config Vercel
├── backend/
│   ├── render.yaml                # Config Render
│   ├── pyproject.toml             # Python dependencies (inclui gunicorn)
│   └── app/main.py                # FastAPI app
├── package.json                   # Node dependencies
└── vite.config.ts                 # Vite config
```

**Nota:** Não precisa de Dockerfiles! As plataformas detectam automaticamente.

---

## 🎯 Resumo

1. ✅ Criar projeto Supabase → obter credenciais
2. ✅ Deploy backend no Render → configurar env vars
3. ✅ Deploy frontend no Vercel → configurar env vars
4. ✅ Testar health check e login
5. ✅ (Opcional) Configurar domínios customizados

**Tempo total:** ~15 minutos

**Complexidade:** Mínima (zero Dockerfiles, zero Nginx)

**Resultado:** App em produção com SSL, CDN, auto-deploy

---

## 🔗 Links Úteis

- [Render Docs](https://render.com/docs)
- [Vercel Docs](https://vercel.com/docs)
- [Supabase Docs](https://supabase.com/docs)

---

**Última atualização:** 2025-01-27
