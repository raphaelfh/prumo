---
status: accepted
last_reviewed: 2026-10-18
owner: '@raphaelfh'
adr_number: '0021'
---

# An `ai_run` grant for agent-started AI extraction runs

> **Status:** Accepted · Date: 2026-10-18 · Deciders: @raphaelfh
> **Amends:** 0020 · **Supersedes:** N/A · **Superseded by:** N/A

## Context and Problem Statement

ADR 0020 and ADR 0022 let a researcher's agent read a project and edit its
configuration over `/mcp`, with a `read` or `read_write` credential. Researchers
now want the same agent to start AI extraction for a set of articles when they
ask for it in chat, instead of switching to the app.

prumo already has a server-side batch path for AI extraction: a batch row, a
dispatcher that advances it item by item, the per-project engine and its
credential checks, and the kickoff role guard. What is missing is a credential
tier that may use that path, a project-level opt-in, and the controls that keep
an agent-started run inside what the researcher approved.

## Decision Drivers

- Off by default at every level: no existing token, connection or project gains
  the ability to start AI runs.
- Reuse the one batch start path and its guards; no second way to create a batch.
- The articles the researcher approved are exactly the articles that run.
- An agent-started run never spends the deployment's provider key.
- Every start and cancel is audited and labelled; a run can be stopped.

## Considered Options

- **A. A boolean `ai_run` grant beside the existing `scope`.** Chosen.
- **B. A `scopes text[]` column.** Rejected: it needs a data migration of every
  token row and breaks the REST token contract.
- **C. Combined enum values** (`read_ai_run`, `read_write_ai_run`). Rejected:
  the enum grows multiplicatively with each future grant.
- **D. `ai_run` implied by `read_write`.** Rejected: it silently widens every
  existing write credential.
- **E. A server-stored plan approved in the app.** Deferred (see R3).

## Decision Outcome

Chosen option: **A**, with the rulings below.

### R1 — Grant storage

`personal_access_tokens` gains a boolean `ai_run` column beside `scope`,
defaulting to false. The `/mcp` principal carries a scope set
`{read, write?, ai_run?}`. The valid shapes are `read`, `read + ai_run`,
`read_write` and `read_write + ai_run`. PAT and OAuth rows share the column.

### R2 — Role

At the choke point the `ai_run` tools require a reviewer-capable role, the same
role the REST kickoff requires (parity). Each project narrows it further with
its policy: `agent_runs = managers | reviewers`.

### R3 — Approval

Approval happens in chat. The agent first asks for a plan; the server returns
it with a signed plan token, and starting requires that token plus echoed
arguments, behind the host's approval prompt. In-app approval of a
server-stored plan is deferred.

### R4 — Deployment key

Agent-started runs never use the deployment's provider key. The plan reports
it, the start refuses it, and execution refuses it. There is no per-project
override in v1.

### R5 — Lifetime

A credential carrying `ai_run` lives at most 30 days, enforced by a database
CHECK constraint, for PATs and OAuth connections alike.

### R6 — Policy defaults

A project that opts in starts with a cap of 25 articles per run and 100
articles per project per rolling 24 hours. Agent runs are off until a manager
turns them on.

### R7 — Open-world hint

`start_ai_run` carries `openWorldHint: true`, because article text leaves prumo
for the AI provider. The pinned annotation contract test becomes an allowlist
holding that one tool.

### R8 — Engine-change kill switch

If the project's AI engine changes while an agent run is in progress, the run
stops at its next advance rather than continuing on an engine the researcher
did not approve.

### R9 — OAuth scope strings

OAuth uses the scope strings `read`, `write` and `ai_run`. Access tokens stay
audience-bound to `/mcp`. A connection is granted `ai_run` only when the client
requested it and the researcher ticked it on the consent page; the grant is
never widened on refresh.

### R10 — Reading runs

`get_ai_runs` needs only `read`: it returns the caller's own runs, which is
owner-only data.

### R11 — Prompt

prumo ships one `run_ai_extraction` prompt, visible only to credentials that
hold the grant. Low priority.

### R12 — Template publishing

Publishing a template stays a human action in the app. An unpublished template
is a plan blocker, not something the agent can resolve.

### R13 — Plan-token key

The plan token is an HMAC whose key is derived with HKDF from `ENCRYPTION_KEY`
(info `prumo:mcp:ai-run-plan:v1`). Minting a plan token is refused while that
key is the shipped placeholder outside local development.

## Annotation policy

- Reads are read-only, idempotent and closed-world.
- Configuration writes are non-destructive and closed-world, without a
  per-call user-interaction prompt.
- `start_ai_run` is the only destructive, open-world tool and the only one
  that requires user interaction.

## Amendment of the researcher MCP server design

The archived researcher MCP server design document is not edited; this ADR
records how its decisions change, and the live text is
`docs/how-to/connect-an-ai-agent.md`.

- Its §1 and §9 no longer exclude triggering AI runs. Writing extraction
  values from an agent stays out of scope.
- Its §3 gains the `ai_run` tier beside read and write.
- Its §5.0 rule "openWorldHint false on every tool" now has one exception,
  `start_ai_run`.
- Its §7 rule "no destructive tools" is replaced by the layered controls
  listed under Consequences.
- Its §9 rule "no prompts" now admits one grant-gated prompt.

## Consequences

- Intent rests on layers: the grant (off by default), the project policy (off
  by default), restrictive server guidance, the signed plan binding, the host's
  approval prompt, server-side caps, kill switches (token revoked or expired,
  policy withdrawn, engine changed) and the audit trail.
- Revoking a credential stops its queued agent work in the same transaction.
- Agent-started runs are labelled as such wherever runs are shown.
- A client that ignores the advisory annotations, holding a deliberately
  granted token in an opted-in project, can start a capped run without a fresh
  click. This is the accepted boundary: the run is bounded by the caps,
  stoppable and audited.

## More Information

- ADR 0020, personal access tokens for `/mcp`.
- ADR 0022, OAuth 2.1 for `/mcp`.
- `docs/how-to/connect-an-ai-agent.md`.
