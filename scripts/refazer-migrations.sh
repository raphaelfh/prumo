#!/bin/bash

# Script para refazer migrations do zero
# Uso: ./scripts/refazer-migrations.sh
#
# Este script:
# 1. Faz backup de tudo
# 2. Gera dump do schema remoto
# 3. Limpa migrations antigas
# 4. Cria nova migration inicial
# 5. Prepara para você editar

set -e  # Parar em caso de erro

echo "🔄 Refazendo Migrations do Zero"
echo "=================================================="
echo ""
echo "⚠️  ATENÇÃO: Este processo vai:"
echo "   - Fazer backup das migrations atuais"
echo "   - Limpar todas as migrations antigas"
echo "   - Criar uma nova migration inicial"
echo ""
read -p "   Continuar? (s/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Ss]$ ]]; then
    echo "❌ Cancelado"
    exit 1
fi

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
    echo "❌ Erro: Você não está logado no Supabase CLI"
    echo "   Execute: supabase login"
    exit 1
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

# =================== PASSO 1: BACKUP ===================
echo "📦 Passo 1: Fazendo backup..."
echo ""

BACKUP_DIR="supabase/migrations_backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Backup das migrations
if [ -d "supabase/migrations" ] && [ "$(ls -A supabase/migrations/*.sql 2>/dev/null)" ]; then
    echo "   Fazendo backup das migrations..."
    cp -r supabase/migrations/*.sql "$BACKUP_DIR/" 2>/dev/null || true
    echo "✅ Migrations backupadas em: $BACKUP_DIR"
else
    echo "⚠️  Nenhuma migration encontrada para backup"
fi

# Backup do schema remoto
echo "   Fazendo dump do schema remoto..."
SCHEMA_DUMP="supabase/schema_remoto_$(date +%Y%m%d_%H%M%S).sql"
if supabase db dump --remote --schema-only -f "$SCHEMA_DUMP" 2>&1; then
    DUMP_SIZE=$(wc -l < "$SCHEMA_DUMP" 2>/dev/null || echo "0")
    echo "✅ Schema remoto dumpado: $SCHEMA_DUMP ($DUMP_SIZE linhas)"
    
    # Estatísticas
    TABLES=$(grep -c "CREATE TABLE" "$SCHEMA_DUMP" 2>/dev/null || echo "0")
    POLICIES=$(grep -c "CREATE POLICY" "$SCHEMA_DUMP" 2>/dev/null || echo "0")
    FUNCTIONS=$(grep -c "CREATE.*FUNCTION" "$SCHEMA_DUMP" 2>/dev/null || echo "0")
    TRIGGERS=$(grep -c "CREATE TRIGGER" "$SCHEMA_DUMP" 2>/dev/null || echo "0")
    
    echo "   📊 Estatísticas do schema:"
    echo "      - Tabelas: $TABLES"
    echo "      - Policies RLS: $POLICIES"
    echo "      - Funções: $FUNCTIONS"
    echo "      - Triggers: $TRIGGERS"
else
    echo "⚠️  Erro ao fazer dump do schema remoto"
    echo "   Continuando mesmo assim..."
fi

echo ""

# =================== PASSO 2: LIMPAR MIGRATIONS ===================
echo "🧹 Passo 2: Limpando migrations antigas..."
echo ""

if [ -d "supabase/migrations" ]; then
    MIGRATION_COUNT=$(ls -1 supabase/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
    
    if [ "$MIGRATION_COUNT" -gt 0 ]; then
        echo "   Encontradas $MIGRATION_COUNT migrations antigas"
        read -p "   Remover migrations antigas? (s/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Ss]$ ]]; then
            # Mover para backup (não deletar)
            mv supabase/migrations/*.sql "$BACKUP_DIR/" 2>/dev/null || true
            echo "✅ Migrations antigas movidas para: $BACKUP_DIR"
        else
            echo "⏭️  Pulando remoção de migrations"
        fi
    else
        echo "✅ Nenhuma migration antiga encontrada"
    fi
else
    echo "⚠️  Diretório supabase/migrations não existe, criando..."
    mkdir -p supabase/migrations
fi

echo ""

# =================== PASSO 3: CRIAR NOVA MIGRATION ===================
echo "✨ Passo 3: Criando nova migration inicial..."
echo ""

# Criar migration com nome descritivo
MIGRATION_NAME="initial_schema_from_remote"
if supabase migration new "$MIGRATION_NAME" 2>&1; then
    NEW_MIGRATION=$(ls -t supabase/migrations/*_${MIGRATION_NAME}.sql 2>/dev/null | head -1)
    
    if [ -n "$NEW_MIGRATION" ]; then
        echo "✅ Nova migration criada: $NEW_MIGRATION"
        echo ""
        
        # Criar template inicial
        cat > "$NEW_MIGRATION" << 'EOF'
-- =====================================================
-- MIGRATION INICIAL: Schema Completo do Review Hub
-- =====================================================
-- Data: REPLACE_WITH_DATE
-- Descrição: Schema completo baseado no estado atual do projeto remoto
-- 
-- Esta migration foi gerada a partir do dump do schema remoto.
-- Substitua este conteúdo pelo conteúdo do arquivo:
--   supabase/schema_remoto_*.sql
-- 
-- IMPORTANTE: Remova inserts de dados, mantenha apenas schema.
-- =====================================================

-- TODO: Copie o conteúdo do dump do schema remoto aqui
-- Arquivo de referência: supabase/schema_remoto_*.sql
-- 
-- O que incluir:
-- ✅ Extensões (CREATE EXTENSION)
-- ✅ Tipos ENUM (CREATE TYPE)
-- ✅ Funções (CREATE FUNCTION)
-- ✅ Tabelas (CREATE TABLE)
-- ✅ Constraints, índices, foreign keys
-- ✅ Triggers (CREATE TRIGGER)
-- ✅ Policies RLS (CREATE POLICY)
-- ✅ Views (CREATE VIEW)
--
-- O que NÃO incluir:
-- ❌ Dados (INSERT statements)
-- ❌ Comentários de debug temporários
-- ❌ Código experimental

-- Exemplo de estrutura:
-- =================== EXTENSÕES ===================
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =================== TIPOS ENUM ===================
-- CREATE TYPE extraction_framework AS ENUM (...);

-- =================== FUNÇÕES ===================
-- CREATE OR REPLACE FUNCTION set_updated_at() ...

-- =================== TABELAS ===================
-- CREATE TABLE users (...);

-- =================== CONSTRAINTS E ÍNDICES ===================
-- ALTER TABLE ... ADD CONSTRAINT ...

-- =================== TRIGGERS ===================
-- CREATE TRIGGER ...

-- =================== ROW LEVEL SECURITY ===================
-- CREATE POLICY ...

EOF
        
        echo "📝 Template criado na migration"
        echo "   Edite o arquivo e substitua pelo conteúdo do dump:"
        echo "   $NEW_MIGRATION"
        echo ""
        
        # Mostrar localização do dump
        if [ -f "$SCHEMA_DUMP" ]; then
            echo "📄 Arquivo de referência (dump do schema):"
            echo "   $SCHEMA_DUMP"
            echo ""
            echo "💡 Dica: Use este comando para ver o dump:"
            echo "   cat $SCHEMA_DUMP | less"
        fi
    else
        echo "⚠️  Migration criada mas não encontrada"
    fi
else
    echo "❌ Erro ao criar nova migration"
    exit 1
fi

echo ""

# =================== RESUMO ===================
echo "=================================================="
echo "✅ Processo concluído!"
echo ""
echo "📋 Próximos passos:"
echo ""
echo "1. Edite a migration criada:"
echo "   $NEW_MIGRATION"
echo ""
echo "2. Copie o conteúdo do dump do schema:"
echo "   $SCHEMA_DUMP"
echo ""
echo "3. Limpe o dump (remova INSERTs, comentários de debug)"
echo ""
echo "4. Teste localmente:"
echo "   supabase db reset --local"
echo ""
echo "5. Verifique diferenças:"
echo "   supabase db diff"
echo ""
echo "6. Quando estiver tudo OK, gere tipos TypeScript:"
echo "   supabase gen types typescript --local > src/integrations/supabase/types.ts"
echo ""
echo "📦 Backups salvos em:"
echo "   $BACKUP_DIR"
echo ""
echo "📚 Documentação completa:"
echo "   docs/REFAZER_MIGRATIONS_DO_ZERO.md"
echo ""


