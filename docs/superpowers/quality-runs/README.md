# `docs/superpowers/quality-runs/` — runtime artefacts from the architectural quality loop

Every invocation of `Skill architectural-quality-loop` (manual or autonomous) creates a self-contained directory here. Each directory is an immutable audit log — once a run converges, do not edit it; future runs cite it via `resumed_from` in their telemetry.

## Layout

```
quality-runs/
├── .mutation-baseline                       # mutation score gate (Phase 5c)
└── 2026-05-19-1430-extraction-services/     # one folder per run
    ├── scope.md                              # the input glob + resolved file list
    ├── scope_hash                            # sha256(scope + tree_hash) — drives idempotency / resume
    ├── findings.jsonl                        # SCAN raw output (one finding per line)
    ├── findings_dropped.jsonl                # findings below confidence floor 0.7 (audit trail)
    ├── backlog.md                            # human-readable TRIAGE backlog
    ├── backlog.jsonl                         # machine-readable backlog (after TRIAGE)
    ├── telemetry.jsonl                       # per-gate + phase-summary metrics (see telemetry-schema.md)
    ├── iterations/
    │   ├── 001-<finding-slug>.md             # PLAN, DIFF, gate output, judge verdict, Reflexion
    │   ├── 002-<finding-slug>.md
    │   └── ...
    ├── quarantine.md                         # findings that failed 3 loopbacks
    ├── mutation-results.txt                  # mutmut report (if Phase 5c ran)
    └── summary.md                            # CONVERGE output: counts, status, time elapsed
```

## Run statuses

The `summary.md` ends with a status line: `status="<X>"`. Possible values:

| Status | Meaning |
|---|---|
| `converged` | Full re-SCAN returns 0 findings ≥ 0.7 confidence AND `verify_all.sh` exits 0. Happy path. |
| `non_converged` | Hit the 5-CONVERGE-cycle cap with findings still in backlog. Human must triage. |
| `budget_exceeded` | Subagent invocations or LLM tokens passed the cap in `references/budget-policy.md`. |
| `awaiting_human_review` | Autonomous mode closed its 2-iteration allowance; human reviews diffs before next invocation. |
| `scan_complete` | SCAN-only run (Phase 2 mode); the orchestrator deliberately did not APPLY anything. |

The run-dir is renamed `<run-id>-converged` on `converged` status; this is what `make quality-clean` matches when culling dirs older than 30 days.

## How to triage a backlog

1. Sort `backlog.md` is already by severity desc, confidence desc, category. Read it top-down.
2. For each finding, decide: **fix now**, **add to a known refactor task**, or **dismiss with rationale**.
3. Dismissals add the finding's `(file, line, category)` to the appropriate `.baseline` file (under `scripts/fitness/`) with a one-line `# why dismissed` comment.
4. Fixes either:
   - Run as standalone tasks (just edit + verify_all.sh + commit), or
   - Re-invoke `Skill architectural-quality-loop --scope <narrow-glob-around-the-fix>` to drive the finding through the formal loop.

## How to triage `quarantine.md`

A finding lands in quarantine after 3 failed APPLY → VERIFY loopbacks. Causes:
- The finding was real but its fix needs more than 300 LOC (decompose into smaller findings).
- The finding was a false positive (close it, add to `scripts/fitness/check_*.baseline`, lower the subagent's confidence rubric in `architectural-scanner/SKILL.md`).
- The fix exists but the gate is flaky (fix the gate first; finding is innocent).

## How to read `findings.jsonl`

```bash
RUN_DIR=docs/superpowers/quality-runs/<run-id>

# Counts by category
jq -s 'group_by(.category) | map({category: .[0].category, count: length})' "${RUN_DIR}/findings.jsonl"

# Top 10 highest-severity, highest-confidence:
jq -s 'sort_by(-.confidence, .severity != "high") | .[0:10]' "${RUN_DIR}/findings.jsonl"

# All findings on one file:
jq 'select(.file == "backend/app/services/extraction_form_service.py")' "${RUN_DIR}/findings.jsonl"
```

## How to read `telemetry.jsonl`

```bash
# Total tokens for a run (budget audit):
jq -s 'map(.tokens_used // 0) | add' "${RUN_DIR}/telemetry.jsonl"

# Total subagent calls:
jq -s 'map(.subagent_calls // 0) | add' "${RUN_DIR}/telemetry.jsonl"

# Slowest 5 gates:
jq -s 'sort_by(-.duration_ms) | .[0:5] | map({gate, duration_ms})' "${RUN_DIR}/telemetry.jsonl"

# Was this a resumed run?
jq -s 'map(select(.resumed_from != null)) | .[0].resumed_from' "${RUN_DIR}/telemetry.jsonl"
```

## Lifecycle

- **Created** by `Skill architectural-quality-loop`.
- **Kept indefinitely** for runs ending in `non_converged`, `budget_exceeded`, `awaiting_human_review` (human attention needed).
- **Renamed** to `<run-id>-converged` on success.
- **Pruned** by `make quality-clean` once they reach 30 days old AND status is `converged` (or `scan_complete`).

## What lives outside this dir

- Skill definitions, prompts, refs: `.claude/skills/architectural-quality-loop/`.
- Fitness scripts: `scripts/fitness/`.
- Verification wrapper: `scripts/verify_all.sh`.
- Mutation wrapper: `scripts/run_mutation_tests.sh`.
- This README + the mutation baseline: `docs/superpowers/quality-runs/`.
