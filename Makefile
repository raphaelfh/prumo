.PHONY: help setup start start-remote start-cloud _print-env-banner supabase-migrate verify-remote-db stop restart status backend frontend supabase install install-backend install-frontend logs logs-backend logs-frontend clean reset-db health db-migrate db-migrate-remote db-rollback db-history db-current db-generate db-setup db-seed db-fresh dev dev-remote e2e-local e2e-remote test-backend-e2e

# Variáveis
BACKEND_DIR := backend
FRONTEND_DIR := .
SUPABASE_DIR := supabase
BACKEND_PORT := 8000
FRONTEND_PORT := 8080
# Root Makefile may `include .env` and export DATABASE_URL for local Supabase; backend reads `backend/.env`.
# Strip inherited DB URLs so Pydantic loads credentials from backend/.env only.
BACKEND_DB_ENV_FILTER := env -u DATABASE_URL -u DIRECT_DATABASE_URL -u SUPABASE_DATABASE_URL

# Carrega variáveis do .env (se existir) e exporta para os comandos do Make
ifneq (,$(wildcard .env))
include .env
export
endif

# Cores para output (opcional, funciona em terminais modernos)
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m # No Color

##@ Comandos Principais

help: ## Mostra esta mensagem de ajuda
	@echo "$(GREEN)Prumo - Comandos Disponíveis$(NC)"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"; printf "\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  $(YELLOW)%-20s$(NC) %s\n", $$1, $$2 } /^##@/ { printf "\n$(GREEN)%s$(NC)\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

setup: ## Configura o ambiente completo (primeira vez)
	@echo "$(GREEN)🔧 Configurando ambiente de desenvolvimento...$(NC)"
	@./scripts/setup.sh

start: ## Inicia todos os serviços LOCAIS (Supabase Docker + Backend + Frontend)
	@echo "$(GREEN)🚀 Iniciando Prumo (ambiente LOCAL)$(NC)"
	@$(MAKE) _print-env-banner ENV_LABEL=LOCAL
	@$(MAKE) supabase-start
	@echo "$(YELLOW)⏳ Aguardando Supabase inicializar...$(NC)"
	@sleep 5
	@$(MAKE) supabase-migrate
	@$(MAKE) backend-start
	@$(MAKE) frontend-start
	@echo "$(GREEN)✅ Todos os serviços LOCAIS iniciados!$(NC)"
	@$(MAKE) status

start-cloud: start-remote ## Alias para start-remote (mais explícito)

_print-env-banner:
	@echo ""
	@echo "$(YELLOW)╭──────────────────────────────────────────────╮$(NC)"
	@echo "$(YELLOW)│$(NC) Ambiente: $(GREEN)$(ENV_LABEL)$(NC)"
	@echo "$(YELLOW)│$(NC) backend/.env DATABASE_URL deve apontar para esse alvo"
	@echo "$(YELLOW)╰──────────────────────────────────────────────╯$(NC)"
	@echo ""

