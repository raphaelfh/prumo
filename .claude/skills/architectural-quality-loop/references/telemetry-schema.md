# Telemetry schema

Every gate (deterministic OR inferential) emits **one JSONL line per invocation** to `docs/superpowers/quality-runs/<run-id>/telemetry.jsonl`. Used for cost accounting (budget cap enforcement), longitudinal regression detection in the loop itself, and post-hoc audit.

## Single line schema

```json
{
  "ts":              "2026-05-19T14:30:01Z",
  "run_id":          "2026-05-19-1430-extraction-services",
  "phase":           "SCAN|TRIAGE|PLAN|APPLY|VERIFY|CONVERGE|fitness",
  "gate":            "check_legacy_concepts|subagent:concept-drift|lint:ruff|tsc|pytest|vitest|playwright|judge:llm",
  "duration_ms":     234,
  "exit_code":       0,
  "finding_count":   13,
  "tokens_used":     1842,
  "subagent_calls":  5,
  "retries":         0,
  "resumed_from":    null
}
```

## Field semantics

- `ts` — ISO 8601 UTC. **Required.**
- `run_id` — matches the run-dir name. **Required.**
- `phase` — which phase emitted this line. **Required.**
- `gate` — the specific check or subagent. **Required.** Use the conventions in the union type above. New gate names land in `fitness-functions.md`.
- `duration_ms` — wall-clock time the gate took, integer. **Required.**
- `exit_code` — 0 for clean; non-zero for failure. **Required for deterministic gates** (lint/test/fitness); for subagents, encode 0 = success, 1 = soft fail (e.g. dropped findings), 124 = timeout (matches `bash`'s convention).
- `finding_count` — number of rows the gate added to `findings.jsonl`. Optional for non-scanning gates (lint can omit unless it writes findings).
- `tokens_used` — LLM tokens consumed by this gate, integer. Required for `subagent:*` and `judge:llm`. Omit for deterministic gates.
- `subagent_calls` — how many subagent invocations this gate represents. Usually 1; the SCAN phase summary aggregate uses 5.
- `retries` — number of automatic retries this gate consumed. 0 by default.
- `resumed_from` — if this run-dir was resumed from a prior run (idempotency), set to the prior run-id; else null.

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

`subagent_calls` here is the sum across all subagents; `tokens_used` is the sum across all subagent calls; `retries` is the total retry count. This lets `make quality-clean` and budget enforcement work with a single `jq -s 'map(select(.gate == "phase_summary")) | ...'` pass.

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

The scanner runs locally and on developer laptops; we want zero infrastructure dependency. JSONL is grep-able, jq-able, and human-eyeballable. If we ever ship metrics to a real observability backend, a thin `telemetry-to-otlp.sh` converter can read this file — the schema is forward-compatible.
