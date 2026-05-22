#!/usr/bin/env bash
# =============================================================================
# run_all.sh — prumo architectural fitness function harness
# =============================================================================
# Composes every check under scripts/fitness/, aggregates exit codes, prints a
# one-line summary per check, and emits aggregated telemetry to stdout.
#
# Usage:
#   bash scripts/fitness/run_all.sh                      # whole repo
#   bash scripts/fitness/run_all.sh --scope "<glob>"     # narrowed scope
#   PRUMO_TELEMETRY_OUT=/tmp/t.jsonl bash scripts/fitness/run_all.sh
#
# Exit code: 0 if every check exit 0; 1 otherwise.
# =============================================================================
set -o pipefail   # do not enable -u (macOS bash 3.2 + empty arrays misbehave)
                  # do not enable -e (we want to aggregate failures, not bail)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TELEMETRY_OUT="${PRUMO_TELEMETRY_OUT:-}"

# Optional scope passthrough — empty when absent.
# Use an array (not a string) to preserve the glob verbatim across the python
# subprocess boundary; unquoted ${str} would undergo pathname expansion.
SCOPE_ARGS=()
if [[ "${1:-}" == "--scope" && -n "${2:-}" ]]; then
  SCOPE_ARGS=(--scope "$2")
fi

cd "${REPO_ROOT}"

# Portable millisecond timestamp (macOS `date` lacks %3N).
_now_ms() { python3 -c 'import time;print(int(time.time()*1000))'; }
_utc_iso() { python3 -c 'import time;print(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))'; }

fail=0
results=()

run_check() {
  local label="$1"; shift
  local start_ts end_ts dur rc
  start_ts=$(_now_ms)
  "$@"
  rc=$?
  end_ts=$(_now_ms)
  dur=$((end_ts - start_ts))
  if [[ ${rc} -eq 0 ]]; then
    results+=("${label}: OK (${dur} ms)")
  else
    results+=("${label}: FAIL exit=${rc} (${dur} ms)")
    fail=1
  fi
  if [[ -n "${TELEMETRY_OUT}" ]]; then
    printf '{"ts":"%s","phase":"fitness","gate":"%s","duration_ms":%d,"exit_code":%d}\n' \
      "$(_utc_iso)" "${label}" "${dur}" "${rc}" >>"${TELEMETRY_OUT}"
  fi
}

echo "Running fitness checks from ${REPO_ROOT}..."
echo ""

run_check "check_migration_split.sh" \
  bash "${SCRIPT_DIR}/check_migration_split.sh"

run_check "check_legacy_concepts.py" \
  python3 "${SCRIPT_DIR}/check_legacy_concepts.py" "${SCOPE_ARGS[@]}"

run_check "check_glossary_sync.py" \
  python3 "${SCRIPT_DIR}/check_glossary_sync.py"

run_check "check_rls_coverage.py" \
  python3 "${SCRIPT_DIR}/check_rls_coverage.py"

run_check "check_api_response_envelope.py" \
  python3 "${SCRIPT_DIR}/check_api_response_envelope.py"

run_check "check_layered_arch.py" \
  python3 "${SCRIPT_DIR}/check_layered_arch.py"

run_check "check_react_query_keys.py" \
  python3 "${SCRIPT_DIR}/check_react_query_keys.py"

echo ""
echo "Summary:"
for line in "${results[@]}"; do
  echo "  ${line}"
done

if [[ ${fail} -ne 0 ]]; then
  echo ""
  echo "One or more fitness checks failed. See output above."
fi

exit ${fail}
