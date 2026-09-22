---
status: stable
last_reviewed: 2026-09-21
owner: '@raphaelfh'
---

> **Status:** Stable · Last reviewed: 2026-09-21 · Owner: @raphaelfh

# `scripts/fitness/` — deterministic architectural fitness functions

Each script enforces one invariant. They run locally (`bash scripts/fitness/run_all.sh`) and in CI's required `Architectural Fitness` job. Together they make up the *computational controls* lane of prumo's harness-engineering split — LLM scanners are advisory; these are ground truth.

## Why fitness functions?

Conventions that exist only as "code review will catch it" rot. Each invariant we depend on gets a script. The script is the spec; if the script is silent on a violation, the invariant is no longer protected.

## Conventions

- Each check is a single executable file in this directory.
- Every `.py` check reads `--repo-root PATH`. `--scope GLOB` only where a narrowed scan is meaningful (today `check_legacy_concepts.py`, the one gate `run_all.sh --scope` forwards to). Most also accept `--jsonl-out PATH` + `--emit-telemetry PATH` (see [Harness contract](#harness-contract)); four accept neither: `check_diff_attribute_copy.py`, `check_file_size.py`, `check_retired_symbols.py`, `check_ui_primitives.py`. `.sh` checks are thin wrappers when an existing script already enforces the invariant.
- Each `.py` check ships with **two** pytest tests under `backend/tests/unit/scripts/`:
  - `test_<check>.py` — green-path: assert exit 0 against the current tree (or against baseline if `.baseline` exists).
  - `test_<check>_canary.py` — **negative test**: plant a deliberate violation in a `tmp_path` repo root, run the check, assert exit 1. A check without a canary is decorative.
- `run_all.sh` aggregates results, returns 0 iff all checks pass.

## Current checks

| Script | Invariant |
| --- | --- |
| `check_migration_split.sh` | Alembic edits only `public.*`; Supabase CLI owns `auth.*` and `storage.*`. Wraps `scripts/validate_migration_boundaries.sh`. |
| `check_legacy_concepts.py` | 4 hard-tier banned patterns (`name == 'prediction_models'`, `extracted_values` SQL identifier, `ai_suggestions` SQL identifier, `===` variants) cannot return. 13 warn-tier patterns (`qa_assessments` endpoint, `@react-pdf-viewer/*`, etc.) are reported but do not fail. Entry numbers and rationale live in `.claude/skills/architectural-quality-loop/references/legacy-patterns.md`. Each pattern carries its own path allowlist in the script; a line that starts with a comment marker is skipped; `docs/reference/**/*.md` is scanned inside fenced `sql` blocks only, always at warn tier. |
| `check_copy_keys.py` | Every key in a `frontend/lib/copy/*.ts` namespace is referenced from `frontend/**/*.{ts,tsx}`, quoted (`t(ns,'key')`, map values) or as `.key`. knip sees unused *exports*, never unused *members* of an exported object literal, so copy catalogues rot silently (shrink-only baseline). Exit 2 on a namespace shape it cannot parse. Read the module docstring before clearing a baseline entry: `t()` renders `''` for a missing key, so a wrong deletion ships as a blank string. |
| `check_diff_attribute_copy.py` | Every attribute the publish-diff backend can emit (`ATTRIBUTE_TIERS` + the constant-emitted `OPTION_KEY` / `TEMPLATE_INSTRUCTION_KEY` in `template_diff.py`) has an `ATTRIBUTE_COPY` entry in `TemplateConfigDiffSheet.tsx` and a defined key in `lib/copy/templateConfig.ts`. The sheet falls back to rendering the RAW WIRE KEY, so a new backend attribute reaches users as `allows_no_information` with every test green. Reads the service by AST — importing it would construct `Settings`. |
| `check_glossary_sync.py` | One-way name check: every `- **Term** —` bullet name in the skill's `concept-glossary.md` appears verbatim somewhere in `docs/reference/extraction-hitl-architecture.md` (anywhere, not only §6). Definitions are not compared, and the canonical doc may define more terms. No baseline. |
| `check_rls_coverage.py` | Every `extraction_*` / `project_*` table has at least one `CREATE POLICY` in Alembic or Supabase migrations. Baselined tables grandfather pre-existing gaps; a new table without a policy fails immediately. |
| `check_api_response_envelope.py` | Every `@router.<method>` handler under `backend/app/api/v1/endpoints/` returns `ApiResponse[<T>]` — no raw dicts, no bare models. AST, not regex. Baselined exemptions. |
| `check_layered_arch.py` | AST import-graph of all of `backend/app/` (`__init__.py`, relative and `from app import x` imports included). Forbids `api → repositories/models`, `repositories → services` and `models → services/repositories`. Support packages (`core`/`utils`/`domain`/`schemas`/`llm`/`infrastructure`) are importable from every layer and so may not import a layer back, or `api → schemas → models` launders the api rule. `worker`/`main`/seed scripts are unchecked composition roots. Exit 2 on zero edges, an unparsable file, or an unclassified top-level package. Baselined `file:module  # reason`. |
| `check_react_query_keys.py` | No literal-array `queryKey` in `frontend/**` — keys come from the `frontend/lib/query-keys/` factories. The factory dir is excluded so a base case is not its own violation. Baselined call sites. |
| `check_frontend_data_path.py` | Ratchet for the single read path (constitution §VI): in browser code (outside `frontend/integrations/`, tests and e2e), counts `supabase.from(<table>)` reads and `import.meta.env.VITE_API_URL` per file. Whole-file scan with comments blanked, so a chain split across lines counts and a comment does not. Baselined `file\|table:count`; a new key or a higher count fails, and a read moved to another file is a new key. |
| `check_file_size.py` | Ratchet, not a ceiling: a baselined oversized file may not grow and no new file may cross the soft limit (800 lines). Shrinking always passes. Re-baseline per path (`--update-baseline <path>...`) — only the named entries change, so files other PRs shrank stay untouched. |
| `check_button_scale.py` | No `h-*` utility in a `<Button>` `className` — the size scale in `ui/button.tsx` owns height. A real tag parser, not a regex, so `className={cn("h-8")}` and `onClick={() => …}` cannot hide an override. `min-h-*`, `max-h-*` and descendant selectors (`[&_svg]:h-3.5`) are not overrides; `sm:h-8` is. Baselined `path:count`. |
| `check_ui_primitives.py` | Five interaction-primitive rules: `icon-button` (icon-only `<Button>` outside `IconButton`, which requires a label), `tooltip-provider` (one root provider), `cursor-class` (the cursor lives in `index.css`), `overlay-size` (the `size` prop owns dialog and sheet frames), `settings-frame` (no `ui/card` / `ui/alert` import and no bordered, rounded box on settings surfaces). Hard zero: no baseline file, pinned by `test_baseline_file_is_gone`. |
| `check_scope_guards.py` | An ownership predicate is written ONCE. `duplicate-predicate`: the same `(model, {id, scope columns})` filtered in two functions (shrink-only baseline; mutating statements carry the scope inline and are grandfathered with a reason). `membership-sql`: raw `public.project_members` SQL anywhere in `backend/app` — no module is exempt, `api/deps/security.py` included, and the baseline holds none. Detects duplication, not absence: a missing guard produces no finding, and `.filter()`, `.in_()`, `text()` SQL and a guard split across chained `.where()` calls are invisible to it. |
| `check_retired_symbols.py` | No symbol in its `RETIRED` list (each with the spec that retired it and why) comes back. Word match on code only (comments and docstrings stripped) in `.py` / `.ts` / `.tsx` under `backend/app`, `backend/tests` and `frontend`; generated API types and the two integration tests that assert the drops are excluded. Absolute: no baseline — bringing a symbol back means editing `RETIRED`, with the reason. |

`run_all.sh` also runs the `/ship-spec` hook tests in `.claude/hooks/tests/` and the state-machine test `scripts/tests/test-ship.sh` as gates; the script lists them.

## Adding a new check

1. Write the script under `scripts/fitness/`. Follow the argument convention above.
2. Add a baseline file `<check>.baseline` if existing violations are too many to fix in one go. Format: one violation per line, exact stable shape (path, identifier, whatever the script naturally emits). Script exits 0 iff every violation found is in the baseline. Fewer is fine — a baselined violation that is gone passes, and is reported so the baseline can be tightened (`--update-baseline`); more is a regression. (This is what all baselined checks actually do; the stricter "no fewer" reading was never implemented.)
3. Add the green-path test (`backend/tests/unit/scripts/test_<check>.py`) — assert exit 0 on the current tree.
4. **Add the canary test** (`backend/tests/unit/scripts/test_<check>_canary.py`). Create the smallest possible fixture under `tmp_path` that *should* trigger the check (a forbidden pattern in a non-allowlisted file), run the script with `--repo-root <tmp_path>`, assert exit 1. This is non-negotiable: without it, the check could silently break and the gate would lie green.
5. Append the check to `run_all.sh` (`test_fitness_run_all.py` fails while a `check_*` file on disk is not wired in).
6. Add its row to [Current checks](#current-checks).

## Harness contract

- **Telemetry**: with `PRUMO_TELEMETRY_OUT` set, `run_all.sh` appends one JSONL line per gate, `{ts, phase: "fitness", gate, duration_ms, exit_code}`. A check's own `--emit-telemetry <path>` serves direct invocation. `check_file_size.py` and `check_retired_symbols.py` also append their own row to `PRUMO_TELEMETRY_OUT` (keyed `check`, no `ts` / `phase` / `gate`).
- **JSONL findings**: `--jsonl-out <path>` writes one JSONL line per finding, conforming to the schema in `.claude/skills/architectural-quality-loop/architectural-scanner/SKILL.md` (`source: fitness:<check>[:<rule>]`). `run_all.sh` passes it to no check; run a check directly to get rows.
- **Exit codes**: `0` clean; `1` violations; `2` internal error.
- **Idempotent**: re-running with the same tree produces identical output.
- **Fast**: target ≤ 5 s wall-clock for full-repo scans; budget +2 s per check added to `run_all.sh`.
