---
name: architectural-quality-loop
description: Run one cycle of the prumo autonomous architectural quality loop on a scoped slice of the repo — detects concept-vocabulary drift, layered-architecture violations, security gaps, legacy code, and missing tests; converges through deterministic gates + LLM judge. Trigger on requests like "run the quality loop", "sweep extraction services for drift", "find legacy in this slice", "audit architectural drift", "autoloop on <path>", "quality sweep". Manual: one cycle per invocation. Autonomous: chainable via `superpowers:loop` skill.
---

# Architectural Quality Auto-Loop (prumo)

A 7-phase autonomous loop that finds and fixes architectural drift, legacy code, security gaps, and concept-vocabulary drift on a **scoped slice** of the repository. Computational controls (linters, type-checkers, tests, fitness scripts in `scripts/fitness/`) are ground truth; LLM scanners are advisory until confirmed by a gate or the judge.

This skill is the **only user-facing entry point**. It dispatches the sibling sub-skills `architectural-scanner` (for SCAN) and `legacy-eviction` (for APPLY of deletions).

## When to use

- "Run the quality loop on `backend/app/services/extraction_*`."
- "Sweep `frontend/components/extraction/**` for legacy concepts."
- "Audit architectural drift in this slice."
- Periodically (via `superpowers:loop`) as a maintenance cycle.

Do **not** use for: a known bug (→ `debugging`); a single concrete refactor (→ the relevant domain skill directly); CI changes; constitution edits.

## The 7-phase contract

| Phase | Runs | Artefact | Exit condition |
|---|---|---|---|
| SCOPE | parses user-supplied glob/concept; refuses without one | `scope.md`, `scope_hash` | scope.md written + run-id assigned |
| SCAN | sibling skill `architectural-scanner` — 5 parallel Explore subagents + deterministic fitness scripts | `findings.jsonl`, `findings_dropped.jsonl`, `telemetry.jsonl` | scanner returns; aggregated findings written |
| TRIAGE | filter by confidence ≥ 0.7, dedupe by `(file, line, category)`, order by severity | `backlog.md`, `backlog.jsonl` | backlog is non-empty OR backlog is empty AND new SCAN converges |
| PLAN | `superpowers:writing-plans` on first backlog item; ≤300 LOC, ≤5 files | `iterations/<n>-<finding>.md` (PLAN section) | plan written and ≤300 LOC |
| APPLY | inside an isolated git worktree, delegate to the right skill (see APPLY dispatch table below) | `iterations/<n>-*.md` (DIFF + commit hash) | diff produced + commit made on the worktree branch |
| VERIFY | `scripts/verify_all.sh` (lint + tsc + tests + fitness + conditional Playwright) + LLM judge with counterfactual probe | `iterations/<n>-*.md` (gate output + judge verdict) | judge returns `RESOLVES` |
| CONVERGE | re-SCAN the original scope; if 0 findings ≥ 0.7 AND `verify_all.sh` exit 0 → STOP | `summary.md` | converged OR cap reached |

```
SCOPE → SCAN → TRIAGE → PLAN → APPLY → VERIFY → CONVERGE
  ^                                       │
  └───────────── loopback (max 3 / item) ─┘
```

## SCOPE — refuse without a slice

Accepted forms (one per invocation):
- Path glob: `backend/app/services/extraction_*`, `frontend/components/extraction/**`
- Concept tag: `concept:extraction-run`, `concept:hitl-session` (resolved via `references/concept-glossary.md`)
- Literal `everything` — runs over the whole repo, slow, used rarely

Write `scope.md` to `docs/superpowers/quality-runs/<run-id>/`. Compute `scope_hash = sha256(scope + sorted_list_of_tracked_files_in_scope)`. **If a prior run-dir contains the same `scope_hash` and status ≠ `converged`**: resume from its last iteration; log `resumed_from=<old-run-id>` to `telemetry.jsonl`. Otherwise create new run-id `YYYY-MM-DD-HHMM-<scope-slug>`.

## SCAN — delegate to `architectural-scanner`

Invoke the sibling `architectural-scanner` sub-skill with the SCOPE. It dispatches 5 parallel Explore subagents (`concept-drift`, `layered-arch`, `security`, `legacy-spotter`, `test-gaps`) and aggregates their output with the deterministic fitness checks from `scripts/fitness/run_all.sh`. Output: `findings.jsonl`, `findings_dropped.jsonl` (below confidence floor), `telemetry.jsonl`. Schema in `references/telemetry-schema.md`.

## TRIAGE — rules

1. Drop findings with `confidence < 0.7` → move to `findings_dropped.jsonl` (audit trail; not deleted).
2. Dedupe by `(file, line, category)`. On collision: `max(severity)`, `max(confidence)`, evidence concatenated with ` || ` (max 200 chars total).
3. Order by `(severity desc, confidence desc, file)`. Severity rank: `high > medium > low`.
4. Within severity, prioritise categories in this order: `security` → `concept-drift` → `layered-arch` → `legacy` → `test-gaps` → `computational`.
5. Emit `backlog.md` (human-readable) + `backlog.jsonl` (machine-readable).

## PLAN — single item, small, test-first

For the **first** backlog item:
1. Invoke `superpowers:writing-plans` with the finding (verbatim) + the relevant excerpt from `references/concept-glossary.md` and `references/legacy-patterns.md`.
2. Plan must specify: (a) files to touch (≤5), (b) **failing test to write first**, (c) **fitness rule or regression test to add** if the fix removes a concept (the "no recurrence guard"), (d) total LOC ≤ 300.
3. If the plan exceeds 300 LOC, decompose: re-queue the larger work as 2+ separate backlog items and start with the smallest.
4. Persist plan to `iterations/<n>-<finding-slug>.md` under heading `## PLAN`.

