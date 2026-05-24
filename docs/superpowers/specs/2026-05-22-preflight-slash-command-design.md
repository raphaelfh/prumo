# `/preflight` slash command — design

**Status**: implemented in `.claude/commands/preflight.md`
**Date**: 2026-05-22 (updated 2026-05-24 for Render → Railway migration)

## Goal

A single `/preflight` slash command that runs the full pre-deploy
verification flow for prumo: local code-quality gates plus liveness
probes against the three remote services (Vercel, Supabase, Railway).
Output is a green/red gate report aligned with the
`verification-before-completion` skill's "evidence before claims" rule.

The command is **read-only**: it never deploys, never fixes, never
commits. It only reports whether the working tree is in a state where
shipping is safe.

## Non-goals

- Auto-fix lint/format/test failures.
- Trigger a deploy, run migrations, or push code.
- Block on advisor warnings (warnings are reported, not gating).
- Replace `/security-review` — preflight surfaces Supabase advisors,
  but a full secure-review is a separate command.

## Architecture

One orchestrator command file: `.claude/commands/preflight.md`. The
body dispatches four sub-agents in parallel via `Task` calls in a
single message:

| Sub-agent | Responsibility | Allowed tools |
|---|---|---|
| `local-code` | `make lint-backend` + `make db-lint-migrations` + `npm run lint` + `npm run build` | `Bash(make:*)`, `Bash(npm run:*)` |
| `local-tests` | `make test-backend` + `npm run test:run` + `npm run test:e2e:local` | `Bash(make:*)`, `Bash(npm run:*)` |
| `remote-supabase` | `get_advisors` (security + perf) + `list_migrations` (compared to local files under `supabase/migrations/`) + `get_logs` last 5min, error level | Supabase MCP read tools |
| `remote-deploys` | Vercel `list_deployments` → latest must be `READY` + `get_runtime_logs` last 15min + Render `curl /health` | Vercel MCP read tools + `Bash(curl:*)` |

Each sub-agent returns the same structured response:

```
status:   PASS | WARN | FAIL | UNKNOWN
summary:  <one-line human-readable>
evidence: <last 20 lines of the most relevant command output>
```

The orchestrator:

1. **Verifies the evidence is present.** If a sub-agent claims `PASS`
   without attached `evidence`, the orchestrator downgrades it to
   `UNKNOWN`. This implements the `verification-before-completion`
   red flag: "Trusting agent success reports".
2. Aggregates into a markdown table.
3. Prints `GREEN` / `GREEN with N warns` / `RED — N gates failed` as the
   final line.

## Arguments

```
/preflight [--local-only] [--remote-only]
```

- `--local-only` — skip the two remote sub-agents (offline use).
- `--remote-only` — skip the two local sub-agents (run after green CI).
- E2E is **not** opt-out-able. `preflight` is a deploy gate, not a
  per-commit hook; the user explicitly chose always-run.

## Failure model

| Condition | Result |
|---|---|
| Sub-agent timeout or crash | `UNKNOWN` (counts as failure) |
| Network failure on a remote sub-agent | `UNKNOWN`, not `FAIL` |
| Supabase advisor at `info` level | `WARN` |
| Supabase advisor at `warning` / `error` level | `FAIL` |
| Render `/health` ≠ HTTP 200 | `FAIL` |
| Vercel latest deployment `readyState != READY` | `FAIL` |
| Supabase MCP `list_migrations` count ≠ file count under `supabase/migrations/` | `FAIL` (auth/storage migration unapplied) |
| Alembic state is **not** directly checked — Render's startup command is `alembic upgrade head && gunicorn …`, so a failed Alembic migration makes `/health` time out and the Render gate fails on its own. |  |

Any `UNKNOWN` or `FAIL` → overall result is `RED`. `PASS`s with `WARN`s
→ `GREEN with N warns`. All `PASS` → `GREEN`.

## Tool gating

The frontmatter `allowed-tools` is the security boundary. It lists only:

- `Task` (sub-agent dispatch)
- `Bash(make:*)`, `Bash(npm run:*)`, `Bash(curl:*)`
- The three Supabase MCP **read** tools (`get_advisors`, `get_logs`,
  `list_migrations`)
- The three Vercel MCP **read** tools (`list_deployments`,
  `get_deployment`, `get_runtime_logs`)

No `Edit`, no `Write`, no general `Bash(*)`. Preflight cannot mutate
the repo while it runs.

## Decisions log

| Decision | Why |
|---|---|
| Sub-agents over single-pass orchestration | 2026 best practice; ~3× wall-clock improvement via parallelism; tool-gating granularity per agent |
| Sub-agents read-only | 2026 security pattern: defer all writes to parent — preflight never writes |
| E2E runs by default | User decision — preflight is a deploy gate, not a per-commit hook |
| Render via `curl /health`, not Render API | Render API needs an opt-in key; `/health` is sufficient for green/red |
| No auto-fix | A spec gate must be deterministic; auto-fix changes the working tree mid-check |
| `model: sonnet` | Parent must interpret Supabase advisors / Vercel runtime logs — non-trivial text analysis |

## Open questions

None at design time.

## References

- `verification-before-completion` skill — iron law and gate function.
- Claude Code Slash Commands 2026 best-practices research synthesis in
  the brainstorming thread that produced this spec.
- Existing `.claude/commands/speckit.plan.md` for the in-project
  frontmatter pattern (`description`, `handoffs`).
- `Makefile` targets `lint-backend`, `test-backend`, `db-lint-migrations`,
  `quality-scan`.
- `railway.toml`, `vercel.json`, and the Vercel + Supabase + Railway
  MCP servers configured for this project.
