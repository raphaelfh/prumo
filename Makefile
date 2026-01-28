.PHONY: help setup start stop restart status backend frontend supabase install install-backend install-frontend logs logs-backend logs-frontend clean reset-db health

# Variáveis
BACKEND_DIR := backend
FRONTEND_DIR := .
SUPABASE_DIR := supabase
BACKEND_PORT := 8000
FRONTEND_PORT := 8080

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
	@echo "$(GREEN)Review Hub - Comandos Disponíveis$(NC)"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"; printf "\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  $(YELLOW)%-20s$(NC) %s\n", $$1, $$2 } /^##@/ { printf "\n$(GREEN)%s$(NC)\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

setup: ## Configura o ambiente completo (primeira vez)
	@echo "$(GREEN)🔧 Configurando ambiente de desenvolvimento...$(NC)"
	@./scripts/setup.sh

start: ## Inicia todos os serviços (Supabase, Backend, Frontend)
	@echo "$(GREEN)🚀 Iniciando Review Hub...$(NC)"
	@$(MAKE) supabase-start
	@echo "$(YELLOW)⏳ Aguardando Supabase inicializar...$(NC)"
	@sleep 5
	@$(MAKE) backend-start
	@$(MAKE) frontend-start
	@echo "$(GREEN)✅ Todos os serviços iniciados!$(NC)"
	@$(MAKE) status

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
	@curl -s http://localhost:$(BACKEND_PORT)/health > /dev/null 2>&1 && \
		echo "  ✅ Rodando em http://localhost:$(BACKEND_PORT)" || \
		echo "  ❌ Não está respondendo"
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
	@cd $(BACKEND_DIR) && uv run uvicorn app.main:app --reload --port $(BACKEND_PORT) &

backend-stop: ## Para o backend
	@echo "$(YELLOW)🛑 Parando Backend...$(NC)"
	@lsof -ti:$(BACKEND_PORT) | xargs kill -9 2>/dev/null || echo "  Backend já estava parado"

frontend: frontend-start ## Inicia apenas o frontend
frontend-start: ## Inicia o frontend React/Vite
	@echo "$(GREEN)🎨 Iniciando Frontend...$(NC)"
	@cd $(FRONTEND_DIR) && npm run dev &

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

test-backend: ## Executa testes do backend
	@echo "$(GREEN)🧪 Executando testes do Backend...$(NC)"
	@cd $(BACKEND_DIR) && uv run pytest

test-frontend: ## Executa testes do frontend
	@echo "$(GREEN)🧪 Executando testes do Frontend...$(NC)"
	@cd $(FRONTEND_DIR) && npm test

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
