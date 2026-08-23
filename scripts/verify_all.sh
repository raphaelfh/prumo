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
#   playwright < 90 s (local-api + local-ui projects only)
#
# A gate must never report OK without having run and passed. Two rules follow:
#   * chain gate commands with `&&` only. `|`, `;` and `|| true` discard the
#     exit status, and `set -o pipefail` below does NOT cross into `bash -c`.
#   * when the harness cannot tell whether a gate applies, RUN it; when it
#     cannot run at all, report SKIP. Never silence.
# Both rules are enforced by backend/tests/unit/scripts/test_verify_all_gates.py.
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
    printf '{"ts":"%s","phase":"VERIFY","gate":"%s","duration_ms":%d,"exit_code":%d,"status":"ran"}\n' \
      "$(_utc_iso)" "${label}" "${dur}" "${rc}" >>"${TELEMETRY_OUT}"
  fi
}

# A gate that could not run. Recorded in the Summary next to the gates that did
# run, because a SKIP that only prints a banner mid-scroll is indistinguishable
# from a gate that never existed — which is the same blindness as a false OK.
# `exit_code` is null, never 0: a skip must not read as a pass downstream.
skip_gate() {
  local label="$1" reason="$2"
  echo "=== ${label} SKIP (${reason}) ==="
  results+=("${label}: SKIP (${reason})")
  if [[ -n "${TELEMETRY_OUT}" ]]; then
    printf '{"ts":"%s","phase":"VERIFY","gate":"%s","duration_ms":0,"exit_code":null,"status":"skip","reason":"%s"}\n' \
      "$(_utc_iso)" "${label}" "${reason}" >>"${TELEMETRY_OUT}"
  fi
}

# Files changed on this branch, including uncommitted work — the quality loop
# runs VERIFY against the working tree, not against committed history.
# The previous `HEAD~1..HEAD` window only ever saw the last commit, so a
# migration added earlier in a multi-commit branch was invisible; and when git
# could not answer (root commit, shallow clone) the empty output read as
# "nothing changed" and the gate was skipped. Unknown must mean RUN, so
# CHANGED_FILES_KNOWN is set only when a diff actually succeeded.
# `rev-parse --verify --quiet` matters: a bare `git rev-parse HEAD~1` echoes
# the literal string "HEAD~1" to stdout and exits 128, so a `|| echo ""`
# fallback never fires and the base silently becomes garbage.
CHANGED_FILES=""
CHANGED_FILES_KNOWN="0"
_base="$(git -C "${REPO_ROOT}" merge-base HEAD origin/dev 2>/dev/null \
         || git -C "${REPO_ROOT}" merge-base HEAD dev 2>/dev/null \
         || git -C "${REPO_ROOT}" rev-parse --verify --quiet HEAD~1 2>/dev/null)"
if [[ -n "${_base}" ]] && _committed="$(git -C "${REPO_ROOT}" diff --name-only "${_base}"...HEAD 2>/dev/null)"; then
  # --no-renames keeps the destination path (an `R old -> new` line would
  # otherwise be tested at its OLD path); git C-quotes paths containing a
  # space or a non-ASCII character, so strip the surrounding quotes.
  _worktree="$(git -C "${REPO_ROOT}" status --porcelain --no-renames 2>/dev/null \
               | cut -c4- | sed -e 's/^"//' -e 's/"$//')"
  CHANGED_FILES="${_committed}
${_worktree}"
  CHANGED_FILES_KNOWN="1"
fi

# Is this branch documentation-only? Used to skip the e2e gate on prose edits.
#
# Deliberately an inverted predicate rather than an allowlist of "UI paths".
# An allowlist cannot work: the copy under frontend/lib/copy/ supplies the
# strings e2e selects by text, the router lives in frontend/App.tsx, the specs
# themselves live in frontend/e2e/, and backend/app/main.py wires the routes —
# none of those look like "UI", and all of them break e2e when changed.
# A false RUN costs a minute; a false SKIP costs the gate entirely.
# A here-string, not `printf | grep`: under `set -o pipefail` a `grep -q` that
# exits on the first match can leave the writer with SIGPIPE, and 141 would
# read as "not matched".
_only_docs_changed() {
  [[ "${CHANGED_FILES_KNOWN}" == "1" ]] || return 1
  ! grep -qvE '^(docs/|\.claude/|.*\.md$|[[:space:]]*$)' <<<"${CHANGED_FILES}"
}

