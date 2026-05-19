# `scripts/fitness/` — deterministic architectural fitness functions

Each script enforces one invariant. They run locally (`bash scripts/fitness/run_all.sh`) and in CI. Together they make up the *computational controls* lane of prumo's harness-engineering split — LLM scanners are advisory; these are ground truth.

## Why fitness functions?

Conventions that exist only as "code review will catch it" rot. Each invariant we depend on gets a script. The script is the spec; if the script is silent on a violation, the invariant is no longer protected.

## Conventions

- Each check is a single executable file in this directory.
- `.py` checks read `--scope GLOB` and `--repo-root PATH` and emit JSONL via `--jsonl-out PATH` + telemetry via `--emit-telemetry PATH`. `.sh` checks are thin wrappers when an existing script already enforces the invariant.
- Each `.py` check ships with **two** pytest tests under `backend/tests/unit/scripts/`:
  - `test_<check>.py` — green-path: assert exit 0 against the current tree (or against baseline if `.baseline` exists).
  - `test_<check>_canary.py` — **negative test**: plant a deliberate violation in a `tmp_path` repo root, run the check, assert exit 1. A check without a canary is decorative.
- Each check appends a paragraph to `.claude/skills/architectural-quality-loop/references/fitness-functions.md`.
- `run_all.sh` aggregates results, returns 0 iff all checks pass.

## Current checks

| Script | Invariant |
|---|---|
| `check_migration_split.sh` | Alembic edits only `public.*`; Supabase CLI owns `auth.*` and `storage.*`. Wraps `scripts/validate_migration_boundaries.sh`. |
| `check_legacy_concepts.py` | 4 hard-tier banned patterns (`name == 'prediction_models'`, `extracted_values` SQL identifier, `ai_suggestions` SQL identifier, `===` variants) cannot return. 12 warn-tier patterns (`qa_assessments` endpoint, `@react-pdf-viewer/*`, etc.) are reported but do not fail. |

## Adding a new check

1. Write the script under `scripts/fitness/`. Follow the argument convention above.
2. Add a baseline file `<check>.baseline` if existing violations are too many to fix in one go. Format: one violation per line, exact stable shape (path, identifier, whatever the script naturally emits). Script exits 0 iff violations match the baseline exactly (no fewer, no more — fewer is a baseline tightening that must be committed; more is a regression).
3. Add the green-path test (`backend/tests/unit/scripts/test_<check>.py`) — assert exit 0 on the current tree.
4. **Add the canary test** (`backend/tests/unit/scripts/test_<check>_canary.py`). Create the smallest possible fixture under `tmp_path` that *should* trigger the check (a forbidden pattern in a non-allowlisted file), run the script with `--repo-root <tmp_path>`, assert exit 1. This is non-negotiable: without it, the check could silently break and the gate would lie green.
5. Append the check to `run_all.sh`.
6. Append a paragraph to `.claude/skills/architectural-quality-loop/references/fitness-functions.md`.

## Harness contract

- **Telemetry**: every check supports `--emit-telemetry <path>` (where applicable) writing one JSONL line per invocation with `{ts, phase: "fitness", gate, duration_ms, exit_code, …}`.
- **JSONL findings**: every `.py` check supports `--jsonl-out <path>` writing one JSONL line per finding, conforming to the schema in `.claude/skills/architectural-quality-loop/architectural-scanner/SKILL.md` (`source: fitness:<script>:<rule>`).
- **Exit codes**: `0` clean; `1` violations; `2` internal error.
- **Idempotent**: re-running with the same tree produces identical output.
- **Fast**: target ≤ 5 s wall-clock for full-repo scans; budget +2 s per check added to `run_all.sh`.
