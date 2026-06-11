#!/usr/bin/env bash
# =============================================================================
# verify_all.sh — prumo verification harness
# =============================================================================
# Composes every deterministic gate (lint, type-check, tests, fitness, Playwright
# smoke) for the architectural-quality-loop's VERIFY phase. Emits aggregated
# telemetry. Returns 0 iff every gate exits 0.
#
# Usage:
#   bash scripts/verify_all.sh                              # full run
#   bash scripts/verify_all.sh --scope "<glob>"             # narrowed scope
#   bash scripts/verify_all.sh --skip-playwright            # skip e2e smoke
#   PRUMO_TELEMETRY_OUT=/tmp/t.jsonl bash scripts/verify_all.sh
#
# Conventions: each gate emits its own structured stdout line; the harness
# adds a "Summary:" block at the end. Wall-clock targets per gate:
#   ruff       < 2 s
#   eslint     < 10 s
#   tsc        < 30 s
#   pytest     < 60 s (unit/integration scope)
#   vitest     < 60 s
#   fitness    < 5 s
#   playwright < 30 s (local-api + local-ui projects only)
# =============================================================================
set -o pipefail   # do not enable -u (mac bash 3.2 + empty arrays misbehave)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TELEMETRY_OUT="${PRUMO_TELEMETRY_OUT:-}"

SCOPE=""
SKIP_PLAYWRIGHT="0"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scope)         SCOPE="$2"; shift 2 ;;
    --skip-playwright) SKIP_PLAYWRIGHT="1"; shift ;;
    *) shift ;;
  esac
done

cd "${REPO_ROOT}"

_now_ms() { python3 -c 'import time;print(int(time.time()*1000))'; }
_utc_iso() { python3 -c 'import time;print(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))'; }

fail=0
results=()

run_gate() {
  local label="$1"; shift
  local start_ts end_ts dur rc
  start_ts=$(_now_ms)
  echo "=== ${label} ==="
  "$@"
  rc=$?
  end_ts=$(_now_ms)
  dur=$((end_ts - start_ts))
  echo "=== ${label} exit=${rc} ==="
  if [[ ${rc} -eq 0 ]]; then
    results+=("${label}: OK (${dur} ms)")
  else
    results+=("${label}: FAIL exit=${rc} (${dur} ms)")
    fail=1
  fi
  if [[ -n "${TELEMETRY_OUT}" ]]; then
    printf '{"ts":"%s","phase":"VERIFY","gate":"%s","duration_ms":%d,"exit_code":%d}\n' \
      "$(_utc_iso)" "${label}" "${dur}" "${rc}" >>"${TELEMETRY_OUT}"
  fi
}

echo "Running verify_all.sh from ${REPO_ROOT}"
echo "Scope: ${SCOPE:-<full>}"
echo ""

# 1. Backend lint (ruff)
run_gate "lint:ruff" \
  bash -c 'cd backend && uv run ruff check . && uv run ruff format --check .'

# 2. Frontend lint (eslint)
run_gate "lint:eslint" \
  npm run lint --silent

# 3. Frontend type-check (tsc)
run_gate "lint:tsc" \
  bash -c 'npx tsc --noEmit -p tsconfig.json 2>&1 | tail -20'

# 4. Backend tests (pytest)
run_gate "test:pytest" \
  bash -c 'cd backend && uv run pytest -q --tb=short'

# 5. Frontend tests (vitest, --run = no watch)
run_gate "test:vitest" \
  npm test -- --run

# 5b. React Compiler pipeline proof — fails if a config refactor silently
#     stops the compiler from being applied (manual memoization was removed
#     on the assumption that it runs; see the compiler-enablement spec).
run_gate "build:react-compiler" \
  node scripts/check_compiler_coverage.mjs

# 6. DB migration lint (squawk, only if migrations touched)
#    We check `git diff --name-only HEAD~1..HEAD` for alembic versions; if nothing
#    is in scope, skip silently.
if git -C "${REPO_ROOT}" diff --name-only HEAD~1..HEAD 2>/dev/null | \
   grep -q '^backend/alembic/versions/'; then
  run_gate "db:squawk" \
    make db-lint-migrations
else
  echo "=== db:squawk SKIP (no migration changes detected) ==="
fi

# 7. Architectural fitness functions
run_gate "fitness:run_all" \
  bash "${SCRIPT_DIR}/fitness/run_all.sh" ${SCOPE:+--scope "${SCOPE}"}

# 8. Playwright smoke (local-api + local-ui projects only — local-hitl is too slow
#    to run on every iteration). Skip if no router/UI files in scope.
if [[ "${SKIP_PLAYWRIGHT}" == "0" ]]; then
  touched_routing="0"
  if git -C "${REPO_ROOT}" diff --name-only HEAD~1..HEAD 2>/dev/null | \
     grep -qE '^(backend/app/api/|frontend/components/|frontend/pages/|frontend/hooks/)'; then
    touched_routing="1"
  fi
  if [[ "${touched_routing}" == "1" ]]; then
    run_gate "smoke:playwright" \
      bash -c 'npm run test:e2e:local -- --project=local-api --project=local-ui 2>&1 | tail -30'
  else
    echo "=== smoke:playwright SKIP (no routing/UI changes detected) ==="
  fi
fi

echo ""
echo "Summary:"
for line in "${results[@]}"; do
  echo "  ${line}"
done

if [[ ${fail} -ne 0 ]]; then
  echo ""
  echo "One or more verification gates failed. See output above."
fi

exit ${fail}
