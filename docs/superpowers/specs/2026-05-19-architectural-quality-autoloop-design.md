---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

# Architectural Quality Auto-Loop — Design Spec

**Date:** 2026-05-19
**Status:** Draft for review
**Scope:** A skill-driven autonomous quality loop for prumo. Detects architectural drift, concept-vocabulary drift, legacy code, security gaps and missing test coverage; turns findings into small, reviewable, test-first patches; verifies through deterministic gates plus an independent LLM judge; and converges when a full sweep finds no new issues. Out of scope: replacing existing skills (`code-review`, `debugging`, `web-testing`), changing CI, or running anything in production environments.

## 1. Goals

1. **Reduce architectural & concept drift** with the hybrid technique recommended in the [Thoughtworks Tech Radar Vol. 34](https://www.thoughtworks.com/radar/techniques/architecture-drift-reduction-with-llms): deterministic fitness functions first, LLM evaluation second.
2. **Make the loop autonomous and bounded** — explicit `STOP` criterion (convergence + green gates), so the agent never spirals.
3. **Apply the harness-engineering split** (Fowler, 04/2026) between *computational controls* (linters, type-checkers, tests, fitness scripts) and *inferential controls* (LLM scanners + LLM judge). Lint errors are themselves prompts for the next iteration.
4. **Stay aligned with the project's invariants** — the canonical [extraction-hitl-architecture.md](../../architecture/extraction-hitl-architecture.md) glossary; the Alembic-vs-Supabase-CLI migration split; the API → Service → Repository → Model layering; RLS coverage on `extraction_*`; the `ApiResponse` envelope.
5. **Iterative extraction cycle** — one finding per iteration, ≤ 300 LOC, test-first, reversible. Borrowed from the 2026 legacy-refactor playbook ([SitePoint 2026](https://www.sitepoint.com/handson-with-claude-code-automating-git-workflows-and-legacy-refactoring/)).
6. **Single user-facing entry point**: `Skill architectural-quality-loop`. Cadence is either manual (one cycle per invocation) or autonomous via `superpowers:loop`.

## 2. Non-goals

- Replacing or rewriting the existing `code-review`, `debugging`, `web-testing`, `backend-development`, `ui-styling`, `frontend-ux` skills. The loop **delegates** to them.
- Adding mutation testing (mutmut, cosmic-ray) at MVP. The LLM judge with diff + original evidence is the adversarial check for v1; mutation testing is a Phase 2 add-on.
- Touching CI. The loop runs locally; gates are the same commands CI uses.
- Acting on remote environments (`start-remote`, `e2e-remote`). The loop is local-only.
- Modifying [.specify/memory/constitution.md](../../../.specify/memory/constitution.md) or any architecture canonical doc. The loop *enforces* them; it does not *change* them.

## 3. Design principles

- **Two ground truths.** Deterministic gates are always right; LLM findings are advisory until confirmed by a gate or by the judge. A finding without evidence is dropped.
- **Small, reversible diffs.** ≤ 300 LOC changed per APPLY phase. Bigger items get decomposed in PLAN.
- **No magic strings replacing magic strings.** Whenever the loop removes a legacy concept, it adds a regression test or a fitness function that prevents reintroduction.
- **Convergence over completeness.** STOP when a full re-SCAN returns zero findings above the confidence threshold AND every gate is green — not when the agent feels done.
- **Tests are not optional.** APPLY must produce or update tests in the same diff. VERIFY runs the full project test suite, not just touched files (catches downstream regressions — the prumo `extraction_*` graph is too coupled for partial test runs).
- **Memory of past iterations.** Each cycle appends to `docs/superpowers/quality-runs/<run-id>.md` (findings, plan, diff hash, gate output). Lets the user audit and the agent avoid re-litigating closed findings.

## 4. The 7-phase loop

```
SCOPE → SCAN → TRIAGE → PLAN → APPLY → VERIFY → CONVERGE
  ^                                       │
  └───────────── (loopback on failure) ───┘
```

### 4.1 SCOPE (input gate)

User provides a slice. Accepted forms:
- Path glob: `backend/app/services/extraction_*` or `frontend/components/extraction/**`.
- Concept tag: `concept:extraction-run`, `concept:hitl-session` (loop resolves via glossary).
- The literal `everything` — runs over the whole repo (slow, used rarely).

Loop refuses to run without an explicit scope. Prevents the "boil the ocean" failure mode.

### 4.2 SCAN (computational + inferential, in parallel)

**Computational lane** (must all run; failures become findings with `confidence=1.0`):
- `ruff check .` and `ruff format --check .` (backend)
- `npm run lint`
- `npx tsc --noEmit`
- `uv run mypy app --ignore-missing-imports` (advisory weight 0.7 at MVP — matches CI policy)
- `make db-lint-migrations` (squawk on touched Alembic files)
- `scripts/fitness/*` — deterministic architecture checks; see §5.

**Inferential lane** (5 subagents in parallel via `Agent` tool, each `subagent_type=Explore`):
- `concept-drift` — reads `references/concept-glossary.md`; greps for forbidden legacy strings (e.g. `name == 'prediction_models'`, references to `extracted_values` or `ai_suggestions` outside archived migrations), reports drift.
- `layered-arch` — verifies API/Service/Repository/Model boundaries; flags repositories importing routers, services bypassing repositories, models with business logic.
- `security` — RLS coverage on `extraction_*` and project-membership tables; BOLA patterns in routers (missing `project_id` checks); TOCTOU on run state transitions; secret/PII in logs.
- `legacy-spotter` — dead exports, unused imports, orphan files, `// removed` comments, `_unused` rename hacks, `is_*` flags that are never read.
- `test-gaps` — critical paths (HITL session open/close, run stage transitions, `ProposalRecord → PublishedState`) with no integration test.

Each subagent emits findings in this shape:

```jsonl
{"category":"concept-drift","severity":"high","confidence":0.85,"file":"backend/app/services/extraction_form_service.py","line":142,"evidence":"hardcoded 'prediction_models'","suggested_action":"replace with role lookup via partitionEntityTypes / get_by_role"}
```

All findings land in `docs/superpowers/quality-runs/<run-id>/findings.jsonl`.

### 4.3 TRIAGE

The meta-skill:
1. Drops `confidence < 0.7` from the inferential lane.
2. Dedupes (same file + line + category).
3. Buckets by category and severity.
4. Orders: `security high` → `concept-drift high` → `layered-arch high` → `legacy high` → `test-gaps high` → `medium` of each → `low`.
5. Emits `backlog.md` (human-readable) + `backlog.jsonl` (machine-readable).

### 4.4 PLAN

For the first backlog item, the loop invokes `superpowers:writing-plans` to produce a focused plan that:
- Cites the finding's evidence verbatim.
- Lists files to touch (≤ 5).
- Specifies the failing test to write **first**.
- Specifies the fitness function / lint rule to add when the fix removes a concept that should never come back.
- Stays ≤ 300 LOC. Larger fixes get decomposed and re-queued.

### 4.5 APPLY

The loop reads the plan and delegates to the right skill:
- Backend Python → `backend-development`.
- Frontend TS/React → `ui-styling` (visual) or `frontend-ux` (interaction).
- Pure deletion of unused/legacy code → `legacy-eviction` (new skill, §6).
- Bug fix that needs investigation → `debugging`.

APPLY always writes the failing test first (per [feedback_always_test](../../../.claude/projects/-Users-raphael-PycharmProjects-prumo/memory/feedback_always_test.md)).

### 4.6 VERIFY (the gate)

`scripts/verify_all.sh` runs, in this order:

1. `make lint-backend`
2. `npm run lint`
3. `npx tsc --noEmit`
4. `make test-backend`
5. `npm test -- --run` (vitest, no watch)
6. `make db-lint-migrations` (if migrations changed)
7. `scripts/fitness/run_all.sh` (re-runs the deterministic architecture checks on the touched scope)
8. **Playwright smoke** (the `local-api` + `local-ui` projects only, not `local-hitl` — too slow). Only triggers if frontend or any router changed.
9. **LLM judge** — receives:
   - The original finding (verbatim).
   - The diff produced by APPLY.
   - The gate output above.
   And answers one of: `RESOLVES`, `DOES_NOT_RESOLVE`, `INTRODUCES_REGRESSION`. Only `RESOLVES` passes.

If any step fails, its output (lint error, test failure, judge verdict) becomes the **prompt** for an APPLY loopback. Max 3 loopbacks per item; on the 4th failure, the item is moved to `quality-runs/<run-id>/quarantine.md` and the loop moves on. Quarantined items are surfaced to the user at CONVERGE.

### 4.7 CONVERGE

When the backlog is empty, the loop re-runs SCAN (this is the **agent-drift guard** — Agent Stability Index spirit: convergence is the metric). If the new SCAN returns zero findings above threshold AND `verify_all.sh` exits 0, the loop:

1. Writes `docs/superpowers/quality-runs/<run-id>/summary.md` (counts, categories, items closed, quarantined).
2. Stops.

If new findings appear, the loop appends them to the backlog and continues.

## 5. Fitness functions (deterministic checks, new)

Stored in `scripts/fitness/`, each script exits non-zero on violation. They run in CI **and** locally.

| Script | Invariant | Source of truth |
|---|---|---|
| `check_migration_split.sh` | Alembic only edits `public.*`; Supabase migrations only edit `auth.*` / `storage.*`. | [docs/architecture/migrations.md](../../architecture/migrations.md) |
| `check_layered_arch.py` | `app/api/v1/routers/**` imports only services + schemas; `app/services/**` imports only repositories + schemas + other services; `app/repositories/**` imports only models. | [.specify/memory/constitution.md](../../../.specify/memory/constitution.md) principle I |
| `check_rls_coverage.py` | Every `extraction_*` and `project_*` table has at least one RLS policy referencing `auth.uid()`. | constitution.md principle IV |
| `check_api_response_envelope.py` | Every router function returns `ApiResponse[...]` (no raw dicts, no bare models). | [docs/reference/extraction-hitl-architecture.md](../../reference/extraction-hitl-architecture.md) §3 |
| `check_legacy_concepts.py` | Forbids reintroduction of `extracted_values`, `ai_suggestions`, `name == 'prediction_models'`, `initializeArticleInstances`. Pattern list lives in the skill's `legacy-patterns.md`. | CLAUDE.md "Recent Changes" |
| `check_react_query_keys.py` | Every `useQuery({ queryKey: [...] })` key starts with a domain constant (`projectKeys`, `articleKeys`, ...), not a string literal. | code-review skill |

`scripts/fitness/run_all.sh` wraps them.

These ARE the computational controls in Fowler's harness-engineering split. Each is a one-shot deterministic check; LLM scanners discover *new* patterns, fitness functions enforce *known* invariants.

## 6. New skills

### 6.1 `.claude/skills/architectural-quality-loop/` (meta-skill, orchestrator)

```
architectural-quality-loop/
├── SKILL.md                          # the 7-phase contract + checklist
└── references/
    ├── concept-glossary.md           # compact mirror of extraction-hitl-architecture.md §Glossary
    ├── fitness-functions.md          # one paragraph per script in scripts/fitness/
    └── legacy-patterns.md            # blacklisted strings / shapes, with rationale
```

`SKILL.md` frontmatter:

```yaml
---
name: architectural-quality-loop
description: Use to run one cycle of the autonomous quality loop on a scoped slice of the repo — detects architectural drift, concept-vocabulary drift, legacy code, security gaps, missing tests, and converges through deterministic gates + LLM judge. Trigger on requests like "run the quality loop", "sweep for legacy", "check architectural drift", "autoloop on extraction services".
---
```

Body has the 7-phase checklist (one TaskCreate per phase), the fan-out subagent prompts (verbatim, parameterised by scope), and the STOP criterion.

### 6.2 `.claude/skills/architectural-scanner/` (the SCAN phase)

Encapsulates the parallel-subagent dispatch logic and the `findings.jsonl` schema. Frontmatter triggers on "scan for drift", "find legacy", "audit extraction services". Body:
- The 5 subagent prompts (parameterised).
- Confidence rubric (1.0 deterministic; 0.85+ for matched glossary blacklist; 0.7 floor for shape-based LLM finding; below = dropped).
- Output schema (the JSONL above).
- "How to read `findings.jsonl`" cheatsheet for whoever runs SCAN standalone.

### 6.3 `.claude/skills/legacy-eviction/` (focused APPLY skill for deletions)

Most APPLY work goes through existing skills. Deletion of legacy code is distinct enough to deserve its own playbook because of the project's history (the squashed 0001 baseline; the dropped `extracted_values`, `ai_suggestions`, `initializeArticleInstances`, `name == 'prediction_models'` saga).

Body covers:
- "Before delete: prove unused" — `grep -r` across `backend/`, `frontend/`, `tests/`, then `git log -S` to confirm no live consumer; for exported APIs, audit `__all__` and any external schema.
- "Delete in one commit, not over two PRs" (counter-pattern to "deprecate first" which the project explicitly rejects per CLAUDE.md `claudeMd` guidance).
- "Add a fitness check on the way out" so the legacy concept cannot return.

## 7. Runtime artefacts

```
docs/superpowers/quality-runs/
└── 2026-05-19-1430-extraction-services/   # one folder per run
    ├── scope.md
    ├── findings.jsonl                      # SCAN output (raw)
    ├── backlog.md                          # TRIAGE output (human)
    ├── backlog.jsonl                       # TRIAGE output (machine)
    ├── iterations/
    │   ├── 001-concept-drift-prediction_models.md   # plan + diff hash + judge verdict
    │   └── 002-...
    ├── quarantine.md                       # items that failed 3 loopbacks
    └── summary.md                          # CONVERGE output
```

This makes every cycle auditable, and lets the user `git diff HEAD~N -- docs/superpowers/quality-runs/` to see what the loop has been doing overnight.

## 8. Invocation

```bash
# one manual cycle
Skill architectural-quality-loop --scope "backend/app/services/extraction_*"

# autonomous, paced by superpowers:loop (e.g. every 20 min)
/loop /architectural-quality-loop --scope "backend/app/services/extraction_*"

# scope by concept tag
Skill architectural-quality-loop --scope "concept:hitl-session"
```

## 9. Risks and how the design handles them

| Risk | Mitigation |
|---|---|
| **Agent drift** — loop invents new conventions across iterations | STOP criterion + per-iteration commit + `concept-glossary.md` as the only source of truth for vocabulary |
| **Loop spiral** — APPLY → VERIFY fails forever | Max 3 loopbacks per item → quarantine |
| **False positives flood** | Confidence threshold (≥ 0.7 for LLM); deterministic findings always pass |
| **Big-bang refactor smuggled in** | LOC cap (≤ 300) in PLAN; decomposition mandatory above |
| **Tests-on-the-mocks** — gate stays green but reality broken | Real-DB tests mandated by `web-testing` skill; integration smoke required when routers change |
| **Cost / time** | Scope is mandatory; 5 subagents parallel; Playwright limited to `local-api`+`local-ui` projects |
| **Removing something that's actually used** | `legacy-eviction` proof-of-unused step + full test suite in VERIFY |

## 10. Phase-2 follow-ups (out of scope for this spec)

- Mutation testing (mutmut for backend, Stryker for frontend) replacing the LLM judge for verification.
- Quality-runs surfacing via the existing in-app activity feed.
- A `make quality-loop` shortcut that wraps `Skill architectural-quality-loop` + `scripts/verify_all.sh`.
- Agent Stability Index metrics (semantic / coordination / behavioural drift) computed from quality-runs history.

## 11. Open questions

(intentionally none — user requested no clarifying questions; this spec makes the reasonable calls)

## References

- Fowler, M. (2026). [Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html).
- Thoughtworks Technology Radar Vol. 34. [Architecture drift reduction with LLMs](https://www.thoughtworks.com/radar/techniques/architecture-drift-reduction-with-llms).
- Inductivee (2026). [Autonomous Agent Design Patterns](https://inductivee.com/blog/autonomous-agent-design-patterns).
- arXiv:2510.08996. [Saving SWE-Bench: A Benchmark Mutation Approach for Realistic Agent Evaluation](https://arxiv.org/abs/2510.08996).
- Masood, A. (2026). [Agent Drift: the reliability blind spot in multi-agent LLM systems](https://medium.com/@adnanmasood/agent-drift-the-reliability-blind-spot-in-multi-agent-llm-systems-and-a-blueprint-to-measure-it-7c653d684b80).
- prumo canonical docs: [extraction-hitl-architecture.md](../../architecture/extraction-hitl-architecture.md), [migrations.md](../../architecture/migrations.md), [test-strategy.md](../../architecture/test-strategy.md), [.specify/memory/constitution.md](../../../.specify/memory/constitution.md).
