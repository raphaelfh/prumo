#!/usr/bin/env bash
# =============================================================================
# run_mutation_tests.sh — wrapper around `mutmut` for prumo's quality loop.
# =============================================================================
# Runs mutation testing on the modules listed under [tool.mutmut] in
# backend/pyproject.toml (scoped to extraction services), compares the new
# mutation score against the baseline, and emits a pass/fail.
#
# Usage:
#   bash scripts/run_mutation_tests.sh                  # full run (slow!)
#   PRUMO_MUTATION_BASELINE_DELTA=-0.10 \
#     bash scripts/run_mutation_tests.sh                # accept larger regression
#
# Exit codes:
#   0 — mutation score ≥ baseline - max_delta
#   1 — score dropped beyond max_delta (or mutmut missing)
#   2 — input error (no baseline file, no scope)
#
# Wall-clock: 20–40 min on extraction services. Run weekly via CI cron, not
# per-PR. Locally, run before merging non-trivial changes to extraction_*.
# =============================================================================
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND="${REPO_ROOT}/backend"
BASELINE_FILE="${REPO_ROOT}/docs/superpowers/quality-runs/.mutation-baseline"
MAX_DELTA="${PRUMO_MUTATION_BASELINE_DELTA:--0.05}"

if [[ ! -f "${BASELINE_FILE}" ]]; then
  echo "ERROR: mutation baseline not found: ${BASELINE_FILE}" >&2
  echo "       Run mutmut once and seed the baseline before enabling this gate." >&2
  exit 2
fi

cd "${BACKEND}"

if ! uv run --frozen mutmut --version >/dev/null 2>&1; then
  echo "ERROR: mutmut not installed. Add it to backend/pyproject.toml [dependency-groups.dev]:" >&2
  echo "       \"mutmut>=3.0\"" >&2
  exit 1
fi

echo "Running mutmut on extraction services (this may take 20–40 min)..."
# mutmut 3.x exposes --max-children for parallelism. Cap at $(nproc)/2 so we
# do not starve the test suite of CPU. Falls back to 4 if nproc unavailable.
PARALLELISM=$( ( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 8 ) | awk '{print int($1/2 < 4 ? 4 : $1/2)}' )
uv run --frozen mutmut run --max-children "${PARALLELISM}" || true   # mutmut exits non-zero when survivors exist; we judge by score

# Compute current score: survived / total (lower is better; we use 1 - survived/total)
TOTAL=$(uv run --frozen mutmut results 2>/dev/null | grep -c '^[0-9]\+:' || echo 0)
SURVIVED=$(uv run --frozen mutmut results --suspicious 2>/dev/null | grep -c '^[0-9]\+:' || echo 0)
if [[ "${TOTAL}" -eq 0 ]]; then
  echo "ERROR: mutmut produced 0 mutants. Check [tool.mutmut].paths_to_mutate." >&2
  exit 2
fi
SCORE=$(python3 -c "print(round(1.0 - ${SURVIVED} / ${TOTAL}, 3))")

BASELINE_SCORE=$(awk -F'=' '/^score *=/ { print $2 }' "${BASELINE_FILE}" | tr -d ' ')
if [[ -z "${BASELINE_SCORE}" ]]; then
  echo "ERROR: baseline file has no 'score = X.XX' line." >&2
  exit 2
fi

DELTA=$(python3 -c "print(round(${SCORE} - ${BASELINE_SCORE}, 3))")
echo ""
echo "Mutation score:    ${SCORE}"
echo "Baseline score:    ${BASELINE_SCORE}"
echo "Delta vs baseline: ${DELTA}"
echo "Max allowed delta: ${MAX_DELTA}"

# Persist a results snapshot in the latest run-dir if available, else stdout.
LATEST_RUN_DIR=$(ls -td "${REPO_ROOT}"/docs/superpowers/quality-runs/[0-9]* 2>/dev/null | head -1 || true)
if [[ -n "${LATEST_RUN_DIR}" && -d "${LATEST_RUN_DIR}" ]]; then
  {
    echo "# Mutation results — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo ""
    echo "Total mutants:  ${TOTAL}"
    echo "Survived:       ${SURVIVED}"
    echo "Score:          ${SCORE}"
    echo "Baseline:       ${BASELINE_SCORE}"
    echo "Delta:          ${DELTA}"
  } >"${LATEST_RUN_DIR}/mutation-results.txt"
fi

# Compare delta against max_delta (both can be negative).
if python3 -c "exit(0 if ${DELTA} >= ${MAX_DELTA} else 1)"; then
  echo "mutation: OK (delta ${DELTA} >= max ${MAX_DELTA})"
  exit 0
else
  echo "mutation: FAIL (delta ${DELTA} < max ${MAX_DELTA})"
  echo "  → New survivors detected. Inspect with: cd backend && uv run mutmut show <id>"
  exit 1
fi