# Read an E2E_* value the way playwright.config.ts does: `.env.e2e` wins over
# `.env` (its loader keeps the first value it sees), values are trimmed, and a
# matching pair of surrounding quotes is stripped. Getting this wrong is not
# harmless — a quoted URL makes curl reject the address and the gate would SKIP
# against a perfectly healthy stack, which is the same blindness as a false OK.
_e2e_env_value() {
  local key="$1" file value
  for file in "${REPO_ROOT}/.env.e2e" "${REPO_ROOT}/.env"; do
    [[ -f "${file}" ]] || continue
    value="$(grep -hE "^[[:space:]]*${key}=" "${file}" 2>/dev/null | tail -1 | cut -d= -f2-)"
    value="$(printf '%s' "${value}" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
             -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")"
    if [[ -n "${value}" ]]; then
      printf '%s' "${value}"
      return 0
    fi
  done
  return 1
}

# Is the local stack actually serving? Playwright's global setup spends 60 s per
# URL before dying, and that death must read as SKIP, never OK.
_stack_reachable() {
  local api_url frontend_url attempt
  api_url="${E2E_API_URL:-$(_e2e_env_value E2E_API_URL)}"
  frontend_url="${E2E_FRONTEND_URL:-$(_e2e_env_value E2E_FRONTEND_URL)}"
  api_url="${api_url:-http://127.0.0.1:8000}"
  frontend_url="${frontend_url:-http://127.0.0.1:8080}"

  # Retry: the first request to a cold Vite server triggers dep pre-bundling
  # and can take several seconds.
  for attempt in 1 2 3; do
    if curl -fsS -o /dev/null --max-time 5 "${api_url}/health" 2>/dev/null \
       && curl -fsS -o /dev/null --max-time 5 "${frontend_url}" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
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

# 3. Frontend type-check (tsc) — the same command CI runs, on purpose.
#    `tsc -p tsconfig.json` type-checks NOTHING: the root config is
#    solution-style (`"files": []` + `references`), which only `tsc --build`
#    honors, so it exited 0 with real type errors in frontend/.
run_gate "lint:tsc" \
  npm run typecheck --silent

# 3b. Dead code (repo rule: none ships). Frontend gates at ZERO knip findings
#     (config-as-baseline: every legitimate exception lives in knip.jsonc with
#     a reason). Backend is a vulture ratchet: findings must be a subset of
#     backend/.vulture_baseline, which only shrinks (--exec exists so this
#     gate needs no pipe — a pipe would hide vulture's own exit status).
run_gate "deadcode:knip" \
  npx knip
run_gate "deadcode:vulture" \
  bash -c 'cd backend && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec'

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

# 6. Architectural fitness functions
run_gate "fitness:run_all" \
  bash "${SCRIPT_DIR}/fitness/run_all.sh" ${SCOPE:+--scope "${SCOPE}"}

# 7. Playwright smoke (local-api + local-ui projects only — local-hitl is too
#    slow to run on every iteration; CI still runs all three in the
#    frontend-e2e-ephemeral job).
#    Invoked as `npx playwright test`, NOT `npm run test:e2e:local -- ...`:
#    that script hard-codes all three projects and the appended `--project`
#    flags accumulate rather than restrict, so the "too slow" project was
#    running on every iteration anyway (67 tests instead of 50).
if [[ "${SKIP_PLAYWRIGHT}" != "0" ]]; then
  skip_gate "smoke:playwright" "--skip-playwright"
elif _only_docs_changed; then
  skip_gate "smoke:playwright" "documentation-only branch"
elif ! _stack_reachable; then
  # The local stack is down: Playwright's global setup would spend 120 s on
  # healthchecks and then die before running a single test. That is a gate
  # that did not run — never an OK.
  skip_gate "smoke:playwright" "local stack unreachable — run make start"
else
  run_gate "smoke:playwright" \
    npx playwright test --project=local-api --project=local-ui
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
