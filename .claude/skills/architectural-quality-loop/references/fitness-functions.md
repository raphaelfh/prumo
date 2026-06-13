# Fitness functions

One paragraph per deterministic check under `scripts/fitness/`. Each check:
- exits 0 on clean, 1 on violation, 2 on internal error
- supports `--scope GLOB`, `--repo-root PATH` (where applicable)
- supports `--emit-telemetry PATH` and `--jsonl-out PATH` (Python checks)
- ships with a green-path pytest AND a **canary** (negative test) in `backend/tests/unit/scripts/`

## Active checks

### `check_migration_split.sh`

Thin wrapper over the canonical `scripts/validate_migration_boundaries.sh`. Enforces that Alembic migrations only edit `public.*` schemas; `auth.*` and `storage.*` are owned by the Supabase CLI. Allowed exceptions (FKs to `auth.users`, `auth.uid()`/`auth.role()` calls, `POLICY ON storage.objects` consulting public tables) are documented inside the script. The wrapper exists so `scripts/fitness/run_all.sh` has a single entry-point convention; the wrapped script is the single implementation. Wall-clock budget: < 100 ms.

### `check_legacy_concepts.py`

Bans reintroduction of the 16-entry legacy patterns blacklist (see `legacy-patterns.md`). Two tiers:
- **Hard tier (4 patterns)**: `name == 'prediction_models'` (Python), `name === 'prediction_models'` (TypeScript), `extracted_values` SQL identifier, `ai_suggestions` SQL identifier. A hit outside the literal allowlist fails the gate.
- **Warn tier (12 patterns)**: the rest. Reported in stdout + JSONL but do not fail.

The allowlist is a literal constant inside the script (not a separate file) so the contract stays single-file; covers historical-comment files (`seed.py`, `models/extraction.py`), the canary test dir (`backend/tests/unit/scripts/`), and archived migrations (`backend/alembic/versions/archive/`). Comment lines (Python `#`, JS/TS `//`, JSDoc `*`, Python docstring `"""`) are universally skipped — documentation referencing the legacy pattern is allowed. Wall-clock budget: < 1 s for full-repo scan.

## Planned (Phase 4)

### `check_rls_coverage.py`

For every `extraction_*` and `project_*` table declared in `backend/alembic/versions/baseline_v1.sql` or any delta migration, assert that at least one `CREATE POLICY ... ON <table>` exists (in Alembic OR Supabase migrations). Maintains a `.baseline` of currently-grandfathered tables so a new table without policy fails immediately but pre-existing gaps require explicit baseline edits.

### `check_api_response_envelope.py`

AST-parse every router file under `backend/app/api/v1/endpoints/`. For every function decorated with `@router.<method>`, assert the return annotation is `ApiResponse[<T>]` (no raw dicts, no bare models). Class-based views are out of scope until one exists. Maintains a `.baseline` of grandfathered exemptions.

### `check_layered_arch.py`

AST import-graph of `backend/app/{api,services,repositories,models}`. Forbidden edges: `api → repository` direct, `repository → service` reverse, `model → service` reverse. Cross-cutting prefixes (`app.core`, `app.utils`, `app.config`, `app.exceptions`, `app.domain`) are allow-listed. Maintains a `.baseline` of grandfathered violations.

### `check_glossary_sync.py`

Reads `concept-glossary.md` and `docs/reference/extraction-hitl-architecture.md` §6. Asserts every term defined in the glossary appears in the architecture doc (catches glossary drift when the canonical doc is edited without updating the skill mirror). No baseline file — the two must always agree.

## Planned (Phase 5)

### `check_react_query_keys.py`

After the `frontend/lib/query-keys/` convention is introduced, this check parses every `**/*.ts(x)` for `useQuery({ queryKey: [...] })` literal arrays. A literal array is a violation unless its first element is a re-export from `frontend/lib/query-keys/<namespace>.ts`. Maintains a `.baseline` of grandfathered call sites.

## Harness invariants

- `run_all.sh` invokes each check, aggregates exit codes, returns 0 iff every check returns 0.
- Each Python check emits structured stdout: `<check_name>: OK|FAIL (<duration> ms; <details>)`.
- Each Python check accepts `--emit-telemetry <path>` to append a JSON line `{ts, phase: "fitness", gate, duration_ms, exit_code, finding_count?, ...}`.
- Each Python check accepts `--jsonl-out <path>` to write per-finding JSON conforming to the scanner schema. The orchestrator concatenates these into the run-dir's `findings.jsonl`.
- The scanner skill's SCAN phase invokes `bash scripts/fitness/run_all.sh --scope "<scope>"` (when a `--scope` arg is supported by the check) in parallel with the 5 Explore subagents.
