#!/bin/bash
# Script de setup completo do Review Hub
# 
# Uso: ./scripts/setup.sh
#
# Este script configura o ambiente de desenvolvimento completo:
# 1. Verifica pré-requisitos
# 2. Instala dependências do frontend
# 3. Instala dependências do backend
# 4. Configura arquivos .env
# 5. Inicia Supabase local (opcional)
#
# Não depende de configurações pessoais do usuário (.zshrc, etc)

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Diretório raiz do projeto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Review Hub - Setup Completo${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${YELLOW}📁 Diretório do projeto: ${PROJECT_ROOT}${NC}"
echo ""

# ============================================
# 1. Verificar pré-requisitos
# ============================================
echo -e "${BLUE}🔍 Verificando pré-requisitos...${NC}"
echo ""

MISSING_DEPS=0

# Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js não está instalado${NC}"
    echo -e "${YELLOW}   Instale com: https://nodejs.org/ ou use nvm${NC}"
    MISSING_DEPS=1
else
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✓ Node.js: ${NODE_VERSION}${NC}"
fi

# npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm não está instalado${NC}"
    MISSING_DEPS=1
else
    NPM_VERSION=$(npm --version)
    echo -e "${GREEN}✓ npm: ${NPM_VERSION}${NC}"
fi

# Python
if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
    echo -e "${RED}❌ Python não está instalado${NC}"
    echo -e "${YELLOW}   Instale Python 3.11+${NC}"
    MISSING_DEPS=1
else
    PYTHON_CMD=$(command -v python3 || command -v python)
    PYTHON_VERSION=$($PYTHON_CMD --version 2>&1)
    echo -e "${GREEN}✓ Python: ${PYTHON_VERSION}${NC}"
fi

# uv (recomendado para backend)
if ! command -v uv &> /dev/null; then
    echo -e "${YELLOW}⚠️  uv não está instalado (recomendado para backend)${NC}"
    echo -e "${YELLOW}   Instale com: curl -LsSf https://astral.sh/uv/install.sh | sh${NC}"
    echo -e "${YELLOW}   Ou use pip como alternativa${NC}"
    USE_UV=0
else
    UV_VERSION=$(uv --version)
    echo -e "${GREEN}✓ uv: ${UV_VERSION}${NC}"
    USE_UV=1
fi

# Supabase CLI (opcional)
if ! command -v supabase &> /dev/null; then
    echo -e "${YELLOW}⚠️  Supabase CLI não está instalado (opcional)${NC}"
    echo -e "${YELLOW}   Instale com: brew install supabase/tap/supabase${NC}"
    USE_SUPABASE=0
else
    SUPABASE_VERSION=$(supabase --version 2>&1 | head -n1)
    echo -e "${GREEN}✓ Supabase CLI: ${SUPABASE_VERSION}${NC}"
    USE_SUPABASE=1
fi

# Docker (opcional, para Supabase)
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}⚠️  Docker não está instalado (necessário para Supabase local)${NC}"
    USE_DOCKER=0
else
    DOCKER_VERSION=$(docker --version)
    echo -e "${GREEN}✓ Docker: ${DOCKER_VERSION}${NC}"
    USE_DOCKER=1
fi

if [ $MISSING_DEPS -eq 1 ]; then
    echo ""
    echo -e "${RED}❌ Alguns pré-requisitos estão faltando. Instale-os e execute o script novamente.${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Todos os pré-requisitos essenciais estão instalados${NC}"
echo ""

# ============================================
# 2. Instalar dependências do Frontend
# ============================================
echo -e "${BLUE}📦 Instalando dependências do Frontend...${NC}"
cd "$PROJECT_ROOT"

if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ package.json não encontrado${NC}"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    npm install
    echo -e "${GREEN}✓ Dependências do frontend instaladas${NC}"
else
    echo -e "${YELLOW}⚠️  node_modules já existe. Execute 'npm install' manualmente se necessário${NC}"
fi

echo ""

