---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

# `scripts/fitness/` — deterministic architectural fitness functions

Each script enforces one invariant. They run locally (`bash scripts/fitness/run_all.sh`) and in CI. Together they make up the *computational controls* lane of prumo's harness-engineering split — LLM scanners are advisory; these are ground truth.

## Why fitness functions?

Conventions that exist only as "code review will catch it" rot. Each invariant we depend on gets a script. The script is the spec; if the script is silent on a violation, the invariant is no longer protected.

## Conventions

- Each check is a single executable file in this directory.
- Every `.py` check reads `--repo-root PATH`. `--scope GLOB` only where a narrowed scan is meaningful (today `check_legacy_concepts.py`, the one gate `run_all.sh --scope` forwards to). `--jsonl-out PATH` + `--emit-telemetry PATH` where the check has per-finding output — `run_all.sh` writes its own telemetry line per gate, so a check that emits only a pass/fail verdict omits both rather than ship an unused flag. `.sh` checks are thin wrappers when an existing script already enforces the invariant.
- Each `.py` check ships with **two** pytest tests under `backend/tests/unit/scripts/`:
  - `test_<check>.py` — green-path: assert exit 0 against the current tree (or against baseline if `.baseline` exists).
  - `test_<check>_canary.py` — **negative test**: plant a deliberate violation in a `tmp_path` repo root, run the check, assert exit 1. A check without a canary is decorative.
- Each check appends a paragraph to `.claude/skills/architectural-quality-loop/references/fitness-functions.md`.
- `run_all.sh` aggregates results, returns 0 iff all checks pass.

## Current checks

| Script | Invariant |
| --- | --- |
| `check_migration_split.sh` | Alembic edits only `public.*`; Supabase CLI owns `auth.*` and `storage.*`. Wraps `scripts/validate_migration_boundaries.sh`. |
| `check_legacy_concepts.py` | 4 hard-tier banned patterns (`name == 'prediction_models'`, `extracted_values` SQL identifier, `ai_suggestions` SQL identifier, `===` variants) cannot return. 12 warn-tier patterns (`qa_assessments` endpoint, `@react-pdf-viewer/*`, etc.) are reported but do not fail. |
| `check_copy_keys.py` | Every key in a `frontend/lib/copy/*.ts` namespace is referenced from `frontend/**/*.{ts,tsx}`, quoted (`t(ns,'key')`, map values) or as `.key`. knip sees unused *exports*, never unused *members* of an exported object literal, so copy catalogues rot silently (shrink-only baseline). |
| `check_diff_attribute_copy.py` | Every attribute the publish-diff backend can emit (`ATTRIBUTE_TIERS` + the constant-emitted `OPTION_KEY` / `TEMPLATE_INSTRUCTION_KEY` in `template_diff.py`) has an `ATTRIBUTE_COPY` entry in `TemplateConfigDiffSheet.tsx` and a defined key in `lib/copy/templateConfig.ts`. The sheet falls back to rendering the RAW WIRE KEY, so a new backend attribute reaches users as `allows_no_information` with every test green. Reads the service by AST — importing it would construct `Settings`. |
| `check_glossary_sync.py` | Every term defined in the skill's `concept-glossary.md` appears in `docs/reference/extraction-hitl-architecture.md` §6 — catches the mirror drifting from the canonical doc. No baseline; the two must always agree. |
| `check_rls_coverage.py` | Every `extraction_*` / `project_*` table has at least one `CREATE POLICY` in Alembic or Supabase migrations. Baselined tables grandfather pre-existing gaps; a new table without a policy fails immediately. |
| `check_api_response_envelope.py` | Every `@router.<method>` handler under `backend/app/api/v1/endpoints/` returns `ApiResponse[<T>]` — no raw dicts, no bare models. AST, not regex. Baselined exemptions. |
| `check_layered_arch.py` | AST import-graph of `backend/app/{api,services,repositories,models}`. Forbids `api → repository` direct, `repository → service` and `model → service` reverse edges. `app.core`/`utils`/`config`/`exceptions`/`domain` are cross-cutting and allow-listed. |
| `check_react_query_keys.py` | No literal-array `queryKey` in `frontend/**` — keys come from the `frontend/lib/query-keys/` factories. The factory dir is excluded so a base case is not its own violation. Baselined call sites. |
| `check_frontend_data_path.py` | The single read path (constitution §VI): outside `frontend/integrations/`, no `supabase.from(` and no `import.meta.env.VITE_API_URL`. Comments are NOT exempt — an intentional mention must be baselined. |
| `check_skill_router_sync.py` | Every skill named in CLAUDE.md's `## Which skill to load` router resolves to a real `.claude/skills/<name>/` dir. No baseline. Exit 2 if the router section goes missing, since an unparsed router reports zero dead entries forever. |
| `check_file_size.py` | Ratchet, not a ceiling: a baselined oversized file may not grow and no new file may cross the soft limit. Shrinking always passes and lets the baseline tighten. |
| `check_button_scale.py` | No `h-*` utility in a `<Button>` `className` — the size scale in `ui/button.tsx` owns height. A real tag parser, not a regex, so `className={cn("h-8")}` and `onClick={() => …}` cannot hide an override. Baselined `path:count`. |
| `check_scope_guards.py` | An ownership predicate is written ONCE. `duplicate-predicate`: the same `(model, {id, scope columns})` filtered in two functions (shrink-only baseline; mutating statements carry the scope inline and are grandfathered with a reason). `membership-sql`: raw `public.project_members` SQL outside `api/deps/security.py` — hard ban, empty baseline. |

## Adding a new check

1. Write the script under `scripts/fitness/`. Follow the argument convention above.
2. Add a baseline file `<check>.baseline` if existing violations are too many to fix in one go. Format: one violation per line, exact stable shape (path, identifier, whatever the script naturally emits). Script exits 0 iff every violation found is in the baseline. Fewer is fine — a baselined violation that is gone passes, and is reported so the baseline can be tightened (`--update-baseline`); more is a regression. (This is what all baselined checks actually do; the stricter "no fewer" reading was never implemented.)
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
