#!/bin/bash

# Script para testar Edge Functions
# Uso: ./scripts/test-edge-functions.sh [nome-da-funcao]

set -e

FUNCTION_NAME=${1:-""}

if [ -z "$FUNCTION_NAME" ]; then
  echo "📋 Testando todas as Edge Functions..."
  echo ""
  
  # Testa cada função que tem testes
  FUNCTIONS=(
    "ai-assessment"
    "section-extraction"
    "model-extraction"
  )
  
  for func in "${FUNCTIONS[@]}"; do
    if [ -d "supabase/functions/$func/tests" ]; then
      echo "🧪 Testando $func..."
      cd "supabase/functions/$func"
      deno test --allow-all || {
        echo "❌ Testes de $func falharam"
        cd - > /dev/null
        exit 1
      }
      cd - > /dev/null
      echo "✅ $func: OK"
      echo ""
    fi
  done
  
  echo "✅ Todos os testes passaram!"
else
  if [ ! -d "supabase/functions/$FUNCTION_NAME" ]; then
    echo "❌ Função '$FUNCTION_NAME' não encontrada em supabase/functions/"
    exit 1
  fi
  
  if [ ! -d "supabase/functions/$FUNCTION_NAME/tests" ]; then
    echo "⚠️  Nenhum teste encontrado para '$FUNCTION_NAME'"
    echo "   Crie testes em supabase/functions/$FUNCTION_NAME/tests/"
    exit 1
  fi
  
  echo "🧪 Testando $FUNCTION_NAME..."
  cd "supabase/functions/$FUNCTION_NAME"
  deno test --allow-all
  cd - > /dev/null
  echo "✅ Testes de $FUNCTION_NAME passaram!"
fi
