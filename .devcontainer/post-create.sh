#!/usr/bin/env bash
# Materialize .env files from Codespaces secrets, then install deps and migrate.
set -euo pipefail

cd /workspace

write_env() {
  local path="$1" content="$2"
  if [ -f "$path" ]; then
    echo "==> $path exists, skipping"
  else
    printf '%s' "$content" > "$path"
    echo "==> wrote $path"
  fi
}

write_env ".env" "$(cat <<EOF
VITE_SUPABASE_ENV=remote
VITE_SUPABASE_URL=${VITE_SUPABASE_URL:-${SUPABASE_URL:-}}
VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY:-${SUPABASE_ANON_KEY:-}}
VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY:-${SUPABASE_ANON_KEY:-}}
VITE_API_URL=${VITE_API_URL:-http://127.0.0.1:8000}
EOF
)"

write_env "backend/.env" "$(cat <<EOF
PROJECT_NAME=Prumo API
DEBUG=true
API_V1_PREFIX=/api/v1
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080

SUPABASE_ENV=production
SUPABASE_URL=${SUPABASE_URL:-}
SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:-}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY:-}

DATABASE_URL=${DATABASE_URL:-}
DIRECT_DATABASE_URL=${DIRECT_DATABASE_URL:-${DATABASE_URL:-}}

OPENAI_API_KEY=${OPENAI_API_KEY:-}
OPENAI_DEFAULT_MODEL=${OPENAI_DEFAULT_MODEL:-gpt-4o-mini}

RATE_LIMIT_PER_MINUTE=60
ENCRYPTION_KEY=${ENCRYPTION_KEY:-prumo_devcontainer_default_key_change_me_32}
EOF
)"

echo "==> uv sync --extra dev"
( cd backend && uv sync --extra dev )

echo "==> npm ci"
[ -f package-lock.json ] && npm ci || npm install

if [ -n "${DATABASE_URL:-}" ] \
   && [[ "$DATABASE_URL" != *localhost* ]] \
   && [[ "$DATABASE_URL" != *127.0.0.1* ]] \
   && [[ "$DATABASE_URL" != *"<"* ]]; then
  echo "==> alembic upgrade head"
  ( cd backend && uv run alembic upgrade head ) || echo "WARN: alembic upgrade failed"
else
  echo "==> Skipping alembic (no remote DATABASE_URL)"
fi

echo "==> Done. Run: make test-backend | make start-remote"
