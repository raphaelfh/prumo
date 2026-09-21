# Telemetry schema

Every gate (deterministic OR inferential) emits **one JSONL line per invocation** to `docs/superpowers/quality-runs/<run-id>/telemetry.jsonl`. Used for cost accounting (budget cap enforcement), longitudinal regression detection in the loop itself, and post-hoc audit.

## Single line schema

```json
{
  "ts":              "2026-05-19T14:30:01Z",
  "run_id":          "2026-05-19-1430-extraction-services",
  "phase":           "SCAN|TRIAGE|PLAN|APPLY|VERIFY|CONVERGE|fitness",
  "gate":            "subagent:concept-drift|judge:llm|phase_summary|budget_check|lint:tsc|test:pytest|test:vitest|smoke:playwright|check_legacy_concepts.py",
  "duration_ms":     234,
  "exit_code":       0,
  "status":          "ran|skip",
  "reason":          "local stack unreachable — run make start",
  "finding_count":   13,
  "tokens_used":     1842,
  "subagent_calls":  5,
  "retries":         0,
  "resumed_from":    null
}
```

## Field semantics

- `ts` — ISO 8601 UTC. **Required.**
- `run_id` — matches the run-dir name. **Required** on rows the orchestrator writes; the harness rows below carry none (the run-dir holding the file identifies the run).
- `phase` — which phase emitted this line. **Required.**
- `gate` — the specific check or subagent. **Required.** Harness labels are listed under [Harness rows](#harness-rows).
- `duration_ms` — wall-clock time the gate took, integer. **Required.**
- `exit_code` — 0 for clean; non-zero for failure; `null` for a VERIFY gate that was skipped. **Required for deterministic gates** (lint/test/fitness); for subagents, encode 0 = success, 1 = soft fail (e.g. dropped findings), 124 = timeout (matches `bash`'s convention).
- `status` / `reason` — VERIFY rows only: `status` is `ran` or `skip`, and a skip carries its `reason`. A skip is not a pass.
- `finding_count` — number of rows the gate added to `findings.jsonl`. Optional for non-scanning gates (lint can omit unless it writes findings).
- `tokens_used` — LLM tokens consumed by this gate, integer. Required for `subagent:*` and `judge:llm`. Omit for deterministic gates.
- `subagent_calls` — how many subagent invocations this gate represents. Usually 1; the SCAN phase summary aggregate uses 5.
- `retries` — number of automatic retries this gate consumed. 0 by default.
- `resumed_from` — if this run-dir was resumed from a prior run (idempotency), set to the prior run-id; else null.

## Harness rows

Run the harnesses with `PRUMO_TELEMETRY_OUT=docs/superpowers/quality-runs/<run-id>/telemetry.jsonl`; each appends one row per gate:

- `scripts/fitness/run_all.sh` — `{ts, phase: "fitness", gate, duration_ms, exit_code}`. `gate` is the check's file name as `run_all.sh` lists it (`check_legacy_concepts.py`, `test-bash-guard.sh`, …).
- `scripts/verify_all.sh` — `{ts, phase: "VERIFY", gate, duration_ms, exit_code, status: "ran"}`; a skipped gate writes `duration_ms: 0, exit_code: null, status: "skip", reason`. `gate` is the label `verify_all.sh` passes to `run_gate` / `skip_gate` (`lint:ruff`, `lint:tsc`, `test:pytest`, `test:vitest`, `fitness:run_all`, `smoke:playwright`, …).

Neither writes `run_id`, `finding_count` or `tokens_used`. The variable reaches child processes: a `verify_all.sh` run also collects its nested `run_all.sh` rows, and every `run_all.sh` run collects one extra row each from `check_file_size.py` and `check_retired_symbols.py` in their own shape (a `check` key, no `ts` / `phase` / `gate`).

## Aggregation conventions

The orchestrator writes a **single summary row** per phase to `telemetry.jsonl` at phase end (in addition to the per-gate rows):

```json
{
  "ts": "...",
  "run_id": "...",
  "phase": "SCAN",
  "gate": "phase_summary",
  "duration_ms": 14523,
  "exit_code": 0,
  "finding_count": 17,
  "tokens_used": 8400,
  "subagent_calls": 5,
  "retries": 1
}
```

`subagent_calls` here is the sum across all subagents; `tokens_used` is the sum across all subagent calls; `retries` is the total retry count. This lets budget enforcement work with a single `jq -s 'map(select(.gate == "phase_summary")) | ...'` pass.

## Reading recipes

```bash
# Total tokens for a run:
jq -s 'map(.tokens_used // 0) | add' \
  docs/superpowers/quality-runs/<run-id>/telemetry.jsonl

# Total subagent calls (budget tracking):
jq -s 'map(.subagent_calls // 0) | add' \
  docs/superpowers/quality-runs/<run-id>/telemetry.jsonl

# Slowest 5 gates:
jq -s 'sort_by(-.duration_ms) | .[0:5] | map({gate, duration_ms})' \
  docs/superpowers/quality-runs/<run-id>/telemetry.jsonl

# Did this run resume a prior one?
jq -s 'map(select(.resumed_from != null)) | .[0].resumed_from' \
  docs/superpowers/quality-runs/<run-id>/telemetry.jsonl
```

## Why JSONL, not Prometheus / OTLP

The scanner runs locally and on developer laptops; we want zero infrastructure dependency. JSONL is grep-able, jq-able, and human-readable. If we ever ship metrics to a real observability backend, a thin `telemetry-to-otlp.sh` converter can read this file — the schema is forward-compatible.