# ============================================
# 3. Instalar dependências do Backend
# ============================================
echo -e "${BLUE}📦 Instalando dependências do Backend...${NC}"
cd "$PROJECT_ROOT/backend"

if [ ! -f "pyproject.toml" ]; then
    echo -e "${RED}❌ pyproject.toml não encontrado${NC}"
    exit 1
fi

if [ $USE_UV -eq 1 ]; then
    echo -e "${YELLOW}   Usando uv...${NC}"
    uv sync
    echo -e "${GREEN}✓ Dependências do backend instaladas com uv${NC}"
else
    echo -e "${YELLOW}   Usando pip...${NC}"
    if [ ! -d ".venv" ]; then
        python3 -m venv .venv
    fi
    source .venv/bin/activate
    pip install -e ".[dev]"
    echo -e "${GREEN}✓ Dependências do backend instaladas com pip${NC}"
fi

echo ""

# ============================================
# 4. Configurar arquivos .env
# ============================================
echo -e "${BLUE}⚙️  Configurando variáveis de ambiente...${NC}"

# Frontend .env
cd "$PROJECT_ROOT"
if [ ! -f ".env.local" ] && [ -f ".env.example" ]; then
    cp .env.example .env.local
    echo -e "${GREEN}✓ .env.local criado a partir de .env.example${NC}"
    echo -e "${YELLOW}⚠️  Edite .env.local com suas credenciais do Supabase${NC}"
elif [ -f ".env.local" ]; then
    echo -e "${GREEN}✓ .env.local já existe${NC}"
fi

# Backend .env
cd "$PROJECT_ROOT/backend"
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp .env.example .env
    echo -e "${GREEN}✓ backend/.env criado a partir de .env.example${NC}"
    echo -e "${YELLOW}⚠️  Edite backend/.env com suas credenciais${NC}"
elif [ -f ".env" ]; then
    echo -e "${GREEN}✓ backend/.env já existe${NC}"
fi

echo ""

# ============================================
# 5. Setup do Supabase (opcional)
# ============================================
if [ $USE_SUPABASE -eq 1 ] && [ $USE_DOCKER -eq 1 ]; then
    echo -e "${BLUE}🗄️  Configurando Supabase local...${NC}"
    cd "$PROJECT_ROOT/supabase"
    
    if [ -f "config.toml" ]; then
        echo -e "${YELLOW}   Supabase já está configurado${NC}"
        echo -e "${YELLOW}   Para iniciar: ${GREEN}make supabase${NC} ou ${GREEN}supabase start${NC}"
    else
        echo -e "${YELLOW}   Supabase não está inicializado${NC}"
        echo -e "${YELLOW}   Para inicializar: ${GREEN}supabase init${NC}"
    fi
    echo ""
fi

# ============================================
# Resumo final
# ============================================
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  ✅ Setup completo!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Próximos passos:${NC}"
echo ""
echo -e "  1. ${YELLOW}Configure as variáveis de ambiente:${NC}"
echo -e "     - Edite ${YELLOW}.env.local${NC} (frontend)"
echo -e "     - Edite ${YELLOW}backend/.env${NC} (backend)"
echo ""
echo -e "  2. ${YELLOW}Inicie os serviços:${NC}"
echo -e "     ${GREEN}make start${NC}          # Inicia tudo"
echo -e "     ${GREEN}make supabase${NC}      # Apenas Supabase"
echo -e "     ${GREEN}make backend${NC}       # Apenas backend"
echo -e "     ${GREEN}make frontend${NC}      # Apenas frontend"
echo ""
echo -e "  3. ${YELLOW}Verifique o status:${NC}"
echo -e "     ${GREEN}make status${NC}        # Status de todos os serviços"
echo -e "     ${GREEN}make urls${NC}          # URLs importantes"
echo ""
echo -e "  4. ${YELLOW}Veja todos os comandos:${NC}"
echo -e "     ${GREEN}make help${NC}"
echo ""
