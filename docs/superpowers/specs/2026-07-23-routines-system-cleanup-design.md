---
status: draft
last_reviewed: 2026-07-23
owner: '@raphaelfh'
---

# Routines system cleanup — design

> **Status:** Draft · Date: 2026-07-23 · Deciders: @raphaelfh
> **Scope:** the ten claude.ai scheduled cloud agents ("routines") pointed at
> `raphaelfh/prumo`, and the 43 open GitHub issues they produced. This spec
> retires eight of them, reshapes two, adds one, and liquidates the backlog.
> **Not in scope:** the repository's own CI workflows. Every retired routine's
> job is either already covered deterministically or explicitly dropped.

## Context

Ten routines run against `raphaelfh/prumo` from the claude.ai routines surface
(not from `.github/workflows/` — no workflow in this repo references Claude).
Eight are cron-driven, two are GitHub-event-driven. They were created between
2026-05-27 and 2026-06-11 to give a single-maintainer project a background
automation portfolio: bug hunting, dependency CVE sweeps, prod health checks,
migration-drift detection, flaky-test tracking, technical-debt cleanup, PR
review, and a watchdog over the whole set.

Exactly one of the ten delivers today. This spec establishes why, and what
replaces the rest.

## Problem — the evidence

### 1. Consumption collapsed; production did not

The last `auto-found` issue closed on **2026-06-06 — 47 days ago**. Production
continued at the same rate throughout.

| month | opened | closed | net | cumulative open |
|---|---|---|---|---|
| 2026-04 | 8 | 0 | +8 | 8 |
| 2026-05 | 80 | 59 | +21 | 29 |
| 2026-06 | 18 | 17 | +1 | 30 |
| 2026-07 | 13 | 0 | +13 | 43 |

The productive phase was 2026-05-16 to 2026-06-06: **69 issues closed as
`COMPLETED`** — real bugs, really fixed. That phase harvested a backlog of
pre-existing defects. Once harvested, the marginal value of each new finding
fell sharply while the production rate stayed constant.

Today: 43 open `auto-found` issues, **median age 40 days**, 27 older than 30
days, oldest 2026-05-18.

Open issues by producing routine:

| routine | open issues |
|---|---|
| `bug-watch` | 26 |
| `dep-vuln-sweep` | 12 |
| `system-health-check` | 3 |
| `flaky-test-tracker` | 1 |
| `routine-watchdog` | 1 |

### 2. The write path has never worked — the gate is not runnable in the sandbox

This is the deepest cause, and it splits the portfolio cleanly in two.

| pre-write gate | routines | delivery |
|---|---|---|
| none (read-only) | `pr-review`, `bug-watch`, `dep-vuln-sweep`, `system-health-check`, `migration-drift-detector`, `flaky-test-tracker`, `routine-watchdog` | all produce output |
| `make lint-backend && make test-backend` | `cleanup`, `bug-watch-write` | **zero, always** |

The correlation is exact across all ten. `cleanup` is the clean test case: it
has fired weekly since 2026-05-27 (most recently 2026-07-21), and

- no branch matching `cleanup/*` exists on the remote or in PR history;
- no PR in the repository was authored by it — the four cleanup-flavoured PRs
  (#320, #367, #402, #529) are all `author=raphaelfh`, from interactive
  sessions.

`make test-backend` resolves to `uv run pytest` — the **entire** suite,
including `backend/tests/integration/`, which requires a live local Supabase
plus applied Alembic migrations. The routine sandbox has neither; issue #186
documents that the same environment did not even have the `gh` CLI installed.
The gate goes red, and step 4 of the prompt aborts before the push.

Empirically the prompt's own abort path (`aborted=true reason=tests-failed`) is
the expected terminal state of every proactive run.

The consequence for this redesign: **"green PR before push" is unachievable as
currently specified.** Any routine that must pass the full suite in the sandbox
before writing will never write. The gate must be redefined to what the sandbox
can actually run, with CI on the resulting PR supplying the rest.

### 3. `cleanup` is invisible even to the watchdog

`cleanup` is the only routine whose prompt has no heartbeat step. It has posted
**zero** comments to the heartbeat log. That is why `routine-watchdog` reported
`healthy=6` on 2026-07-19 against eight cron routines — it counts what checks
in, and `cleanup` never checked in.

So the one routine with write capability has fired weekly for two months,
delivered nothing, reported nothing, and no part of the system noticed.

### 4. The bug hunt covered one seventh of its intended surface

`bug-watch` defines a seven-row scope table keyed on `DOW=$(date -u +%u)` — day
of week. Its cron is `0 6 * * 6`. It only ever fires on Saturday, so `DOW` is
always `6`, and the scope is always row 6:
`frontend/hooks/extraction/* + frontend/services/* + frontend/components/extraction/*`.

Backend services, API endpoints (the BOLA lens), models, schemas, migrations and
Celery tasks — rows 1 through 5 — **have never been scanned**. The open issues
confirm it: nearly all 26 carry `scope:hooks` on frontend extraction hooks.

### 5. All observability lives in a closed issue

Issue #171, titled *"🤖 Automation Heartbeat (do not close — routines check in
here)"*, was **closed as `NOT_PLANNED` on 2026-05-31, the same day it was
created**. Every heartbeat-posting routine still appends there — 149 comments —
and `routine-watchdog` still reads it successfully. But a closed issue appears
in no issue list. The system's only status surface has been invisible since day
one.

