#!/usr/bin/env bash
# Generate the frontend API contract from the FastAPI app.
#
# Output (committed):
#   frontend/types/api/openapi.json  — the contract, diffable in review
#   frontend/types/api/schema.d.ts   — openapi-typescript types
#
# CI regenerates and fails on diff (api-contract job), so the committed
# types can never drift from the backend — the structural fix for the
# ApiResponse-envelope-drift incident class (hand-mirrored types).
#
# Requires: backend deps installed (uv sync) and npm deps (npm ci).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT/backend"
uv run python - <<'PY' > "$ROOT/frontend/types/api/openapi.json"
import json

from app.main import app

# sort_keys keeps the dump deterministic so the CI no-diff check is
# byte-stable across runs.
print(json.dumps(app.openapi(), indent=2, sort_keys=True))
PY

cd "$ROOT"
npx openapi-typescript frontend/types/api/openapi.json \
  -o frontend/types/api/schema.d.ts

echo "Generated frontend/types/api/{openapi.json,schema.d.ts}"
