# Review Hub - Estrutura e Comandos

## 🚀 Início Rápido com Makefile

**Recomendado**: Use o Makefile na raiz do projeto para gerenciar todos os serviços:

```bash
# Iniciar tudo (Supabase + Backend + Frontend)
make start

# Ver status de todos os serviços
make status

# Parar tudo
make stop

# Ver ajuda completa
make help
```

## 📋 Serviços

### Supabase
**Iniciar:**
```bash
make supabase
# ou manualmente:
cd review-hub/supabase && supabase start
```

**Rodando:**
- Studio: http://127.0.0.1:54323
- API: http://127.0.0.1:54321
- Database: postgresql://postgres:postgres@127.0.0.1:54322/postgres

### Backend (FastAPI)

**Para rodar:**
```bash
make backend
# ou manualmente:
cd review-hub/backend && uv run uvicorn app.main:app --reload --port 8000
```

**Rodando na porta 8000:**
- Health check: http://localhost:8000/health
- Status: {"status":"healthy","version":"0.1.0"}
- Documentação: http://localhost:8000/api/v1/docs
- ReDoc: http://localhost:8000/api/v1/redoc
- OpenAPI JSON: http://localhost:8000/api/v1/openapi.json

### Frontend (Vite) - REACT

**Para rodar:**
```bash
make frontend
# ou manualmente:
cd review-hub && npm run dev
```

**Rodando na porta 8080:**
- URL: http://localhost:8080

## 📚 Comandos Makefile Úteis

- `make start` - Inicia todos os serviços
- `make stop` - Para todos os serviços
- `make restart` - Reinicia todos os serviços
- `make status` - Verifica status de todos os serviços
- `make health` - Health check de todos os serviços
- `make urls` - Mostra todas as URLs importantes
- `make install` - Instala todas as dependências
- `make clean` - Limpa arquivos temporários
- `make help` - Lista todos os comandos disponíveis