### 6. Both human gates in the design are never operated

Two routines are gated on a label a human must apply:

- `bug-watch-write` requires `auto-fix-approved`. Applied **twice** ever —
  issues #181 and #182, both synthetic trigger tests in May, both closed
  `NOT_PLANNED`.
- `cleanup`'s REACTIVE mode requires `tech-debt`. Applied **three times** ever
  (#161, #191, #197), one of them a synthetic test, and it produced no PR.

The only routine capable of converting a finding into code has never run on a
real finding.

### 7. The meta-alarm proved the bottleneck is attention, not detection

`routine-watchdog` correctly detected that `linear-enrich` was erroring and filed
#364 on 2026-06-21. That issue is **still open 32 days later**, and
`linear-enrich` still reports `error=mcp-unavailable` (2026-07-21, 07-22,
07-23). The watchdog did its job perfectly and changed nothing.

Same pattern elsewhere:

- **#186** (`flaky-test-tracker` cannot read CI logs) — open **52 days**.
- **#390** (`prod-incident`) — open 30 days with **28 daily dedup comments** from
  `system-health-check`, which re-alarms into it every day at 12:00 UTC.

Adding a detection layer on top of an unconsumed detection layer does not fix an
unconsumed detection layer.

### 8. Broken dependencies, some silent

Five routines declare MCP dependencies (Linear, Supabase, Vercel, Context7).
`linear-enrich` degrades loudly — `error=mcp-unavailable` on three consecutive
days. The others degrade silently: `system-health-check`'s daily "score" swinging
between 1 and 5 reads as connector instability rather than as prod actually
changing state.

Note that connector *availability* and connector *attachment* are different
things, and a tooling report claiming "no connected MCP connectors" is not
evidence that a routine's declared connection is dead — see the correction under
`pr-review` below.

### 9. Redundancy with cheaper deterministic gates

- `dep-vuln-sweep` (Mon 16:00 UTC) duplicates
  `.github/workflows/security-audit.yml` (Mon 06:23 UTC), which runs the same
  `pip-audit` and `npm audit` — and **blocks the PR**, while the routine only
  files an issue.
- `flaky-test-tracker` duplicates CI's own run history, and has been
  environmentally blind since #186.
- `migration-drift-detector` checks a condition the application already
  enforces at startup. `check_pending_migrations()` in
  `backend/app/main.py` runs inside the FastAPI `lifespan`, compares the
  database's current heads against the Alembic script heads, and
  `raise SystemExit(1)` on any pending revision. A deploy carrying an
  unapplied migration therefore **cannot boot**; `/health` never returns 200;
  and `post-deploy-smoke.yml` — which already gates on `/health` 200 after
  every push to `main` and every six hours — fails and emails the owner.
  Head drift is structurally impossible to miss. The routine's single true
  positive in two months (#185) was an `RLS_DIFF`, a different class.

### What actually works

One routine delivers: **`pr-review`**. It posts a `## Claude review` comment on
every PR — verified present on #543, #544, #545, #547, #552. High signal: the
#545 review correctly flagged a missing ADR for a dependency swap, confirmed the
exception-ordering fix as a genuine correctness improvement, and included a
per-incident-class sweep table.

It is also the only routine that is **read-only and delivers into the pull
request** — the two properties that turn out to matter.

### The pattern

Two independent failure modes, one shared shape:

- Routines that write must pass a gate the sandbox cannot run, so they never
  write.
- Routines that only read deliver into GitHub Issues — a queue the maintainer
  must decide to visit — and have a **0% consumption rate over seven weeks**.

`pr-review` avoids both: it reads, and it delivers into the flow the maintainer
already traverses.

## Decision

### The output contract

Every routine obeys one rule:

> A routine delivers **one reviewable artifact inside the pull-request flow, or
> nothing at all.**

Binding consequences:

- No routine may open a GitHub issue, write to a queue, or record a finding for
  later.
- No routine merges. Code-producing routines open a PR that is `ready-for-review`;
  the human performs the merge. This preserves the merge-train discipline in
  `CLAUDE.md` (one armed auto-merge at a time) and keeps human judgement at the
  only irreversible step.
- No routine writes to `backend/alembic/versions/`, `supabase/migrations/`,
  `.env*`, `.github/workflows/`, or any lock file.
- A routine with nothing worth delivering exits silently. Silence is a valid,
  expected outcome — not a failure to report.

### The verification gate, redefined

The pre-push gate is **what the sandbox can actually run**:

```bash
cd backend
uv run ruff check .
uv run ruff format --check .
uv run mypy app
uv run pytest tests/unit          # mocks Supabase; no live DB required
```

```bash
# only when TypeScript is touched
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npm run test:run
```

Explicitly **not** in the pre-push gate: `make test-backend`, any
`backend/tests/integration/` target, Playwright, or anything needing a live
Supabase, Redis or Docker.

The full suite still gates the change — it just runs **on the PR, in CI**, where
the infrastructure exists. The division of labour:

- the routine proves the change is *self-consistent* (lints, types, unit tests);
- CI proves it is *integrated* (integration, E2E, migrations, fitness);
- the human merges only on CI green.

"Green PR" in this spec means **sandbox-gate green at push time, CI green before
merge**. A routine that cannot get its own gate green does not push.

### The portfolio: three routines

| routine | trigger | model | output |
|---|---|---|---|
| `pr-review` | `pull_request` event | Sonnet | `## Claude review` comment on the PR |
| `bug-fix` | weekly, Saturday | Opus | one green ready PR, or nothing |
| `cleanup` | weekly, Tuesday | Opus | one green ready PR, or nothing |

Down from ten routines (two daily, six weekly, two event-driven) to three (two
weekly, one event-driven).

Both weekly routines are **unproven** and both run on probation — see
"Probation" below. Only `pr-review` carries a track record.

## Routine specifications

### `pr-review` — unchanged

Keep the existing configuration **verbatim, including its `Context7` MCP
connection**. It is a thin shell that defers all review knowledge to the
repository's committed
`.claude/skills/code-review/references/automated-pr-review.md`, which is the
correct design and is working.

**Correction, recorded because the mistake is instructive.** An earlier draft of
this spec dropped the `Context7` connection, on the premise that the account had
no connected MCP connectors — a premise taken from a stale tooling report. That
premise was false: creating `bug-fix` caused the API to auto-attach six
connectors (Vercel, Linear, Context7, Supabase, Buffer, Claude_Code_Remote)
without being asked, which proves they exist on the account.

The change was applied on 2026-07-24 at 01:22Z and reverted at 01:57Z after
`pr-review` failed to comment on PR #554 within 15 minutes, against a measured
historical latency of **2–4 minutes on every one of the six preceding PRs**.

The change is exonerated as the cause: at 02:06Z, with Context7 already restored,
`pr-review` was triggered manually and still produced nothing. The revert stands
on a principle regardless — do not modify the one component that works to tidy
it, especially on an unverified premise.

**But the silence was not a failure at all — corrected from the session
transcripts.** An earlier draft here concluded the silence was *platform-side
capacity* (a queue or run cap). That was **wrong**, and it was reached without
the one piece of evidence that settles it: the session transcripts at
`claude.ai/code`. They show all three routines ran correctly and were silent for
three distinct, deterministic, *correct* reasons:

| session | outcome | why silent — and why that is correct |
|---|---|---|
| `cleanup`, rewritten | `skip nothing-to-clean` | `backend/app/utils` is genuinely clean (42-LOC `rate_limiter.py` + 1-line `__init__.py`, no dead code, ruff clean). A valid no-op. |
| `bug-fix`, first run | `skip above-ceiling` | Found a **real high-confidence BOLA leak** in `articles_export.get_export_status`, then correctly withheld the fix — BOLA is outside the probation ceiling. |
| `pr-review`, on #554 | `skip` | The committed `automated-pr-review.md` contract skips `claude/*` branches without a `needs-review` label. #554 is exactly that. #553/#550/#549 were already reviewed (dedup). |

So the end-to-end verification this section had marked "incomplete" is **complete
and passing**. The three routines execute and produce correct outcomes. The lone
finding, the BOLA leak, became a real fix (PR #555). The `pr-review` "anomaly"
was a documented skip rule I failed to read before spending an hour chasing it —
recorded so the next reader checks the contract first.

**Two design facts the transcripts surfaced — both now resolved (2026-07-24
SOTA-hardening pass):**

1. **The probation ceiling blocked a real security fix → resolved by widening
   the ceiling.** `bug-fix` found the BOLA bug and, forbidden from fixing it,
   improvised a private notification — a side-channel *outside* the "a PR or
   nothing" contract. The ceiling exists to keep the unproven routine's changes
   low-amplitude, but a confirmed security fix is exactly the high-value, human-
   merged change that should reach a PR fast. The ceiling now permits **(a)** the
   four low-amplitude classes **plus (b)** confirmed security findings (BOLA /
   missing ownership or membership check, auth bypass, injection, secret/PII
   leak), under the same minimal-fix + regression-test + green-gate discipline.
   The side-channel is now explicitly forbidden: a finding that cannot become a
   PR is dropped.

2. **The `gh pr create` write path was unexercised and would have failed →
   resolved by routing all GitHub writes through MCP.** `gh` is not installed in
   the routine sandbox (issue #186, months ago). Both routines already adapted to
   GitHub **MCP** tools for their read/dedup steps, but their prompts still said
   `gh pr create` for the write step — which would have aborted the first run
   that actually found something, silently recreating the two-month
   never-produces-a-PR failure. Both prompts now open with a "GitHub access"
   section: `gh` is absent, use GitHub MCP for every GitHub operation (list,
   branch, commit, PR), and `git` is for local work only — do not assume
   `git push` has credentials. GitHub MCP is confirmed available in the sandbox
   (the transcripts show both routines calling it without any configured
   `mcp_connections`).

**Model currency (same pass).** A routine pinned to an aging model is a latent
burden — deprecation turns "works" into "silently broken". `cleanup` and
`bug-fix` are on `claude-opus-4-8[1m]` (current top tier, best at the subtle-bug
and dead-code judgement these do). `pr-review` was still on the prior-generation
`claude-sonnet-4-6`; it is bumped to `claude-sonnet-5` — a pure model-currency
change, prompt byte-identical, the single deliberate exception to "leave
`pr-review` alone", justified because model rot is precisely the burden this
directive targets. Like the other two routines this is unverified end to end
(the sandbox exposes no session output); the id is from the documented model
list, not a guess, and it is one field to revert.

**Caveat carried forward:** none of these three changes has been observed
completing a cloud run — the platform exposes no session output and a manual
trigger of `bug-fix`/`cleanup` currently skips (nothing new in scope; `pr-review`
skips `claude/*` PRs). The MCP write path in particular is proven for *reads* but
still unexercised for *PR creation*; the first scheduled run that finds something
is its first real test. If it aborts `reason=no-github-access` or fails to open a
PR, the MCP write flow is where to look.

### `bug-fix` — new; merges `bug-watch` and `bug-watch-write`

Replaces both retired routines and removes the `auto-fix-approved` human gate.

**Inherited from `bug-watch`:**

- The seven scope-and-lens rows (async/transaction boundaries; run-state TOCTOU;
  BOLA and envelope drift; external-API call sites; ORM/Pydantic drift; frontend
  extraction hooks; frontend runs/QA/HITL hooks).
- The dedup step, retargeted: it checks open PRs and recent commits, not the
  issue list.
- The test-driven identification step — `ruff`, `mypy`, `tsc`, `npm run lint` as
  candidate generators, with the hard rule that a candidate the routine cannot
  prove is dropped.

**Inherited from `bug-watch-write`:**

- Minimal correction at the cited `file:line`, no scope broadening.
- Exactly one regression test that fails without the fix (verified via
  `git stash`) and passes with it.
- `autofix_on_pr_create = true`, so the routine reacts to CI failures on its own
  PR.

**Changed:**

- **Gate replaced** with the sandbox gate above. This is the change that makes
  the write path possible at all.
- **Scope rotation fixed.** Scope selection uses the ISO week number,
  `SCOPE=$(( $(date -u +%V) % 7 ))`, not the day of week. Over seven weeks the
  routine covers all seven rows. Backend services, endpoints, models and
  migrations enter the rotation for the first time.
- **One bug per run, not five.** The routine picks the single highest-confidence
  finding and fixes it. With no provable finding it exits clean, opening nothing.
- **No issue is ever filed. No heartbeat comment.**

### `cleanup` — gate replaced, reactive mode dropped

Keep the core of the existing prompt, which is well-constructed: cold-module
selection, a mandatory anti-conflict gate against open PRs, a bounded change
budget (≤200 net LOC, ≤15 files), an explicit allowed/forbidden category list.

Changes:

- **Gate replaced** with the sandbox gate above — the fix for the zero-delivery
  history.
- `gh pr create --draft` becomes `gh pr create` (ready for review). Draft is the
  state that requires the maintainer to decide to visit it — the same failure
  mode this spec exists to remove.
- **REACTIVE mode dropped.** It is triggered by the `tech-debt` label, a human
  gate applied three times ever and never converted to a PR; it is also most of
  the prompt's complexity.
- **Module selection made total.** Today the predicate is "untouched in the last
  30 days", whose miss path is `skip=true reason=nothing-cold`. It becomes "the
  least-recently-touched module in the rotation list", which always returns a
  candidate. The anti-conflict gate against open PRs stays as the only skip path.

  (At the time of writing `backend/app/utils` has had zero commits in 30 days, so
  the old predicate was satisfiable — this change removes a latent skip path, it
  is not the fix for the zero-delivery history. The gate is.)

### Probation — both weekly routines

Neither weekly routine has ever produced a merged PR. Both carry the same
probation terms, fixed in advance:

- **Amplitude ceiling.** `bug-fix` is limited to low-amplitude defect classes —
  missing cancellation guards, swallowed errors, success paths firing on partial
  failure, missing cache invalidation. These are the classes the historical
  record shows `bug-watch` identifies reliably. `cleanup` keeps its existing
  category list.
- **Kill criterion.** After four scheduled runs each: if fewer than two of the
  four produced a PR the maintainer merged, the routine is deleted. The decision
  is made against that number, not against a fresh impression.

## What is retired

| routine | reason |
|---|---|
| `bug-watch` | merged into `bug-fix`; issue-filing violates the output contract |
| `bug-watch-write` | merged into `bug-fix`; its human gate was never operated |
| `dep-vuln-sweep` | duplicates `security-audit.yml`, which blocks instead of filing |
| `flaky-test-tracker` | blind since #186 (52 days); zero findings; CI holds the data |
| `system-health-check` | 30 days of daily alarms into #390 with no action taken |
| `linear-enrich` | broken 32 days; `analyzed=0`; Linear MCP unreachable |
| `migration-drift-detector` | head drift already blocked by `check_pending_migrations()` at startup and proven by `post-deploy-smoke.yml` |
| `routine-watchdog` | with three routines delivering into the PR flow, silence is self-evident |

**Operational constraint:** the routines API supports `enabled: false` but not
deletion. Retirement is therefore two steps — this work disables them via the
API; the maintainer deletes them at `https://claude.ai/code/routines`.

## What moves to deterministic tooling

Three retired jobs are already covered by deterministic tooling. **None of them
requires new work**, which is what makes the retirement safe:

- **Migration head drift** is enforced by `check_pending_migrations()` at
  application startup and proven on every deploy by `post-deploy-smoke.yml`'s
  `/health` probe. See §9. No CI step is added; adding one would duplicate a
  guarantee the application already provides.
- **Prod health** moves to native Railway, Vercel and Supabase alerting. Cheaper,
  more reliable, and it pages instead of filing.
- **CVE detection** is already covered by `security-audit.yml` and Dependabot.

**Residual gap, stated honestly:** nothing replaces the *schema-object* half of
`migration-drift-detector` — RLS policy divergence between the Alembic-declared
state and the live Supabase database, the class that produced #185. The startup
gate compares revision identifiers, not policies. This gap is accepted: one
occurrence in two months, and the routine that covered it filed into a queue that
was never read, so its practical detection value was already zero. If RLS drift
recurs, the right fix is a deterministic check in the migration round-trip suite,
not a weekly agent.

## Backlog liquidation — one-shot, not a routine

The 43 open `auto-found` issues are liquidated once, by hand, in this branch.
This is deliberately not automated: it is a single bounded job, and building a
routine for it would recreate the producer-without-consumer pattern.

Procedure per issue:

1. Verify the cited symptom against current `dev` HEAD.
2. **Obsolete** — close with evidence: the commit or PR that resolved it, or the
   grep showing the cited code no longer exists.
3. **Still real** — fix it, with a regression test, in a green PR.

Grouping: the 26 `bug-watch` issues concentrate on frontend extraction hooks and
repeat a small number of root-cause patterns (missing cancellation guards, toast
on partial failure, cache never invalidated). They are grouped by pattern into a
small number of PRs rather than one PR per issue.

The 12 `dep-vuln` issues are revalidated against the dependency sweep merged on
2026-07-21 (#522–#552) and against the standing ignores now encoded in
`dependabot.yml`; anything already decided there is closed citing that decision.

Exit condition: **zero open `auto-found` issues**, and the output contract keeps
the count at zero.

## Observability

The heartbeat and the watchdog are retired together. Issue #171 has been closed
since 2026-05-31; routines simply stop writing to it.

The new status surface is the pull-request list itself. `pr-review` is visible on
every PR the maintainer opens. `bug-fix` and `cleanup` produce a weekly PR or
they do not — and their absence is visible in the same place the maintainer
already works, without a dashboard, a heartbeat log, or a watchdog to read it.

This is a deliberate trade: the system loses the ability to distinguish "ran and
found nothing" from "did not run". Note that the trade is already the status quo
for the only write-capable routine — `cleanup` has never posted a heartbeat and
the watchdog never noticed it. The difference is that under the new contract a
silent week is *informative*, because the routine's selection step always returns
a candidate and its gate is one it can actually run.

## Success criteria

Measured at four weeks (2026-08-20):

- Open `auto-found` issues: **0**, and still 0.
- `bug-fix`: at least two of four runs produced a PR the maintainer merged.
  Below that, delete per the kill criterion.
- `cleanup`: at least two of four runs produced a PR the maintainer merged.
  Below that, delete per the kill criterion. Any number above zero is already a
  strict improvement on its entire history.
- `pr-review`: a review comment on every non-draft PR opened.
- No routine has filed a GitHub issue.

## Risks

- **The gate hypothesis could be incomplete.** The evidence for it is
  circumstantial but tight: an exact correlation across ten routines, a gate that
  provably requires infrastructure the sandbox lacks, and zero pushes in two
  months. A manual `Run now` of `cleanup` was executed on 2026-07-24 to observe
  the real abort point; its outcome is recorded in the implementation plan. If
  the abort has a different cause, the gate redefinition is still correct — the
  full suite genuinely cannot run there — but an additional fix may be needed.
- **`bug-fix` opens PRs that are green but not worth merging.** Mitigated by the
  amplitude ceiling and the kill criterion. The failure cost is bounded: one PR
  to close per week.
- **The newly-rotated scopes are unexplored ground.** Rows 1–5 have never been
  scanned, so the first passes over backend services and endpoints may surface
  findings above the probation ceiling. The routine files nothing in that case
  and the finding is lost. Accepted: the alternative is an issue queue, which
  this spec exists to remove.
- **Sandbox-green is weaker than suite-green.** PRs will reach the maintainer
  having passed only lints, types and unit tests. CI catches the rest, but review
  load per PR is slightly higher than if the routine had run everything.
- **RLS drift becomes undetected.** The startup gate covers revision identifiers,
  not policy bodies. Accepted and stated in "What moves to deterministic
  tooling"; the replacement, if ever needed, is a check in the migration
  round-trip suite.
- **Retiring `system-health-check` removes cross-provider aggregation** that
  native alerts do not offer. Accepted: the aggregation was consumed zero times
  in 30 days.

## Out of scope

- Reconnecting MCP connectors. No surviving routine needs one.
- Refreshing routine model identifiers to current names. Worth doing, but it is
  configuration hygiene, not part of this redesign.
- Any change to the repository's existing CI workflows. The investigation
  concluded that none is required — see "What moves to deterministic tooling".
