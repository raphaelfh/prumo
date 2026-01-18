#!/usr/bin/env bash
set -euo pipefail

# Aplica as migrations SQL do diretório supabase/migrations em um Postgres
# apontado por DATABASE_URL.
#
# Uso:
#   DATABASE_URL=postgresql://... ./backend/scripts/apply_supabase_migrations.sh
#
# Requisitos:
#   - psql instalado
#   - DATABASE_URL setado

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL não está definido"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql não encontrado. Instale o postgresql-client."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MIGRATIONS_DIR="${REPO_ROOT}/supabase/migrations"

if [[ ! -d "${MIGRATIONS_DIR}" ]]; then
  echo "ERROR: diretório de migrations não encontrado: ${MIGRATIONS_DIR}"
  exit 1
fi

echo "Using DATABASE_URL=${DATABASE_URL}"
echo "Applying migrations from: ${MIGRATIONS_DIR}"

# Garantir que o glob expanda corretamente (evita iterar com o literal '*.sql')
shopt -s nullglob
migrations=("${MIGRATIONS_DIR}"/*.sql)
shopt -u nullglob

if (( ${#migrations[@]} == 0 )); then
  echo "ERROR: nenhum arquivo .sql encontrado em ${MIGRATIONS_DIR}"
  exit 1
fi

# Importante:
# - os arquivos são prefixados (0001_, 0002_, ...) então a ordenação lexicográfica funciona.
# - ON_ERROR_STOP garante fail-fast se alguma migration falhar.
for file in "${migrations[@]}"; do
  echo "Applying: $(basename "${file}")"
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${file}"
done

echo "Migrations applied successfully."
