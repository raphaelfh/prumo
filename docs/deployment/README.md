# Deploy - Review Hub

Documentação de deploy para produção.

## 🚀 Guia Rápido (Recomendado)

**Stack:** Vercel (Frontend) + Render (Backend) + Supabase (Database)

**Setup em 15 minutos:** [DEPLOY.md](./DEPLOY.md)

---

## 📚 Documentação Completa

### Guias de Deploy

1. **[DEPLOY.md](./DEPLOY.md)** - Guia passo-a-passo (RECOMENDADO)
   - Setup em 15 minutos
   - Vercel + Render + Supabase
   - Sem Dockerfiles, sem complexidade

2. **[ENV_VARS.md](./ENV_VARS.md)** - Variáveis de ambiente
   - Como obter credenciais do Supabase
   - Como configurar no Render e Vercel
   - Comandos úteis

3. **[GUIA_DEPLOYMENT.md](./GUIA_DEPLOYMENT.md)** - Análise detalhada
   - Comparação de plataformas
   - Cenários de uso
   - Custos e trade-offs

---

## 🎯 Arquivos de Configuração

```
review-hub/
├── vercel.json                    # Config Vercel (frontend)
└── backend/
    ├── render.yaml                # Config Render (backend)
    └── pyproject.toml             # Dependências (inclui gunicorn)
```

**Nota:** Não precisa de Dockerfiles! As plataformas detectam automaticamente.

---

## ✅ Quick Checklist

Antes de fazer deploy:

- [ ] Criar projeto no Supabase
- [ ] Obter credenciais (URL, keys, DATABASE_URL)
- [ ] Criar Web Service no Render (backend)
- [ ] Configurar env vars no Render
- [ ] Deploy backend → testar `/health`
- [ ] Deploy frontend no Vercel
- [ ] Configurar env vars no Vercel
- [ ] Testar login e funcionalidades

**Tempo estimado:** 15-30 minutos

---

## 💰 Custo Estimado

| Serviço | Free Tier | Produção |
|---------|-----------|----------|
| Vercel | ✅ Ilimitado | $20/mês |
| Render | ✅ 750h/mês | $7-25/mês |
| Supabase | ✅ 500MB DB | $25/mês |
| **Total** | **$0** | **$32-70/mês** |

---

## 🔗 Links Rápidos

- [Render Dashboard](https://dashboard.render.com)
- [Vercel Dashboard](https://vercel.com/dashboard)
- [Supabase Dashboard](https://supabase.com/dashboard)

---

**Última atualização:** 2025-01-27