## APPLY — dispatch by category

Always inside an isolated git worktree (invoke `superpowers:using-git-worktrees`); commit at end; tear down on failure.

| Finding category | Delegate to |
|---|---|
| Backend Python (services, repos, models, schemas, tasks, migrations) | `backend-development` |
| Frontend TS/React (components, hooks, services) | `ui-styling` (visual) or `frontend-ux` (interaction) |
| Pure deletion of unused/legacy code | sibling `legacy-eviction` sub-skill |
| Bug fix that needs investigation | `debugging` |
| Tests added or modified | `web-testing` |

APPLY **must** write the failing test first (per project rule `feedback_always_test`). Diff + commit hash appended to `iterations/<n>-*.md` under `## DIFF`.

## VERIFY — the gate

Run `scripts/verify_all.sh` (composes existing Makefile gates + `scripts/fitness/run_all.sh` + Playwright smoke if router/UI touched). Then the LLM judge — see `references/judge-prompt.md` — receives FINDING, DIFF, GATE_OUTPUT, COUNTERFACTUAL_PROBE and returns exactly one of `RESOLVES` / `DOES_NOT_RESOLVE` / `INTRODUCES_REGRESSION`. Only `RESOLVES` passes.

On failure, the gate's stderr or judge's reason **is the prompt** for an APPLY loopback. Hard caps:
- Max 3 loopbacks per finding → finding moves to `quarantine.md`; APPLY tears down the worktree without merging.
- Max 5 CONVERGE cycles total → write `summary.md` with `status="non_converged"` and stop.
- Budget exceeded (see `references/budget-policy.md`) → write `summary.md` with `status="budget_exceeded"` and stop.

After every successful VERIFY, write a brief **Reflexion** paragraph to the iteration file using the template in `references/reflexion-template.md`. This is two lines: "what could still go wrong" + "what I'd do differently next time." Cheap; catches our blind spots.

## CONVERGE — the STOP criterion

```python
def converged(run_dir: Path) -> bool:
    rescan = invoke_scanner(scope=read(run_dir / "scope.md"))
    high_conf = [f for f in rescan if f["confidence"] >= 0.7]
    gates_green = run("bash scripts/verify_all.sh").returncode == 0
    return len(high_conf) == 0 and gates_green
```

Convergence is the success metric, not "I closed everything I saw." A new re-SCAN may surface findings that the previous SCAN missed — that is fine; they enter the backlog and the loop continues. STOP only when **both** the re-SCAN is quiet AND the gates are green.

When converged: write `summary.md` (counts table, closed/quarantined/dropped, time elapsed, mutation score delta if Phase 5 mutation ran). Rename run-dir to `<run-id>-converged` for easy filtering by `make quality-clean`.

## Run artefact layout

```
docs/superpowers/quality-runs/
└── 2026-05-19-1430-extraction-services/
    ├── scope.md
    ├── scope_hash
    ├── findings.jsonl
    ├── findings_dropped.jsonl
    ├── backlog.md
    ├── backlog.jsonl
    ├── telemetry.jsonl
    ├── iterations/
    │   ├── 001-concept-drift-prediction_models.md
    │   ├── 002-legacy-extracted-values-comment.md
    │   └── ...
    ├── quarantine.md
    └── summary.md
```

## Budget cap (see `references/budget-policy.md`)

- **Hard cap**: 150 subagent invocations + 500k tokens per run.
- **Soft cap**: 200k tokens — emit telemetry warning, continue.
- **Autonomous mode** (via `superpowers:loop`): reduced caps (50 subagents, 100k tokens) and max 2 iterations closed before writing `status="awaiting_human_review"`.

Override for a one-off sweep: `PRUMO_QUALITY_LOOP_BUDGET_TOKENS=1000000`.

## Autonomous cadence

For periodic sweeps, invoke via `superpowers:loop`:

```
/loop 30m Skill architectural-quality-loop --scope "backend/app/services/extraction_*"
```

Minimum interval: 20 minutes. The loop respects the autonomous-mode caps above. After 2 iterations closed, it stops with `status="awaiting_human_review"`; the human reviews the diffs and clears the gate before the next invocation.

## House rules

- **Deterministic gates are ground truth.** An LLM finding without evidence in a gate is dropped.
- **Diff ≤ 300 LOC**, always test-first, always commit-per-iteration.
- **No magic string replacing magic string.** Every removal of a legacy concept requires a fitness rule or regression test that prevents recurrence; the LLM judge enforces this via the "no recurrence guard" clause.
- **Worker isolation.** APPLY runs in a worktree; if VERIFY fails or judge rejects, the worktree is discarded without merging — the main tree is never partially mutated.
- **Convergence over completeness.** STOP when re-SCAN is quiet AND gates green; do NOT chase low-confidence findings indefinitely.
- **Memory.** Each run-dir is a self-contained audit log; never edit a closed run after the fact.

## Quick reference

- Concept glossary (single source of vocabulary): `references/concept-glossary.md`
- Legacy patterns blacklist (16 entries, hard/warn tiers): `references/legacy-patterns.md`
- Fitness functions (deterministic checks): `references/fitness-functions.md`
- LLM judge prompt: `references/judge-prompt.md`
- Reflexion template: `references/reflexion-template.md`
- Telemetry schema: `references/telemetry-schema.md`
- Budget policy: `references/budget-policy.md`