supabase-migrate: ## Aplica migrations Supabase (auth/storage) no banco local
	@echo "$(GREEN)📜 Aplicando migrations Supabase locais...$(NC)"
	@if ( cd $(SUPABASE_DIR) && supabase db push --local >/dev/null 2>&1 ); then \
		echo "  via supabase db push --local"; \
	else \
		echo "$(YELLOW)ℹ️  supabase db push --local indisponível; aplicando via psql.$(NC)"; \
		for f in $$(ls -1 $(SUPABASE_DIR)/migrations/*.sql 2>/dev/null); do \
			echo "  -> $$f"; \
			docker exec -i supabase_db_supabase_local psql -U postgres -d postgres -v ON_ERROR_STOP=0 -q < "$$f" >/dev/null 2>&1 || true; \
		done; \
	fi
	@echo "$(GREEN)✅ Migrations Supabase aplicadas$(NC)"

start-remote: verify-remote-db ## Inicia ambiente com Supabase REMOTO (apenas Backend + Frontend)
	@echo "$(RED)⚠️  ATENÇÃO: subindo backend contra Supabase REMOTO$(NC)"
	@$(MAKE) _print-env-banner ENV_LABEL=REMOTE
	@$(MAKE) backend-start
	@$(MAKE) frontend-start
	@echo "$(GREEN)✅ Backend e Frontend iniciados (Supabase REMOTO)$(NC)"
	@$(MAKE) status

verify-remote-db: ## Valida se DATABASE_URL aponta para host remoto antes do start-remote
	@echo "$(YELLOW)🔎 Validando configuração de banco remoto...$(NC)"
	@cd $(BACKEND_DIR) && $(BACKEND_DB_ENV_FILTER) uv run python -c "from app.core.config import settings; from urllib.parse import urlparse; import sys; raw=settings.DIRECT_DATABASE_URL or settings.DATABASE_URL.unicode_string(); p=urlparse(raw); host=(p.hostname or '').lower(); port=p.port; local_hosts={'127.0.0.1','localhost'}; is_local=host in local_hosts or (host=='' and port in (5432,54322)); has_placeholder=('<' in host) or ('>' in host) or ('project_ref' in host) or ('db.<project_ref>.supabase.co' in host); uses_ssl='sslmode=' in (p.query or '') or 'ssl=' in (p.query or ''); \
print(f'  Host detectado: {host or \"(vazio)\"}:{port or \"(sem porta)\"}'); \
print(f'  Usa DIRECT_DATABASE_URL: {bool(settings.DIRECT_DATABASE_URL)}'); \
print(f'  SSL em query string: {uses_ssl}'); \
print(f'  Host com placeholder: {has_placeholder}'); \
sys.exit(1 if (is_local or has_placeholder) else 0)" || { \
		echo "$(RED)❌ DATABASE_URL/DIRECT_DATABASE_URL está inválida para uso remoto.$(NC)"; \
		echo "$(YELLOW)➡️  Configure URL remota válida no ambiente do backend (backend/.env ou variáveis exportadas).$(NC)"; \
		echo "$(YELLOW)➡️  Não use placeholders literais como <project_ref> na URL.$(NC)"; \
		echo "$(YELLOW)Exemplo (pooler Supabase): postgresql://...pooler.supabase.com:5432/postgres?sslmode=require$(NC)"; \
		exit 1; \
	}
	@echo "$(GREEN)✅ Configuração remota validada$(NC)"

stop: ## Para todos os serviços
	@echo "$(RED)🛑 Parando todos os serviços...$(NC)"
	@$(MAKE) backend-stop || true
	@$(MAKE) frontend-stop || true
	@$(MAKE) supabase-stop || true
	@echo "$(GREEN)✅ Todos os serviços parados$(NC)"

restart: stop start ## Reinicia todos os serviços

status: ## Verifica o status de todos os serviços
	@echo "$(GREEN)📊 Status dos Serviços$(NC)"
	@echo ""
	@echo "$(YELLOW)Supabase:$(NC)"
	@cd $(SUPABASE_DIR) && supabase status 2>/dev/null || echo "  ❌ Não está rodando"
	@echo ""
	@echo "$(YELLOW)Backend (FastAPI):$(NC)"
	@healthy=0; attempts=10; elapsed=0; \
	for i in $$(seq 1 $$attempts); do \
		if curl -s "http://localhost:$(BACKEND_PORT)/health" > /dev/null 2>&1; then \
			healthy=1; \
			break; \
		fi; \
		sleep 1; \
		elapsed=$$i; \
	done; \
	if [ $$healthy -eq 1 ]; then \
		echo "  ✅ Rodando em http://localhost:$(BACKEND_PORT)"; \
	else \
		echo "  ❌ Não está respondendo"; \
	fi
	@echo ""
	@echo "$(YELLOW)Frontend (React/Vite):$(NC)"
	@curl -s -o /dev/null -w "  %{http_code}" http://localhost:$(FRONTEND_PORT) > /dev/null 2>&1 && \
		echo " ✅ Rodando em http://localhost:$(FRONTEND_PORT)" || \
		echo "  ❌ Não está respondendo"
	@echo ""

##@ Serviços Individuais

backend: backend-start ## Inicia apenas o backend
backend-start: ## Inicia o backend FastAPI
	@echo "$(GREEN)🔧 Iniciando Backend...$(NC)"
	@if curl -s "http://localhost:$(BACKEND_PORT)/health" > /dev/null 2>&1; then \
		echo "$(YELLOW)ℹ️  Backend já está saudável na porta $(BACKEND_PORT), não será reiniciado.$(NC)"; \
		true; \
	else \
		stale_pids="$$(lsof -ti:$(BACKEND_PORT) 2>/dev/null || true)"; \
		if [ -n "$$stale_pids" ]; then \
			echo "$(YELLOW)🧹 Limpando processos órfãos na porta $(BACKEND_PORT): $$stale_pids$(NC)"; \
			echo "$$stale_pids" | xargs kill -9 2>/dev/null || true; \
			true; \
		fi; \
		(cd $(BACKEND_DIR) && $(BACKEND_DB_ENV_FILTER) uv run uvicorn app.main:app --reload --port $(BACKEND_PORT)) & \
	fi

backend-stop: ## Para o backend
	@echo "$(YELLOW)🛑 Parando Backend...$(NC)"
	@lsof -ti:$(BACKEND_PORT) | xargs kill -9 2>/dev/null || echo "  Backend já estava parado"

frontend: frontend-start ## Inicia apenas o frontend
frontend-start: ## Inicia o frontend React/Vite
	@echo "$(GREEN)🎨 Iniciando Frontend...$(NC)"
	@if lsof -iTCP:$(FRONTEND_PORT) -sTCP:LISTEN -n -P > /dev/null 2>&1; then \
		echo "$(YELLOW)ℹ️  Frontend já está rodando na porta $(FRONTEND_PORT), não será reiniciado.$(NC)"; \
		true; \
	else \
		cd $(FRONTEND_DIR) && npm run dev & \
	fi

frontend-stop: ## Para o frontend
	@echo "$(YELLOW)🛑 Parando Frontend...$(NC)"
	@lsof -ti:$(FRONTEND_PORT) | xargs kill -9 2>/dev/null || echo "  Frontend já estava parado"

supabase: supabase-start ## Inicia apenas o Supabase
supabase-start: ## Inicia o Supabase local
	@echo "$(GREEN)🗄️  Iniciando Supabase...$(NC)"
	@cd $(SUPABASE_DIR) && supabase start

supabase-stop: ## Para o Supabase
	@echo "$(YELLOW)🛑 Parando Supabase...$(NC)"
	@cd $(SUPABASE_DIR) && supabase stop

supabase-restart: supabase-stop supabase-start ## Reinicia o Supabase

##@ Instalação

install: install-backend install-frontend ## Instala todas as dependências
	@echo "$(GREEN)✅ Todas as dependências instaladas$(NC)"

install-backend: ## Instala dependências do backend
	@echo "$(GREEN)📦 Instalando dependências do Backend...$(NC)"
	@cd $(BACKEND_DIR) && uv sync

install-frontend: ## Instala dependências do frontend
	@echo "$(GREEN)📦 Instalando dependências do Frontend...$(NC)"
	@cd $(FRONTEND_DIR) && npm install

##@ Logs

logs: ## Mostra logs de todos os serviços
	@echo "$(GREEN)📋 Logs dos Serviços$(NC)"
	@echo ""
	@echo "$(YELLOW)Supabase:$(NC)"
	@cd $(SUPABASE_DIR) && supabase logs 2>/dev/null || echo "  Nenhum log disponível"

logs-backend: ## Mostra logs do backend (últimas 50 linhas)
	@echo "$(GREEN)📋 Logs do Backend$(NC)"
	@lsof -ti:$(BACKEND_PORT) > /dev/null 2>&1 && \
		echo "  Backend está rodando (verifique o terminal onde foi iniciado)" || \
		echo "  Backend não está rodando"

logs-frontend: ## Mostra logs do frontend (últimas 50 linhas)
	@echo "$(GREEN)📋 Logs do Frontend$(NC)"
	@lsof -ti:$(FRONTEND_PORT) > /dev/null 2>&1 && \
		echo "  Frontend está rodando (verifique o terminal onde foi iniciado)" || \
		echo "  Frontend não está rodando"

##@ Utilitários

health: ## Verifica a saúde de todos os serviços
	@echo "$(GREEN)🏥 Health Check$(NC)"
	@echo ""
	@echo "$(YELLOW)Backend:$(NC)"
	@curl -s http://localhost:$(BACKEND_PORT)/health || echo "  ❌ Não respondeu"
	@echo ""
	@echo "$(YELLOW)Frontend:$(NC)"
	@curl -s -o /dev/null -w "  Status: %{http_code}\n" http://localhost:$(FRONTEND_PORT) || echo "  ❌ Não respondeu"

reset-db: ## Reseta o banco de dados do Supabase (CUIDADO: apaga todos os dados)
	@echo "$(RED)⚠️  ATENÇÃO: Isso vai apagar todos os dados do banco!$(NC)"
	@read -p "Tem certeza? (s/N): " confirm && [ "$$confirm" = "s" ] || exit 1
	@cd $(SUPABASE_DIR) && supabase db reset

##@ Migrations (Alembic)

db-migrate: ## Aplica todas as migrações pendentes (alembic upgrade head)
	@echo "$(GREEN)🧬 Aplicando migrações Alembic...$(NC)"
	@cd $(BACKEND_DIR) && env -u DATABASE_URL -u SUPABASE_DATABASE_URL uv run alembic upgrade head

db-rollback: ## Reverte a última migração (alembic downgrade -1)
	@echo "$(YELLOW)⏪ Revertendo última migração...$(NC)"
	@cd $(BACKEND_DIR) && env -u DATABASE_URL -u SUPABASE_DATABASE_URL uv run alembic downgrade -1

db-history: ## Exibe o histórico de migrações (alembic history --verbose)
	@cd $(BACKEND_DIR) && env -u DATABASE_URL -u SUPABASE_DATABASE_URL uv run alembic history --verbose

db-current: ## Exibe a revisão atual do banco (alembic current)
	@cd $(BACKEND_DIR) && env -u DATABASE_URL -u SUPABASE_DATABASE_URL uv run alembic current

db-generate: ## Gera uma nova migração via autogenerate — uso: make db-generate MSG="add_users_table"
	@if [ -z "$(MSG)" ]; then echo "$(RED)❌ Forneça uma mensagem: make db-generate MSG=\"sua_mensagem\"$(NC)"; exit 1; fi
	@echo "$(GREEN)✨ Gerando migração: $(MSG)$(NC)"
	@cd $(BACKEND_DIR) && env -u DATABASE_URL -u SUPABASE_DATABASE_URL uv run alembic revision --autogenerate -m "$(MSG)"

db-setup: ## Setup completo do banco: supabase db reset + alembic upgrade head
	@echo "$(GREEN)🔄 Resetando banco e aplicando todas as migrações...$(NC)"
	@cd $(SUPABASE_DIR) && supabase db reset
	@echo "$(YELLOW)⏳ Aguardando PostgreSQL estar pronto...$(NC)"
	@for i in $$(seq 1 30); do \
		pg_isready -h 127.0.0.1 -p 54322 -U postgres -q && break; \
		echo "  Aguardando... ($$i/30)"; \
		sleep 1; \
	done
	@$(MAKE) db-migrate
	@echo "$(GREEN)✅ Banco de dados pronto$(NC)"

db-seed: ## Executa o seed (CHARMS + PROBAST + QUADAS-2 + outros dados base). Idempotente.
	@echo "$(GREEN)🌱 Aplicando seed (templates globais + dados base)...$(NC)"
	@cd $(BACKEND_DIR) && env -u DATABASE_URL -u SUPABASE_DATABASE_URL uv run python -m app.seed

db-fresh: ## Reset + migrate + seed em um único comando (AI-friendly dev cycle)
	@echo "$(GREEN)🌀 Banco zerado de ponta a ponta — reset + migrate + seed$(NC)"
	@$(MAKE) db-setup
	@$(MAKE) db-seed
	@echo "$(GREEN)✅ Pronto. Schema em head, seed aplicado, dados base presentes.$(NC)"

db-migrate-remote: ## Aplica migrações Alembic no banco REMOTO (usa DATABASE_URL do root .env)
	@echo "$(YELLOW)⚠️  Applying Alembic migrations to REMOTE database...$(NC)"
	@if [ -z "$(DATABASE_URL)" ]; then echo "$(RED)❌ DATABASE_URL não definida no root .env$(NC)"; exit 1; fi
	@cd $(BACKEND_DIR) && uv run alembic upgrade head

clean: ## Limpa arquivos temporários e caches
	@echo "$(YELLOW)🧹 Limpando arquivos temporários...$(NC)"
	@cd $(FRONTEND_DIR) && rm -rf node_modules/.vite dist
	@cd $(BACKEND_DIR) && find . -type d -name __pycache__ -exec rm -r {} + 2>/dev/null || true
	@cd $(BACKEND_DIR) && find . -type f -name "*.pyc" -delete 2>/dev/null || true
	@echo "$(GREEN)✅ Limpeza concluída$(NC)"

migrate: ## Aplica migrations LOCALMENTE (Supabase CLI)
	@echo "$(GREEN)🧬 Aplicando migrations (local)...$(NC)"
	@bash scripts/apply_and_test_migration.sh

migrate-remote: ## Aplica migrations no Supabase REMOTO via DATABASE_URL (sem link; usa Docker se precisar)
	@echo "$(GREEN)🧬 Aplicando migrations (remoto)...$(NC)"
	@if [ -z "$$DATABASE_URL" ]; then \
		echo "$(RED)❌ DATABASE_URL não definido.$(NC)"; \
		echo "$(YELLOW)Exemplo: DATABASE_URL='postgresql://<USER>:<PASSWORD>@<HOST>:5432/<DB>?sslmode=require' make migrate-remote$(NC)"; \
		exit 1; \
	fi
	@bash scripts/apply_and_test_migration.sh


##@ Desenvolvimento

dev: start ## Alias para start (inicia ambiente de desenvolvimento)

dev-remote: start-remote ## Alias para start-remote (Supabase remoto)

test-backend: ## Executa testes do backend
	@echo "$(GREEN)🧪 Executando testes do Backend...$(NC)"
	@cd $(BACKEND_DIR) && uv run pytest

test-frontend: ## Executa testes do frontend
	@echo "$(GREEN)🧪 Executando testes do Frontend...$(NC)"
	@cd $(FRONTEND_DIR) && npm test

test-backend-e2e: ## Executa testes e2e do backend (pytest -m e2e)
	@echo "$(GREEN)🧪 Executando testes E2E do Backend...$(NC)"
	@cd $(BACKEND_DIR) && uv run pytest -m e2e

e2e-local: ## Roda suíte E2E local do frontend
	@echo "$(GREEN)🧪 Executando E2E local (Playwright)...$(NC)"
	@cd $(FRONTEND_DIR) && npm run test:e2e:local

e2e-remote: ## Roda smoke E2E remoto do frontend
	@echo "$(GREEN)🧪 Executando E2E remoto (Playwright)...$(NC)"
	@cd $(FRONTEND_DIR) && npm run test:e2e:remote

lint-backend: ## Executa linter do backend
	@echo "$(GREEN)🔍 Executando linter do Backend...$(NC)"
	@cd $(BACKEND_DIR) && uv run ruff check .

lint-frontend: ## Executa linter do frontend
	@echo "$(GREEN)🔍 Executando linter do Frontend...$(NC)"
	@cd $(FRONTEND_DIR) && npm run lint

lint: lint-backend lint-frontend ## Executa linter de todos os serviços

##@ URLs Úteis

urls: ## Mostra URLs importantes dos serviços
	@echo "$(GREEN)🔗 URLs dos Serviços$(NC)"
	@echo ""
	@echo "$(YELLOW)Frontend:$(NC)"
	@echo "  http://localhost:$(FRONTEND_PORT)"
	@echo ""
	@echo "$(YELLOW)Backend:$(NC)"
	@echo "  API: http://localhost:$(BACKEND_PORT)"
	@echo "  Health: http://localhost:$(BACKEND_PORT)/health"
	@echo "  Docs: http://localhost:$(BACKEND_PORT)/api/v1/docs"
	@echo "  ReDoc: http://localhost:$(BACKEND_PORT)/api/v1/redoc"
	@echo ""
	@echo "$(YELLOW)Supabase:$(NC)"
	@echo "  Studio: http://127.0.0.1:54323"
	@echo "  API: http://127.0.0.1:54321"
	@echo "  Database: postgresql://postgres:postgres@127.0.0.1:54322/postgres"
