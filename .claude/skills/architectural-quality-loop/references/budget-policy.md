# Budget policy

A run has hard caps on subagent invocations and LLM tokens. Exceeding the hard cap stops the run immediately with `status="budget_exceeded"` written to `summary.md`. Soft cap emits a warning row to `telemetry.jsonl` and continues.

## Defaults (manual invocation)

| Limit | Soft cap | Hard cap |
|---|---:|---:|
| Subagent invocations | n/a | **150** per run |
| LLM tokens | 200 000 | **500 000** per run |
| Wall-clock per run | 30 min | **60 min** |
| Wall-clock per subagent | n/a | **5 min** (then 1 retry, then timeout finding) |
| Loopbacks per finding | n/a | **3** (then quarantine) |
| CONVERGE cycles | n/a | **5** (then `status="non_converged"`) |

## Defaults (autonomous mode via `superpowers:loop`)

| Limit | Soft cap | Hard cap |
|---|---:|---:|
| Subagent invocations | n/a | **50** per run |
| LLM tokens | 80 000 | **100 000** per run |
| Iterations closed without human review | n/a | **2** (then `status="awaiting_human_review"`) |

Autonomous mode is intentionally tighter to make night-time / unattended runs safe — the loop produces small, reviewable batches that a human can triage in the morning.

## Counting rules

- One Explore subagent call = 1 subagent invocation, regardless of how many files it reads or how big the response.
- A retry counts as a separate invocation (so a 5-subagent SCAN with one retry = 6 invocations).
- Tokens counted = sum of `tokens_used` across all `telemetry.jsonl` rows for this run.
- Wall-clock counted = `ts` of last row minus `ts` of first row in `telemetry.jsonl`.

## Overrides

Environment variables override caps for a single invocation. They must be exported by the user before invoking the skill; the loop does not change them mid-run.

| Env var | Effect | Use case |
|---|---|---|
| `PRUMO_QUALITY_LOOP_BUDGET_TOKENS` | Sets the hard token cap (integer) | Rare full-repo sweep, e.g. before a major release |
| `PRUMO_QUALITY_LOOP_BUDGET_SUBAGENTS` | Sets the hard subagent cap | Wider exploratory scope |
| `PRUMO_QUALITY_LOOP_MAX_LOOPBACKS` | Per-finding loopback cap (default 3) | Debugging a stubborn finding |
| `PRUMO_QUALITY_LOOP_MODE` | `manual` (default) or `autonomous` | Switch caps preset |

Example:

```bash
PRUMO_QUALITY_LOOP_BUDGET_TOKENS=1000000 \
  Skill architectural-quality-loop --scope "everything"
```

## When the cap fires

The orchestrator checks caps **between phases**, never mid-phase. A running subagent is allowed to finish even if its tokens push the run over the cap; the cap is honoured by refusing to start the next subagent or the next iteration.

On hard-cap exceed:
1. Stop dispatching new work.
2. Wait for in-flight subagents/checks to finish (or hit their own 5-min timeout).
3. Write `summary.md` with `status="budget_exceeded"`, the cap that was hit, and the run's current state (closed / quarantined / pending counts).
4. Telemetry row: `{phase: "CONVERGE", gate: "budget_check", exit_code: 1, ...}`.
5. Return control to the user with a one-paragraph summary pointing at `summary.md`.

The user can resume by re-invoking the loop with the same `--scope` (idempotency picks up the same run-dir) **and** an override env var that raises the cap.

## Why not a per-finding token cap?

Tempting but wrong. A single high-severity finding may legitimately need a long PLAN + 2 loopbacks + counterfactual probe; that can hit 30k+ tokens. We let the per-run cap be the budget and trust the LOC cap on the diff to keep individual fixes small. If a finding repeatedly hits its 3-loopback cap, that is a signal the finding was misclassified — the per-finding LOC + loopback caps catch this, not a token cap.
