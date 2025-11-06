#!/bin/bash

# Script para limpar e organizar dump do schema
# Uso: ./scripts/clean-schema-dump.sh <arquivo_dump.sql> [output.sql]

set -e

if [ $# -lt 1 ]; then
    echo "Uso: $0 <arquivo_dump.sql> [output.sql]"
    echo ""
    echo "Limpa um dump do schema removendo:"
    echo "  - Comentários de debug"
    echo "  - SET statements desnecessários"
    echo "  - Dados (INSERT statements)"
    echo "  - Comandos de ownership"
    exit 1
fi

INPUT_FILE="$1"
OUTPUT_FILE="${2:-${INPUT_FILE%.sql}_limpo.sql}"

if [ ! -f "$INPUT_FILE" ]; then
    echo "❌ Erro: Arquivo não encontrado: $INPUT_FILE"
    exit 1
fi

echo "🧹 Limpando dump do schema..."
echo "   Entrada: $INPUT_FILE"
echo "   Saída: $OUTPUT_FILE"
echo ""

# Limpar o dump
cat "$INPUT_FILE" | \
    # Remover comentários de debug (linhas que começam com -- e contêm debug/temp/test)
    grep -v "^--.*\(debug\|temp\|test\|TODO\|FIXME\)" | \
    # Remover SET statements de configuração temporária
    grep -v "^SET " | \
    # Remover ALTER TABLE ... OWNER (não necessário em migrations)
    grep -v "OWNER TO" | \
    # Remover INSERT statements (dados)
    grep -v "^INSERT INTO" | \
    # Remover COPY statements (dados)
    grep -v "^COPY " | \
    # Remover SELECT pg_catalog (metadata do pg_dump)
    grep -v "^SELECT pg_catalog" | \
    # Manter linhas vazias para legibilidade, mas limitar a 1 linha vazia consecutiva
    sed ':a;/^$/N;/^\n$/ba' | \
    # Remover espaços em branco no final das linhas
    sed 's/[[:space:]]*$//' > "$OUTPUT_FILE"

# Estatísticas
ORIGINAL_LINES=$(wc -l < "$INPUT_FILE")
CLEANED_LINES=$(wc -l < "$OUTPUT_FILE")
REMOVED_LINES=$((ORIGINAL_LINES - CLEANED_LINES))

echo "✅ Limpeza concluída!"
echo ""
echo "📊 Estatísticas:"
echo "   Linhas originais: $ORIGINAL_LINES"
echo "   Linhas após limpeza: $CLEANED_LINES"
echo "   Linhas removidas: $REMOVED_LINES"
echo ""
echo "📄 Arquivo limpo salvo em:"
echo "   $OUTPUT_FILE"
echo ""
echo "💡 Dica: Revise o arquivo antes de usar na migration"
echo "   cat $OUTPUT_FILE | less"


