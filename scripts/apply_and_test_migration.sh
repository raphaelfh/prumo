#!/bin/bash
# =====================================================
# Script para aplicar e testar migrations
#
# Uso (remoto, sem link):
#   export DATABASE_URL='postgresql://<USER>:<PASSWORD>@<HOST>:5432/<DB>?sslmode=require'
#   bash scripts/apply_and_test_migration.sh
#
# Uso (local):
#   bash scripts/apply_and_test_migration.sh
# =====================================================

set -euo pipefail

echo "🔧 Aplicando migrations..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MIGRATIONS_DIR="${REPO_ROOT}/supabase/migrations"
DOCKER_PSQL_IMAGE="${DOCKER_PSQL_IMAGE:-postgres:15}"

if [[ ! -d "${MIGRATIONS_DIR}" ]]; then
  echo "❌ Diretório de migrations não encontrado: ${MIGRATIONS_DIR}"
  exit 1
fi

have_psql() { command -v psql >/dev/null 2>&1; }
have_docker() { command -v docker >/dev/null 2>&1; }

run_psql() {
  # Uso: run_psql "<DATABASE_URL>" [args...]
  local db_url="$1"
  shift

  if have_psql; then
    psql "${db_url}" "$@"
    return
  fi

  if ! have_docker; then
    echo "❌ 'psql' não encontrado e 'docker' também não."
    echo "   Instale postgresql-client (psql) OU instale/rode o Docker."
    exit 1
  fi

  docker run --rm -i "${DOCKER_PSQL_IMAGE}" psql "${db_url}" "$@"
}

apply_sql_file() {
  # Aplica um arquivo .sql no DATABASE_URL
  local db_url="$1"
  local sql_file="$2"
  local base
  base="$(basename "${sql_file}")"

  if have_psql; then
    psql "${db_url}" -v ON_ERROR_STOP=1 -f "${sql_file}"
    return
  fi

  if ! have_docker; then
    echo "❌ Não é possível aplicar ${base}: 'psql' e 'docker' ausentes."
    exit 1
  fi

  docker run --rm -i \
    -v "${MIGRATIONS_DIR}:/migrations:ro" \
    "${DOCKER_PSQL_IMAGE}" \
    psql "${db_url}" -v ON_ERROR_STOP=1 -f "/migrations/${base}"
}

apply_missing_migrations_remote() {
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "❌ DATABASE_URL não está definido (necessário para modo remoto/psql)."
    exit 1
  fi

  echo "🌐 Modo remoto (sem link): aplicando somente migrations faltantes"
  echo "   MIGRATIONS_DIR=${MIGRATIONS_DIR}"
  if have_psql; then
    echo "   Runner: psql local"
  else
    echo "   Runner: Docker (${DOCKER_PSQL_IMAGE})"
  fi

  # Compatível com o tracking padrão do Supabase CLI
  run_psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c \
    "create schema if not exists supabase_migrations;
     create table if not exists supabase_migrations.schema_migrations (version text primary key);"

  applied_versions="$(run_psql "${DATABASE_URL}" -t -A -c \
    "select version from supabase_migrations.schema_migrations order by version;")"

  shopt -s nullglob
  migrations=( "${MIGRATIONS_DIR}"/*.sql )
  shopt -u nullglob

  if (( ${#migrations[@]} == 0 )); then
    echo "❌ Nenhum arquivo .sql encontrado em ${MIGRATIONS_DIR}"
    exit 1
  fi

  for file in "${migrations[@]}"; do
    base="$(basename "${file}")"
    version="${base%%_*}" # ex: 0027 de 0027_nome.sql

    if [[ "${version}" =~ ^[0-9]{4}$ ]]; then
      if printf '%s\n' "${applied_versions}" | grep -qx "${version}"; then
        echo "⏭️  Skip: ${base} (já aplicada)"
        continue
      fi
    fi

    echo "📝 Applying: ${base}"
    apply_sql_file "${DATABASE_URL}" "${file}"

    if [[ "${version}" =~ ^[0-9]{4}$ ]]; then
      run_psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c \
        "insert into supabase_migrations.schema_migrations(version)
         values ('${version}')
         on conflict (version) do nothing;"
    fi
  done

  echo "✅ Migrations aplicadas com sucesso (somente as faltantes)."
}

apply_local_supabase_cli() {
  echo "🏠 Modo local/Supabase CLI"

  if ! supabase status > /dev/null 2>&1; then
    echo "❌ Supabase não está rodando. Iniciando..."
    supabase start
  fi

  echo "📝 Aplicando migrations via supabase db push..."
  supabase db push
  echo "✅ Migration aplicada!"
}

run_tests() {
  echo ""
  echo "🧪 Testando unique constraints..."

  if [[ -n "${DATABASE_URL:-}" ]]; then
    run_psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 << 'EOF'
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('extraction_instances', 'extracted_values')
  AND indexname LIKE 'idx_%unique%'
ORDER BY tablename, indexname;

SELECT typname, enumlabel
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE typname = 'extraction_instance_status'
ORDER BY e.enumsortorder;

SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_name = 'chk_extraction_instances_metadata_object';

DO $$
BEGIN
  RAISE NOTICE '✅ Unique constraints verificados com sucesso!';
END $$;
EOF
    return
  fi

  # Local (mantém comportamento original)
  PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 << 'EOF'
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('extraction_instances', 'extracted_values')
  AND indexname LIKE 'idx_%unique%'
ORDER BY tablename, indexname;

SELECT typname, enumlabel
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE typname = 'extraction_instance_status'
ORDER BY e.enumsortorder;

SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_name = 'chk_extraction_instances_metadata_object';

DO $$
BEGIN
  RAISE NOTICE '✅ Unique constraints verificados com sucesso!';
END $$;
EOF
}

if [[ -n "${DATABASE_URL:-}" ]]; then
  apply_missing_migrations_remote
else
  apply_local_supabase_cli
fi

run_tests

echo ""
echo "🎉 Migration aplicada e testada com sucesso!"