#!/bin/bash

# Script para testar a implementação de API Keys
# Verifica se a migration foi aplicada e testa os endpoints

set -e

echo "🧪 Testando implementação de API Keys..."
echo ""

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Verificar se Supabase está rodando
echo -e "${YELLOW}1. Verificando se Supabase está rodando...${NC}"
if ! curl -s http://127.0.0.1:54321/rest/v1/ > /dev/null 2>&1; then
    echo -e "${RED}❌ Supabase não está respondendo${NC}"
    echo "Execute: cd supabase && supabase start"
    exit 1
fi
echo -e "${GREEN}✅ Supabase está rodando${NC}"
echo ""

# Verificar se a tabela foi criada
echo -e "${YELLOW}2. Verificando se a tabela user_api_keys foi criada...${NC}"
TABLE_EXISTS=$(curl -s "http://127.0.0.1:54321/rest/v1/user_api_keys?select=id&limit=1" \
    -H "apikey: sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH" \
    -H "Authorization: Bearer sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH" 2>&1 | grep -c "user_api_keys" || echo "0")

if [ "$TABLE_EXISTS" -eq 0 ]; then
    echo -e "${RED}❌ Tabela user_api_keys não encontrada${NC}"
    echo "Execute: cd supabase && supabase db reset"
    exit 1
fi
echo -e "${GREEN}✅ Tabela user_api_keys existe${NC}"
echo ""

# Verificar se o backend está rodando
echo -e "${YELLOW}3. Verificando se o backend está rodando...${NC}"
if ! curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Backend não está rodando (isso é OK se você ainda não iniciou)${NC}"
    echo "Execute: make backend"
else
    echo -e "${GREEN}✅ Backend está rodando${NC}"
    
    # Testar endpoint de provedores
    echo -e "${YELLOW}4. Testando endpoint de provedores...${NC}"
    RESPONSE=$(curl -s http://localhost:8000/api/v1/user-api-keys/providers 2>&1)
    if echo "$RESPONSE" | grep -q "openai"; then
        echo -e "${GREEN}✅ Endpoint de provedores funcionando${NC}"
    else
        echo -e "${RED}❌ Endpoint de provedores não retornou dados esperados${NC}"
        echo "Resposta: $RESPONSE"
    fi
fi
echo ""

# Verificar imports Python
echo -e "${YELLOW}5. Verificando imports Python...${NC}"
cd backend
if command -v uv &> /dev/null; then
    if uv run python -c "from app.models.user_api_key import UserAPIKey; from app.repositories.user_api_key_repository import UserAPIKeyRepository; from app.services.api_key_service import APIKeyService; print('✅ Imports OK')" 2>&1; then
        echo -e "${GREEN}✅ Todos os imports Python estão corretos${NC}"
    else
        echo -e "${RED}❌ Erro nos imports Python${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠️  uv não encontrado, pulando verificação de imports${NC}"
fi
cd ..
echo ""

echo -e "${GREEN}✅ Testes básicos concluídos!${NC}"
echo ""
echo "Próximos passos:"
echo "1. Certifique-se de que a migration foi aplicada: cd supabase && supabase db reset"
echo "2. Inicie o backend: make backend"
echo "3. Acesse a UI em Configurações > Integrações para adicionar API keys"
