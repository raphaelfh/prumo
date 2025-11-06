#!/bin/bash

# Script para sincronizar projeto Supabase remoto para local
# Uso: ./scripts/sync-remote-to-local.sh

set -e  # Parar em caso de erro

echo "🔄 Sincronizando Projeto Supabase Remoto para Local"
echo "=================================================="
echo ""

# Verificar se está no diretório do projeto
if [ ! -f "supabase/config.toml" ]; then
    echo "❌ Erro: Execute este script da raiz do projeto"
    exit 1
fi

# Verificar se Supabase CLI está instalado
if ! command -v supabase &> /dev/null; then
    echo "❌ Erro: Supabase CLI não está instalado"
    echo "   Instale com: npm install -g supabase"
    exit 1
fi

# Verificar se está logado
if ! supabase projects list &> /dev/null; then
    echo "⚠️  Aviso: Parece que você não está logado no Supabase CLI"
    echo "   Execute: supabase login"
    read -p "   Continuar mesmo assim? (s/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Ss]$ ]]; then
        exit 1
    fi
fi

# Verificar se projeto está linkado
PROJECT_ID=$(grep "project_id" supabase/config.toml | cut -d '"' -f 2)
if [ -z "$PROJECT_ID" ]; then
    echo "❌ Erro: Projeto não está linkado"
    echo "   Execute: supabase link --project-ref <seu-project-ref>"
    exit 1
fi

echo "✅ Projeto linkado: $PROJECT_ID"
echo ""

# Passo 1: Verificar status das migrations
echo "📋 Passo 1: Verificando migrations..."
echo ""

echo "Migrations locais:"
supabase migration list --local || echo "   (nenhuma migration local encontrada)"
echo ""

echo "Migrations remotas:"
supabase migration list --remote || echo "   (erro ao listar migrations remotas)"
echo ""

# Passo 2: Puxar migrations do remoto
echo "📥 Passo 2: Puxando migrations do remoto..."
read -p "   Puxar migrations novas do remoto? (S/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    supabase db pull
    echo "✅ Migrations puxadas"
else
    echo "⏭️  Pulando pull de migrations"
fi
echo ""

# Passo 3: Verificar diferenças
echo "🔍 Passo 3: Verificando diferenças entre local e remoto..."
DIFF_OUTPUT=$(supabase db diff 2>&1 || true)
if [ -n "$DIFF_OUTPUT" ] && [ "$DIFF_OUTPUT" != "No schema differences found." ]; then
    echo "⚠️  Diferenças encontradas:"
    echo "$DIFF_OUTPUT"
    echo ""
    echo "💾 Salvando diff em schema_diff.sql..."
    supabase db diff > schema_diff.sql 2>&1 || true
    echo "✅ Diff salvo em schema_diff.sql"
else
    echo "✅ Nenhuma diferença encontrada"
fi
echo ""

# Passo 4: Fazer dump do schema remoto
echo "💾 Passo 4: Fazendo dump do schema remoto..."
read -p "   Fazer dump completo do schema? (S/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    echo "   Fazendo dump (isso pode levar alguns segundos)..."
    supabase db dump --remote --schema-only -f supabase/remote_schema_dump.sql 2>&1 || {
        echo "⚠️  Erro ao fazer dump. Verifique se está logado e linkado."
    }
    
    if [ -f "supabase/remote_schema_dump.sql" ]; then
        DUMP_SIZE=$(wc -l < supabase/remote_schema_dump.sql)
        echo "✅ Dump criado: supabase/remote_schema_dump.sql ($DUMP_SIZE linhas)"
        
        # Contar policies, funções, triggers
        POLICIES=$(grep -c "CREATE POLICY" supabase/remote_schema_dump.sql 2>/dev/null || echo "0")
        FUNCTIONS=$(grep -c "CREATE FUNCTION" supabase/remote_schema_dump.sql 2>/dev/null || echo "0")
        TRIGGERS=$(grep -c "CREATE TRIGGER" supabase/remote_schema_dump.sql 2>/dev/null || echo "0")
        
        echo "   📊 Estatísticas do dump:"
        echo "      - Policies RLS: $POLICIES"
        echo "      - Funções: $FUNCTIONS"
        echo "      - Triggers: $TRIGGERS"
    fi
else
    echo "⏭️  Pulando dump do schema"
fi
echo ""

# Passo 5: Verificar se Supabase local está rodando
echo "🐳 Passo 5: Verificando Supabase local..."
if docker ps | grep -q "supabase"; then
    echo "✅ Supabase local está rodando"
else
    echo "⚠️  Supabase local não está rodando"
    read -p "   Iniciar Supabase local agora? (S/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        echo "   Iniciando Supabase local..."
        supabase start
        echo "✅ Supabase local iniciado"
    fi
fi
echo ""

# Passo 6: Aplicar migrations
echo "🚀 Passo 6: Aplicar migrations no local..."
echo "   ⚠️  ATENÇÃO: Isso vai resetar o banco local e apagar todos os dados!"
read -p "   Aplicar todas as migrations no local? (s/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Ss]$ ]]; then
    echo "   Resetando banco local e aplicando migrations..."
    supabase db reset --local
    echo "✅ Migrations aplicadas"
else
    echo "⏭️  Pulando aplicação de migrations"
    echo "   Você pode aplicar depois com: supabase db reset --local"
fi
echo ""

# Passo 7: Gerar tipos TypeScript
echo "📝 Passo 7: Gerar tipos TypeScript..."
read -p "   Gerar tipos TypeScript? (S/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    if docker ps | grep -q "supabase"; then
        echo "   Gerando tipos..."
        supabase gen types typescript --local > src/integrations/supabase/types.ts
        echo "✅ Tipos gerados em src/integrations/supabase/types.ts"
    else
        echo "⚠️  Supabase local não está rodando. Não é possível gerar tipos."
    fi
else
    echo "⏭️  Pulando geração de tipos"
fi
echo ""

# Resumo
echo "=================================================="
echo "✅ Sincronização concluída!"
echo ""
echo "📋 Próximos passos:"
echo "   1. Revise o arquivo schema_diff.sql (se foi criado)"
echo "   2. Revise o arquivo supabase/remote_schema_dump.sql"
echo "   3. Verifique se há policies/funções que precisam ser migradas"
echo "   4. Se necessário, crie uma migration manual:"
echo "      supabase migration new sync_missing_items"
echo ""
echo "📚 Documentação completa:"
echo "   docs/SINCRONIZAR_REMOTO_PARA_LOCAL.md"
echo ""


