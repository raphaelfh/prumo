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
# The script writes the file itself: importing the app logs to stdout, so a
# shell redirect would prepend log lines to the JSON.
OPENAPI_OUT="$ROOT/frontend/types/api/openapi.json" uv run python - <<'PY'
import json
import os
from pathlib import Path

from app.main import app

# sort_keys keeps the dump deterministic so the CI no-diff check is
# byte-stable across runs.
Path(os.environ["OPENAPI_OUT"]).write_text(
    json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n", encoding="utf-8"
)
PY

cd "$ROOT"
npx openapi-typescript frontend/types/api/openapi.json \
  -o frontend/types/api/schema.d.ts

echo "Generated frontend/types/api/{openapi.json,schema.d.ts}"
